use std::collections::{BTreeMap, HashMap};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{oneshot, Notify};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::ai_assistant::{
    apply_anthropic_reasoning_fields, apply_openai_reasoning_fields, assess_command,
    ensure_provider_response, normalize_endpoint, provider_request_error, provider_stream_error,
    read_sse_events, stream_parse_error, AiAgentMode, AiApiFormat, AiCommandAssessment,
    AiCommandRisk, AiModelMessage, AiToolCallRecord, StoredAiProviderConfig, StreamEmitter,
    DEFAULT_ANTHROPIC_VERSION,
};
use crate::app_error::AppError;
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::ResolvedSshConfig;
use crate::terminal::session::ExecOutput;

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
const REMOTE_SEARCH_TIMEOUT_SECONDS: u64 = 30;
const SERVER_MONITOR_COMMAND: &str = "printf '== hostname ==\\n'; hostname 2>/dev/null; printf '\\n== uptime ==\\n'; uptime 2>/dev/null; printf '\\n== memory ==\\n'; free -h 2>/dev/null; printf '\\n== disk ==\\n'; df -h 2>/dev/null | head -20";
const LOCAL_MONITOR_COMMAND: &str = "Get-ComputerInfo -Property CsName,OsName,OsVersion; Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize; Get-Volume | Select-Object DriveLetter,SizeRemaining,Size";

pub(crate) const TOOL_RUN_COMMAND: &str = "run_command";
pub(crate) const TOOL_SERVER_MONITOR: &str = "server_monitor";
pub(crate) const TOOL_READ_TERMINAL_OUTPUT: &str = "read_terminal_output";
pub(crate) const TOOL_START_TASK: &str = "start_task";
pub(crate) const TOOL_TASK_STATUS: &str = "task_status";
pub(crate) const TOOL_TASK_OUTPUT: &str = "task_output";
pub(crate) const TOOL_CANCEL_TASK: &str = "cancel_task";

pub(crate) const TOOL_STATUS_PENDING_APPROVAL: &str = "pending_approval";
pub(crate) const TOOL_STATUS_RUNNING: &str = "running";
pub(crate) const TOOL_STATUS_COMPLETED: &str = "completed";
pub(crate) const TOOL_STATUS_FAILED: &str = "failed";
pub(crate) const TOOL_STATUS_REJECTED: &str = "rejected";
pub(crate) const TOOL_STATUS_CANCELLED: &str = "cancelled";

pub(crate) type PendingApprovals = Arc<StdMutex<HashMap<String, oneshot::Sender<bool>>>>;

pub(crate) struct PreparedAgent {
    pub config: Option<ResolvedSshConfig>,
    pub mode: AiAgentMode,
    pub working_directory: Option<String>,
    pub host_local_directory: Option<std::path::PathBuf>,
    pub local_workspace: Option<std::path::PathBuf>,
    pub terminal_output: Option<String>,
    pub terminal_session_id: Option<String>,
}

pub(crate) struct AgentRun<'a> {
    pub app: &'a AppHandle,
    pub provider: &'a StoredAiProviderConfig,
    pub api_key: &'a str,
    pub agent: &'a PreparedAgent,
    pub pool: &'a RemoteExecSessionPool,
    pub stopped: Arc<AtomicBool>,
    pub content: Arc<StdMutex<String>>,
    pub thinking: Arc<StdMutex<String>>,
    pub tool_calls: Arc<StdMutex<Vec<AiToolCallRecord>>>,
    pub approvals: PendingApprovals,
    pub emitter: &'a StreamEmitter,
    pub pending_separator: AtomicBool,
    pub reasoning_level: Option<&'a str>,
    pub files: tokio::sync::Mutex<WorkspaceState>,
    pub audit_failed: AtomicBool,
    pub tasks: Arc<StdMutex<HashMap<String, Arc<BackgroundTask>>>>,
}

pub(crate) struct BackgroundTask {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) workspace: Option<String>,
    pub(crate) command: String,
    pub(crate) created_at_ms: u128,
    status: StdMutex<String>,
    output: StdMutex<String>,
    exit_status: StdMutex<Option<u32>>,
    finished_at_ms: StdMutex<Option<u128>>,
    cancel_requested: AtomicBool,
    stop_confirmed: AtomicBool,
    cancel_notify: Arc<Notify>,
}

impl BackgroundTask {
    fn snapshot(&self) -> crate::storage_sqlite::AiTaskSnapshot {
        crate::storage_sqlite::AiTaskSnapshot {
            id: self.id.clone(),
            session_id: self.session_id.clone(),
            workspace: self.workspace.clone(),
            command: self.command.clone(),
            status: self
                .status
                .lock()
                .map(|value| value.clone())
                .unwrap_or_else(|_| "unknown".into()),
            output: self
                .output
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default(),
            exit_status: self.exit_status.lock().ok().and_then(|value| *value),
            cancel_requested: self.cancel_requested.load(Ordering::SeqCst),
            created_at_ms: self.created_at_ms,
            updated_at_ms: now_millis(),
            finished_at_ms: self.finished_at_ms.lock().ok().and_then(|value| *value),
        }
    }

    fn persist(&self, app: &AppHandle) {
        if let Err(error) = crate::storage_sqlite::upsert_ai_task(app, &self.snapshot()) {
            eprintln!(
                "[ai-agent] persist background task failed: {}",
                error.raw_message
            );
        }
    }
}

#[derive(Default)]
pub(crate) struct WorkspaceState {
    reads: HashMap<String, Option<String>>,
    remote_meta: HashMap<String, (u64, u64)>,
    patches: HashMap<String, PendingPatch>,
    applied: HashMap<String, PendingPatch>,
}
#[derive(Clone)]
struct PendingPatch {
    path: String,
    before: Option<String>,
    after: Option<String>,
    diff: String,
    action: String,
    destination: Option<String>,
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
    pub thinking: String,
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
    thinking: String,
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
            |delta| run.push_thinking(delta),
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
            if run.audit_failed.load(Ordering::SeqCst) {
                return Err(AppError::new(
                    "ai_audit_failed",
                    "审计记录保存失败，已停止工具执行。",
                    "audit write failed",
                    true,
                ));
            }
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

    fn push_thinking(&self, delta: String) {
        if delta.is_empty() {
            return;
        }
        if let Ok(mut thinking) = self.thinking.lock() {
            thinking.push_str(&delta);
        }
        self.emitter.thinking(delta);
    }

    fn text_offset(&self) -> usize {
        self.content
            .lock()
            .map(|content| content.chars().count())
            .unwrap_or(0)
    }

    fn upsert_tool_call(&self, record: &AiToolCallRecord) -> bool {
        let audit = self.emitter.audit(record);
        if let Err(error) = &audit {
            self.audit_failed.store(true, Ordering::SeqCst);
            self.emitter
                .chunk(format!("\n\n审计失败：{}\n", error.message));
        }
        if let Ok(mut calls) = self.tool_calls.lock() {
            match calls.iter_mut().find(|item| item.id == record.id) {
                Some(existing) => *existing = record.clone(),
                None => calls.push(record.clone()),
            }
        }
        self.emitter.tool_call(record.clone());
        audit.is_ok()
    }

    fn fail_tool(&self, mut record: AiToolCallRecord, message: String) -> ToolOutcome {
        record.status = TOOL_STATUS_FAILED.to_string();
        record.error = Some(message.clone());
        record.finished_at_ms = Some(now_millis());
        self.upsert_tool_call(&record);
        ToolOutcome {
            content: format!("工具执行失败：{message}"),
            is_error: true,
        }
    }

    async fn execute_tool(&self, call: &AgentToolCall) -> ToolOutcome {
        let mut record = AiToolCallRecord::new(&call.id, &call.name, self.text_offset());
        record.created_at_ms = now_millis();
        record.connection_id = self
            .agent
            .config
            .as_ref()
            .map(|config| config.connection_id.clone());
        record.workspace = self.agent.working_directory.clone();
        if matches!(
            call.name.as_str(),
            "read_file"
                | "glob"
                | "grep"
                | "preview_patch"
                | "apply_patch"
                | "rollback_patch"
                | "preview_file_change"
                | "apply_file_change"
        ) {
            if let Some(path) = self.agent.local_workspace.as_ref() {
                record.workspace = Some(path.to_string_lossy().to_string());
            }
        }
        match call.name.as_str() {
            "read_file"
            | "glob"
            | "grep"
            | "preview_patch"
            | "apply_patch"
            | "rollback_patch"
            | "preview_file_change"
            | "apply_file_change" => self.workspace_tool(call, record).await,
            "update_plan" => {
                record.output = call
                    .arguments
                    .chars()
                    .take(MAX_RECORD_OUTPUT_CHARS)
                    .collect();
                record.status = TOOL_STATUS_COMPLETED.into();
                record.finished_at_ms = Some(now_millis());
                self.upsert_tool_call(&record);
                ToolOutcome {
                    content: "计划已展示给用户。".into(),
                    is_error: false,
                }
            }
            "ask_user" => {
                let value = parse_tool_input(&call.arguments);
                record.output = value["question"].as_str().unwrap_or_default().to_string();
                if record.output.trim().is_empty() {
                    return self.fail_tool(record, "问题不能为空。".into());
                }
                let approved = self.request_approval(&mut record).await;
                ToolOutcome {
                    content: if approved {
                        "用户选择继续。"
                    } else {
                        "用户拒绝继续，请停止依赖此选择的操作。"
                    }
                    .into(),
                    is_error: !approved,
                }
            }
            TOOL_START_TASK | TOOL_TASK_STATUS | TOOL_TASK_OUTPUT | TOOL_CANCEL_TASK => {
                self.background_task_tool(call, record).await
            }
            TOOL_RUN_COMMAND => self.run_command_tool(call, record).await,
            TOOL_SERVER_MONITOR => {
                let mut record = record;
                let command = if self.agent.config.is_some() {
                    SERVER_MONITOR_COMMAND
                } else {
                    LOCAL_MONITOR_COMMAND
                };
                record.command = Some(command.to_string());
                record.risk = Some(AiCommandRisk::Safe);
                self.exec_tool(
                    record,
                    command.to_string(),
                    Duration::from_secs(SERVER_MONITOR_TIMEOUT_SECONDS),
                )
                .await
            }
            TOOL_READ_TERMINAL_OUTPUT => self.read_terminal_output_tool(call, record),
            other => self.fail_tool(record, format!("未知工具：{other}")),
        }
    }

    async fn request_approval(&self, record: &mut AiToolCallRecord) -> bool {
        record.approval_required = true;
        record.status = TOOL_STATUS_PENDING_APPROVAL.to_string();
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut approvals) = self.approvals.lock() {
            approvals.insert(record.id.clone(), sender);
        } else {
            return false;
        }
        if !self.upsert_tool_call(record) {
            if let Ok(mut approvals) = self.approvals.lock() {
                approvals.remove(&record.id);
            }
            return false;
        }
        let approved = receiver.await.unwrap_or(false);
        if let Ok(mut approvals) = self.approvals.lock() {
            approvals.remove(&record.id);
        }
        record.approval_decision = Some(if approved { "approved" } else { "rejected" }.into());
        if approved {
            record.status = TOOL_STATUS_RUNNING.into();
        } else {
            record.status = TOOL_STATUS_REJECTED.into();
            record.finished_at_ms = Some(now_millis());
        }
        let audited = self.upsert_tool_call(record);
        approval_allows_execution(
            approved,
            audited && !self.audit_failed.load(Ordering::SeqCst),
            self.stopped.load(Ordering::SeqCst),
        )
    }

    async fn authorize_command(
        &self,
        record: &mut AiToolCallRecord,
        command: &str,
    ) -> Result<(), ToolOutcome> {
        let (assessment, blocked) = assess_agent_command(command);
        record.command = Some(command.to_string());
        record.risk = Some(assessment.risk);
        record.reasons = assessment.reasons;
        if blocked {
            return Err(self.fail_tool(
                record.clone(),
                "此命令涉及磁盘或根目录破坏，不能由 AI 执行。".into(),
            ));
        }
        if self.stopped.load(Ordering::SeqCst) || self.audit_failed.load(Ordering::SeqCst) {
            return Err(self.fail_tool(record.clone(), "运行已停止或审计失败，命令未执行。".into()));
        }
        if record.risk == Some(AiCommandRisk::Dangerous)
            && self.agent.mode != AiAgentMode::Full
            && !self.request_approval(record).await
        {
            if self.audit_failed.load(Ordering::SeqCst) {
                return Err(self.fail_tool(record.clone(), "审计保存失败，命令未执行。".into()));
            }
            return Err(ToolOutcome {
                content: "命令未获用户确认或运行已停止，没有执行。请停止依赖该命令的操作。".into(),
                is_error: true,
            });
        }
        Ok(())
    }

    async fn remote_file_lifecycle_tool(
        &self,
        call: &AgentToolCall,
        mut record: AiToolCallRecord,
        args: Value,
    ) -> ToolOutcome {
        let Some(config) = self.agent.config.clone() else {
            return self.fail_tool(record, "Agent 配置尚未解析。".into());
        };
        let Some(root) = self.agent.working_directory.as_deref() else {
            return self.fail_tool(record, "远程工作目录未选择。".into());
        };
        let path = args["path"].as_str().unwrap_or_default().trim().to_string();
        if path.is_empty()
            || !(path == root || path.starts_with(&format!("{}/", root.trim_end_matches('/'))))
        {
            return self.fail_tool(record, "远程文件路径必须位于所选工作目录内。".into());
        }
        let manager = self.app.state::<crate::remote_files::RemoteFileManager>();
        let exists = match self
            .pool
            .exec(
                self.app,
                &config,
                &format!("test -e -- {}", quote_posix_shell(&path)),
                RemoteExecRetry::None,
            )
            .await
        {
            Ok(output) => output.exit_status == Some(0),
            Err(error) => return self.fail_tool(record, error.message),
        };
        let current = if exists {
            match manager.read_file(self.app, config.clone(), &path).await {
                Ok(value) => {
                    self.files
                        .lock()
                        .await
                        .remote_meta
                        .insert(path.clone(), (value.mtime, value.size));
                    Some(value.content)
                }
                Err(error) => return self.fail_tool(record, error.message),
            }
        } else {
            None
        };

        if call.name == "preview_file_change" {
            let action = args["operation"].as_str().unwrap_or_default();
            if !matches!(action, "create" | "delete" | "rename") {
                return self
                    .fail_tool(record, "operation 必须是 create、delete 或 rename。".into());
            }
            if action == "create" && current.is_some() {
                return self.fail_tool(record, "目标文件已存在，不能覆盖创建。".into());
            }
            if action != "create" && current.is_none() {
                return self.fail_tool(record, "目标文件不存在，无法执行该操作。".into());
            }
            let destination = if action == "rename" {
                let destination = args["destination"].as_str().unwrap_or_default().trim();
                if destination.is_empty()
                    || !(destination == root
                        || destination.starts_with(&format!("{}/", root.trim_end_matches('/'))))
                {
                    return self.fail_tool(record, "重命名目标必须位于所选工作目录内。".into());
                }
                let target_exists = match self
                    .pool
                    .exec(
                        self.app,
                        &config,
                        &format!("test -e -- {}", quote_posix_shell(destination)),
                        RemoteExecRetry::None,
                    )
                    .await
                {
                    Ok(output) => output.exit_status == Some(0),
                    Err(error) => return self.fail_tool(record, error.message),
                };
                if target_exists {
                    return self.fail_tool(record, "重命名目标已经存在。".into());
                }
                Some(destination.to_string())
            } else {
                None
            };
            let after = if action == "create" {
                Some(args["content"].as_str().unwrap_or_default().to_string())
            } else {
                current.clone()
            };
            let diff = match action {
                "create" => format!("+++ {path}\n{}", after.as_deref().unwrap_or_default()),
                "delete" => format!("--- {path}\n{}", current.as_deref().unwrap_or_default()),
                "rename" => format!(
                    "rename {path} -> {}",
                    destination.as_deref().unwrap_or_default()
                ),
                _ => String::new(),
            };
            let id = Uuid::new_v4().to_string();
            self.files.lock().await.patches.insert(
                id.clone(),
                PendingPatch {
                    path: path.clone(),
                    before: current,
                    after,
                    diff: diff.clone(),
                    action: action.to_string(),
                    destination,
                },
            );
            record.command = Some(format!("file_change:{id}"));
            record.output = diff.clone();
            record.status = TOOL_STATUS_PENDING_APPROVAL.into();
            record.approval_required = true;
            self.upsert_tool_call(&record);
            return ToolOutcome {
                content: format!("待确认的远程文件操作 {id}\n{diff}"),
                is_error: false,
            };
        }

        let change_id = args["change_id"].as_str().unwrap_or_default();
        let patch = self.files.lock().await.patches.remove(change_id);
        let Some(patch) = patch else {
            return self.fail_tool(record, "远程文件变更预览不存在或已失效。".into());
        };
        if !self.request_approval(&mut record).await {
            return ToolOutcome {
                content: "用户拒绝应用远程文件变更。".into(),
                is_error: false,
            };
        }
        let current_now = match self
            .pool
            .exec(
                self.app,
                &config,
                &format!("test -e -- {}", quote_posix_shell(&patch.path)),
                RemoteExecRetry::None,
            )
            .await
        {
            Ok(output) if output.exit_status == Some(0) => {
                match manager
                    .read_file(self.app, config.clone(), &patch.path)
                    .await
                {
                    Ok(value) => Some(value.content),
                    Err(error) => return self.fail_tool(record, error.message),
                }
            }
            Ok(_) => None,
            Err(error) => return self.fail_tool(record, error.message),
        };
        if current_now != patch.before {
            return self.fail_tool(record, "远程文件在预览后发生变化，已取消应用。".into());
        }
        let backup = format!("{}.mxterm-agent-backup-{}", patch.path, Uuid::new_v4());
        if patch.before.is_some() {
            let backup_output = self
                .pool
                .exec(
                    self.app,
                    &config,
                    &format!(
                        "cp -p -- {} {}",
                        quote_posix_shell(&patch.path),
                        quote_posix_shell(&backup)
                    ),
                    RemoteExecRetry::None,
                )
                .await;
            if !matches!(backup_output.as_ref(), Ok(value) if value.exit_status == Some(0)) {
                return self.fail_tool(record, "远程备份失败，未写入文件。".into());
            }
        }
        let result = match patch.action.as_str() {
            "create" => {
                let metadata = match manager
                    .create_file(self.app, config.clone(), &patch.path)
                    .await
                {
                    Ok(metadata) => metadata,
                    Err(error) => return self.fail_tool(record, error.message),
                };
                if patch.after.as_deref().unwrap_or_default().is_empty() {
                    Ok(())
                } else {
                    manager
                        .write_file(
                            self.app,
                            config.clone(),
                            &patch.path,
                            patch.after.as_deref().unwrap_or_default(),
                            metadata.mtime,
                            metadata.size,
                            false,
                        )
                        .await
                        .map(|_| ())
                }
            }
            "delete" => self
                .pool
                .exec(
                    self.app,
                    &config,
                    &format!("rm -f -- {}", quote_posix_shell(&patch.path)),
                    RemoteExecRetry::None,
                )
                .await
                .map(|output| ())
                .map_err(|error| error),
            "rename" => {
                let Some(destination) = patch.destination.as_deref() else {
                    return self.fail_tool(record, "重命名缺少目标路径。".into());
                };
                self.pool
                    .exec(
                        self.app,
                        &config,
                        &format!(
                            "mv -- {} {}",
                            quote_posix_shell(&patch.path),
                            quote_posix_shell(destination)
                        ),
                        RemoteExecRetry::None,
                    )
                    .await
                    .map(|_| ())
                    .map_err(|error| error)
            }
            _ => Err(AppError::new(
                "ai_workspace_operation_invalid",
                "远程文件操作无效。",
                "operation",
                true,
            )),
        };
        if let Err(error) = result {
            return self.fail_tool(record, error.message);
        }
        record.status = TOOL_STATUS_COMPLETED.into();
        record.output = if patch.before.is_some() {
            format!("远程文件操作已应用，备份：{backup}")
        } else {
            "远程文件操作已应用。".into()
        };
        record.finished_at_ms = Some(now_millis());
        self.files
            .lock()
            .await
            .applied
            .insert(backup.clone(), patch);
        self.upsert_tool_call(&record);
        ToolOutcome {
            content: record.output.clone(),
            is_error: false,
        }
    }

    async fn workspace_tool(
        &self,
        call: &AgentToolCall,
        mut record: AiToolCallRecord,
    ) -> ToolOutcome {
        let args = parse_tool_input(&call.arguments);
        let mut path = args["path"].as_str().unwrap_or_default().to_string();
        if self.agent.local_workspace.is_none()
            && self.agent.config.is_some()
            && matches!(
                call.name.as_str(),
                "preview_file_change" | "apply_file_change"
            )
        {
            return self.remote_file_lifecycle_tool(call, record, args).await;
        }
        if self.agent.local_workspace.is_none()
            && self.agent.config.is_some()
            && matches!(call.name.as_str(), "glob" | "grep")
        {
            let Some(root) = self.agent.working_directory.as_deref() else {
                return self.fail_tool(record, "远程工作目录未选择。".into());
            };
            let command = match build_remote_search_command(
                &call.name,
                root,
                args["pattern"].as_str().unwrap_or("*"),
                args["query"].as_str(),
            ) {
                Ok(command) => command,
                Err(message) => return self.fail_tool(record, message),
            };
            record.command = Some(command.clone());
            record.risk = Some(AiCommandRisk::Safe);
            return self
                .exec_tool(
                    record,
                    command,
                    Duration::from_secs(REMOTE_SEARCH_TIMEOUT_SECONDS),
                )
                .await;
        }
        if self.agent.local_workspace.is_none()
            && self.agent.config.is_some()
            && call.name != "apply_patch"
        {
            if !matches!(
                call.name.as_str(),
                "read_file" | "preview_patch" | "apply_patch"
            ) {
                return self.fail_tool(
                    record,
                    "远程工作区目前只开放受保护的 read_file；写入前会接入远程 diff/CAS。".into(),
                );
            }
            let Some(config) = self.agent.config.clone() else {
                return self.fail_tool(record, "Agent 工作区未绑定连接。".into());
            };
            let Some(root) = self.agent.working_directory.as_deref() else {
                return self.fail_tool(record, "远程工作目录未选择。".into());
            };
            if !path.starts_with(root) {
                return self.fail_tool(record, "远程文件必须位于已选择的工作目录内。".into());
            }
            let manager = self.app.state::<crate::remote_files::RemoteFileManager>();
            let result = match manager.read_file(self.app, config, &path).await {
                Ok(v) => v,
                Err(e) => return self.fail_tool(record, e.message),
            };
            self.files
                .lock()
                .await
                .reads
                .insert(path.clone(), Some(result.content.clone()));
            self.files
                .lock()
                .await
                .remote_meta
                .insert(path.clone(), (result.mtime, result.size));
            if call.name == "read_file" {
                record.status = TOOL_STATUS_COMPLETED.into();
                record.output = result
                    .content
                    .chars()
                    .take(MAX_RECORD_OUTPUT_CHARS)
                    .collect();
                record.output_truncated = result.content.chars().count() > MAX_RECORD_OUTPUT_CHARS;
                record.finished_at_ms = Some(now_millis());
                self.upsert_tool_call(&record);
                return ToolOutcome {
                    content: result.content,
                    is_error: false,
                };
            }
        }
        if self.agent.local_workspace.is_none() && self.agent.config.is_some() {
            let current = self
                .files
                .lock()
                .await
                .reads
                .get(&path)
                .cloned()
                .flatten()
                .unwrap_or_default();
            if call.name == "preview_patch" {
                let (updated, diff) = match crate::ai_workspace::build_patch(
                    &current,
                    &path,
                    args["old_string"].as_str().unwrap_or_default(),
                    args["new_string"].as_str().unwrap_or_default(),
                ) {
                    Ok(v) => v,
                    Err(e) => return self.fail_tool(record, e.message),
                };
                let id = Uuid::new_v4().to_string();
                self.files.lock().await.patches.insert(
                    id.clone(),
                    PendingPatch {
                        path: path.into(),
                        before: Some(current),
                        after: Some(updated),
                        diff: diff.clone(),
                        action: "patch".into(),
                        destination: None,
                    },
                );
                record.output = diff.clone();
                record.command = Some(format!("patch:{id}"));
                record.status = TOOL_STATUS_PENDING_APPROVAL.into();
                record.approval_required = true;
                self.upsert_tool_call(&record);
                return ToolOutcome {
                    content: format!("补丁编号 {id}\n{diff}"),
                    is_error: false,
                };
            }
            let id = args["patch_id"].as_str().unwrap_or_default().to_string();
            let patch = self.files.lock().await.patches.remove(&id);
            let Some(patch) = patch else {
                return self.fail_tool(record, "补丁不存在或已失效。".into());
            };
            path = patch.path.clone();
            if !self.request_approval(&mut record).await {
                return ToolOutcome {
                    content: "用户拒绝应用补丁。".into(),
                    is_error: false,
                };
            }
            let Some(config) = self.agent.config.clone() else {
                return self.fail_tool(record, "Agent 工作区未绑定连接。".into());
            };
            let Some(root) = self.agent.working_directory.as_deref() else {
                return self.fail_tool(record, "远程工作目录未选择。".into());
            };
            if !(path == root || path.starts_with(&format!("{}/", root.trim_end_matches('/')))) {
                return self.fail_tool(record, "远程路径超出工作目录。".into());
            };
            let backup = format!("{}.mxterm-agent-backup-{}", path, Uuid::new_v4());
            let backup_cmd = format!(
                "cp -p -- {} {}",
                quote_posix_shell(&path),
                quote_posix_shell(&backup)
            );
            if self
                .pool
                .exec(self.app, &config, &backup_cmd, RemoteExecRetry::None)
                .await
                .is_err()
            {
                return self.fail_tool(record, "远程备份失败，未写入文件。".into());
            };
            let Some((mtime, size)) = self.files.lock().await.remote_meta.get(&path).copied()
            else {
                return self.fail_tool(record, "缺少远程文件版本，请重新读取。".into());
            };
            let manager = self.app.state::<crate::remote_files::RemoteFileManager>();
            match manager
                .write_file(
                    self.app,
                    config,
                    &path,
                    patch.after.as_deref().unwrap_or_default(),
                    mtime,
                    size,
                    false,
                )
                .await
            {
                Ok(_) => {
                    record.status = TOOL_STATUS_COMPLETED.into();
                    record.output = format!("已应用远程补丁，备份：{backup}");
                    record.finished_at_ms = Some(now_millis());
                    self.upsert_tool_call(&record);
                    ToolOutcome {
                        content: record.output.clone(),
                        is_error: false,
                    }
                }
                Err(e) => self.fail_tool(record, e.message),
            }
        } else {
            let Some(root) = self.agent.local_workspace.as_ref() else {
                return self.fail_tool(record, "尚未选择本地文件工作区。".into());
            };
            let result = match call.name.as_str() {
                "read_file" => {
                    let value = match crate::ai_workspace::read_local_file(
                        root,
                        &path,
                        crate::ai_workspace::MAX_SEARCH_FILE_BYTES as usize,
                    ) {
                        Ok(result) => result.content,
                        Err(e) => return self.fail_tool(record, e.message),
                    };
                    self.files
                        .lock()
                        .await
                        .reads
                        .insert(path.to_string(), Some(value.clone()));
                    record.status = TOOL_STATUS_COMPLETED.into();
                    record.output = value.chars().take(MAX_RECORD_OUTPUT_CHARS).collect();
                    record.output_truncated = value.chars().count() > MAX_RECORD_OUTPUT_CHARS;
                    record.finished_at_ms = Some(now_millis());
                    self.upsert_tool_call(&record);
                    return ToolOutcome {
                        content: value,
                        is_error: false,
                    };
                }
                "glob" | "grep" => {
                    let pattern = args["pattern"].as_str().unwrap_or("*");
                    let query = args["query"].as_str();
                    if call.name == "glob" {
                        match crate::ai_workspace::search_local_files(root, pattern) {
                            Ok(value) => serde_json::to_string(&value).unwrap_or_default(),
                            Err(e) => return self.fail_tool(record, e.message),
                        }
                    } else {
                        match crate::ai_workspace::search_local_content(
                            root,
                            query.unwrap_or_default(),
                            Some(pattern),
                        ) {
                            Ok(value) => serde_json::to_string(&value).unwrap_or_default(),
                            Err(e) => return self.fail_tool(record, e.message),
                        }
                    }
                }
                "preview_file_change" => {
                    let action = args["operation"].as_str().unwrap_or_default();
                    if !matches!(action, "create" | "delete" | "rename") {
                        return self.fail_tool(
                            record,
                            "operation 必须是 create、delete 或 rename。".into(),
                        );
                    }
                    let current = match crate::ai_workspace::read_version(root, &path) {
                        Ok(value) => value,
                        Err(error) => return self.fail_tool(record, error.message),
                    };
                    if action != "create" {
                        if self.files.lock().await.reads.get(&path) != Some(&current) {
                            return self.fail_tool(
                                record,
                                "请先读取文件，且文件在预览前不能发生变化。".into(),
                            );
                        }
                    } else if current.is_some() {
                        return self.fail_tool(record, "目标文件已存在，不能覆盖创建。".into());
                    }
                    let destination = if action == "rename" {
                        let value = args["destination"].as_str().unwrap_or_default();
                        if value.is_empty() {
                            return self.fail_tool(record, "重命名需要 destination。".into());
                        }
                        let value = match crate::ai_workspace::resolve_workspace_path(root, value) {
                            Ok(v) => v.to_string_lossy().to_string(),
                            Err(e) => return self.fail_tool(record, e.message),
                        };
                        match crate::ai_workspace::read_version(root, &value) {
                            Ok(Some(_)) => {
                                return self.fail_tool(record, "重命名目标已存在。".into())
                            }
                            Ok(None) => {}
                            Err(error) => return self.fail_tool(record, error.message),
                        }
                        Some(value)
                    } else {
                        None
                    };
                    let after = if action == "create" {
                        Some(args["content"].as_str().unwrap_or_default().to_string())
                    } else {
                        current.clone()
                    };
                    if after.as_ref().is_some_and(|v| {
                        v.len() > crate::ai_workspace::MAX_SEARCH_FILE_BYTES as usize
                    }) {
                        return self.fail_tool(record, "文件超过 2 MiB。".into());
                    }
                    let diff = if let Some(destination) = &destination {
                        format!("rename from {path}\nrename to {destination}\n")
                    } else {
                        format!(
                            "operation={action}\n{}",
                            crate::ai_workspace::simple_diff(
                                &path,
                                current.as_deref().unwrap_or_default(),
                                after.as_deref().unwrap_or_default()
                            )
                        )
                    };
                    let id = Uuid::new_v4().to_string();
                    self.files.lock().await.patches.insert(
                        id.clone(),
                        PendingPatch {
                            path: path.clone(),
                            before: current,
                            after,
                            diff: diff.clone(),
                            action: action.into(),
                            destination,
                        },
                    );
                    record.output = diff.clone();
                    record.command = Some(format!("change:{id}"));
                    record.status = TOOL_STATUS_PENDING_APPROVAL.into();
                    record.approval_required = true;
                    self.upsert_tool_call(&record);
                    return ToolOutcome {
                        content: format!("文件操作编号 {id}\n{diff}"),
                        is_error: false,
                    };
                }
                "apply_file_change" => {
                    let id = args["change_id"].as_str().unwrap_or_default().to_string();
                    let patch = self.files.lock().await.patches.remove(&id);
                    let Some(patch) = patch else {
                        return self.fail_tool(record, "文件操作不存在或已失效。".into());
                    };
                    record.output = patch.diff.clone();
                    if !self.request_approval(&mut record).await {
                        return ToolOutcome {
                            content: "用户拒绝文件操作。".into(),
                            is_error: false,
                        };
                    }
                    let current = match crate::ai_workspace::read_version(root, &patch.path) {
                        Ok(value) => value,
                        Err(error) => return self.fail_tool(record, error.message),
                    };
                    if current != patch.before {
                        return self.fail_tool(record, "审批期间文件已变化，请重新预览。".into());
                    };
                    let backup_dir = self
                        .app
                        .path()
                        .app_data_dir()
                        .map(|p| p.join("ai-agent-backups"))
                        .unwrap_or_else(|_| root.join(".mxterm-agent-backups"));
                    let backup = if let Some(before) = patch.before.as_deref() {
                        crate::ai_workspace::write_version(
                            root,
                            &patch.path,
                            Some(before),
                            before,
                            &backup_dir,
                        )
                    } else {
                        Ok(String::new())
                    };
                    let backup = match backup {
                        Ok(id) => id,
                        Err(e) => return self.fail_tool(record, e.message),
                    };
                    let operation = match patch.action.as_str() {
                        "create" => crate::ai_workspace::write_version(
                            root,
                            &patch.path,
                            None,
                            patch.after.as_deref().unwrap_or_default(),
                            &backup_dir,
                        )
                        .map_err(|e| e.message),
                        "delete" => std::fs::remove_file(
                            match crate::ai_workspace::resolve_workspace_path(root, &patch.path) {
                                Ok(path) => path,
                                Err(e) => return self.fail_tool(record, e.message),
                            },
                        )
                        .map(|_| backup.clone())
                        .map_err(|e| e.to_string()),
                        "rename" => {
                            let dest = patch.destination.as_deref().unwrap_or_default();
                            std::fs::rename(
                                match crate::ai_workspace::resolve_workspace_path(root, &patch.path)
                                {
                                    Ok(path) => path,
                                    Err(e) => return self.fail_tool(record, e.message),
                                },
                                match crate::ai_workspace::resolve_workspace_path(root, dest) {
                                    Ok(path) => path,
                                    Err(e) => return self.fail_tool(record, e.message),
                                },
                            )
                            .map(|_| backup.clone())
                            .map_err(|e| e.to_string())
                        }
                        _ => Ok(backup.clone()),
                    };
                    return match operation {
                        Ok(_) => {
                            record.status = TOOL_STATUS_COMPLETED.into();
                            record.output = if backup.is_empty() {
                                "文件操作已完成。".into()
                            } else {
                                format!("文件操作已完成，备份编号 {backup}")
                            };
                            self.files.lock().await.applied.insert(
                                if backup.is_empty() {
                                    id
                                } else {
                                    backup.clone()
                                },
                                patch,
                            );
                            record.finished_at_ms = Some(now_millis());
                            self.upsert_tool_call(&record);
                            ToolOutcome {
                                content: record.output.clone(),
                                is_error: false,
                            }
                        }
                        Err(e) => self.fail_tool(record, e.to_string()),
                    };
                }
                "preview_patch" => {
                    let before = match self.files.lock().await.reads.get(&path) {
                        Some(value) => value.clone(),
                        None => {
                            return self.fail_tool(record, "必须先 read_file 再生成补丁。".into())
                        }
                    };
                    let current = before.clone().unwrap_or_default();
                    let after_old = args["old_string"].as_str().unwrap_or_default();
                    let new = args["new_string"].as_str().unwrap_or_default();
                    let (updated, diff) =
                        match crate::ai_workspace::build_patch(&current, &path, after_old, new) {
                            Ok(v) => v,
                            Err(e) => return self.fail_tool(record, e.message),
                        };
                    let id = Uuid::new_v4().to_string();
                    self.files.lock().await.patches.insert(
                        id.clone(),
                        PendingPatch {
                            path: path.into(),
                            before,
                            after: Some(updated),
                            diff: diff.clone(),
                            action: "patch".into(),
                            destination: None,
                        },
                    );
                    record.output = diff.clone();
                    record.status = TOOL_STATUS_PENDING_APPROVAL.into();
                    record.approval_required = true;
                    record.command = Some(format!("patch:{id}"));
                    self.upsert_tool_call(&record);
                    return ToolOutcome {
                        content: format!("补丁编号 {id}\n{diff}\n请用户确认后再 apply_patch。"),
                        is_error: false,
                    };
                }
                "apply_patch" => {
                    let id = args["patch_id"].as_str().unwrap_or_default().to_string();
                    let patch = self.files.lock().await.patches.remove(&id);
                    let Some(patch) = patch else {
                        return self.fail_tool(
                            record,
                            "补丁不存在或已失效，请重新 preview_patch。".into(),
                        );
                    };
                    record.output = patch.diff.clone();
                    if !self.request_approval(&mut record).await {
                        return ToolOutcome {
                            content: "用户拒绝应用补丁。".into(),
                            is_error: false,
                        };
                    }
                    let backup_dir = self
                        .app
                        .path()
                        .app_data_dir()
                        .map(|p| p.join("ai-agent-backups"))
                        .unwrap_or_else(|_| root.join(".mxterm-agent-backups"));
                    match crate::ai_workspace::write_version(
                        root,
                        &patch.path,
                        patch.before.as_deref(),
                        patch.after.as_deref().unwrap_or_default(),
                        &backup_dir,
                    ) {
                        Ok(backup) => {
                            record.status = TOOL_STATUS_COMPLETED.into();
                            record.output = format!("已应用补丁，备份编号 {backup}");
                            self.files
                                .lock()
                                .await
                                .applied
                                .insert(backup.clone(), patch);
                            record.finished_at_ms = Some(now_millis());
                            self.upsert_tool_call(&record);
                            return ToolOutcome {
                                content: record.output.clone(),
                                is_error: false,
                            };
                        }
                        Err(e) => return self.fail_tool(record, e.message),
                    }
                }
                "rollback_patch" => {
                    let backup_id = args["backup_id"].as_str().unwrap_or_default().to_string();
                    let patch = self.files.lock().await.applied.get(&backup_id).cloned();
                    let Some(patch) = patch else {
                        return self
                            .fail_tool(record, "备份不属于当前 Agent 会话或已失效。".into());
                    };
                    if self.agent.local_workspace.is_none()
                        && self.agent.config.is_some()
                        && matches!(patch.action.as_str(), "create" | "delete" | "rename")
                    {
                        let Some(config) = self.agent.config.clone() else {
                            return self.fail_tool(record, "Agent 配置尚未解析。".into());
                        };
                        if !self.request_approval(&mut record).await {
                            return ToolOutcome {
                                content: "用户拒绝回滚远程文件操作。".into(),
                                is_error: false,
                            };
                        }
                        let result = match patch.action.as_str() {
                            "create" => self
                                .pool
                                .exec(
                                    self.app,
                                    &config,
                                    &format!("rm -f -- {}", quote_posix_shell(&patch.path)),
                                    RemoteExecRetry::None,
                                )
                                .await
                                .map(|_| ()),
                            "delete" => self
                                .pool
                                .exec(
                                    self.app,
                                    &config,
                                    &format!(
                                        "cp -p -- {} {}",
                                        quote_posix_shell(&backup_id),
                                        quote_posix_shell(&patch.path)
                                    ),
                                    RemoteExecRetry::None,
                                )
                                .await
                                .map(|_| ()),
                            "rename" => {
                                let Some(destination) = patch.destination.as_deref() else {
                                    return self
                                        .fail_tool(record, "重命名回滚缺少目标路径。".into());
                                };
                                self.pool
                                    .exec(
                                        self.app,
                                        &config,
                                        &format!(
                                            "mv -- {} {}",
                                            quote_posix_shell(destination),
                                            quote_posix_shell(&patch.path)
                                        ),
                                        RemoteExecRetry::None,
                                    )
                                    .await
                                    .map(|_| ())
                            }
                            _ => Ok(()),
                        };
                        if let Err(error) = result {
                            return self.fail_tool(record, error.message);
                        }
                        record.status = TOOL_STATUS_COMPLETED.into();
                        record.output = "远程文件操作已回滚。".into();
                        record.finished_at_ms = Some(now_millis());
                        self.files.lock().await.applied.remove(&backup_id);
                        self.upsert_tool_call(&record);
                        return ToolOutcome {
                            content: record.output.clone(),
                            is_error: false,
                        };
                    }
                    if patch.action == "create"
                        || patch.action == "delete"
                        || patch.action == "rename"
                    {
                        let backup_dir = match self.app.path().app_data_dir() {
                            Ok(path) => path.join("ai-agent-backups"),
                            Err(error) => return self.fail_tool(record, error.to_string()),
                        };
                        let current = match crate::ai_workspace::read_version(root, &patch.path) {
                            Ok(value) => value,
                            Err(error) => return self.fail_tool(record, error.message),
                        };
                        let valid = match patch.action.as_str() {
                            "create" => current == patch.after,
                            "delete" => current.is_none(),
                            "rename" => {
                                let Some(destination) = patch.destination.as_deref() else {
                                    return self
                                        .fail_tool(record, "重命名回滚缺少目标路径。".into());
                                };
                                let destination_current =
                                    match crate::ai_workspace::read_version(root, destination) {
                                        Ok(value) => value,
                                        Err(error) => return self.fail_tool(record, error.message),
                                    };
                                destination_current == patch.before && current.is_none()
                            }
                            _ => false,
                        };
                        if !valid {
                            return self
                                .fail_tool(record, "文件已发生后续变化，不能自动回滚。".into());
                        }
                        record.output = format!("rollback {} {}", patch.action, patch.path);
                        if !self.request_approval(&mut record).await {
                            return ToolOutcome {
                                content: "用户拒绝回滚文件操作。".into(),
                                is_error: false,
                            };
                        }
                        let result: Result<String, AppError> = match patch.action.as_str() {
                            "create" => {
                                let path = match crate::ai_workspace::resolve_workspace_path(
                                    root,
                                    &patch.path,
                                ) {
                                    Ok(path) => path,
                                    Err(error) => return self.fail_tool(record, error.message),
                                };
                                std::fs::remove_file(path)
                            }
                            .map(|_| String::new())
                            .map_err(|e| {
                                crate::app_error::AppError::new(
                                    "ai_workspace_write_failed",
                                    "删除文件失败。",
                                    e,
                                    true,
                                )
                            }),
                            "delete" => crate::ai_workspace::write_version(
                                root,
                                &patch.path,
                                None,
                                patch.before.as_deref().unwrap_or_default(),
                                &backup_dir,
                            ),
                            "rename" => {
                                let destination = patch.destination.as_deref().unwrap_or_default();
                                let source = match crate::ai_workspace::resolve_workspace_path(
                                    root,
                                    destination,
                                ) {
                                    Ok(path) => path,
                                    Err(error) => return self.fail_tool(record, error.message),
                                };
                                let target = match crate::ai_workspace::resolve_workspace_path(
                                    root,
                                    &patch.path,
                                ) {
                                    Ok(path) => path,
                                    Err(error) => return self.fail_tool(record, error.message),
                                };
                                std::fs::rename(source, target)
                                    .map(|_| String::new())
                                    .map_err(|e| {
                                        crate::app_error::AppError::new(
                                            "ai_workspace_write_failed",
                                            "重命名回滚失败。",
                                            e,
                                            true,
                                        )
                                    })
                            }
                            _ => Ok(String::new()),
                        };
                        match result {
                            Ok(id) => {
                                record.status = TOOL_STATUS_COMPLETED.into();
                                record.output = "文件操作已回滚。".into();
                                self.files.lock().await.applied.remove(&backup_id);
                                record.finished_at_ms = Some(now_millis());
                                self.upsert_tool_call(&record);
                                return ToolOutcome {
                                    content: record.output.clone(),
                                    is_error: false,
                                };
                            }
                            Err(error) => return self.fail_tool(record, error.message),
                        }
                    }
                    let Some(original) = patch.before.as_ref() else {
                        return self.fail_tool(
                            record,
                            "新建文件回滚需要删除确认，当前不支持此备份。".into(),
                        );
                    };
                    let (_, diff) = match crate::ai_workspace::build_patch(
                        patch.after.as_deref().unwrap_or_default(),
                        &patch.path,
                        patch.after.as_deref().unwrap_or_default(),
                        original,
                    ) {
                        Ok(value) => value,
                        Err(error) => return self.fail_tool(record, error.message),
                    };
                    record.output = diff;
                    if !self.request_approval(&mut record).await {
                        return ToolOutcome {
                            content: "用户拒绝回滚文件。".into(),
                            is_error: false,
                        };
                    }
                    let backup_dir = match self.app.path().app_data_dir() {
                        Ok(path) => path.join("ai-agent-backups"),
                        Err(error) => return self.fail_tool(record, error.to_string()),
                    };
                    match crate::ai_workspace::restore_version(
                        root,
                        &patch.path,
                        patch.after.as_deref().unwrap_or_default(),
                        original,
                        &backup_dir,
                    ) {
                        Ok(id) => {
                            record.status = TOOL_STATUS_COMPLETED.into();
                            record.output = format!("已回滚文件；回滚前版本备份编号：{id}");
                            self.files.lock().await.applied.remove(&backup_id);
                            record.finished_at_ms = Some(now_millis());
                            self.upsert_tool_call(&record);
                            return ToolOutcome {
                                content: record.output.clone(),
                                is_error: false,
                            };
                        }
                        Err(error) => return self.fail_tool(record, error.message),
                    }
                }
                _ => unreachable!(),
            };
            record.status = TOOL_STATUS_COMPLETED.into();
            record.output = result.chars().take(MAX_RECORD_OUTPUT_CHARS).collect();
            record.output_truncated = result.chars().count() > MAX_RECORD_OUTPUT_CHARS;
            record.finished_at_ms = Some(now_millis());
            self.upsert_tool_call(&record);
            ToolOutcome {
                content: result,
                is_error: false,
            }
        }
    }

    async fn background_task_tool(
        &self,
        call: &AgentToolCall,
        mut record: AiToolCallRecord,
    ) -> ToolOutcome {
        let args = parse_tool_input(&call.arguments);
        let id = args["task_id"].as_str().unwrap_or_default().to_string();
        if call.name == TOOL_START_TASK {
            let (command, limit) = match parse_command_args(
                &call.arguments,
                TOOL_START_TASK,
                MAX_COMMAND_TIMEOUT_SECONDS,
            ) {
                Ok(parsed) => parsed,
                Err(message) => return self.fail_tool(record, message),
            };
            if let Err(outcome) = self.authorize_command(&mut record, &command).await {
                return outcome;
            }
            record.status = TOOL_STATUS_RUNNING.into();
            record.started_at_ms = Some(now_millis());
            if !self.upsert_tool_call(&record) || self.stopped.load(Ordering::SeqCst) {
                return self.fail_tool(record, "审计失败或运行已停止，后台任务未启动。".into());
            }
            let task_id = Uuid::new_v4().to_string();
            let entry = Arc::new(BackgroundTask {
                id: task_id.clone(),
                session_id: self.emitter.session_id().to_string(),
                workspace: self.agent.working_directory.clone(),
                command: command.clone(),
                created_at_ms: now_millis(),
                status: StdMutex::new("running".into()),
                output: StdMutex::new(String::new()),
                exit_status: StdMutex::new(None),
                finished_at_ms: StdMutex::new(None),
                cancel_requested: AtomicBool::new(false),
                stop_confirmed: AtomicBool::new(false),
                cancel_notify: Arc::new(Notify::new()),
            });
            if let Ok(mut tasks) = self.tasks.lock() {
                tasks.insert(task_id.clone(), Arc::clone(&entry));
            } else {
                return self.fail_tool(record, "后台任务状态不可用。".into());
            }
            entry.persist(self.app);
            let tasks = Arc::clone(&self.tasks);
            let task_id_for_worker = task_id.clone();
            let config = self.agent.config.clone();
            let root = self.agent.host_local_directory.clone();
            let pool = self.pool.clone();
            let app = self.app.clone();
            tokio::spawn(async move {
                let result = match (config, root) {
                    (Some(config), None) => {
                        run_remote_background_command(&pool, &app, &config, &command, &entry, limit)
                            .await
                    }
                    (None, Some(root)) => {
                        run_local_background_command(&root, &command, &entry, limit).await
                    }
                    _ => Err(AppError::new(
                        "ai_task_workspace_invalid",
                        "后台任务工作区无效。",
                        "workspace",
                        true,
                    )),
                };
                if let Ok(mut status) = entry.status.lock() {
                    *status = if entry.cancel_requested.load(Ordering::SeqCst) {
                        if entry.stop_confirmed.load(Ordering::SeqCst) {
                            "cancelled".into()
                        } else {
                            "stop_requested_unconfirmed".into()
                        }
                    } else if result.is_ok() {
                        "succeeded".into()
                    } else {
                        "failed".into()
                    };
                }
                if let Ok(output) = result {
                    if let Ok(mut value) = entry.output.lock() {
                        *value = combine_output_preview(
                            &String::from_utf8_lossy(&output.stdout),
                            &String::from_utf8_lossy(&output.stderr),
                        )
                        .chars()
                        .take(MAX_RECORD_OUTPUT_CHARS * 4)
                        .collect();
                    }
                    if let Ok(mut code) = entry.exit_status.lock() {
                        *code = output.exit_status;
                    }
                }
                if let Ok(mut finished_at) = entry.finished_at_ms.lock() {
                    *finished_at = Some(now_millis());
                }
                entry.persist(&app);
                if let Ok(mut map) = tasks.lock() {
                    map.insert(task_id_for_worker, entry);
                }
            });
            record.status = TOOL_STATUS_COMPLETED.into();
            record.output = format!("后台任务已启动：{id}", id = task_id);
            record.finished_at_ms = Some(now_millis());
            self.upsert_tool_call(&record);
            return ToolOutcome {
                content: record.output.clone(),
                is_error: false,
            };
        }
        let task = self.tasks.lock().ok().and_then(|map| map.get(&id).cloned());
        let Some(task) = task else {
            let snapshot = match crate::storage_sqlite::get_ai_task(self.app, &id) {
                Ok(Some(snapshot)) => snapshot,
                Ok(None) => {
                    return self.fail_tool(record, "后台任务不存在或不属于当前 Agent 会话。".into())
                }
                Err(error) => return self.fail_tool(record, error.message),
            };
            if call.name == TOOL_CANCEL_TASK {
                return self.fail_tool(
                    record,
                    "该任务来自已结束的进程，停止请求无法恢复原进程。".into(),
                );
            }
            record.status = TOOL_STATUS_COMPLETED.into();
            record.output = format!(
                "status={} exit={:?}\n{}",
                snapshot.status, snapshot.exit_status, snapshot.output
            );
            record.finished_at_ms = Some(now_millis());
            self.upsert_tool_call(&record);
            return ToolOutcome {
                content: record.output.clone(),
                is_error: false,
            };
        };
        if call.name == TOOL_CANCEL_TASK {
            task.cancel_requested.store(true, Ordering::SeqCst);
            task.cancel_notify.notify_waiters();
            if let Ok(mut status) = task.status.lock() {
                *status = "stop_requested".into();
            }
            task.persist(self.app);
            record.status = TOOL_STATUS_COMPLETED.into();
            record.output = "已请求停止后台任务；远程命令是否已终止以任务最终状态为准。".into();
        } else {
            let status = task
                .status
                .lock()
                .map(|v| v.clone())
                .unwrap_or_else(|_| "unknown".into());
            let output = task.output.lock().map(|v| v.clone()).unwrap_or_default();
            let code = task.exit_status.lock().ok().and_then(|v| *v);
            record.status = TOOL_STATUS_COMPLETED.into();
            record.output = format!("status={status} exit={code:?}\n{output}");
        }
        record.finished_at_ms = Some(now_millis());
        self.upsert_tool_call(&record);
        ToolOutcome {
            content: record.output.clone(),
            is_error: false,
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
        if let Err(outcome) = self.authorize_command(&mut record, &command).await {
            return outcome;
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
        record.started_at_ms = Some(now_millis());
        if !self.upsert_tool_call(&record) || self.stopped.load(Ordering::SeqCst) {
            return self.fail_tool(record, "审计失败或运行已停止，命令未执行。".into());
        }
        let script =
            command_with_working_directory(&command, self.agent.working_directory.as_deref());
        let started = Instant::now();
        let result = match (&self.agent.config, &self.agent.host_local_directory) {
            (Some(config), None) => match timeout(
                limit,
                self.pool
                    .exec(self.app, config, &script, RemoteExecRetry::None),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => {
                    self.pool
                        .invalidate_connection_detached(&config.connection_id)
                        .await;
                    Err(AppError::new(
                        "ai_command_timeout",
                        "远程命令执行超时。",
                        format!("timeout_seconds={}", limit.as_secs()),
                        true,
                    ))
                }
            },
            (None, Some(root)) => match timeout(limit, run_local_command(root, &command)).await {
                Ok(result) => result,
                Err(_) => Err(AppError::new(
                    "ai_command_timeout",
                    "本地命令执行超时。",
                    format!("timeout_seconds={}", limit.as_secs()),
                    true,
                )),
            },
            _ => Err(AppError::new(
                "ai_agent_workspace_invalid",
                "Agent 工作区状态无效。",
                "exactly one workspace target is required",
                false,
            )),
        };
        record.duration_ms = Some(started.elapsed().as_millis() as u64);
        record.finished_at_ms = Some(now_millis());
        let output = match result {
            Ok(output) => output,
            Err(error) => return self.fail_tool(record, error.message),
        };
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let (preview, preview_truncated) = tail_chars(
            &combine_output_preview(&stdout, &stderr),
            MAX_RECORD_OUTPUT_CHARS,
        );
        record.status = if output.exit_status == Some(0) {
            TOOL_STATUS_COMPLETED
        } else {
            TOOL_STATUS_FAILED
        }
        .to_string();
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
            is_error: output.exit_status != Some(0),
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
        record.started_at_ms = Some(now_millis());
        let live = if let Some(session_id) = &self.agent.terminal_session_id {
            match self
                .app
                .state::<crate::terminal::manager::TerminalManager>()
                .recent_output(crate::terminal::manager::TerminalRecentOutputRequest {
                    session_id: session_id.clone(),
                    max_chars: Some(max_chars),
                    connection_id: self.agent.config.as_ref().map(|c| c.connection_id.clone()),
                }) {
                Ok(value) => Some(value),
                Err(error) => return self.fail_tool(record, error.message),
            }
        } else {
            None
        };
        let snapshot = live
            .as_ref()
            .map(|value| value.data.as_str())
            .or_else(|| self.agent.terminal_output.as_deref().map(str::trim))
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
        let content = if let Some(live) = live {
            format!(
                "[实时终端 cursor={} retained_from={} truncated={} updated_at_ms={}]\n{}",
                live.cursor, live.retained_from, live.truncated, live.updated_at_ms, content
            )
        } else {
            format!("[发送时快照，未绑定实时终端]\n{content}")
        };
        let (preview, preview_truncated) = tail_chars(&content, MAX_RECORD_OUTPUT_CHARS);
        record.status = TOOL_STATUS_COMPLETED.to_string();
        record.output = preview;
        record.output_truncated = preview_truncated;
        record.finished_at_ms = Some(now_millis());
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
    fn apply_openai_event(&mut self, data: &str) -> Result<(bool, String, String), AppError> {
        if data == "[DONE]" {
            return Ok((true, String::new(), String::new()));
        }
        let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
        if let Some(error) = value.get("error") {
            return Err(provider_stream_error(error));
        }
        let Some(delta) = value.pointer("/choices/0/delta") else {
            return Ok((false, String::new(), String::new()));
        };
        let thinking = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let text = delta
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.text.push_str(&text);
        self.thinking.push_str(&thinking);
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
        Ok((false, text, thinking))
    }

    fn apply_anthropic_event(&mut self, data: &str) -> Result<(bool, String, String), AppError> {
        if data == "[DONE]" {
            return Ok((true, String::new(), String::new()));
        }
        let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
        let index = value
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(0);
        let mut text = String::new();
        let mut thinking = String::new();
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
                    "thinking_delta" => {
                        thinking = delta
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
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
            "message_stop" => return Ok((true, String::new(), String::new())),
            "error" => return Err(provider_stream_error(&value)),
            _ => {}
        }
        self.text.push_str(&text);
        self.thinking.push_str(&thinking);
        Ok((false, text, thinking))
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
            thinking: self.thinking,
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
    mut on_thinking: impl FnMut(String),
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
        let (done, delta, thinking) = match format {
            AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => {
                accumulator.apply_openai_event(data)?
            }
            AiApiFormat::Anthropic => accumulator.apply_anthropic_event(data)?,
        };
        if !delta.is_empty() {
            on_delta(delta);
        }
        if !thinking.is_empty() {
            on_thinking(thinking);
        }
        Ok(done)
    })
    .await?;
    Ok(accumulator.finish())
}

fn tool_specs() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        ("read_file", "读取当前明确授权的文件作用域内的 UTF-8 文本文件；编辑前必须先读取。SSH 当前目录和本地文件工作区是两个独立作用域。", json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})),
        ("glob", "在当前明确授权的文件作用域内查找文件名，返回匹配路径。", json!({"type":"object","properties":{"pattern":{"type":"string"}},"required":["pattern"]})),
        ("grep", "在当前明确授权的文件作用域内搜索内容，返回匹配行号、列号和内容。", json!({"type":"object","properties":{"query":{"type":"string"},"pattern":{"type":"string"}},"required":["query"]})),
        ("preview_patch", "根据已读取文件生成待确认的 unified diff，不会写入文件。", json!({"type":"object","properties":{"path":{"type":"string"},"old_string":{"type":"string"},"new_string":{"type":"string"}},"required":["path","old_string","new_string"]})),
        ("apply_patch", "应用已经 preview 的补丁；会再次核对原文、先备份再原子替换，并要求用户确认。", json!({"type":"object","properties":{"patch_id":{"type":"string"}},"required":["patch_id"]})),
        ("rollback_patch", "回滚当前会话中已应用的补丁；会再次校验当前文件版本并要求确认。", json!({"type":"object","properties":{"backup_id":{"type":"string"}},"required":["backup_id"]})),
        ("preview_file_change", "预览创建、删除或重命名文件，只有确认后才会产生副作用。", json!({"type":"object","properties":{"operation":{"type":"string","enum":["create","delete","rename"]},"path":{"type":"string"},"destination":{"type":"string"},"content":{"type":"string"}},"required":["operation","path"]})),
        ("apply_file_change", "应用已经预览的创建、删除或重命名操作，并先保存备份。", json!({"type":"object","properties":{"change_id":{"type":"string"}},"required":["change_id"]})),
        ("update_plan", "向用户展示当前编码计划和下一步。", json!({"type":"object","properties":{"plan":{"type":"string"}},"required":["plan"]})),
        ("ask_user", "需要用户做出明确选择时提问。", json!({"type":"object","properties":{"question":{"type":"string"}},"required":["question"]})),
        (
            TOOL_RUN_COMMAND,
            "在当前终端对应的主机上以非交互方式执行一条 shell 命令；SSH 终端执行在当前 SSH 主机，本机终端执行在本机。命令走独立的 exec 通道，不是用户正在使用的终端，不共享其环境变量、sudo 凭据和 shell 状态。已选择的本地文件工作区不会改变命令目标。",
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
        (TOOL_START_TASK, "启动当前工作区中的后台命令，返回任务编号；命令仍受工作区和超时限制。", json!({"type":"object","properties":{"command":{"type":"string"},"timeout_seconds":{"type":"integer","minimum":1,"maximum":300}},"required":["command"]})),
        (TOOL_TASK_STATUS, "查询本次 Agent 启动的后台任务状态和退出码。", json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]})),
        (TOOL_TASK_OUTPUT, "读取本次 Agent 后台任务已收集的输出。", json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]})),
        (TOOL_CANCEL_TASK, "请求停止本次 Agent 的后台任务，并返回真实停止边界。", json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]})),
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
    let host = if agent.config.is_some() {
        "当前 SSH 终端对应的远程主机"
    } else {
        "当前本机终端对应的本机"
    };
    let local_file_scope = agent
        .local_workspace
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "未选择（需要本地文件操作时先让用户选择）".to_string());
    format!(
        "你是 mXterm 内置的终端运维助手，当前处于「执行命令」模式。\n\
当前执行主机：{host}\n\
当前终端目录：{directory}\n\
本地文件工作区：{local_file_scope}\n\
终端输出快照：{terminal_snapshot}\n\n\
工具说明：\n\
- run_command：只在当前终端对应的主机上以非交互方式执行 shell 命令；已选择的本地文件工作区不会改变命令目标。它使用独立的 exec 通道，不是用户正在使用的终端；若当前目录已知，会先进入该目录。\n\
- server_monitor：只读获取主机负载、内存、磁盘概况。\n\
- read_terminal_output：读取用户发送消息时终端最近输出的快照。\n\
- read_file / glob / grep：在明确授权的文件作用域内读取、查找和搜索；有本地文件工作区时优先使用它，否则在当前 SSH 工作目录内操作；编辑前必须先 read_file。\n\
- preview_patch / apply_patch：先展示完整 diff，用户确认后再次校验原文、备份并替换。\n\
- start_task / task_status / task_output / cancel_task：管理有边界的后台任务；停止请求未确认时必须如实说明。\n\n\
执行规则：\n\
1. 先用只读命令收集事实再下结论，不要臆测命令输出。\n\
2. 不要运行交互式或常驻命令（vim、top、less、tail -f、watch 等），改用有限输出的写法（top -bn1、tail -n 200、journalctl -n 200 --no-pager）。\n\
3. 不要执行需要输入密码的命令（例如需要密码的 sudo）；如需提权，先向用户说明。\n\
4. 修改配置、删除数据、重启服务等操作前先说明目的和影响；这类命令会交给用户确认，被拒绝时换方案或询问用户。\n\
5. 控制输出量（配合 head、tail、grep），每条命令保持简短、可验证。\n\
6. 工具执行记录和内部摘要只用于上下文，绝对不要把“[本轮工具调用记录]”或原始工具日志原样输出给用户；界面会单独展示执行过程。\n\
7. 最后用中文总结发现、原因和建议；不要声称执行过工具结果里没有的命令。"
    )
}

fn approval_allows_execution(approved: bool, audited: bool, stopped: bool) -> bool {
    approved && audited && !stopped
}

// Full access skips approval for ordinary risky commands, but catastrophic disk/root
// destruction remains blocked before execution.
fn assess_agent_command(command: &str) -> (AiCommandAssessment, bool) {
    let mut assessment = assess_command(command);
    let lower = command.to_lowercase();
    let blocked = [
        "mkfs",
        "wipefs",
        "format-volume",
        "clear-disk",
        "diskpart",
        ":(){",
        "dd if=",
    ]
    .iter()
    .any(|item| lower.contains(item))
        || is_root_recursive_delete(&lower);
    let known_read_only = !lower.chars().any(|ch| {
        matches!(
            ch,
            '$' | '`' | '\\' | '>' | '<' | ';' | '&' | '\n' | '\r' | '{' | '}'
        )
    }) && lower.split('|').all(|part| {
        matches!(
            part.split_whitespace().next(),
            Some(
                "ls" | "pwd"
                    | "cat"
                    | "head"
                    | "tail"
                    | "grep"
                    | "rg"
                    | "wc"
                    | "sort"
                    | "uniq"
                    | "df"
                    | "du"
                    | "free"
                    | "uptime"
                    | "hostname"
                    | "whoami"
                    | "uname"
                    | "ps"
                    | "lsof"
                    | "journalctl"
                    | "get-content"
                    | "get-childitem"
                    | "get-location"
                    | "get-process"
                    | "get-service"
                    | "select-object"
                    | "measure-object"
            )
        )
    }) && !lower.split_whitespace().any(|part| {
        part == "-o"
            || part.starts_with("--output")
            || part == "--pre"
            || part.starts_with("--pre=")
    });
    if blocked || !known_read_only {
        assessment.risk = AiCommandRisk::Dangerous;
        assessment
            .reasons
            .push("命令未被确认是只读操作，执行前需要用户确认。".into());
    }
    (assessment, blocked)
}

fn is_root_recursive_delete(command: &str) -> bool {
    command.split([';', '|', '&', '\n', '\r']).any(|segment| {
        let words = segment.split_whitespace().collect::<Vec<_>>();
        let Some(rm_index) = words
            .iter()
            .position(|word| *word == "rm" || word.ends_with("/rm"))
        else {
            return false;
        };
        let args = &words[rm_index + 1..];
        let recursive = args.iter().any(|arg| {
            matches!(
                arg.trim_matches('\''),
                "-r" | "-R" | "--recursive" | "-rf" | "-fr" | "-rfd" | "-frd"
            )
        });
        let force = args.iter().any(|arg| {
            matches!(
                arg.trim_matches('\''),
                "-f" | "--force" | "-rf" | "-fr" | "-rfd" | "-frd"
            )
        });
        let root_target = args
            .iter()
            .any(|arg| matches!(arg.trim_matches('\''), "/" | "/*" | "--no-preserve-root"));
        recursive && force && root_target
    })
}

fn build_remote_search_command(
    tool: &str,
    root: &str,
    pattern: &str,
    query: Option<&str>,
) -> Result<String, String> {
    let root = root.trim();
    if root.is_empty() || !root.starts_with('/') {
        return Err("远程搜索目录必须是绝对路径。".into());
    }
    let pattern = pattern.trim();
    let pattern = if pattern.is_empty() { "*" } else { pattern };
    let quoted_root = quote_posix_shell(root);
    let quoted_pattern = quote_posix_shell(pattern);
    match tool {
        "glob" => Ok(format!(
            "if command -v rg >/dev/null 2>&1; then rg --files --hidden --glob '!.git/**' --glob {quoted_pattern} {quoted_root}; else find {quoted_root} -type f -not -path '*/.git/*' -name {quoted_pattern} -print; fi"
        )),
        "grep" => {
            let query = query.map(str::trim).unwrap_or_default();
            if query.is_empty() {
                return Err("grep 缺少 query。".into());
            }
            Ok(format!(
                "if command -v rg >/dev/null 2>&1; then rg --line-number --column --hidden --glob '!.git/**' --glob {quoted_pattern} -e {} {quoted_root}; else grep -RIn -I --exclude-dir=.git --include={quoted_pattern} -e {} -- {quoted_root}; fi",
                quote_posix_shell(query),
                quote_posix_shell(query)
            ))
        }
        _ => Err(format!("不支持的远程搜索工具：{tool}")),
    }
}

fn parse_run_command_args(arguments: &str) -> Result<(String, Duration), String> {
    parse_command_args(arguments, TOOL_RUN_COMMAND, DEFAULT_COMMAND_TIMEOUT_SECONDS)
}

fn parse_command_args(
    arguments: &str,
    tool: &str,
    default_seconds: u64,
) -> Result<(String, Duration), String> {
    let args: RunCommandArgs =
        serde_json::from_str(arguments).map_err(|error| format!("{tool} 参数无效：{error}"))?;
    let command = args.command.trim().to_string();
    if command.is_empty() {
        return Err(format!("{tool} 缺少要执行的命令。"));
    }
    if command.chars().count() > MAX_COMMAND_CHARS {
        return Err(format!("命令超过 {MAX_COMMAND_CHARS} 字，请拆分后执行。"));
    }
    let seconds = args.timeout_seconds.unwrap_or(default_seconds);
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

pub(crate) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

async fn run_remote_background_command(
    pool: &RemoteExecSessionPool,
    app: &AppHandle,
    config: &ResolvedSshConfig,
    command: &str,
    entry: &BackgroundTask,
    limit: Duration,
) -> Result<ExecOutput, AppError> {
    tokio::select! {
        result = timeout(limit, pool.exec(app, config, command, RemoteExecRetry::None)) => {
            result
                .map_err(|_| AppError::new("ai_task_timeout", "后台任务超时。", "timeout", true))?
        }
        _ = entry.cancel_notify.notified() => {
            Err(AppError::new(
                "ai_task_stop_requested",
                "远程任务已发出停止请求，远端停止状态尚未确认。",
                "remote cancellation is not confirmed",
                true,
            ))
        }
    }
}

async fn run_local_background_command(
    root: &std::path::Path,
    command: &str,
    entry: &BackgroundTask,
    limit: Duration,
) -> Result<ExecOutput, AppError> {
    let mut process = if cfg!(windows) {
        let mut process = Command::new("powershell.exe");
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ]);
        process
    } else {
        let mut process = Command::new("sh");
        process.args(["-lc", command]);
        process
    };
    let mut child = process
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            AppError::new("ai_local_command_failed", "启动本地任务失败。", error, true)
        })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        AppError::new(
            "ai_task_output_unavailable",
            "无法读取任务输出。",
            "stdout",
            true,
        )
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        AppError::new(
            "ai_task_output_unavailable",
            "无法读取任务错误输出。",
            "stderr",
            true,
        )
    })?;
    let stdout_task = tokio::spawn(async move {
        let mut output = Vec::new();
        let result = stdout.read_to_end(&mut output).await;
        (result, output)
    });
    let stderr_task = tokio::spawn(async move {
        let mut output = Vec::new();
        let result = stderr.read_to_end(&mut output).await;
        (result, output)
    });
    let (status, cancelled) = timeout(limit, async {
        tokio::select! {
            status = child.wait() => {
                let status = status.map_err(|error| AppError::new("ai_local_command_failed", "等待本地任务失败。", error, true))?;
                Ok::<_, AppError>((Some(status), false))
            }
            _ = entry.cancel_notify.notified() => {
                entry.stop_confirmed.store(true, Ordering::SeqCst);
                let _ = child.kill().await;
                let status = child.wait().await.ok();
                Ok((status, true))
            }
        }
    })
    .await
    .map_err(|_| AppError::new("ai_task_timeout", "后台任务超时。", "timeout", true))??;
    let (stdout_result, stdout_bytes) = stdout_task.await.map_err(|error| {
        AppError::new("ai_task_output_failed", "读取任务输出失败。", error, true)
    })?;
    let (stderr_result, stderr_bytes) = stderr_task.await.map_err(|error| {
        AppError::new(
            "ai_task_output_failed",
            "读取任务错误输出失败。",
            error,
            true,
        )
    })?;
    stdout_result.map_err(|error| {
        AppError::new("ai_task_output_failed", "读取任务输出失败。", error, true)
    })?;
    stderr_result.map_err(|error| {
        AppError::new(
            "ai_task_output_failed",
            "读取任务错误输出失败。",
            error,
            true,
        )
    })?;
    Ok(ExecOutput {
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        exit_status: if cancelled {
            None
        } else {
            status
                .and_then(|value| value.code())
                .map(|code| code as u32)
        },
    })
}

async fn run_local_background_command_legacy(
    root: &std::path::Path,
    command: &str,
    entry: &BackgroundTask,
    limit: Duration,
) -> Result<ExecOutput, AppError> {
    let mut process = if cfg!(windows) {
        let mut process = Command::new("powershell.exe");
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ]);
        process
    } else {
        let mut process = Command::new("sh");
        process.args(["-lc", command]);
        process
    };
    let mut child = process
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            AppError::new("ai_local_command_failed", "启动本地任务失败。", error, true)
        })?;
    let mut stdout = child.stdout.take().ok_or_else(|| {
        AppError::new(
            "ai_task_output_unavailable",
            "无法读取任务输出。",
            "stdout",
            true,
        )
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        AppError::new(
            "ai_task_output_unavailable",
            "无法读取任务错误输出。",
            "stderr",
            true,
        )
    })?;

    let result = timeout(limit, async {
        tokio::select! {
            status = child.wait() => {
                let mut stdout_bytes = Vec::new();
                let mut stderr_bytes = Vec::new();
                let (stdout_result, stderr_result) = tokio::join!(
                    stdout.read_to_end(&mut stdout_bytes),
                    stderr.read_to_end(&mut stderr_bytes),
                );
                stdout_result.map_err(|error| AppError::new("ai_task_output_failed", "读取任务输出失败。", error, true))?;
                stderr_result.map_err(|error| AppError::new("ai_task_output_failed", "读取任务错误输出失败。", error, true))?;
                let status = status.map_err(|error| AppError::new("ai_local_command_failed", "等待本地任务失败。", error, true))?;
                Ok(ExecOutput {
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                    exit_status: status.code().map(|code| code as u32),
                })
            }
            _ = entry.cancel_notify.notified() => {
                entry.stop_confirmed.store(true, Ordering::SeqCst);
                let _ = child.kill().await;
                let _ = child.wait().await;
                let mut stdout_bytes = Vec::new();
                let mut stderr_bytes = Vec::new();
                let _ = tokio::join!(
                    stdout.read_to_end(&mut stdout_bytes),
                    stderr.read_to_end(&mut stderr_bytes),
                );
                Ok(ExecOutput {
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                    exit_status: None,
                })
            }
        }
    })
    .await
    .map_err(|_| AppError::new("ai_task_timeout", "后台任务超时。", "timeout", true))?;
    result
}

async fn run_local_command(root: &std::path::Path, command: &str) -> Result<ExecOutput, AppError> {
    let mut process = if cfg!(windows) {
        let mut process = Command::new("powershell.exe");
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ]);
        process
    } else {
        let mut process = Command::new("sh");
        process.args(["-lc", command]);
        process
    };
    let output = process
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| {
            AppError::new("ai_local_command_failed", "本地命令启动失败。", error, true)
        })?;
    Ok(ExecOutput {
        stdout: output.stdout,
        stderr: output.stderr,
        exit_status: output.status.code().map(|code| code as u32),
    })
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
    fn remote_search_commands_prefer_rg_and_keep_shell_quoting() {
        let glob = build_remote_search_command("glob", "/srv/app", "*.rs", None).unwrap();
        assert!(glob.contains("command -v rg"));
        assert!(glob.contains("rg --files --hidden"));
        assert!(glob.contains("--glob '*.rs'"));
        assert!(glob.contains("find '/srv/app'"));
        assert!(!glob.contains("head -n"));

        let grep = build_remote_search_command("grep", "/srv/app", "*.toml", Some("a'b")).unwrap();
        assert!(grep.contains("rg --line-number --column"));
        assert!(grep.contains("--include='*.toml'"));
        assert!(grep.contains("-e 'a'\\''b'"));
        assert!(grep.contains("-- '/srv/app'"));
    }

    #[test]
    fn remote_search_commands_reject_invalid_scope_or_query() {
        assert!(build_remote_search_command("glob", "relative", "*", None).is_err());
        assert!(build_remote_search_command("grep", "/srv/app", "*", Some("  ")).is_err());
        assert!(build_remote_search_command("unknown", "/srv/app", "*", None).is_err());
    }

    #[test]
    fn command_gate_requires_confirmation_for_mutations_and_opaque_shells() {
        for command in [
            "Remove-Item test.txt",
            "rm -f test.txt",
            "git clean -fd",
            "python script.py",
            "node script.js",
            "sh -c 'reboot'",
            "cat $(reboot)",
            "ls; reboot",
            "rg --pre=script needle",
            "sort -o output.txt input.txt",
        ] {
            let (assessment, _) = assess_agent_command(command);
            assert_eq!(assessment.risk, AiCommandRisk::Dangerous, "{command}");
        }
        for command in ["df -h", "ls -la", "cat README.md | head -20", "Get-Process"] {
            let (assessment, blocked) = assess_agent_command(command);
            assert_eq!(assessment.risk, AiCommandRisk::Safe, "{command}");
            assert!(!blocked);
        }
        assert!(assess_agent_command("rm -rf /").1);
        assert!(assess_agent_command("rm --recursive --force /").1);
        assert!(assess_agent_command("sudo rm -rf --no-preserve-root /tmp").1);
        assert!(assess_agent_command("Clear-Disk -Number 1").1);
        assert!(!assess_agent_command("rm -rf /tmp/demo").1);
    }

    #[test]
    fn full_access_skips_confirmation_only_for_non_catastrophic_commands() {
        let (assessment, blocked) = assess_agent_command("date; uname -a; uptime");
        assert_eq!(assessment.risk, AiCommandRisk::Dangerous);
        assert!(!blocked);
        assert!(assess_agent_command("rm -rf /").1);
    }

    #[test]
    fn approval_gate_fails_closed_on_rejection_audit_failure_or_stop() {
        for approved in [false, true] {
            for audited in [false, true] {
                for stopped in [false, true] {
                    assert_eq!(
                        approval_allows_execution(approved, audited, stopped),
                        approved && audited && !stopped
                    );
                }
            }
        }
    }

    #[test]
    fn background_command_args_use_the_same_limits_as_foreground() {
        for args in [
            "not-json",
            r#"{"command":" "}"#,
            r#"{"command":"ls","timeout_seconds":0}"#,
            r#"{"command":"ls","timeout_seconds":301}"#,
            r#"{"command":"ls","timeout_seconds":"60"}"#,
        ] {
            assert!(parse_command_args(args, TOOL_START_TASK, 300).is_err());
        }
        assert_eq!(
            parse_command_args(r#"{"command":"ls"}"#, TOOL_START_TASK, 300)
                .unwrap()
                .1
                .as_secs(),
            300
        );
        assert!(parse_command_args(
            &json!({"command": "x".repeat(MAX_COMMAND_CHARS + 1)}).to_string(),
            TOOL_START_TASK,
            300
        )
        .is_err());
    }

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
            let (done, delta, _) = accumulator.apply_openai_event(event).unwrap();
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
            thinking: String::new(),
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
