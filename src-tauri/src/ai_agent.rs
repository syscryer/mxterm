use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::ai_assistant::{
    apply_anthropic_reasoning_fields, apply_openai_reasoning_fields, assess_command,
    ensure_provider_response, normalize_endpoint, provider_request_error, provider_stream_error,
    read_sse_events, stream_parse_error, AiAgentMode, AiApiFormat, AiCommandRisk, AiModelMessage,
    AiToolCallRecord, StoredAiProviderConfig, StreamEmitter, DEFAULT_ANTHROPIC_VERSION,
};
use crate::app_error::AppError;
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::ResolvedSshConfig;

const MAX_AGENT_ROUNDS: usize = 16;
const AGENT_MAX_TOKENS: u32 = 4096;
const DEFAULT_COMMAND_TIMEOUT_SECONDS: u64 = 60;
const MAX_COMMAND_TIMEOUT_SECONDS: u64 = 300;
const MAX_COMMAND_CHARS: usize = 8_000;
const MAX_MODEL_OUTPUT_CHARS: usize = 12_000;
const MAX_RECORD_OUTPUT_CHARS: usize = 4_000;
const DEFAULT_TERMINAL_OUTPUT_CHARS: u64 = 6_000;
const MIN_TERMINAL_OUTPUT_CHARS: u64 = 200;
const MAX_TERMINAL_OUTPUT_CHARS: u64 = 20_000;
const SERVER_MONITOR_TIMEOUT_SECONDS: u64 = 20;
const SERVER_MONITOR_COMMAND: &str = "printf '== hostname ==\\n'; hostname 2>/dev/null; printf '\\n== uptime ==\\n'; uptime 2>/dev/null; printf '\\n== memory ==\\n'; free -h 2>/dev/null; printf '\\n== disk ==\\n'; df -h 2>/dev/null | head -20";

pub(crate) const TOOL_RUN_COMMAND: &str = "run_command";
pub(crate) const TOOL_SERVER_MONITOR: &str = "server_monitor";
pub(crate) const TOOL_READ_TERMINAL_OUTPUT: &str = "read_terminal_output";

pub(crate) const TOOL_STATUS_PENDING_APPROVAL: &str = "pending_approval";
pub(crate) const TOOL_STATUS_RUNNING: &str = "running";
pub(crate) const TOOL_STATUS_COMPLETED: &str = "completed";
pub(crate) const TOOL_STATUS_FAILED: &str = "failed";
pub(crate) const TOOL_STATUS_REJECTED: &str = "rejected";
pub(crate) const TOOL_STATUS_CANCELLED: &str = "cancelled";

pub(crate) type PendingApprovals = Arc<StdMutex<HashMap<String, oneshot::Sender<bool>>>>;

pub(crate) struct PreparedAgent {
    pub config: ResolvedSshConfig,
    pub mode: AiAgentMode,
    pub working_directory: Option<String>,
    pub terminal_output: Option<String>,
}

pub(crate) struct AgentRun<'a> {
    pub app: &'a AppHandle,
    pub provider: &'a StoredAiProviderConfig,
    pub api_key: &'a str,
    pub agent: &'a PreparedAgent,
    pub pool: &'a RemoteExecSessionPool,
    pub stopped: Arc<AtomicBool>,
    pub content: Arc<StdMutex<String>>,
    pub tool_calls: Arc<StdMutex<Vec<AiToolCallRecord>>>,
    pub approvals: PendingApprovals,
    pub emitter: &'a StreamEmitter,
    pub pending_separator: AtomicBool,
    pub reasoning_level: Option<&'a str>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Default)]
pub(crate) struct AgentTurn {
    pub text: String,
    pub tool_calls: Vec<AgentToolCall>,
}

#[derive(Debug)]
struct ToolOutcome {
    content: String,
    is_error: bool,
}

#[derive(Default)]
struct TurnAccumulator {
    text: String,
    tools: BTreeMap<usize, AgentToolCall>,
}

#[derive(Deserialize)]
struct RunCommandArgs {
    command: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

#[derive(Default, Deserialize)]
struct ReadTerminalOutputArgs {
    #[serde(default)]
    max_chars: Option<u64>,
}

struct AgentConversation {
    format: AiApiFormat,
    messages: Vec<Value>,
}

pub(crate) async fn run_agent(
    run: &AgentRun<'_>,
    history: Vec<AiModelMessage>,
) -> Result<(), AppError> {
    let client = Client::new();
    let system = agent_system_prompt(run.agent);
    let mut conversation = AgentConversation::new(run.provider.api_format, history);
    for _ in 0..MAX_AGENT_ROUNDS {
        let turn = run_turn(
            &client,
            run.provider,
            run.api_key,
            run.reasoning_level,
            &system,
            &conversation.messages,
            Arc::clone(&run.stopped),
            |delta| run.push_text(delta),
        )
        .await?;
        if run.is_stopped() || turn.tool_calls.is_empty() {
            return Ok(());
        }
        conversation.push_assistant_turn(&turn);
        let mut results = Vec::with_capacity(turn.tool_calls.len());
        for call in &turn.tool_calls {
            if run.is_stopped() {
                return Ok(());
            }
            let outcome = run.execute_tool(call).await;
            results.push((call.clone(), outcome));
        }
        conversation.push_tool_results(&results);
        run.pending_separator.store(true, Ordering::SeqCst);
    }
    run.push_text(format!(
        "\n\n> 已达到单次回复最多 {MAX_AGENT_ROUNDS} 轮工具调用，如需继续排查请再次提问。"
    ));
    Ok(())
}

impl AgentRun<'_> {
    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn push_text(&self, delta: String) {
        if delta.is_empty() {
            return;
        }
        let delta = if self.pending_separator.swap(false, Ordering::SeqCst) {
            let needs_break = self
                .content
                .lock()
                .map(|content| !content.is_empty() && !content.ends_with("\n\n"))
                .unwrap_or(false);
            if needs_break {
                format!("\n\n{}", delta.trim_start_matches('\n'))
            } else {
                delta
            }
        } else {
            delta
        };
        if let Ok(mut content) = self.content.lock() {
            content.push_str(&delta);
        }
        self.emitter.chunk(delta);
    }

    fn text_offset(&self) -> usize {
        self.content
            .lock()
            .map(|content| content.chars().count())
            .unwrap_or(0)
    }

    fn upsert_tool_call(&self, record: &AiToolCallRecord) {
        if let Ok(mut calls) = self.tool_calls.lock() {
            match calls.iter_mut().find(|item| item.id == record.id) {
                Some(existing) => *existing = record.clone(),
                None => calls.push(record.clone()),
            }
        }
        self.emitter.tool_call(record.clone());
    }

    fn fail_tool(&self, mut record: AiToolCallRecord, message: String) -> ToolOutcome {
        record.status = TOOL_STATUS_FAILED.to_string();
        record.error = Some(message.clone());
        self.upsert_tool_call(&record);
        ToolOutcome {
            content: format!("工具执行失败：{message}"),
            is_error: true,
        }
    }

    async fn execute_tool(&self, call: &AgentToolCall) -> ToolOutcome {
        let record = AiToolCallRecord::new(&call.id, &call.name, self.text_offset());
        match call.name.as_str() {
            TOOL_RUN_COMMAND => self.run_command_tool(call, record).await,
            TOOL_SERVER_MONITOR => {
                let mut record = record;
                record.command = Some(SERVER_MONITOR_COMMAND.to_string());
                record.risk = Some(AiCommandRisk::Safe);
                self.exec_tool(
                    record,
                    SERVER_MONITOR_COMMAND.to_string(),
                    Duration::from_secs(SERVER_MONITOR_TIMEOUT_SECONDS),
                )
                .await
            }
            TOOL_READ_TERMINAL_OUTPUT => self.read_terminal_output_tool(call, record),
            other => self.fail_tool(record, format!("未知工具：{other}")),
        }
    }

    async fn run_command_tool(
        &self,
        call: &AgentToolCall,
        mut record: AiToolCallRecord,
    ) -> ToolOutcome {
        let (command, limit) = match parse_run_command_args(&call.arguments) {
            Ok(parsed) => parsed,
            Err(message) => return self.fail_tool(record, message),
        };
        let assessment = assess_command(&command);
        record.command = Some(command.clone());
        record.risk = Some(assessment.risk);
        record.reasons = assessment.reasons;
        if assessment.risk == AiCommandRisk::Dangerous {
            if self.agent.mode == AiAgentMode::Assist {
                record.status = TOOL_STATUS_REJECTED.to_string();
                self.upsert_tool_call(&record);
                return ToolOutcome {
                    content: "辅助排查模式不会执行高风险命令。请改用只读排查命令，或切换到执行模式后再请求该操作。"
                        .to_string(),
                    is_error: false,
                };
            }
            if self.agent.mode != AiAgentMode::Full {
                record.status = TOOL_STATUS_PENDING_APPROVAL.to_string();
                let (sender, receiver) = oneshot::channel();
                if let Ok(mut approvals) = self.approvals.lock() {
                    approvals.insert(record.id.clone(), sender);
                }
                self.upsert_tool_call(&record);
                let approved = receiver.await.unwrap_or(false);
                if let Ok(mut approvals) = self.approvals.lock() {
                    approvals.remove(&record.id);
                }
                if !approved {
                    record.status = TOOL_STATUS_REJECTED.to_string();
                    self.upsert_tool_call(&record);
                    return ToolOutcome {
                        content: "用户拒绝执行该命令。不要重复提交同一命令，请改用更安全的方案，或先向用户说明原因和影响。"
                            .to_string(),
                        is_error: false,
                    };
                }
            }
        }
        self.exec_tool(record, command, limit).await
    }

    async fn exec_tool(
        &self,
        mut record: AiToolCallRecord,
        command: String,
        limit: Duration,
    ) -> ToolOutcome {
        record.status = TOOL_STATUS_RUNNING.to_string();
        self.upsert_tool_call(&record);
        let script =
            command_with_working_directory(&command, self.agent.working_directory.as_deref());
        let started = Instant::now();
        let result = timeout(
            limit,
            self.pool.exec(
                self.app,
                &self.agent.config,
                &script,
                RemoteExecRetry::ReconnectOnce,
            ),
        )
        .await;
        record.duration_ms = Some(started.elapsed().as_millis() as u64);
        let output = match result {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => return self.fail_tool(record, error.message),
            Err(_) => {
                self.pool
                    .invalidate_connection_detached(&self.agent.config.connection_id)
                    .await;
                return self.fail_tool(
                    record,
                    format!("命令执行超时（{} 秒），已断开该执行通道。", limit.as_secs()),
                );
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let (preview, preview_truncated) = tail_chars(
            &combine_output_preview(&stdout, &stderr),
            MAX_RECORD_OUTPUT_CHARS,
        );
        record.status = TOOL_STATUS_COMPLETED.to_string();
        record.exit_status = output.exit_status;
        record.output = preview;
        record.output_truncated = preview_truncated;
        let content = format_command_output_for_model(
            output.exit_status,
            record.duration_ms.unwrap_or_default(),
            &stdout,
            &stderr,
        );
        self.upsert_tool_call(&record);
        ToolOutcome {
            content,
            is_error: false,
        }
    }

    fn read_terminal_output_tool(
        &self,
        call: &AgentToolCall,
        mut record: AiToolCallRecord,
    ) -> ToolOutcome {
        let max_chars = match parse_read_terminal_output_args(&call.arguments) {
            Ok(value) => value,
            Err(message) => return self.fail_tool(record, message),
        };
        let snapshot = self
            .agent
            .terminal_output
            .as_deref()
            .map(str::trim)
            .unwrap_or_default();
        let content = if snapshot.is_empty() {
            "当前没有可用的终端输出快照。".to_string()
        } else {
            let (tail, truncated) = tail_chars(snapshot, max_chars);
            if truncated {
                format!("[仅保留最后 {max_chars} 字]\n{tail}")
            } else {
                tail
            }
        };
        let (preview, preview_truncated) = tail_chars(&content, MAX_RECORD_OUTPUT_CHARS);
        record.status = TOOL_STATUS_COMPLETED.to_string();
        record.output = preview;
        record.output_truncated = preview_truncated;
        self.upsert_tool_call(&record);
        ToolOutcome {
            content,
            is_error: false,
        }
    }
}

impl AgentConversation {
    fn new(format: AiApiFormat, history: Vec<AiModelMessage>) -> Self {
        Self {
            format,
            messages: history
                .into_iter()
                .filter(|message| message.role != "system")
                .map(|message| json!({ "role": message.role, "content": message.content }))
                .collect(),
        }
    }

    fn push_assistant_turn(&mut self, turn: &AgentTurn) {
        let message = match self.format {
            AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => json!({
                "role": "assistant",
                "content": if turn.text.is_empty() { Value::Null } else { Value::String(turn.text.clone()) },
                "tool_calls": turn
                    .tool_calls
                    .iter()
                    .map(|call| json!({
                        "id": call.id,
                        "type": "function",
                        "function": { "name": call.name, "arguments": call.arguments },
                    }))
                    .collect::<Vec<_>>(),
            }),
            AiApiFormat::Anthropic => {
                let mut content = Vec::new();
                if !turn.text.trim().is_empty() {
                    content.push(json!({ "type": "text", "text": turn.text }));
                }
                content.extend(turn.tool_calls.iter().map(|call| {
                    json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": parse_tool_input(&call.arguments),
                    })
                }));
                json!({ "role": "assistant", "content": content })
            }
        };
        self.messages.push(message);
    }

    fn push_tool_results(&mut self, results: &[(AgentToolCall, ToolOutcome)]) {
        match self.format {
            AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => {
                self.messages.extend(results.iter().map(|(call, outcome)| {
                    json!({ "role": "tool", "tool_call_id": call.id, "content": outcome.content })
                }));
            }
            AiApiFormat::Anthropic => {
                let content = results
                    .iter()
                    .map(|(call, outcome)| {
                        json!({
                            "type": "tool_result",
                            "tool_use_id": call.id,
                            "content": outcome.content,
                            "is_error": outcome.is_error,
                        })
                    })
                    .collect::<Vec<_>>();
                self.messages
                    .push(json!({ "role": "user", "content": content }));
            }
        }
    }
}

impl TurnAccumulator {
    fn apply_openai_event(&mut self, data: &str) -> Result<(bool, String), AppError> {
        if data == "[DONE]" {
            return Ok((true, String::new()));
        }
        let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
        if let Some(error) = value.get("error") {
            return Err(provider_stream_error(error));
        }
        let Some(delta) = value.pointer("/choices/0/delta") else {
            return Ok((false, String::new()));
        };
        let text = delta
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.text.push_str(&text);
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for (position, call) in calls.iter().enumerate() {
                let index = call
                    .get("index")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)
                    .unwrap_or(position);
                let entry = self.tools.entry(index).or_default();
                if let Some(id) = call.get("id").and_then(Value::as_str) {
                    if !id.is_empty() {
                        entry.id = id.to_string();
                    }
                }
                if let Some(function) = call.get("function") {
                    if let Some(name) = function.get("name").and_then(Value::as_str) {
                        if !name.is_empty() && entry.name.is_empty() {
                            entry.name = name.to_string();
                        }
                    }
                    if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                        entry.arguments.push_str(arguments);
                    }
                }
            }
        }
        Ok((false, text))
    }

    fn apply_anthropic_event(&mut self, data: &str) -> Result<(bool, String), AppError> {
        if data == "[DONE]" {
            return Ok((true, String::new()));
        }
        let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
        let index = value
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(0);
        let mut text = String::new();
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "content_block_start" => {
                let block = value.get("content_block").cloned().unwrap_or(Value::Null);
                match block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "text" => {
                        text = block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                    }
                    "tool_use" => {
                        let arguments = block
                            .get("input")
                            .filter(|input| input.as_object().is_some_and(|map| !map.is_empty()))
                            .map(Value::to_string)
                            .unwrap_or_default();
                        self.tools.insert(
                            index,
                            AgentToolCall {
                                id: block
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                arguments,
                            },
                        );
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let delta = value.get("delta").cloned().unwrap_or(Value::Null);
                match delta
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "input_json_delta" => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        self.tools
                            .entry(index)
                            .or_default()
                            .arguments
                            .push_str(partial);
                    }
                    _ => {
                        text = delta
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                    }
                }
            }
            "message_stop" => return Ok((true, String::new())),
            "error" => return Err(provider_stream_error(&value)),
            _ => {}
        }
        self.text.push_str(&text);
        Ok((false, text))
    }

    fn finish(self) -> AgentTurn {
        let tool_calls = self
            .tools
            .into_values()
            .filter(|call| !call.name.trim().is_empty())
            .map(|mut call| {
                if call.id.trim().is_empty() {
                    call.id = format!("call_{}", Uuid::new_v4().simple());
                }
                if call.arguments.trim().is_empty() {
                    call.arguments = "{}".to_string();
                }
                call
            })
            .collect();
        AgentTurn {
            text: self.text,
            tool_calls,
        }
    }
}

async fn run_turn<F>(
    client: &Client,
    provider: &StoredAiProviderConfig,
    api_key: &str,
    reasoning_level: Option<&str>,
    system: &str,
    messages: &[Value],
    stopped: Arc<AtomicBool>,
    mut on_delta: F,
) -> Result<AgentTurn, AppError>
where
    F: FnMut(String),
{
    let endpoint = normalize_endpoint(&provider.endpoint, provider.api_format)?;
    let request = match provider.api_format {
        AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => {
            let mut all_messages = Vec::with_capacity(messages.len() + 1);
            all_messages.push(json!({ "role": "system", "content": system }));
            all_messages.extend(messages.iter().cloned());
            let mut body = json!({
                "model": provider.model,
                "stream": true,
                "messages": all_messages,
                "tools": openai_tool_definitions(),
            });
            apply_openai_reasoning_fields(&mut body, reasoning_level);
            client.post(endpoint).bearer_auth(api_key).json(&body)
        }
        AiApiFormat::Anthropic => {
            let mut body = json!({
                "model": provider.model,
                "stream": true,
                "max_tokens": AGENT_MAX_TOKENS,
                "system": system,
                "messages": messages,
                "tools": anthropic_tool_definitions(),
            });
            apply_anthropic_reasoning_fields(&mut body, reasoning_level, AGENT_MAX_TOKENS);
            client
                .post(endpoint)
                .header("x-api-key", api_key)
                .header("anthropic-version", DEFAULT_ANTHROPIC_VERSION)
                .json(&body)
        }
    };
    let response = request.send().await.map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    let format = provider.api_format;
    let mut accumulator = TurnAccumulator::default();
    read_sse_events(response, stopped, |data| {
        let (done, delta) = match format {
            AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => {
                accumulator.apply_openai_event(data)?
            }
            AiApiFormat::Anthropic => accumulator.apply_anthropic_event(data)?,
        };
        if !delta.is_empty() {
            on_delta(delta);
        }
        Ok(done)
    })
    .await?;
    Ok(accumulator.finish())
}

fn tool_specs() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        (
            TOOL_RUN_COMMAND,
            "在用户当前选中的 SSH 主机上以非交互方式执行一条 shell 命令，返回退出码、stdout 和 stderr。命令走独立的 exec 通道，不是用户正在使用的终端，不共享其环境变量、sudo 凭据和 shell 状态。",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的 shell 命令" },
                    "timeout_seconds": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_COMMAND_TIMEOUT_SECONDS,
                        "description": "超时秒数，默认 60"
                    }
                },
                "required": ["command"]
            }),
        ),
        (
            TOOL_SERVER_MONITOR,
            "只读获取主机名、运行时间与负载、内存和磁盘使用概况。",
            json!({ "type": "object", "properties": {} }),
        ),
        (
            TOOL_READ_TERMINAL_OUTPUT,
            "只读获取用户发送本条消息时当前终端最近输出的快照；快照不会随后续执行刷新。",
            json!({
                "type": "object",
                "properties": {
                    "max_chars": {
                        "type": "integer",
                        "minimum": MIN_TERMINAL_OUTPUT_CHARS,
                        "maximum": MAX_TERMINAL_OUTPUT_CHARS,
                        "description": "最多返回的末尾字符数，默认 6000"
                    }
                }
            }),
        ),
    ]
}

fn openai_tool_definitions() -> Value {
    Value::Array(
        tool_specs()
            .into_iter()
            .map(|(name, description, parameters)| {
                json!({
                    "type": "function",
                    "function": { "name": name, "description": description, "parameters": parameters },
                })
            })
            .collect(),
    )
}

fn anthropic_tool_definitions() -> Value {
    Value::Array(
        tool_specs()
            .into_iter()
            .map(|(name, description, input_schema)| {
                json!({ "name": name, "description": description, "input_schema": input_schema })
            })
            .collect(),
    )
}

fn agent_system_prompt(agent: &PreparedAgent) -> String {
    let directory = agent
        .working_directory
        .as_deref()
        .unwrap_or("未知（命令将在登录用户的默认目录执行）");
    let terminal_snapshot = if agent
        .terminal_output
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        "可用"
    } else {
        "不可用"
    };
    format!(
        "你是 mXterm 内置的终端运维助手，当前处于「执行命令」模式，可以通过工具在用户选中的 SSH 主机上执行命令。\n\
当前终端目录：{directory}\n\
终端输出快照：{terminal_snapshot}\n\n\
工具说明：\n\
- run_command：在该主机上以非交互方式执行一条 shell 命令。它使用独立的 exec 通道，不是用户正在使用的终端；若当前目录已知，会先进入该目录。\n\
- server_monitor：只读获取主机负载、内存、磁盘概况。\n\
- read_terminal_output：读取用户发送消息时终端最近输出的快照。\n\n\
执行规则：\n\
1. 先用只读命令收集事实再下结论，不要臆测命令输出。\n\
2. 不要运行交互式或常驻命令（vim、top、less、tail -f、watch 等），改用有限输出的写法（top -bn1、tail -n 200、journalctl -n 200 --no-pager）。\n\
3. 不要执行需要输入密码的命令（例如需要密码的 sudo）；如需提权，先向用户说明。\n\
4. 修改配置、删除数据、重启服务等操作前先说明目的和影响；这类命令会交给用户确认，被拒绝时换方案或询问用户。\n\
5. 控制输出量（配合 head、tail、grep），每条命令保持简短、可验证。\n\
6. 最后用中文总结发现、原因和建议；不要声称执行过工具结果里没有的命令。"
    )
}

fn parse_run_command_args(arguments: &str) -> Result<(String, Duration), String> {
    let args: RunCommandArgs = serde_json::from_str(arguments)
        .map_err(|error| format!("run_command 参数无效：{error}"))?;
    let command = args.command.trim().to_string();
    if command.is_empty() {
        return Err("run_command 缺少要执行的命令。".to_string());
    }
    if command.chars().count() > MAX_COMMAND_CHARS {
        return Err(format!("命令超过 {MAX_COMMAND_CHARS} 字，请拆分后执行。"));
    }
    let seconds = args
        .timeout_seconds
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_SECONDS);
    if !(1..=MAX_COMMAND_TIMEOUT_SECONDS).contains(&seconds) {
        return Err(format!(
            "timeout_seconds 必须在 1 到 {MAX_COMMAND_TIMEOUT_SECONDS} 之间，当前为 {seconds}。"
        ));
    }
    Ok((command, Duration::from_secs(seconds)))
}

fn parse_read_terminal_output_args(arguments: &str) -> Result<usize, String> {
    let args: ReadTerminalOutputArgs = serde_json::from_str(arguments)
        .map_err(|error| format!("read_terminal_output 参数无效：{error}"))?;
    let max_chars = args.max_chars.unwrap_or(DEFAULT_TERMINAL_OUTPUT_CHARS);
    if !(MIN_TERMINAL_OUTPUT_CHARS..=MAX_TERMINAL_OUTPUT_CHARS).contains(&max_chars) {
        return Err(format!(
            "max_chars 必须在 {MIN_TERMINAL_OUTPUT_CHARS} 到 {MAX_TERMINAL_OUTPUT_CHARS} 之间，当前为 {max_chars}。"
        ));
    }
    Ok(max_chars as usize)
}

fn parse_tool_input(arguments: &str) -> Value {
    serde_json::from_str::<Value>(arguments)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn command_with_working_directory(command: &str, directory: Option<&str>) -> String {
    let Some(directory) = directory.map(str::trim).filter(|value| !value.is_empty()) else {
        return command.to_string();
    };
    let target = if directory == "~" {
        "~".to_string()
    } else if let Some(rest) = directory.strip_prefix("~/") {
        format!("~/{}", quote_posix_shell(rest))
    } else {
        quote_posix_shell(directory)
    };
    format!("cd {target} || exit 1\n{command}")
}

fn tail_chars(value: &str, max_chars: usize) -> (String, bool) {
    let total = value.chars().count();
    if total <= max_chars {
        return (value.to_string(), false);
    }
    (value.chars().skip(total - max_chars).collect(), true)
}

fn combine_output_preview(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim_end();
    let stderr = stderr.trim_end();
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout}\n[stderr]\n{stderr}"),
    }
}

fn format_output_section(label: &str, value: &str) -> String {
    let trimmed = value.trim_end();
    if trimmed.is_empty() {
        return format!("{label}: (空)");
    }
    let (tail, truncated) = tail_chars(trimmed, MAX_MODEL_OUTPUT_CHARS);
    if truncated {
        format!("{label}（输出过长，仅保留最后 {MAX_MODEL_OUTPUT_CHARS} 字）:\n{tail}")
    } else {
        format!("{label}:\n{tail}")
    }
}

fn format_command_output_for_model(
    exit_status: Option<u32>,
    duration_ms: u64,
    stdout: &str,
    stderr: &str,
) -> String {
    let exit = exit_status
        .map(|value| value.to_string())
        .unwrap_or_else(|| "未知".to_string());
    format!(
        "exit_status: {exit}\nduration_ms: {duration_ms}\n{}\n{}",
        format_output_section("stdout", stdout),
        format_output_section("stderr", stderr)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_stream_accumulates_text_and_split_tool_call_arguments() {
        let mut accumulator = TurnAccumulator::default();
        let events = [
            r#"{"choices":[{"delta":{"content":"先看磁盘"}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run_command","arguments":"{\"comm"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"and\":\"df -h\"}"}}]}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ];
        let mut deltas = Vec::new();
        for event in events {
            let (done, delta) = accumulator.apply_openai_event(event).unwrap();
            assert!(!done);
            if !delta.is_empty() {
                deltas.push(delta);
            }
        }
        assert!(accumulator.apply_openai_event("[DONE]").unwrap().0);
        let turn = accumulator.finish();
        assert_eq!(deltas, vec!["先看磁盘".to_string()]);
        assert_eq!(turn.text, "先看磁盘");
        assert_eq!(
            turn.tool_calls,
            vec![AgentToolCall {
                id: "call_1".to_string(),
                name: "run_command".to_string(),
                arguments: r#"{"command":"df -h"}"#.to_string(),
            }]
        );
    }

    #[test]
    fn anthropic_stream_accumulates_tool_use_input_json() {
        let mut accumulator = TurnAccumulator::default();
        let events = [
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"检查中"}}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"server_monitor","input":{}}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#,
        ];
        for event in events {
            assert!(!accumulator.apply_anthropic_event(event).unwrap().0);
        }
        assert!(
            accumulator
                .apply_anthropic_event(r#"{"type":"message_stop"}"#)
                .unwrap()
                .0
        );
        let turn = accumulator.finish();
        assert_eq!(turn.text, "检查中");
        assert_eq!(turn.tool_calls.len(), 1);
        assert_eq!(turn.tool_calls[0].id, "toolu_1");
        assert_eq!(turn.tool_calls[0].name, "server_monitor");
        assert_eq!(turn.tool_calls[0].arguments, "{}");
    }

    #[test]
    fn stream_error_payloads_fail_the_turn() {
        let mut accumulator = TurnAccumulator::default();
        assert!(accumulator
            .apply_openai_event(r#"{"error":{"message":"bad"}}"#)
            .is_err());
        assert!(accumulator
            .apply_anthropic_event(r#"{"type":"error","error":{"message":"overloaded"}}"#)
            .is_err());
    }

    #[test]
    fn tool_calls_without_ids_get_generated_ids() {
        let mut accumulator = TurnAccumulator::default();
        accumulator
            .apply_openai_event(
                r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"server_monitor","arguments":""}}]}}]}"#,
            )
            .unwrap();
        let turn = accumulator.finish();
        assert!(turn.tool_calls[0].id.starts_with("call_"));
        assert_eq!(turn.tool_calls[0].arguments, "{}");
    }

    #[test]
    fn run_command_args_validate_command_and_timeout_without_clamping() {
        let (command, limit) = parse_run_command_args(r#"{"command":"  uptime  "}"#).unwrap();
        assert_eq!(command, "uptime");
        assert_eq!(limit.as_secs(), DEFAULT_COMMAND_TIMEOUT_SECONDS);
        assert_eq!(
            parse_run_command_args(r#"{"command":"ls","timeout_seconds":300}"#)
                .unwrap()
                .1
                .as_secs(),
            300
        );
        assert!(parse_run_command_args(r#"{"command":"ls","timeout_seconds":301}"#).is_err());
        assert!(parse_run_command_args(r#"{"command":"ls","timeout_seconds":0}"#).is_err());
        assert!(parse_run_command_args(r#"{"command":"ls","timeout_seconds":"60"}"#).is_err());
        assert!(parse_run_command_args(r#"{"command":"   "}"#).is_err());
        assert!(parse_run_command_args("not-json").is_err());
    }

    #[test]
    fn read_terminal_output_args_reject_out_of_range_values() {
        assert_eq!(parse_read_terminal_output_args("{}").unwrap(), 6_000);
        assert_eq!(
            parse_read_terminal_output_args(r#"{"max_chars":200}"#).unwrap(),
            200
        );
        assert!(parse_read_terminal_output_args(r#"{"max_chars":199}"#).is_err());
        assert!(parse_read_terminal_output_args(r#"{"max_chars":20001}"#).is_err());
    }

    #[test]
    fn working_directory_prefix_quotes_paths_and_keeps_home_expansion() {
        assert_eq!(command_with_working_directory("ls", None), "ls");
        assert_eq!(command_with_working_directory("ls", Some("  ")), "ls");
        assert_eq!(
            command_with_working_directory("ls", Some("/var/log")),
            "cd '/var/log' || exit 1\nls"
        );
        assert_eq!(
            command_with_working_directory("ls", Some("~")),
            "cd ~ || exit 1\nls"
        );
        assert_eq!(
            command_with_working_directory("ls", Some("~/my app")),
            "cd ~/'my app' || exit 1\nls"
        );
        assert_eq!(
            command_with_working_directory("ls", Some("/tmp/it's")),
            "cd '/tmp/it'\\''s' || exit 1\nls"
        );
    }

    #[test]
    fn conversation_replays_tool_turns_in_provider_shape() {
        let turn = AgentTurn {
            text: "先看负载".to_string(),
            tool_calls: vec![AgentToolCall {
                id: "call_1".to_string(),
                name: "run_command".to_string(),
                arguments: r#"{"command":"uptime"}"#.to_string(),
            }],
        };
        let outcome = ToolOutcome {
            content: "exit_status: 0".to_string(),
            is_error: false,
        };

        let mut openai = AgentConversation::new(AiApiFormat::OpenaiCompatible, Vec::new());
        openai.push_assistant_turn(&turn);
        openai.push_tool_results(&[(turn.tool_calls[0].clone(), outcome)]);
        assert_eq!(
            openai.messages[0]["tool_calls"][0]["function"]["name"],
            "run_command"
        );
        assert_eq!(openai.messages[1]["role"], "tool");
        assert_eq!(openai.messages[1]["tool_call_id"], "call_1");

        let outcome = ToolOutcome {
            content: "失败".to_string(),
            is_error: true,
        };
        let mut anthropic = AgentConversation::new(AiApiFormat::Anthropic, Vec::new());
        anthropic.push_assistant_turn(&turn);
        anthropic.push_tool_results(&[(turn.tool_calls[0].clone(), outcome)]);
        assert_eq!(anthropic.messages[0]["content"][1]["type"], "tool_use");
        assert_eq!(
            anthropic.messages[0]["content"][1]["input"]["command"],
            "uptime"
        );
        assert_eq!(anthropic.messages[1]["role"], "user");
        assert_eq!(anthropic.messages[1]["content"][0]["type"], "tool_result");
        assert_eq!(anthropic.messages[1]["content"][0]["is_error"], true);
    }

    #[test]
    fn command_output_for_model_keeps_tail_and_reports_empty_streams() {
        let long = "x".repeat(MAX_MODEL_OUTPUT_CHARS + 10);
        let formatted = format_command_output_for_model(Some(1), 12, &long, "");
        assert!(formatted.starts_with("exit_status: 1\nduration_ms: 12\n"));
        assert!(formatted.contains("仅保留最后"));
        assert!(formatted.ends_with("stderr: (空)"));
        assert_eq!(tail_chars("abcdef", 3), ("def".to_string(), true));
        assert_eq!(
            combine_output_preview("out\n", "err\n"),
            "out\n[stderr]\nerr"
        );
    }
}
