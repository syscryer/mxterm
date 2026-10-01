use std::collections::HashMap;
use std::string::FromUtf8Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::{Client, Response, Url};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

#[cfg(test)]
use crate::ai_agent::TOOL_RUN_COMMAND;
use crate::ai_agent::{
    self, AgentRun, PendingApprovals, PreparedAgent, TOOL_STATUS_CANCELLED,
    TOOL_STATUS_PENDING_APPROVAL, TOOL_STATUS_RUNNING,
};
use crate::app_error::AppError;
use crate::events::{AiChatStreamEvent, AI_CHAT_STREAM_EVENT};
use crate::remote_exec_pool::RemoteExecSessionPool;
use crate::ssh_config::resolve_saved_connection;
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretKind, SecretReference, VAULT_SERVICE};

const AI_PROVIDER_CONFIGS_KEY: &str = "ai.provider_configs.v1";
pub(crate) const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
pub(crate) const THINKING_MODE_AUTO: &str = "auto";
pub(crate) const THINKING_MODE_OFF: &str = "off";
/// ZCode 的内置模型规则默认给模型提供二态思考选项；具体模型声明更细档位时再覆盖。
pub(crate) const DEFAULT_REASONING_LEVELS: [&str; 2] = ["disabled", "enabled"];
pub(crate) const DEFAULT_REASONING_LEVEL: &str = "enabled";
pub(crate) const REASONING_LEVELS: [&str; 3] = ["low", "medium", "high"];
pub(crate) const ANTHROPIC_THINKING_BUDGET_TOKENS: [u32; 3] = [2_048, 8_192, 16_384];
const MAX_AGENT_TERMINAL_OUTPUT_CHARS: usize = 20_000;
#[cfg(test)]
const MAX_HISTORY_TOOL_OUTPUT_CHARS: usize = 300;
const MAX_CONTEXT_CHARS_PER_BLOCK: usize = 20_000;
const MAX_SSE_ERROR_BODY_CHARS: usize = 1200;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    Openai,
    Claude,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiApiFormat {
    OpenaiCompatible,
    Anthropic,
    Responses,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiModelConfig {
    pub id: String,
    #[serde(default = "default_context_window")]
    pub context_window: u32,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default = "default_model_enabled")]
    pub enabled: bool,
}

fn default_context_window() -> u32 {
    200_000
}

fn default_model_enabled() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiCommandRisk {
    Safe,
    Dangerous,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    pub provider: AiProviderKind,
    pub api_format: AiApiFormat,
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    pub api_key_saved: bool,
    #[serde(default)]
    pub thinking_mode: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiProviderConfigInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub provider: AiProviderKind,
    pub api_format: AiApiFormat,
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    #[serde(default)]
    pub thinking_mode: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_touched: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiProviderConfigIdRequest {
    pub id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RevealedAiProviderApiKey {
    pub api_key: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiProviderConfigTestResult {
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiProviderModelOption {
    pub id: String,
    pub display_name: Option<String>,
    pub subtitle: Option<String>,
    /// 接口明确声明的能力优先使用；未声明时按内置模型目录规则或通用二态默认补齐。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_levels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_default_level: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct StoredAiProviderConfig {
    id: String,
    name: String,
    provider: AiProviderKind,
    pub(crate) api_format: AiApiFormat,
    pub(crate) endpoint: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<AiModelConfig>,
    #[serde(default)]
    pub(crate) thinking_mode: Option<String>,
    secret_slot_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiContextBlock {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub source: String,
    pub line_count: usize,
    pub char_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiCommandSuggestion {
    pub command: String,
    pub risk: AiCommandRisk,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiCommandAssessment {
    pub command: String,
    pub risk: AiCommandRisk,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiCommandAssessRequest {
    pub command: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiToolCallRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub command: Option<String>,
    pub status: String,
    #[serde(default)]
    pub risk: Option<AiCommandRisk>,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default)]
    pub exit_status: Option<u32>,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub output_truncated: bool,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub text_offset: usize,
    #[serde(default)]
    pub created_at_ms: u128,
    #[serde(default)]
    pub started_at_ms: Option<u128>,
    #[serde(default)]
    pub finished_at_ms: Option<u128>,
    #[serde(default)]
    pub approval_required: bool,
    #[serde(default)]
    pub approval_decision: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub workspace: Option<String>,
}

impl AiToolCallRecord {
    pub(crate) fn new(id: &str, name: &str, text_offset: usize) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            command: None,
            status: TOOL_STATUS_RUNNING.to_string(),
            risk: None,
            reasons: Vec::new(),
            exit_status: None,
            output: String::new(),
            output_truncated: false,
            duration_ms: None,
            error: None,
            text_offset,
            created_at_ms: 0,
            started_at_ms: None,
            finished_at_ms: None,
            approval_required: false,
            approval_decision: None,
            connection_id: None,
            workspace: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AiChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub thinking: String,
    pub contexts: Vec<AiContextBlock>,
    pub commands: Vec<AiCommandSuggestion>,
    pub tool_calls: Vec<AiToolCallRecord>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiChatSessionSummary {
    pub id: String,
    pub title: String,
    pub provider_config_id: Option<String>,
    pub host_scope: Option<String>,
    pub connection_id: Option<String>,
    pub message_count: usize,
    pub last_message_preview: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiChatSession {
    pub summary: AiChatSessionSummary,
    pub messages: Vec<AiChatMessage>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiChatSessionIdRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiChatStreamStartRequest {
    pub provider_config_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub content: String,
    #[serde(default)]
    pub contexts: Vec<AiContextBlock>,
    #[serde(default)]
    pub agent: Option<AiAgentRequest>,
    #[serde(default)]
    pub reasoning_level: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub host_scope: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiAgentRequest {
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub workspace_type: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub local_workspace_path: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub terminal_output: Option<String>,
    #[serde(default)]
    pub terminal_session_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum AiAgentMode {
    #[default]
    Execute,
    Full,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiChatToolDecisionRequest {
    pub stream_id: String,
    pub tool_call_id: String,
    pub approved: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiChatStreamStartResponse {
    pub stream_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AiChatStreamStopRequest {
    pub stream_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct AiModelMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Clone)]
pub struct AiChatStreamManager {
    streams: Arc<AsyncMutex<HashMap<String, AiChatStreamHandle>>>,
    exec_pool: RemoteExecSessionPool,
    tasks: Arc<StdMutex<HashMap<String, Arc<ai_agent::BackgroundTask>>>>,
}

struct AiChatStreamHandle {
    session_id: String,
    message_id: String,
    content: Arc<StdMutex<String>>,
    thinking: Arc<StdMutex<String>>,
    tool_calls: Arc<StdMutex<Vec<AiToolCallRecord>>>,
    approvals: PendingApprovals,
    emitter: StreamEmitter,
    stopped: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

struct PreparedAiStream {
    config: StoredAiProviderConfig,
    api_key: String,
    messages: Vec<AiModelMessage>,
    agent: Option<PreparedAgent>,
    reasoning_level: Option<String>,
    response: AiChatStreamStartResponse,
}

#[derive(Clone)]
pub(crate) struct StreamEmitter {
    app: AppHandle,
    stream_id: String,
    session_id: String,
    message_id: String,
}

impl StreamEmitter {
    pub(crate) fn audit(&self, record: &AiToolCallRecord) -> Result<(), AppError> {
        crate::ai_audit::append(&self.app, &self.session_id, &self.message_id, record)
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }
    fn event(&self, kind: &str) -> AiChatStreamEvent {
        AiChatStreamEvent {
            kind: kind.to_string(),
            stream_id: self.stream_id.clone(),
            session_id: self.session_id.clone(),
            message_id: self.message_id.clone(),
            delta: None,
            thinking_delta: None,
            content: None,
            error: None,
            tool_call: None,
        }
    }

    fn emit(&self, event: AiChatStreamEvent) {
        let _ = self.app.emit(AI_CHAT_STREAM_EVENT, event);
    }

    pub(crate) fn chunk(&self, delta: String) {
        self.emit(AiChatStreamEvent {
            delta: Some(delta),
            ..self.event("chunk")
        });
    }

    pub(crate) fn thinking(&self, delta: String) {
        self.emit(AiChatStreamEvent {
            thinking_delta: Some(delta),
            ..self.event("thinking")
        });
    }

    pub(crate) fn tool_call(&self, record: AiToolCallRecord) {
        self.emit(AiChatStreamEvent {
            tool_call: Some(record),
            ..self.event("tool_call")
        });
    }

    fn finished(&self, content: String) {
        self.emit(AiChatStreamEvent {
            content: Some(content),
            ..self.event("finished")
        });
    }

    fn stopped(&self, content: String) {
        self.emit(AiChatStreamEvent {
            content: Some(content),
            ..self.event("stopped")
        });
    }

    fn failed(&self, content: String, error: String) {
        self.emit(AiChatStreamEvent {
            content: Some(content),
            error: Some(error),
            ..self.event("error")
        });
    }
}

struct ValidatedAiProviderConfigInput {
    id: Option<String>,
    name: Option<String>,
    provider: AiProviderKind,
    api_format: AiApiFormat,
    endpoint: String,
    model: Option<String>,
    models: Vec<AiModelConfig>,
    thinking_mode: Option<String>,
}

impl Default for AiChatStreamManager {
    fn default() -> Self {
        Self {
            streams: Arc::new(AsyncMutex::new(HashMap::new())),
            exec_pool: RemoteExecSessionPool::default(),
            tasks: Arc::new(StdMutex::new(HashMap::new())),
        }
    }
}

impl AiChatStreamManager {
    async fn start(&self, app: AppHandle, prepared: PreparedAiStream) -> Result<(), AppError> {
        let stream_id = prepared.response.stream_id.clone();
        let session_id = prepared.response.session_id.clone();
        let message_id = prepared.response.assistant_message_id.clone();
        let emitter = StreamEmitter {
            app: app.clone(),
            stream_id: stream_id.clone(),
            session_id: session_id.clone(),
            message_id: message_id.clone(),
        };
        let content = Arc::new(StdMutex::new(String::new()));
        let thinking = Arc::new(StdMutex::new(String::new()));
        let tool_calls = Arc::new(StdMutex::new(Vec::new()));
        let approvals: PendingApprovals = Arc::new(StdMutex::new(HashMap::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = self.clone();
        let task_content = Arc::clone(&content);
        let task_thinking = Arc::clone(&thinking);
        let task_tool_calls = Arc::clone(&tool_calls);
        let task_approvals = Arc::clone(&approvals);
        let task_stopped = Arc::clone(&stopped);
        let task_tasks = Arc::clone(&self.tasks);
        let task_emitter = emitter.clone();

        let task = tokio::spawn(async move {
            let PreparedAiStream {
                config,
                api_key,
                messages,
                agent,
                reasoning_level,
                ..
            } = prepared;
            let result = match agent.as_ref() {
                Some(agent) => {
                    let run = AgentRun {
                        app: &app,
                        provider: &config,
                        api_key: &api_key,
                        agent,
                        pool: &manager.exec_pool,
                        stopped: Arc::clone(&task_stopped),
                        content: Arc::clone(&task_content),
                        thinking: Arc::clone(&task_thinking),
                        tool_calls: Arc::clone(&task_tool_calls),
                        approvals: Arc::clone(&task_approvals),
                        emitter: &task_emitter,
                        pending_separator: AtomicBool::new(false),
                        reasoning_level: reasoning_level.as_deref(),
                        files: tokio::sync::Mutex::new(Default::default()),
                        audit_failed: AtomicBool::new(false),
                        tasks: Arc::clone(&task_tasks),
                    };
                    ai_agent::run_agent(&run, messages).await
                }
                None => {
                    run_provider_stream(
                        &config,
                        &api_key,
                        reasoning_level.as_deref(),
                        messages,
                        Arc::clone(&task_stopped),
                        |delta| {
                            if delta.is_empty() {
                                return;
                            }
                            if let Ok(mut current) = task_content.lock() {
                                current.push_str(&delta);
                            }
                            task_emitter.chunk(delta);
                        },
                        |delta| {
                            if delta.is_empty() {
                                return;
                            }
                            if let Ok(mut current) = task_thinking.lock() {
                                current.push_str(&delta);
                            }
                            task_emitter.thinking(delta);
                        },
                    )
                    .await
                }
            };

            if task_stopped.load(Ordering::SeqCst) {
                manager.finish_stream(&task_emitter.stream_id).await;
                return;
            }

            let final_content = strip_tool_call_summary(locked_string(&task_content));
            let final_thinking = locked_string(&task_thinking);
            let final_tool_calls = settle_tool_calls(&task_tool_calls, &task_emitter);
            let (status, error) = match result {
                Ok(()) => ("complete", None),
                Err(error) => ("error", Some(error.message)),
            };
            let _ = update_assistant_message(
                &app,
                &task_emitter.session_id,
                &task_emitter.message_id,
                &final_content,
                &final_thinking,
                status,
                &final_tool_calls,
            );
            match error {
                None => task_emitter.finished(final_content),
                Some(error) => task_emitter.failed(final_content, error),
            }

            manager.finish_stream(&task_emitter.stream_id).await;
        });

        let previous = {
            let mut streams = self.streams.lock().await;
            streams.insert(
                stream_id,
                AiChatStreamHandle {
                    session_id,
                    message_id,
                    content,
                    thinking,
                    tool_calls,
                    approvals,
                    emitter,
                    stopped,
                    task,
                },
            )
        };
        close_stream_handle(previous);

        Ok(())
    }

    async fn decide_tool_call(&self, request: AiChatToolDecisionRequest) -> Result<(), AppError> {
        let stream_id = require_non_empty(
            &request.stream_id,
            "ai_stream_missing",
            "AI 生成流标识缺失。",
        )?;
        let tool_call_id = require_non_empty(
            &request.tool_call_id,
            "ai_tool_call_missing",
            "AI 工具调用标识缺失。",
        )?;
        let approvals = self
            .streams
            .lock()
            .await
            .get(stream_id)
            .map(|handle| Arc::clone(&handle.approvals));
        let sender = approvals.and_then(|approvals| {
            approvals
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(tool_call_id))
        });
        if let Some(sender) = sender {
            let _ = sender.send(request.approved);
        }
        Ok(())
    }

    async fn stop(
        &self,
        app: &AppHandle,
        request: AiChatStreamStopRequest,
    ) -> Result<(), AppError> {
        let stream_id = require_non_empty(
            &request.stream_id,
            "ai_stream_missing",
            "AI 生成流标识缺失。",
        )?;
        let removed = self.streams.lock().await.remove(stream_id);
        let Some(handle) = removed else {
            return Ok(());
        };
        handle.stopped.store(true, Ordering::SeqCst);
        handle.task.abort();
        let content = locked_string(&handle.content);
        let thinking = locked_string(&handle.thinking);
        let tool_calls = settle_tool_calls(&handle.tool_calls, &handle.emitter);
        let _ = update_assistant_message(
            app,
            &handle.session_id,
            &handle.message_id,
            &content,
            &thinking,
            "stopped",
            &tool_calls,
        );
        handle.emitter.stopped(content);
        Ok(())
    }

    async fn finish_stream(&self, stream_id: &str) {
        let removed = self.streams.lock().await.remove(stream_id);
        if let Some(handle) = removed {
            handle.stopped.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub fn ai_provider_config_list(app: AppHandle) -> Result<Vec<AiProviderConfig>, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    list_provider_configs(&repository)
}

#[tauri::command]
pub fn ai_provider_config_save(
    app: AppHandle,
    request: AiProviderConfigInput,
) -> Result<AiProviderConfig, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    save_provider_config(&repository, request, &now_timestamp()?)
}

#[tauri::command]
pub fn ai_provider_config_delete(
    app: AppHandle,
    request: AiProviderConfigIdRequest,
) -> Result<(), AppError> {
    let repository = StorageRepository::open_app(&app)?;
    delete_provider_config(&repository, request)
}

#[tauri::command]
pub fn ai_provider_config_reveal_api_key(
    app: AppHandle,
    request: AiProviderConfigIdRequest,
) -> Result<RevealedAiProviderApiKey, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    reveal_provider_config_api_key(&repository, request)
}

#[tauri::command]
pub async fn ai_provider_config_test(
    app: AppHandle,
    request: AiProviderConfigInput,
) -> Result<AiProviderConfigTestResult, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    let validated = validate_provider_config_input(&request, false, true)?;
    let api_key = resolve_request_api_key(&repository, &request)?;
    let config = StoredAiProviderConfig {
        id: validated
            .id
            .clone()
            .unwrap_or_else(|| "ai-provider-test".to_string()),
        name: validated
            .name
            .clone()
            .unwrap_or_else(|| "测试配置".to_string()),
        provider: validated.provider,
        api_format: validated.api_format,
        endpoint: validated.endpoint,
        model: validated.model.unwrap_or_default(),
        models: validated.models.clone(),
        thinking_mode: validated.thinking_mode,
        secret_slot_id: None,
        created_at: String::new(),
        updated_at: String::new(),
    };
    test_provider_config_connectivity(&config, &api_key).await?;
    Ok(AiProviderConfigTestResult {
        message: "AI 配置测试通过，可正常访问模型接口。".to_string(),
    })
}

#[tauri::command]
pub async fn ai_provider_models_list(
    app: AppHandle,
    request: AiProviderConfigInput,
) -> Result<Vec<AiProviderModelOption>, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    let validated = validate_provider_config_input(&request, false, false)?;
    let api_key = resolve_request_api_key(&repository, &request)?;
    let config = StoredAiProviderConfig {
        id: validated
            .id
            .clone()
            .unwrap_or_else(|| "ai-provider-models".to_string()),
        name: validated
            .name
            .clone()
            .unwrap_or_else(|| "模型列表".to_string()),
        provider: validated.provider,
        api_format: validated.api_format,
        endpoint: validated.endpoint,
        model: validated.model.unwrap_or_default(),
        models: validated.models.clone(),
        thinking_mode: validated.thinking_mode,
        secret_slot_id: None,
        created_at: String::new(),
        updated_at: String::new(),
    };
    list_provider_models(&config, &api_key).await
}

#[tauri::command]
pub fn ai_chat_session_list(app: AppHandle) -> Result<Vec<AiChatSessionSummary>, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    list_chat_sessions(&repository)
}

#[tauri::command]
pub fn ai_chat_session_get(
    app: AppHandle,
    request: AiChatSessionIdRequest,
) -> Result<AiChatSession, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    get_chat_session(&repository, &request.session_id)
}

#[tauri::command]
pub fn ai_chat_session_delete(
    app: AppHandle,
    request: AiChatSessionIdRequest,
) -> Result<(), AppError> {
    let repository = StorageRepository::open_app(&app)?;
    let session_id = require_non_empty(
        &request.session_id,
        "ai_session_missing",
        "AI 会话标识缺失。",
    )?;
    repository
        .sqlite_connection()
        .execute(
            "DELETE FROM ai_chat_sessions WHERE id = ?1",
            params![session_id],
        )
        .map_err(sqlite_ai_error)?;
    Ok(())
}

#[tauri::command]
pub fn ai_chat_session_clear(
    app: AppHandle,
    request: AiChatSessionIdRequest,
) -> Result<AiChatSession, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    let session_id = require_non_empty(
        &request.session_id,
        "ai_session_missing",
        "AI 会话标识缺失。",
    )?
    .to_string();
    let now = now_timestamp()?;
    let changed = repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_sessions SET updated_at = ?2 WHERE id = ?1",
            params![session_id, now],
        )
        .map_err(sqlite_ai_error)?;
    if changed == 0 {
        return Err(ai_session_missing());
    }
    repository
        .sqlite_connection()
        .execute(
            "DELETE FROM ai_chat_messages WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(sqlite_ai_error)?;
    get_chat_session(&repository, &session_id)
}

#[tauri::command]
pub async fn ai_chat_stream_start(
    app: AppHandle,
    manager: State<'_, AiChatStreamManager>,
    request: AiChatStreamStartRequest,
) -> Result<AiChatStreamStartResponse, AppError> {
    let prepared = prepare_stream(&app, request)?;
    let response = prepared.response.clone();
    manager.start(app, prepared).await?;
    Ok(response)
}

#[tauri::command]
pub async fn ai_chat_stream_stop(
    app: AppHandle,
    manager: State<'_, AiChatStreamManager>,
    request: AiChatStreamStopRequest,
) -> Result<(), AppError> {
    manager.stop(&app, request).await
}

#[tauri::command]
pub async fn ai_chat_tool_decision(
    manager: State<'_, AiChatStreamManager>,
    request: AiChatToolDecisionRequest,
) -> Result<(), AppError> {
    manager.decide_tool_call(request).await
}

#[tauri::command]
pub fn ai_command_assess(request: AiCommandAssessRequest) -> Result<AiCommandAssessment, AppError> {
    Ok(assess_command(&request.command))
}

fn prepare_stream(
    app: &AppHandle,
    request: AiChatStreamStartRequest,
) -> Result<PreparedAiStream, AppError> {
    let user_content = request.content.trim().to_string();
    if user_content.is_empty() {
        return Err(AppError::new(
            "ai_message_missing",
            "请输入要发送给 AI 的问题。",
            "message is blank",
            true,
        ));
    }
    let provider_config_id = require_non_empty(
        &request.provider_config_id,
        "ai_provider_config_missing",
        "请选择 AI 配置。",
    )?
    .to_string();
    let now = now_timestamp()?;
    let stream_id = Uuid::new_v4().to_string();
    let user_message_id = Uuid::new_v4().to_string();
    let assistant_message_id = Uuid::new_v4().to_string();
    let repository = StorageRepository::open_app(app)?;
    let mut config = load_stored_provider_config(&repository, &provider_config_id)?
        .ok_or_else(ai_provider_config_missing)?;
    apply_model_override(&mut config, request.model.as_deref());
    let api_key = api_key_for_config(&repository, &config)?;
    let reasoning_level = effective_reasoning_level(&config, request.reasoning_level.as_deref())?;
    let agent = request
        .agent
        .map(|agent| prepare_agent(app, agent))
        .transpose()?;
    let host_scope = validate_bounded_tag(
        request.host_scope,
        "ai_host_scope_invalid",
        "会话主机标识过长。",
    )?;
    let session_connection_id = validate_bounded_tag(
        request.connection_id,
        "ai_connection_id_invalid",
        "连接标识过长。",
    )?;
    let session_id = match trim_optional(request.session_id).as_deref() {
        Some(existing_id) => {
            ensure_chat_session_exists(&repository, existing_id)?;
            repository
                .sqlite_connection()
                .execute(
                    "UPDATE ai_chat_sessions
                        SET provider_config_id = ?2, updated_at = ?3
                      WHERE id = ?1",
                    params![existing_id, provider_config_id, now],
                )
                .map_err(sqlite_ai_error)?;
            existing_id.to_string()
        }
        None => {
            let next_id = Uuid::new_v4().to_string();
            repository
                .sqlite_connection()
                .execute(
                    "INSERT INTO ai_chat_sessions(id, title, provider_config_id, host_scope, connection_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![
                        next_id,
                        chat_title_from_content(&user_content),
                        provider_config_id,
                        host_scope,
                        session_connection_id,
                        now,
                    ],
                )
                .map_err(sqlite_ai_error)?;
            next_id
        }
    };

    let previous_messages = list_chat_messages(&repository, &session_id)?;
    let contexts = normalize_context_blocks(request.contexts);
    insert_chat_message(
        &repository,
        InsertChatMessage {
            id: &user_message_id,
            session_id: &session_id,
            role: "user",
            content: &user_content,
            contexts: &contexts,
            commands: &[],
            status: "complete",
            now: &now,
        },
    )?;
    insert_chat_message(
        &repository,
        InsertChatMessage {
            id: &assistant_message_id,
            session_id: &session_id,
            role: "assistant",
            content: "",
            contexts: &[],
            commands: &[],
            status: "streaming",
            now: &now,
        },
    )?;
    repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_sessions SET updated_at = ?2 WHERE id = ?1",
            params![session_id, now],
        )
        .map_err(sqlite_ai_error)?;

    let mut model_messages = model_messages_from_history(previous_messages);
    model_messages.push(AiModelMessage {
        role: "user".to_string(),
        content: format_user_message_for_model(&user_content, &contexts),
    });

    Ok(PreparedAiStream {
        config,
        api_key,
        messages: model_messages,
        agent,
        reasoning_level,
        response: AiChatStreamStartResponse {
            stream_id,
            session_id,
            user_message_id,
            assistant_message_id,
        },
    })
}

/// Applies a per-request model override to a stored provider config clone.
///
/// The override only affects the in-memory config used to build this stream
/// (including the agent path, because `PreparedAiStream` carries the same
/// config); it is never written back to storage. Blank or whitespace-only
/// values are treated as "not sent" and keep the stored model.
fn apply_model_override(config: &mut StoredAiProviderConfig, requested: Option<&str>) {
    if let Some(model) = trim_optional(requested.map(str::to_string)) {
        config.model = model;
    }
}

fn prepare_agent(app: &AppHandle, request: AiAgentRequest) -> Result<PreparedAgent, AppError> {
    let workspace_type = request
        .workspace_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if request
                .connection_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            {
                "remote"
            } else {
                "local"
            }
        });
    if !matches!(workspace_type, "local" | "remote") {
        return Err(AppError::new(
            "ai_workspace_type_invalid",
            "工作区类型无效。",
            workspace_type,
            true,
        ));
    }
    let (config, host_local_directory, default_directory) = if workspace_type == "local" {
        let root = if let Some(path) = trim_optional(
            request
                .working_directory
                .clone()
                .or(request.workspace_path.clone()),
        ) {
            crate::ai_workspace::validate_workspace_root(&path)?
        } else {
            let current = std::env::current_dir().map_err(|error| {
                AppError::new(
                    "ai_agent_workspace_unavailable",
                    "无法获取默认本地工作目录。",
                    error,
                    true,
                )
            })?;
            crate::ai_workspace::validate_workspace_root(&current.to_string_lossy())?
        };
        let directory = root.to_string_lossy().to_string();
        (None, Some(root), Some(directory))
    } else {
        let connection_id = require_non_empty(
            request.connection_id.as_deref().unwrap_or_default(),
            "ai_agent_connection_missing",
            "远程 Agent 需要当前 SSH 连接。",
        )?;
        let directory = trim_optional(request.workspace_path.clone())
            .or_else(|| trim_optional(request.working_directory.clone()));
        if let Some(directory) = directory.as_deref() {
            if !directory.starts_with('/') {
                return Err(AppError::new(
                    "ai_workspace_path_invalid",
                    "远程工作目录必须是绝对路径。",
                    "absolute POSIX path required",
                    true,
                ));
            }
        }
        (
            Some(resolve_saved_connection(app, connection_id, None)?),
            None,
            directory,
        )
    };
    let local_workspace = trim_optional(request.local_workspace_path)
        .map(|path| crate::ai_workspace::validate_workspace_root(&path))
        .transpose()?;
    let terminal_output = trim_optional(request.terminal_output)
        .map(|output| tail_chars_owned(&output, MAX_AGENT_TERMINAL_OUTPUT_CHARS));
    let mode = match request.mode.as_deref() {
        Some("full") => AiAgentMode::Full,
        _ => AiAgentMode::Execute,
    };
    Ok(PreparedAgent {
        config,
        mode,
        working_directory: default_directory,
        host_local_directory,
        local_workspace,
        terminal_output,
        terminal_session_id: trim_optional(request.terminal_session_id),
    })
}

fn tail_chars_owned(value: &str, max_chars: usize) -> String {
    let total = value.chars().count();
    if total <= max_chars {
        return value.to_string();
    }
    value.chars().skip(total - max_chars).collect()
}

fn settle_tool_calls(
    tool_calls: &Arc<StdMutex<Vec<AiToolCallRecord>>>,
    emitter: &StreamEmitter,
) -> Vec<AiToolCallRecord> {
    let (records, settled) = match tool_calls.lock() {
        Ok(mut calls) => {
            let mut settled = Vec::new();
            for call in calls.iter_mut() {
                if call.status == TOOL_STATUS_RUNNING || call.status == TOOL_STATUS_PENDING_APPROVAL
                {
                    call.status = TOOL_STATUS_CANCELLED.to_string();
                    settled.push(call.clone());
                }
            }
            (calls.clone(), settled)
        }
        Err(_) => (Vec::new(), Vec::new()),
    };
    for record in settled {
        emitter.tool_call(record);
    }
    records
}

fn list_provider_configs(
    repository: &StorageRepository,
) -> Result<Vec<AiProviderConfig>, AppError> {
    load_stored_provider_configs(repository)?
        .into_iter()
        .map(|config| provider_config_from_stored(repository, config))
        .collect()
}

fn save_provider_config(
    repository: &StorageRepository,
    request: AiProviderConfigInput,
    now: &str,
) -> Result<AiProviderConfig, AppError> {
    let validated = validate_provider_config_input(&request, true, request.models.is_empty())?;
    let name = validated.name.unwrap_or_default();
    let endpoint = validated.endpoint;
    let model = validated.model.unwrap_or_default();

    let mut configs = load_stored_provider_configs(repository)?;
    let id = validated.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing_index = configs.iter().position(|config| config.id == id);
    let existing = existing_index.and_then(|index| configs.get(index).cloned());
    let secret_slot_id = existing
        .as_ref()
        .and_then(|config| config.secret_slot_id.clone())
        .unwrap_or_else(|| ai_secret_slot_id(&id));
    let stored = StoredAiProviderConfig {
        id: id.clone(),
        name,
        provider: validated.provider,
        api_format: validated.api_format,
        endpoint,
        model,
        models: validated.models,
        thinking_mode: validated.thinking_mode,
        secret_slot_id: Some(secret_slot_id.clone()),
        created_at: existing
            .as_ref()
            .map(|config| config.created_at.clone())
            .unwrap_or_else(|| now.to_string()),
        updated_at: now.to_string(),
    };

    if request.api_key_touched {
        let reference = ai_api_key_reference(&secret_slot_id);
        if let Some(api_key) = trim_optional(request.api_key) {
            repository.secret_set(&reference, &api_key)?;
        } else {
            repository.secret_delete(&reference)?;
        }
    }

    if let Some(index) = existing_index {
        configs[index] = stored.clone();
    } else {
        configs.push(stored.clone());
    }
    repository.app_setting_set(AI_PROVIDER_CONFIGS_KEY, &configs, now)?;
    provider_config_from_stored(repository, stored)
}

fn delete_provider_config(
    repository: &StorageRepository,
    request: AiProviderConfigIdRequest,
) -> Result<(), AppError> {
    let id = require_non_empty(
        &request.id,
        "ai_provider_config_missing",
        "请选择 AI 配置。",
    )?;
    let mut configs = load_stored_provider_configs(repository)?;
    let removed = configs
        .iter()
        .find(|config| config.id == id)
        .cloned()
        .ok_or_else(ai_provider_config_missing)?;
    configs.retain(|config| config.id != id);
    if let Some(slot_id) = removed.secret_slot_id {
        repository.secret_delete(&ai_api_key_reference(&slot_id))?;
    }
    let now = now_timestamp()?;
    repository.app_setting_set(AI_PROVIDER_CONFIGS_KEY, &configs, &now)?;
    repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_sessions SET provider_config_id = NULL WHERE provider_config_id = ?1",
            params![id],
        )
        .map_err(sqlite_ai_error)?;
    Ok(())
}

fn reveal_provider_config_api_key(
    repository: &StorageRepository,
    request: AiProviderConfigIdRequest,
) -> Result<RevealedAiProviderApiKey, AppError> {
    let id = require_non_empty(
        &request.id,
        "ai_provider_config_missing",
        "请选择 AI 配置。",
    )?;
    let config =
        load_stored_provider_config(repository, id)?.ok_or_else(ai_provider_config_missing)?;
    Ok(RevealedAiProviderApiKey {
        api_key: api_key_for_config(repository, &config)?,
    })
}

pub(crate) fn validate_thinking_mode(mode: Option<&str>) -> Result<Option<String>, AppError> {
    let mode = trim_optional(mode.map(str::to_string));
    match mode.as_deref() {
        None => Ok(None),
        Some(value) if value == THINKING_MODE_AUTO || value == THINKING_MODE_OFF => Ok(mode),
        Some(other) => Err(AppError::new(
            "ai_thinking_mode_invalid",
            "思考参数模式必须是 auto 或 off。",
            format!("thinking_mode={other}"),
            true,
        )),
    }
}

pub(crate) fn validate_reasoning_level(level: Option<&str>) -> Result<Option<String>, AppError> {
    let level = trim_optional(level.map(str::to_string));
    match level.as_deref() {
        None => Ok(None),
        Some(value)
            if value.len() <= 64
                && value.chars().all(|character| {
                    character.is_ascii_alphanumeric() || "_-.:".contains(character)
                }) =>
        {
            Ok(level)
        }
        Some(other) => Err(AppError::new(
            "ai_reasoning_level_invalid",
            "思考等级格式无效。",
            format!("reasoning_level={other}"),
            true,
        )),
    }
}

/// provider 思考模式与请求档位组合出本次请求的有效档位；off 或未选时返回 None，不携带任何思考字段。
pub(crate) fn effective_reasoning_level(
    config: &StoredAiProviderConfig,
    requested: Option<&str>,
) -> Result<Option<String>, AppError> {
    if config.thinking_mode.as_deref() == Some(THINKING_MODE_OFF) {
        return Ok(None);
    }
    validate_reasoning_level(requested)
}

pub(crate) fn apply_openai_reasoning_fields(body: &mut Value, level: Option<&str>) {
    if let Some(level) = level {
        let disabled = matches!(level, "disabled" | "off" | "none");
        let effort = if disabled {
            "none"
        } else if level == "enabled" {
            "high"
        } else {
            level
        };
        body["thinking"] = json!({ "type": if disabled { "disabled" } else { "enabled" } });
        body["enable_thinking"] = json!(!disabled);
        body["reasoning_effort"] = json!(effort);
        body["reasoning"] = json!({ "effort": effort });
    }
}

pub(crate) fn apply_anthropic_reasoning_fields(
    body: &mut Value,
    level: Option<&str>,
    base_max_tokens: u32,
) {
    if let Some(level) = level {
        if matches!(level, "disabled" | "off" | "none") {
            body["thinking"] = json!({ "type": "disabled" });
            return;
        }
        if level == "enabled" {
            body["thinking"] = json!({ "type": "adaptive" });
            body["output_config"] = json!({ "effort": "high" });
            return;
        }
        let index = REASONING_LEVELS
            .iter()
            .position(|value| *value == level)
            .unwrap_or(1);
        let budget = ANTHROPIC_THINKING_BUDGET_TOKENS[index];
        body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
        body["max_tokens"] = json!(budget + base_max_tokens);
    }
}

fn validate_provider_config_input(
    request: &AiProviderConfigInput,
    require_name: bool,
    require_model: bool,
) -> Result<ValidatedAiProviderConfigInput, AppError> {
    let name = if require_name {
        Some(
            require_non_empty(
                &request.name,
                "ai_provider_name_missing",
                "请输入配置名称。",
            )?
            .to_string(),
        )
    } else {
        trim_optional(Some(request.name.clone()))
    };
    let endpoint = require_non_empty(
        &request.endpoint,
        "ai_provider_endpoint_missing",
        "请输入请求地址。",
    )?
    .to_string();
    let model = if require_model {
        Some(
            require_non_empty(
                &request.model,
                "ai_provider_model_missing",
                "请输入模型名称。",
            )?
            .to_string(),
        )
    } else {
        trim_optional(Some(request.model.clone()))
    };
    let mut models = request
        .models
        .iter()
        .filter_map(|model| {
            let id = model.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(AiModelConfig {
                id,
                context_window: model.context_window.max(1),
                max_output_tokens: model.max_output_tokens.filter(|value| *value > 0),
                enabled: model.enabled,
            })
        })
        .collect::<Vec<_>>();
    if models.is_empty() {
        if let Some(model_id) = model.as_deref() {
            models.push(AiModelConfig {
                id: model_id.to_string(),
                context_window: default_context_window(),
                max_output_tokens: None,
                enabled: true,
            });
        }
    }
    let _ = normalize_endpoint(&endpoint, request.api_format)?;
    let thinking_mode = validate_thinking_mode(request.thinking_mode.as_deref())?;
    Ok(ValidatedAiProviderConfigInput {
        id: trim_optional(request.id.clone()),
        name,
        provider: request.provider,
        api_format: request.api_format,
        endpoint,
        model,
        models,
        thinking_mode,
    })
}

fn resolve_request_api_key(
    repository: &StorageRepository,
    request: &AiProviderConfigInput,
) -> Result<String, AppError> {
    if let Some(api_key) = trim_optional(request.api_key.clone()) {
        return Ok(api_key);
    }
    let config_id = match trim_optional(request.id.clone()) {
        Some(id) => id,
        None => return Err(ai_api_key_missing()),
    };
    let config = load_stored_provider_config(repository, &config_id)?
        .ok_or_else(ai_provider_config_missing)?;
    api_key_for_config(repository, &config)
}

async fn test_provider_config_connectivity(
    config: &StoredAiProviderConfig,
    api_key: &str,
) -> Result<(), AppError> {
    let stopped = Arc::new(AtomicBool::new(false));
    timeout(
        Duration::from_secs(20),
        run_provider_stream(
            config,
            api_key,
            None,
            vec![AiModelMessage {
                role: "user".to_string(),
                content: "请仅回复 OK。".to_string(),
            }],
            stopped,
            |_| {},
            |_| {},
        ),
    )
    .await
    .map_err(|_| {
        AppError::new(
            "ai_provider_test_timeout",
            "AI 配置测试超时。",
            "provider test timed out",
            true,
        )
    })??;
    Ok(())
}

async fn list_provider_models(
    config: &StoredAiProviderConfig,
    api_key: &str,
) -> Result<Vec<AiProviderModelOption>, AppError> {
    let client = Client::new();
    let models = timeout(Duration::from_secs(20), async {
        match config.api_format {
            AiApiFormat::OpenaiCompatible | AiApiFormat::Responses => {
                list_openai_models(&client, config, api_key).await
            }
            AiApiFormat::Anthropic => list_anthropic_models(&client, config, api_key).await,
        }
    })
    .await
    .map_err(|_| {
        AppError::new(
            "ai_provider_models_timeout",
            "获取模型列表超时。",
            "provider models request timed out",
            true,
        )
    })??;

    if models.is_empty() {
        return Err(AppError::new(
            "ai_provider_models_empty",
            "接口没有返回可用模型。",
            "provider models list is empty",
            true,
        ));
    }
    Ok(models)
}

async fn list_openai_models(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
) -> Result<Vec<AiProviderModelOption>, AppError> {
    let endpoint = normalize_models_endpoint(&config.endpoint, AiApiFormat::OpenaiCompatible)?;
    let response = client
        .get(endpoint)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    let value: Value = response.json().await.map_err(provider_request_error)?;
    parse_openai_models_list(&value)
}

async fn list_anthropic_models(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
) -> Result<Vec<AiProviderModelOption>, AppError> {
    let endpoint = normalize_models_endpoint(&config.endpoint, AiApiFormat::Anthropic)?;
    let response = client
        .get(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", DEFAULT_ANTHROPIC_VERSION)
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    let value: Value = response.json().await.map_err(provider_request_error)?;
    parse_anthropic_models_list(&value)
}

fn parse_openai_models_list(value: &Value) -> Result<Vec<AiProviderModelOption>, AppError> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_models_response_error("openai-compatible models list"))?;
    let mut models = data
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let owned_by = item.get("owned_by").and_then(Value::as_str).map(str::trim);
            let subtitle = owned_by
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let (reasoning_levels, reasoning_default_level) = reasoning_metadata(item, &id);
            Some(AiProviderModelOption {
                id,
                display_name: None,
                subtitle,
                reasoning_levels,
                reasoning_default_level,
            })
        })
        .collect::<Vec<_>>();
    sort_models(&mut models);
    Ok(models)
}

fn parse_anthropic_models_list(value: &Value) -> Result<Vec<AiProviderModelOption>, AppError> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_models_response_error("anthropic models list"))?;
    let mut models = data
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(Value::as_str)?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let display_name = item
                .get("display_name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let subtitle = item
                .get("created_at")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let (reasoning_levels, reasoning_default_level) = reasoning_metadata(item, &id);
            Some(AiProviderModelOption {
                id,
                display_name,
                subtitle,
                reasoning_levels,
                reasoning_default_level,
            })
        })
        .collect::<Vec<_>>();
    sort_models(&mut models);
    Ok(models)
}

/// 不同供应商对 `/models` 能力字段的命名并不统一；按结构读取常见的
/// OpenAI/ZCode 兼容形态，保留“未声明”和“声明为空”两种状态。
///
/// 部分网关只返回模型 ID，不会把能力字段透传出来。已知模型会沿用本地
/// 模型规则，其他模型才回退到通用二态默认，避免把未知模型误判成多档能力。
fn reasoning_metadata(item: &Value, model_id: &str) -> (Option<Vec<String>>, Option<String>) {
    let option_spec = item
        .get("config")
        .and_then(|value| value.get("optionSpecs"))
        .and_then(|value| value.get("reasoningLevel"));
    let candidates = [
        item.get("reasoning"),
        item.get("reasoning_levels"),
        item.get("reasoningLevels"),
        item.get("supported_reasoning_levels"),
        item.get("supportedReasoningLevels"),
        item.get("reasoning_effort"),
        option_spec,
        item.get("optionSpecs")
            .and_then(|value| value.get("reasoningLevel")),
    ];

    for candidate in candidates.into_iter().flatten() {
        let (levels, default_level) = match candidate {
            Value::Array(_) => (read_reasoning_levels(candidate), None),
            Value::Object(object) => {
                let levels_value = object
                    .get("levels")
                    .or_else(|| object.get("variants"))
                    .or_else(|| object.get("values"))
                    .or_else(|| object.get("supported_levels"))
                    .or_else(|| object.get("supportedLevels"))
                    .or_else(|| object.get("supported_values"))
                    .or_else(|| object.get("supportedValues"))
                    .or_else(|| object.get("efforts"));
                let levels = levels_value.and_then(read_reasoning_levels);
                let default_level = ["defaultLevel", "default_level", "default"]
                    .iter()
                    .find_map(|key| object.get(*key).and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                (levels, default_level)
            }
            _ => (None, None),
        };
        if levels.is_some() || default_level.is_some() {
            let default_level = default_level.filter(|value| {
                levels
                    .as_ref()
                    .is_none_or(|values| values.iter().any(|item| item == value))
            });
            return (levels, default_level);
        }
    }
    if let Some((levels, default_level)) = model_specific_reasoning_metadata(model_id) {
        return (Some(levels), Some(default_level));
    }
    if declares_reasoning_capability(item) {
        let default_level = item
            .get("reasoning_effort")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| REASONING_LEVELS.contains(value))
            .map(str::to_string);
        return (Some(known_reasoning_levels()), default_level);
    }
    default_reasoning_metadata(model_id).unwrap_or((None, None))
}

fn declares_reasoning_capability(item: &Value) -> bool {
    [
        item.get("reasoning"),
        item.get("supports_reasoning"),
        item.get("capabilities"),
        item.get("supported_parameters"),
        item.get("reasoning_effort"),
    ]
    .into_iter()
    .flatten()
    .any(value_declares_reasoning)
}

fn value_declares_reasoning(value: &Value) -> bool {
    match value {
        Value::Bool(value) => *value,
        Value::String(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            normalized.contains("reasoning") || normalized.contains("thinking")
        }
        Value::Array(values) => values.iter().any(value_declares_reasoning),
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized = key.trim().to_ascii_lowercase();
            normalized.contains("reasoning")
                || normalized.contains("thinking")
                || value_declares_reasoning(value)
        }),
        Value::Null | Value::Number(_) => false,
    }
}

fn default_reasoning_metadata(model_id: &str) -> Option<(Option<Vec<String>>, Option<String>)> {
    if let Some((levels, default_level)) = model_specific_reasoning_metadata(model_id) {
        return Some((Some(levels), Some(default_level)));
    }
    Some((
        Some(default_reasoning_levels()),
        Some(DEFAULT_REASONING_LEVEL.to_string()),
    ))
}

struct BuiltinReasoningRule {
    model_fragment: &'static str,
    levels: &'static [&'static str],
}

/// 与 ZCode 内置 provider registry 的 modelConfigRules 对齐。
///
/// 这些规则属于应用内置模型目录，不是用户手工配置。供应商的 `/models`
/// 返回明确能力时仍在调用方优先使用返回值；只有能力未声明时才按模型名匹配这里的规则。
const BUILTIN_REASONING_RULES: &[BuiltinReasoningRule] = &[
    BuiltinReasoningRule {
        model_fragment: "deepseek-v4-flash",
        levels: &["disabled", "low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "deepseek-v4-pro",
        levels: &["disabled", "low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "deepseek-flash",
        levels: &["disabled", "low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "deepseek-v4.1-flash",
        levels: &["disabled", "low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "deepseek-v4-1-flash",
        levels: &["disabled", "low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "glm-5.3",
        levels: &["low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "glm-5.2",
        levels: &["disabled", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "gpt-5.6",
        levels: &["none", "low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "gpt-5.3-codex",
        levels: &["low", "medium", "high", "xhigh"],
    },
    BuiltinReasoningRule {
        model_fragment: "gpt-6-astra",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "gpt-5.4-pro",
        levels: &["medium", "high", "xhigh"],
    },
    BuiltinReasoningRule {
        model_fragment: "gpt-5.4",
        levels: &["none", "low", "medium", "high", "xhigh"],
    },
    BuiltinReasoningRule {
        model_fragment: "claude-opus-5",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "claude-sonnet-5",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "claude-fable-5",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "claude-fable-5.1",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "claude-mythos-5.1",
        levels: &["low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "grok-4.6",
        levels: &["low", "medium", "high", "xhigh"],
    },
    BuiltinReasoningRule {
        model_fragment: "kimi-k3",
        levels: &["low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "kimi-k2.7-code",
        levels: &["enabled"],
    },
    BuiltinReasoningRule {
        model_fragment: "k3-256k",
        levels: &["low", "high", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "qwen3.8-omni-flash",
        levels: &["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    },
    BuiltinReasoningRule {
        model_fragment: "qwen3.8-max",
        levels: &["low", "medium", "xhigh"],
    },
    BuiltinReasoningRule {
        model_fragment: "qwen3.8-flash",
        levels: &["low", "medium", "xhigh"],
    },
];

fn model_specific_reasoning_metadata(model_id: &str) -> Option<(Vec<String>, String)> {
    let normalized = model_id.trim().to_ascii_lowercase();
    BUILTIN_REASONING_RULES
        .iter()
        .find(|rule| normalized.contains(rule.model_fragment))
        .map(|rule| {
            (
                rule.levels
                    .iter()
                    .map(|level| (*level).to_string())
                    .collect(),
                rule.levels.last().unwrap_or(&"enabled").to_string(),
            )
        })
}

fn known_reasoning_levels() -> Vec<String> {
    REASONING_LEVELS
        .iter()
        .map(|level| (*level).to_string())
        .collect()
}

fn default_reasoning_levels() -> Vec<String> {
    DEFAULT_REASONING_LEVELS
        .iter()
        .map(|level| (*level).to_string())
        .collect()
}

fn read_reasoning_levels(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Array(values) => Some(
            values
                .iter()
                .filter_map(|entry| {
                    entry
                        .as_str()
                        .or_else(|| entry.get("value").and_then(Value::as_str))
                        .or_else(|| entry.get("id").and_then(Value::as_str))
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(str::to_string)
                })
                .fold(Vec::new(), |mut result, value| {
                    if !result.iter().any(|item| item == &value) {
                        result.push(value);
                    }
                    result
                }),
        ),
        Value::Object(values) => Some(
            values
                .keys()
                .filter(|key| !key.trim().is_empty())
                .cloned()
                .collect(),
        ),
        _ => None,
    }
}

fn sort_models(models: &mut [AiProviderModelOption]) {
    models.sort_by(|left, right| {
        let left_name = left.display_name.as_deref().unwrap_or(&left.id);
        let right_name = right.display_name.as_deref().unwrap_or(&right.id);
        left_name
            .to_ascii_lowercase()
            .cmp(&right_name.to_ascii_lowercase())
            .then_with(|| {
                left.id
                    .to_ascii_lowercase()
                    .cmp(&right.id.to_ascii_lowercase())
            })
    });
}

fn load_stored_provider_configs(
    repository: &StorageRepository,
) -> Result<Vec<StoredAiProviderConfig>, AppError> {
    Ok(repository
        .app_setting_get::<Vec<StoredAiProviderConfig>>(AI_PROVIDER_CONFIGS_KEY)?
        .unwrap_or_default())
}

fn load_stored_provider_config(
    repository: &StorageRepository,
    id: &str,
) -> Result<Option<StoredAiProviderConfig>, AppError> {
    Ok(load_stored_provider_configs(repository)?
        .into_iter()
        .find(|config| config.id == id))
}

fn provider_config_from_stored(
    repository: &StorageRepository,
    stored: StoredAiProviderConfig,
) -> Result<AiProviderConfig, AppError> {
    let api_key_saved = match stored.secret_slot_id.as_deref() {
        Some(slot_id) => repository.secret_exists(&ai_api_key_reference(slot_id))?,
        None => false,
    };
    let models = normalize_stored_models(&stored.model, stored.models);
    let default_model = stored.model.trim().to_string();
    let model = if default_model.is_empty() {
        models
            .iter()
            .find(|item| item.enabled)
            .or_else(|| models.first())
            .map(|item| item.id.clone())
            .unwrap_or_default()
    } else {
        default_model
    };
    Ok(AiProviderConfig {
        id: stored.id,
        name: stored.name,
        provider: stored.provider,
        api_format: stored.api_format,
        endpoint: stored.endpoint,
        model,
        models,
        api_key_saved,
        thinking_mode: stored.thinking_mode,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    })
}

fn normalize_stored_models(model: &str, models: Vec<AiModelConfig>) -> Vec<AiModelConfig> {
    if !models.is_empty() {
        return models;
    }
    let id = model.trim();
    if id.is_empty() {
        return Vec::new();
    }
    vec![AiModelConfig {
        id: id.to_string(),
        context_window: default_context_window(),
        max_output_tokens: None,
        enabled: true,
    }]
}

fn api_key_for_config(
    repository: &StorageRepository,
    config: &StoredAiProviderConfig,
) -> Result<String, AppError> {
    let slot_id = config
        .secret_slot_id
        .as_deref()
        .ok_or_else(ai_api_key_missing)?;
    repository
        .secret_get(&ai_api_key_reference(slot_id))
        .map_err(|error| {
            if error.code == "secret_missing" {
                ai_api_key_missing()
            } else {
                error
            }
        })
}

fn list_chat_sessions(
    repository: &StorageRepository,
) -> Result<Vec<AiChatSessionSummary>, AppError> {
    let mut statement = repository
        .sqlite_connection()
        .prepare(
            "SELECT
                s.id,
                s.title,
                s.provider_config_id,
                s.host_scope,
                s.connection_id,
                s.created_at,
                s.updated_at,
                (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count,
                (SELECT m.content FROM ai_chat_messages m WHERE m.session_id = s.id ORDER BY CAST(m.created_at AS INTEGER) DESC, m.rowid DESC LIMIT 1) AS preview
             FROM ai_chat_sessions s
             ORDER BY CAST(s.updated_at AS INTEGER) DESC, CAST(s.created_at AS INTEGER) DESC, s.rowid DESC",
        )
        .map_err(sqlite_ai_error)?;
    let mut rows = statement.query([]).map_err(sqlite_ai_error)?;
    let mut sessions = Vec::new();
    while let Some(row) = rows.next().map_err(sqlite_ai_error)? {
        let count: i64 = row.get(7).map_err(sqlite_ai_error)?;
        let preview: Option<String> = row.get(8).map_err(sqlite_ai_error)?;
        sessions.push(AiChatSessionSummary {
            id: row.get(0).map_err(sqlite_ai_error)?,
            title: row.get(1).map_err(sqlite_ai_error)?,
            provider_config_id: row.get(2).map_err(sqlite_ai_error)?,
            host_scope: row.get(3).map_err(sqlite_ai_error)?,
            connection_id: row.get(4).map_err(sqlite_ai_error)?,
            created_at: row.get(5).map_err(sqlite_ai_error)?,
            updated_at: row.get(6).map_err(sqlite_ai_error)?,
            message_count: count.max(0) as usize,
            last_message_preview: preview.and_then(|value| {
                let trimmed = value.trim();
                (!trimmed.is_empty()).then(|| truncate_chars(trimmed, 90))
            }),
        });
    }
    Ok(sessions)
}

fn get_chat_session(
    repository: &StorageRepository,
    session_id: &str,
) -> Result<AiChatSession, AppError> {
    let session_id = require_non_empty(session_id, "ai_session_missing", "AI 会话标识缺失。")?;
    let summary = list_chat_sessions(repository)?
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(ai_session_missing)?;
    let messages = list_chat_messages(repository, session_id)?;
    Ok(AiChatSession { summary, messages })
}

fn ensure_chat_session_exists(
    repository: &StorageRepository,
    session_id: &str,
) -> Result<(), AppError> {
    let exists = repository
        .sqlite_connection()
        .query_row(
            "SELECT id FROM ai_chat_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sqlite_ai_error)?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ai_session_missing())
    }
}

struct InsertChatMessage<'a> {
    id: &'a str,
    session_id: &'a str,
    role: &'a str,
    content: &'a str,
    contexts: &'a [AiContextBlock],
    commands: &'a [AiCommandSuggestion],
    status: &'a str,
    now: &'a str,
}

fn insert_chat_message(
    repository: &StorageRepository,
    input: InsertChatMessage<'_>,
) -> Result<(), AppError> {
    let contexts_json = serde_json::to_string(input.contexts).map_err(json_ai_error)?;
    let commands_json = serde_json::to_string(input.commands).map_err(json_ai_error)?;
    repository
        .sqlite_connection()
        .execute(
            "INSERT INTO ai_chat_messages(
                id, session_id, role, content, contexts_json, commands_json, status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                input.id,
                input.session_id,
                input.role,
                input.content,
                contexts_json,
                commands_json,
                input.status,
                input.now,
            ],
        )
        .map_err(sqlite_ai_error)?;
    Ok(())
}

fn list_chat_messages(
    repository: &StorageRepository,
    session_id: &str,
) -> Result<Vec<AiChatMessage>, AppError> {
    let mut statement = repository
        .sqlite_connection()
        .prepare(
            "SELECT id, session_id, role, content, contexts_json, commands_json, status, created_at, updated_at, tool_calls_json, thinking
             FROM ai_chat_messages
             WHERE session_id = ?1
             ORDER BY CAST(created_at AS INTEGER) ASC, rowid ASC",
        )
        .map_err(sqlite_ai_error)?;
    let mut rows = statement
        .query(params![session_id])
        .map_err(sqlite_ai_error)?;
    let mut messages = Vec::new();
    while let Some(row) = rows.next().map_err(sqlite_ai_error)? {
        let contexts_json: String = row.get(4).map_err(sqlite_ai_error)?;
        let commands_json: String = row.get(5).map_err(sqlite_ai_error)?;
        let tool_calls_json: String = row.get(9).map_err(sqlite_ai_error)?;
        let thinking: String = row.get(10).map_err(sqlite_ai_error)?;
        messages.push(AiChatMessage {
            id: row.get(0).map_err(sqlite_ai_error)?,
            session_id: row.get(1).map_err(sqlite_ai_error)?,
            role: row.get(2).map_err(sqlite_ai_error)?,
            content: row.get(3).map_err(sqlite_ai_error)?,
            thinking,
            contexts: serde_json::from_str(&contexts_json).unwrap_or_default(),
            commands: serde_json::from_str(&commands_json).unwrap_or_default(),
            tool_calls: serde_json::from_str(&tool_calls_json).unwrap_or_default(),
            status: row.get(6).map_err(sqlite_ai_error)?,
            created_at: row.get(7).map_err(sqlite_ai_error)?,
            updated_at: row.get(8).map_err(sqlite_ai_error)?,
        });
    }
    Ok(messages)
}

fn update_assistant_message(
    app: &AppHandle,
    session_id: &str,
    message_id: &str,
    content: &str,
    thinking: &str,
    status: &str,
    tool_calls: &[AiToolCallRecord],
) -> Result<(), AppError> {
    let repository = StorageRepository::open_app(app)?;
    save_assistant_message(
        &repository,
        session_id,
        message_id,
        content,
        thinking,
        status,
        tool_calls,
    )
}

fn save_assistant_message(
    repository: &StorageRepository,
    session_id: &str,
    message_id: &str,
    content: &str,
    thinking: &str,
    status: &str,
    tool_calls: &[AiToolCallRecord],
) -> Result<(), AppError> {
    let now = now_timestamp()?;
    let commands = extract_command_suggestions(content);
    let commands_json = serde_json::to_string(&commands).map_err(json_ai_error)?;
    let tool_calls_json = serde_json::to_string(tool_calls).map_err(json_ai_error)?;
    repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_messages
                SET content = ?2, commands_json = ?3, status = ?4, updated_at = ?5, tool_calls_json = ?6, thinking = ?7
              WHERE id = ?1 AND role = 'assistant'",
            params![message_id, content, commands_json, status, now, tool_calls_json, thinking],
        )
        .map_err(sqlite_ai_error)?;
    repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_sessions SET updated_at = ?2 WHERE id = ?1",
            params![session_id, now],
        )
        .map_err(sqlite_ai_error)?;
    Ok(())
}

fn model_messages_from_history(messages: Vec<AiChatMessage>) -> Vec<AiModelMessage> {
    messages
        .into_iter()
        .filter_map(|message| {
            if message.role != "user" && message.role != "assistant" {
                return None;
            }
            if message.role == "assistant"
                && message.content.trim().is_empty()
                && message.tool_calls.is_empty()
            {
                return None;
            }
            let content = if message.role == "user" {
                format_user_message_for_model(&message.content, &message.contexts)
            } else {
                strip_tool_call_summary(message.content)
            };
            Some(AiModelMessage {
                role: message.role,
                content,
            })
        })
        .collect()
}

fn strip_tool_call_summary(content: String) -> String {
    const MARKER: &str = "[本轮工具调用记录]";
    let Some(start) = content.find(MARKER) else {
        return content;
    };

    let prefix = content[..start].trim_end();
    let mut trailing = Vec::new();
    let mut in_summary = true;
    for line in content[start + MARKER.len()..].lines() {
        let trimmed = line.trim();
        if in_summary && (trimmed.is_empty() || trimmed.starts_with("- ")) {
            continue;
        }
        in_summary = false;
        trailing.push(line);
    }
    let suffix = trailing.join("\n").trim_start().to_string();
    match (prefix.is_empty(), suffix.is_empty()) {
        (true, true) => String::new(),
        (false, true) => prefix.to_string(),
        (true, false) => suffix,
        (false, false) => format!("{prefix}\n\n{suffix}"),
    }
}

#[cfg(test)]
fn append_tool_call_summary(content: String, tool_calls: &[AiToolCallRecord]) -> String {
    if tool_calls.is_empty() {
        return content;
    }
    let mut summary = String::from("[本轮工具调用记录]");
    for call in tool_calls {
        let target = call
            .command
            .as_deref()
            .filter(|_| call.name == TOOL_RUN_COMMAND)
            .map(|command| format!("`{}`", truncate_chars(command, 200)))
            .unwrap_or_else(|| call.name.clone());
        let result = match call.status.as_str() {
            "completed" => {
                let exit = call
                    .exit_status
                    .map(|value| format!("退出码 {value}"))
                    .unwrap_or_else(|| "已完成".to_string());
                let output = call.output.trim();
                if output.is_empty() {
                    exit
                } else {
                    format!(
                        "{exit}，输出：{}",
                        truncate_chars(output, MAX_HISTORY_TOOL_OUTPUT_CHARS)
                    )
                }
            }
            "rejected" => "用户拒绝执行".to_string(),
            "cancelled" => "已取消".to_string(),
            _ => format!("失败：{}", call.error.as_deref().unwrap_or("未知错误")),
        };
        summary.push_str(&format!("\n- {target} → {result}"));
    }
    if content.trim().is_empty() {
        summary
    } else {
        format!("{content}\n\n{summary}")
    }
}

async fn run_provider_stream<F>(
    config: &StoredAiProviderConfig,
    api_key: &str,
    reasoning_level: Option<&str>,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    mut on_delta: F,
    mut on_thinking: impl FnMut(String) + Send,
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let client = Client::new();
    match config.api_format {
        AiApiFormat::OpenaiCompatible => {
            run_openai_stream(
                &client,
                config,
                api_key,
                reasoning_level,
                messages,
                stopped,
                &mut on_delta,
                &mut on_thinking,
            )
            .await
        }
        AiApiFormat::Responses => {
            run_responses_stream(
                &client,
                config,
                api_key,
                reasoning_level,
                messages,
                stopped,
                &mut on_delta,
                &mut on_thinking,
            )
            .await
        }
        AiApiFormat::Anthropic => {
            run_anthropic_stream(
                &client,
                config,
                api_key,
                reasoning_level,
                messages,
                stopped,
                &mut on_delta,
                &mut on_thinking,
            )
            .await
        }
    }
}

async fn run_openai_stream<F>(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
    reasoning_level: Option<&str>,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    on_delta: &mut F,
    on_thinking: &mut (impl FnMut(String) + Send),
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let endpoint = normalize_endpoint(&config.endpoint, AiApiFormat::OpenaiCompatible)?;
    let messages = openai_messages_with_system(messages);
    let mut body = json!({
        "model": config.model,
        "stream": true,
        "messages": messages,
    });
    apply_openai_reasoning_fields(&mut body, reasoning_level);
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    read_sse_events(response, stopped, |data| {
        match parse_openai_sse_delta(data)? {
            ParsedSseDelta::Delta(delta) => on_delta(delta),
            ParsedSseDelta::Thinking(delta) => on_thinking(delta),
            ParsedSseDelta::Both { delta, thinking } => {
                on_thinking(thinking);
                on_delta(delta);
            }
            ParsedSseDelta::Done => return Ok(true),
            ParsedSseDelta::None => {}
        }
        Ok(false)
    })
    .await
}

async fn run_anthropic_stream<F>(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
    reasoning_level: Option<&str>,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    on_delta: &mut F,
    on_thinking: &mut (impl FnMut(String) + Send),
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let endpoint = normalize_endpoint(&config.endpoint, AiApiFormat::Anthropic)?;
    let (system, anthropic_messages) = split_system_message(messages);
    let mut body = json!({
        "model": config.model,
        "stream": true,
        "max_tokens": 4096,
        "system": system,
        "messages": anthropic_messages,
    });
    apply_anthropic_reasoning_fields(&mut body, reasoning_level, 4096);
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", DEFAULT_ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    read_sse_events(response, stopped, |data| {
        match parse_anthropic_sse_delta(data)? {
            ParsedSseDelta::Delta(delta) => on_delta(delta),
            ParsedSseDelta::Thinking(delta) => on_thinking(delta),
            ParsedSseDelta::Both { delta, thinking } => {
                on_thinking(thinking);
                on_delta(delta);
            }
            ParsedSseDelta::Done => return Ok(true),
            ParsedSseDelta::None => {}
        }
        Ok(false)
    })
    .await
}

async fn run_responses_stream<F>(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
    reasoning_level: Option<&str>,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    on_delta: &mut F,
    on_thinking: &mut (impl FnMut(String) + Send),
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let endpoint = normalize_endpoint(&config.endpoint, AiApiFormat::Responses)?;
    let input = messages
        .into_iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": [{ "type": "input_text", "text": message.content }]
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": config.model,
        "stream": true,
        "input": input,
    });
    if let Some(level) = reasoning_level {
        body["reasoning"] = json!({
            "effort": if matches!(level, "disabled" | "off" | "none") {
                "none"
            } else if level == "enabled" {
                "high"
            } else {
                level
            }
        });
    }
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    read_sse_events(response, stopped, |data| {
        let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
        match value.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    on_delta(delta.to_string());
                }
                Ok(false)
            }
            Some("response.reasoning_summary_text.delta")
            | Some("response.reasoning_text.delta") => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    on_thinking(delta.to_string());
                }
                Ok(false)
            }
            Some("response.completed") | Some("response.done") => Ok(true),
            Some("response.failed") => {
                Err(provider_stream_error(value.get("error").unwrap_or(&value)))
            }
            _ => Ok(false),
        }
    })
    .await
}

pub(crate) async fn ensure_provider_response(response: Response) -> Result<Response, AppError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "response body unavailable".to_string());
    let body = sanitize_provider_error_body(&body);
    Err(AppError::new(
        "ai_provider_request_failed",
        "AI 服务返回错误。",
        format!(
            "status={} body={}",
            status.as_u16(),
            truncate_chars(&body, MAX_SSE_ERROR_BODY_CHARS)
        ),
        true,
    ))
}

pub(crate) async fn read_sse_events<F>(
    mut response: Response,
    stopped: Arc<AtomicBool>,
    mut on_data: F,
) -> Result<(), AppError>
where
    F: FnMut(&str) -> Result<bool, AppError>,
{
    let mut buffer = Vec::<u8>::new();
    while let Some(chunk) = response.chunk().await.map_err(provider_request_error)? {
        if stopped.load(Ordering::SeqCst) {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk);
        while let Some((event, drain_to)) = next_sse_event(&buffer) {
            let event = String::from_utf8(event).map_err(sse_utf8_error)?;
            let done = process_sse_event(&event, &mut on_data)?;
            buffer.drain(..drain_to);
            if done {
                return Ok(());
            }
        }
    }
    if !buffer.iter().all(|byte| byte.is_ascii_whitespace()) {
        let buffer = String::from_utf8(buffer).map_err(sse_utf8_error)?;
        let _ = process_sse_event(&buffer, &mut on_data)?;
    }
    Ok(())
}

fn next_sse_event(buffer: &[u8]) -> Option<(Vec<u8>, usize)> {
    let lf = find_bytes(buffer, b"\n\n").map(|index| (index, 2));
    let crlf = find_bytes(buffer, b"\r\n\r\n").map(|index| (index, 4));
    match (lf, crlf) {
        (Some(left), Some(right)) => {
            let (index, width) = if left.0 <= right.0 { left } else { right };
            Some((buffer[..index].to_vec(), index + width))
        }
        (Some((index, width)), None) | (None, Some((index, width))) => {
            Some((buffer[..index].to_vec(), index + width))
        }
        (None, None) => None,
    }
}

fn find_bytes(buffer: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || buffer.len() < needle.len() {
        return None;
    }
    buffer
        .windows(needle.len())
        .position(|window| window == needle)
}

fn process_sse_event<F>(event: &str, on_data: &mut F) -> Result<bool, AppError>
where
    F: FnMut(&str) -> Result<bool, AppError>,
{
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.trim().is_empty() {
        return Ok(false);
    }
    on_data(data.trim())
}

enum ParsedSseDelta {
    Delta(String),
    Thinking(String),
    Both { delta: String, thinking: String },
    Done,
    None,
}

fn parse_openai_sse_delta(data: &str) -> Result<ParsedSseDelta, AppError> {
    if data == "[DONE]" {
        return Ok(ParsedSseDelta::Done);
    }
    let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
    if let Some(error) = value.get("error") {
        return Err(provider_stream_error(error));
    }
    let delta_obj = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .unwrap_or(&Value::Null);
    let thinking = delta_obj
        .get("reasoning_content")
        .or_else(|| delta_obj.get("reasoning"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let delta = delta_obj
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !thinking.is_empty() && !delta.is_empty() {
        return Ok(ParsedSseDelta::Both {
            delta: delta.to_string(),
            thinking: thinking.to_string(),
        });
    }
    if !thinking.is_empty() {
        return Ok(ParsedSseDelta::Thinking(thinking.to_string()));
    }
    if delta.is_empty() {
        Ok(ParsedSseDelta::None)
    } else {
        Ok(ParsedSseDelta::Delta(delta.to_string()))
    }
}

fn parse_anthropic_sse_delta(data: &str) -> Result<ParsedSseDelta, AppError> {
    if data == "[DONE]" {
        return Ok(ParsedSseDelta::Done);
    }
    let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
    match value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "content_block_delta" => {
            let delta_value = value.get("delta").unwrap_or(&Value::Null);
            let kind = delta_value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let delta = delta_value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if kind == "thinking_delta" {
                let thinking = delta_value
                    .get("thinking")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                return if thinking.is_empty() {
                    Ok(ParsedSseDelta::None)
                } else {
                    Ok(ParsedSseDelta::Thinking(thinking.to_string()))
                };
            }
            if delta.is_empty() {
                Ok(ParsedSseDelta::None)
            } else {
                Ok(ParsedSseDelta::Delta(delta.to_string()))
            }
        }
        "content_block_start" => {
            let text = value
                .get("content_block")
                .and_then(|block| block.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if text.is_empty() {
                Ok(ParsedSseDelta::None)
            } else {
                Ok(ParsedSseDelta::Delta(text.to_string()))
            }
        }
        "message_stop" => Ok(ParsedSseDelta::Done),
        "error" => Err(provider_stream_error(&value)),
        _ => Ok(ParsedSseDelta::None),
    }
}

pub(crate) fn provider_stream_error(payload: &Value) -> AppError {
    AppError::new(
        "ai_provider_stream_error",
        "AI 服务返回流式错误。",
        truncate_chars(&payload.to_string(), MAX_SSE_ERROR_BODY_CHARS),
        true,
    )
}

pub(crate) fn normalize_endpoint(
    endpoint: &str,
    api_format: AiApiFormat,
) -> Result<String, AppError> {
    let mut url = Url::parse(endpoint.trim()).map_err(|error| {
        AppError::new(
            "ai_provider_endpoint_invalid",
            "AI 请求地址不是合法 URL。",
            error,
            true,
        )
    })?;
    let path = url.path().trim_end_matches('/').to_string();
    match api_format {
        AiApiFormat::OpenaiCompatible if !path.ends_with("/chat/completions") => {
            let next = if path.ends_with("/v1") {
                format!("{path}/chat/completions")
            } else if path.is_empty() || path == "/" {
                "/v1/chat/completions".to_string()
            } else {
                format!("{path}/v1/chat/completions")
            };
            url.set_path(&next);
        }
        AiApiFormat::Anthropic if !path.ends_with("/messages") => {
            let next = if path.ends_with("/v1") {
                format!("{path}/messages")
            } else if path.is_empty() || path == "/" {
                "/v1/messages".to_string()
            } else {
                format!("{path}/v1/messages")
            };
            url.set_path(&next);
        }
        AiApiFormat::Responses if !path.ends_with("/responses") => {
            let next = if path.ends_with("/v1") {
                format!("{path}/responses")
            } else if path.is_empty() || path == "/" {
                "/v1/responses".to_string()
            } else {
                format!("{path}/v1/responses")
            };
            url.set_path(&next);
        }
        _ => {}
    }
    Ok(url.to_string())
}

fn normalize_models_endpoint(endpoint: &str, api_format: AiApiFormat) -> Result<String, AppError> {
    let mut url = Url::parse(endpoint.trim()).map_err(|error| {
        AppError::new(
            "ai_provider_endpoint_invalid",
            "AI 请求地址不是合法 URL。",
            error,
            true,
        )
    })?;
    let path = url.path().trim_end_matches('/').to_string();
    let next = match api_format {
        AiApiFormat::OpenaiCompatible => {
            if path.ends_with("/models") {
                path
            } else if let Some(base) = path.strip_suffix("/chat/completions") {
                format!("{base}/models")
            } else if path.ends_with("/v1") {
                format!("{path}/models")
            } else if path.is_empty() || path == "/" {
                "/v1/models".to_string()
            } else {
                format!("{path}/v1/models")
            }
        }
        AiApiFormat::Anthropic => {
            if path.ends_with("/models") {
                path
            } else if let Some(base) = path.strip_suffix("/messages") {
                format!("{base}/models")
            } else if path.ends_with("/v1") {
                format!("{path}/models")
            } else if path.is_empty() || path == "/" {
                "/v1/models".to_string()
            } else {
                format!("{path}/v1/models")
            }
        }
        AiApiFormat::Responses => {
            if path.ends_with("/models") {
                path
            } else if let Some(base) = path.strip_suffix("/responses") {
                format!("{base}/models")
            } else if path.ends_with("/v1") {
                format!("{path}/models")
            } else if path.is_empty() || path == "/" {
                "/v1/models".to_string()
            } else {
                format!("{path}/v1/models")
            }
        }
    };
    url.set_path(&next);
    Ok(url.to_string())
}

fn split_system_message(messages: Vec<AiModelMessage>) -> (String, Vec<AiModelMessage>) {
    let mut system_parts = vec![default_system_prompt().to_string()];
    let mut chat_messages = Vec::new();
    for message in messages {
        if message.role == "system" {
            system_parts.push(message.content);
        } else {
            chat_messages.push(message);
        }
    }
    (system_parts.join("\n\n"), chat_messages)
}

fn openai_messages_with_system(messages: Vec<AiModelMessage>) -> Vec<AiModelMessage> {
    let mut system_parts = vec![default_system_prompt().to_string()];
    let mut chat_messages = Vec::with_capacity(messages.len() + 1);
    for message in messages {
        if message.role == "system" {
            system_parts.push(message.content);
        } else {
            chat_messages.push(message);
        }
    }
    let mut output = Vec::with_capacity(chat_messages.len() + 1);
    output.push(AiModelMessage {
        role: "system".to_string(),
        content: system_parts.join("\n\n"),
    });
    output.extend(chat_messages);
    output
}

fn default_system_prompt() -> &'static str {
    "你是 mXterm 内置的终端排障和命令生成助手。回答要面向实际终端操作，解释原因、给出可验证步骤，并在命令可能破坏数据、权限、网络或服务时明确提示风险。不要声称已经执行命令。"
}

fn format_user_message_for_model(content: &str, contexts: &[AiContextBlock]) -> String {
    if contexts.is_empty() {
        return content.to_string();
    }
    let mut formatted = String::from("以下是用户在发送前可见并确认附加的上下文：\n");
    for block in contexts {
        formatted.push_str(&format!(
            "\n[{} | {} | {} 行 | {} 字]\n{}\n",
            block.title, block.source, block.line_count, block.char_count, block.content
        ));
    }
    formatted.push_str("\n用户问题：\n");
    formatted.push_str(content);
    formatted
}

fn normalize_context_blocks(blocks: Vec<AiContextBlock>) -> Vec<AiContextBlock> {
    blocks
        .into_iter()
        .filter_map(|mut block| {
            block.content = truncate_chars(block.content.trim(), MAX_CONTEXT_CHARS_PER_BLOCK);
            if block.content.is_empty() {
                return None;
            }
            block.title = non_empty_or(block.title, "上下文");
            block.kind = non_empty_or(block.kind, "custom");
            block.source = non_empty_or(block.source, "mXterm");
            block.char_count = block.content.chars().count();
            block.line_count = block.content.lines().count().max(1);
            Some(block)
        })
        .collect()
}

fn extract_command_suggestions(content: &str) -> Vec<AiCommandSuggestion> {
    let mut commands = Vec::new();
    let mut seen = Vec::<String>::new();
    let mut in_fence = false;
    let mut fence_lang = String::new();
    let mut fence_lines: Vec<String> = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(lang) = line.strip_prefix("```") {
            if in_fence {
                if is_shell_fence(&fence_lang) {
                    let command = fence_lines
                        .iter()
                        .map(String::as_str)
                        .filter(|item| {
                            !item.trim().is_empty() && !item.trim_start().starts_with('#')
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    push_command_suggestion(&mut commands, &mut seen, &command);
                }
                fence_lines.clear();
                fence_lang.clear();
                in_fence = false;
            } else {
                in_fence = true;
                fence_lang = lang.trim().to_lowercase();
            }
            continue;
        }

        if in_fence {
            fence_lines.push(line.to_string());
            continue;
        }

        if let Some(command) = shell_like_command(line) {
            push_command_suggestion(&mut commands, &mut seen, &command);
        }
    }
    if in_fence && is_shell_fence(&fence_lang) {
        let command = fence_lines
            .iter()
            .map(String::as_str)
            .filter(|item| !item.trim().is_empty() && !item.trim_start().starts_with('#'))
            .collect::<Vec<_>>()
            .join("\n");
        push_command_suggestion(&mut commands, &mut seen, &command);
    }
    commands
}

fn push_command_suggestion(
    commands: &mut Vec<AiCommandSuggestion>,
    seen: &mut Vec<String>,
    command: &str,
) {
    let command = command.trim();
    if command.is_empty() || command.len() > 4000 {
        return;
    }
    if seen.iter().any(|item| item == command) {
        return;
    }
    let assessment = assess_command(command);
    seen.push(command.to_string());
    commands.push(AiCommandSuggestion {
        command: command.to_string(),
        risk: assessment.risk,
        reasons: assessment.reasons,
    });
}

fn shell_like_command(line: &str) -> Option<String> {
    let mut command = line.trim();
    if let Some(rest) = command.strip_prefix('$') {
        command = rest.trim_start();
    } else if command.starts_with("# ") {
        return None;
    }
    let first = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| ch == '`' || ch == '"' || ch == '\'');
    let known = [
        "apt",
        "brew",
        "cargo",
        "cat",
        "cd",
        "chmod",
        "chown",
        "cp",
        "curl",
        "dd",
        "df",
        "dig",
        "docker",
        "du",
        "find",
        "fdisk",
        "firewall-cmd",
        "git",
        "grep",
        "halt",
        "ip",
        "iptables",
        "journalctl",
        "kubectl",
        "less",
        "ls",
        "mkdir",
        "mkfs",
        "mv",
        "netstat",
        "node",
        "npm",
        "pnpm",
        "poweroff",
        "ps",
        "python",
        "python3",
        "reboot",
        "rm",
        "route",
        "scp",
        "sed",
        "service",
        "shutdown",
        "ss",
        "ssh",
        "sudo",
        "systemctl",
        "tail",
        "tar",
        "traceroute",
        "ufw",
        "unzip",
        "userdel",
        "vim",
        "wget",
        "wipefs",
        "yarn",
    ];
    (known.iter().any(|item| item.eq_ignore_ascii_case(first))
        || first.to_lowercase().starts_with("mkfs."))
    .then(|| command.trim_matches('`').to_string())
}

pub(crate) fn assess_command(command: &str) -> AiCommandAssessment {
    let normalized = command.to_lowercase();
    let mut reasons = Vec::new();
    if normalized.contains("rm -rf")
        || normalized.contains("rm -fr")
        || normalized.contains("rm -r -f")
        || normalized.contains("rm -f -r")
    {
        reasons.push("包含递归强制删除。".to_string());
    }
    if ["mkfs", "fdisk", "parted", "wipefs"].iter().any(|item| {
        normalized
            .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-')
            .any(|part| part == *item)
    }) {
        reasons.push("包含磁盘分区或格式化操作。".to_string());
    }
    if normalized.contains("dd ") && normalized.contains(" of=") {
        reasons.push("包含 dd 写入目标设备或文件。".to_string());
    }
    if normalized.contains("curl ") && normalized.contains("| sh")
        || normalized.contains("curl ") && normalized.contains("| bash")
        || normalized.contains("wget ") && normalized.contains("| sh")
        || normalized.contains("wget ") && normalized.contains("| bash")
    {
        reasons.push("包含下载脚本后直接执行。".to_string());
    }
    if ["iptables", "ufw", "firewall-cmd", "route", "ip route"]
        .iter()
        .any(|item| normalized.contains(item))
    {
        reasons.push("可能修改防火墙或路由。".to_string());
    }
    if ["shutdown", "reboot", "halt", "poweroff"]
        .iter()
        .any(|item| {
            normalized
                .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-')
                .any(|part| part == *item)
        })
    {
        reasons.push("可能重启或关闭主机。".to_string());
    }
    if normalized.contains("systemctl restart")
        || normalized.contains("systemctl stop")
        || normalized.contains("service ") && normalized.contains(" stop")
    {
        reasons.push("可能停止或重启服务。".to_string());
    }
    if normalized.contains("chmod -r 777")
        || normalized.contains("chown -r")
        || normalized.contains("userdel ")
        || normalized.contains("passwd ")
    {
        reasons.push("可能改变权限、用户或认证状态。".to_string());
    }
    if normalized.contains("/etc/ssh") && (normalized.contains(">") || normalized.contains("tee "))
    {
        reasons.push("可能覆盖 SSH 配置。".to_string());
    }
    if contains_sensitive_command_text(&normalized) {
        reasons.push("包含凭据、密钥或 token 明文。".to_string());
    }
    let risk = if reasons.is_empty() {
        AiCommandRisk::Safe
    } else {
        AiCommandRisk::Dangerous
    };
    AiCommandAssessment {
        command: command.to_string(),
        risk,
        reasons,
    }
}

fn contains_sensitive_command_text(command: &str) -> bool {
    [
        "authorization: bearer",
        "api_key=",
        "apikey=",
        "access_token=",
        "auth_token=",
        "secret_access_key",
        "client_secret",
        "private_key",
        "--password",
        "password=",
        "passwd=",
        "sshpass -p",
        "-----begin",
    ]
    .iter()
    .any(|pattern| command.contains(pattern))
}

fn is_shell_fence(lang: &str) -> bool {
    matches!(
        lang,
        "" | "sh" | "shell" | "bash" | "zsh" | "fish" | "powershell" | "ps1" | "cmd" | "bat"
    )
}

fn ai_secret_slot_id(config_id: &str) -> String {
    format!("ai:{config_id}:api_key")
}

fn ai_api_key_reference(slot_id: &str) -> SecretReference {
    SecretReference {
        service: VAULT_SERVICE,
        account: slot_id.to_string(),
        slot_id: slot_id.to_string(),
        kind: SecretKind::Password,
    }
}

fn chat_title_from_content(content: &str) -> String {
    let compact = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        "新的 AI 对话".to_string()
    } else {
        truncate_chars(&compact, 36)
    }
}

fn locked_string(value: &Arc<StdMutex<String>>) -> String {
    value
        .lock()
        .map(|content| content.clone())
        .unwrap_or_default()
}

fn close_stream_handle(handle: Option<AiChatStreamHandle>) {
    if let Some(handle) = handle {
        handle.stopped.store(true, Ordering::SeqCst);
        handle.task.abort();
    }
}

fn require_non_empty<'a>(value: &'a str, code: &str, message: &str) -> Result<&'a str, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::new(code, message, "value is blank", true))
    } else {
        Ok(trimmed)
    }
}

const MAX_HOST_SCOPE_CHARS: usize = 256;

fn validate_bounded_tag(
    value: Option<String>,
    error_code: &'static str,
    message: &'static str,
) -> Result<Option<String>, AppError> {
    let tag = trim_optional(value);
    if let Some(tag) = &tag {
        if tag.chars().count() > MAX_HOST_SCOPE_CHARS {
            return Err(AppError::new(
                error_code,
                message,
                format!("tag_len={}", tag.chars().count()),
                true,
            ));
        }
    }
    Ok(tag)
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

fn non_empty_or(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            output.push('…');
            break;
        }
        output.push(ch);
    }
    output
}

pub(crate) fn provider_request_error(error: reqwest::Error) -> AppError {
    AppError::new(
        "ai_provider_request_failed",
        "AI 服务请求失败。",
        sanitize_provider_error_body(&error.to_string()),
        true,
    )
}

fn invalid_models_response_error(source: &str) -> AppError {
    AppError::new(
        "ai_provider_models_invalid",
        "模型列表响应格式无法识别。",
        format!("invalid {source} response"),
        true,
    )
}

fn sanitize_provider_error_body(body: &str) -> String {
    let lower = body.to_lowercase();
    let sensitive_markers = [
        "authorization",
        "x-api-key",
        "api_key",
        "apikey",
        "access_token",
        "auth_token",
        "secret",
        "password",
        "bearer ",
        "sk-",
    ];
    if sensitive_markers
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return "provider error body redacted because it contains sensitive-looking fields"
            .to_string();
    }
    truncate_chars(body, MAX_SSE_ERROR_BODY_CHARS)
}

pub(crate) fn stream_parse_error(error: serde_json::Error) -> AppError {
    AppError::new(
        "ai_stream_parse_failed",
        "AI 流式响应解析失败。",
        error,
        true,
    )
}

fn sse_utf8_error(error: FromUtf8Error) -> AppError {
    AppError::new(
        "ai_stream_parse_failed",
        "AI 流式响应编码解析失败。",
        error,
        true,
    )
}

fn json_ai_error(error: serde_json::Error) -> AppError {
    AppError::new("ai_json_failed", "AI 数据序列化失败。", error, true)
}

fn sqlite_ai_error(error: rusqlite::Error) -> AppError {
    AppError::new("ai_storage_failed", "AI 数据存储失败。", error, true)
}

fn ai_provider_config_missing() -> AppError {
    AppError::new(
        "ai_provider_config_missing",
        "AI 配置不存在。",
        "provider config missing",
        true,
    )
}

fn ai_api_key_missing() -> AppError {
    AppError::new(
        "ai_api_key_missing",
        "该 AI 配置还没有保存 API Key。",
        "api key missing",
        true,
    )
}

fn ai_session_missing() -> AppError {
    AppError::new(
        "ai_session_missing",
        "AI 会话不存在。",
        "session missing",
        true,
    )
}

fn now_timestamp() -> Result<String, AppError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::new("ai_clock_invalid", "系统时间异常。", error, false))?;
    Ok(duration.as_millis().to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::storage_vault::{InMemorySecretStore, SecretStore};

    #[test]
    fn reasoning_level_validation_accepts_interface_values() {
        assert_eq!(validate_reasoning_level(None).unwrap(), None);
        assert_eq!(validate_reasoning_level(Some("")).unwrap(), None);
        assert_eq!(
            validate_reasoning_level(Some("low")).unwrap().as_deref(),
            Some("low")
        );
        for level in ["medium", "high"] {
            assert!(validate_reasoning_level(Some(level)).is_ok());
        }
        for level in [Some("off"), Some("ultra"), Some("LOW")] {
            assert!(validate_reasoning_level(level).is_ok());
        }
        for level in [Some("level with spaces"), Some("a/b")] {
            assert_eq!(
                validate_reasoning_level(level).unwrap_err().code,
                "ai_reasoning_level_invalid"
            );
        }
    }

    #[test]
    fn thinking_mode_validation_accepts_auto_and_off_only() {
        assert_eq!(validate_thinking_mode(None).unwrap(), None);
        assert_eq!(
            validate_thinking_mode(Some("auto")).unwrap().as_deref(),
            Some("auto")
        );
        assert_eq!(
            validate_thinking_mode(Some("off")).unwrap().as_deref(),
            Some("off")
        );
        assert_eq!(
            validate_thinking_mode(Some("always")).unwrap_err().code,
            "ai_thinking_mode_invalid"
        );
    }

    fn stored_config_with_thinking(mode: Option<&str>) -> StoredAiProviderConfig {
        StoredAiProviderConfig {
            id: "cfg".to_string(),
            name: "测试".to_string(),
            provider: AiProviderKind::Openai,
            api_format: AiApiFormat::OpenaiCompatible,
            endpoint: "https://example.com/v1/chat/completions".to_string(),
            model: "test-model".to_string(),
            models: Vec::new(),
            thinking_mode: mode.map(str::to_string),
            secret_slot_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn model_override_replaces_stored_model_for_request_only() {
        let mut config = stored_config_with_thinking(None);
        apply_model_override(&mut config, None);
        assert_eq!(config.model, "test-model");

        apply_model_override(&mut config, Some("   "));
        assert_eq!(config.model, "test-model");

        apply_model_override(&mut config, Some("  custom-model  "));
        assert_eq!(config.model, "custom-model");

        apply_model_override(&mut config, Some(""));
        assert_eq!(config.model, "custom-model");
    }

    #[test]
    fn effective_reasoning_level_respects_provider_off_mode() {
        let auto = stored_config_with_thinking(Some("auto"));
        assert_eq!(
            effective_reasoning_level(&auto, Some("high"))
                .unwrap()
                .as_deref(),
            Some("high")
        );
        let off = stored_config_with_thinking(Some("off"));
        assert_eq!(effective_reasoning_level(&off, Some("high")).unwrap(), None);
        let unset = stored_config_with_thinking(None);
        assert_eq!(
            effective_reasoning_level(&unset, Some("medium"))
                .unwrap()
                .as_deref(),
            Some("medium")
        );
        assert_eq!(
            effective_reasoning_level(&auto, Some("xhigh"))
                .unwrap()
                .as_deref(),
            Some("xhigh")
        );
    }

    #[test]
    fn openai_reasoning_fields_write_multi_dialect_body() {
        let mut body = json!({ "model": "m", "stream": true });
        apply_openai_reasoning_fields(&mut body, None);
        assert!(body.get("reasoning_effort").is_none());
        assert!(body.get("thinking").is_none());

        apply_openai_reasoning_fields(&mut body, Some("medium"));
        assert_eq!(body["reasoning_effort"], "medium");
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["enable_thinking"], true);

        apply_openai_reasoning_fields(&mut body, Some("disabled"));
        assert_eq!(body["reasoning_effort"], "none");
        assert_eq!(body["thinking"]["type"], "disabled");
        assert_eq!(body["enable_thinking"], false);

        apply_openai_reasoning_fields(&mut body, Some("enabled"));
        assert_eq!(body["reasoning_effort"], "high");
        assert_eq!(body["thinking"]["type"], "enabled");
    }

    #[test]
    fn anthropic_reasoning_fields_lift_max_tokens_above_budget() {
        let mut body = json!({ "model": "m", "max_tokens": 4096 });
        apply_anthropic_reasoning_fields(&mut body, None, 4096);
        assert_eq!(body["max_tokens"], 4096);
        assert!(body.get("thinking").is_none());

        let mut body = json!({ "model": "m", "max_tokens": 4096 });
        apply_anthropic_reasoning_fields(&mut body, Some("low"), 4096);
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["thinking"]["budget_tokens"], 2048);
        assert_eq!(body["max_tokens"], 2048 + 4096);

        let mut body = json!({ "model": "m", "max_tokens": 4096 });
        apply_anthropic_reasoning_fields(&mut body, Some("high"), 4096);
        assert_eq!(body["thinking"]["budget_tokens"], 16384);
        assert_eq!(body["max_tokens"], 16384 + 4096);

        let mut body = json!({ "model": "m", "max_tokens": 4096 });
        apply_anthropic_reasoning_fields(&mut body, Some("disabled"), 4096);
        assert_eq!(body["thinking"]["type"], "disabled");
        assert_eq!(body["max_tokens"], 4096);

        let mut body = json!({ "model": "m", "max_tokens": 4096 });
        apply_anthropic_reasoning_fields(&mut body, Some("enabled"), 4096);
        assert_eq!(body["thinking"]["type"], "adaptive");
        assert_eq!(body["output_config"]["effort"], "high");
    }

    #[test]
    fn parses_openai_stream_delta() {
        let delta =
            parse_openai_sse_delta(r#"{"choices":[{"delta":{"content":"hello"}}]}"#).unwrap();
        assert!(matches!(delta, ParsedSseDelta::Delta(value) if value == "hello"));
        assert!(matches!(
            parse_openai_sse_delta("[DONE]").unwrap(),
            ParsedSseDelta::Done
        ));
        assert!(matches!(
            parse_openai_sse_delta(
                r#"{"choices":[{"delta":{"content":"answer","reasoning_content":"thought"}}]}"#
            )
            .unwrap(),
            ParsedSseDelta::Both { delta, thinking }
                if delta == "answer" && thinking == "thought"
        ));
    }

    #[test]
    fn parses_anthropic_stream_delta() {
        let delta = parse_anthropic_sse_delta(
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}"#,
        )
        .unwrap();
        assert!(matches!(delta, ParsedSseDelta::Delta(value) if value == "hi"));
        assert!(matches!(
            parse_anthropic_sse_delta("[DONE]").unwrap(),
            ParsedSseDelta::Done
        ));
    }

    #[test]
    fn sse_event_extraction_preserves_utf8_bytes() {
        let mut buffer = b"data: ".to_vec();
        let text = "中";
        let bytes = text.as_bytes();
        buffer.extend_from_slice(&bytes[..1]);
        buffer.extend_from_slice(&bytes[1..]);
        buffer.extend_from_slice(b"\n\n");

        let (event, drain_to) = next_sse_event(&buffer).unwrap();
        assert_eq!(drain_to, buffer.len());
        let event = String::from_utf8(event).unwrap();
        assert_eq!(event, "data: 中");
    }

    #[test]
    fn assesses_dangerous_commands() {
        let assessment = assess_command("sudo rm -rf /var/log/app");
        assert_eq!(assessment.risk, AiCommandRisk::Dangerous);
        assert!(!assessment.reasons.is_empty());

        let secret =
            assess_command("curl -H 'Authorization: Bearer example-token' https://example.com");
        assert_eq!(secret.risk, AiCommandRisk::Dangerous);
        assert!(secret.reasons.iter().any(|reason| reason.contains("token")));

        let safe = assess_command("journalctl -u nginx --since today");
        assert_eq!(safe.risk, AiCommandRisk::Safe);
    }

    #[test]
    fn extracts_shell_fenced_commands() {
        let commands = extract_command_suggestions(
            "试试：\n```bash\nsystemctl status nginx\njournalctl -u nginx -n 80\n```",
        );
        assert_eq!(commands.len(), 1);
        assert!(commands[0].command.contains("systemctl status nginx"));

        let unfinished = extract_command_suggestions("```bash\nmkfs.ext4 /dev/sdb1\n");
        assert_eq!(unfinished.len(), 1);
        assert_eq!(unfinished[0].risk, AiCommandRisk::Dangerous);
    }

    #[test]
    fn appends_provider_paths() {
        assert_eq!(
            normalize_endpoint("https://api.example.com/v1", AiApiFormat::OpenaiCompatible)
                .unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_endpoint("https://api.example.com/anthropic", AiApiFormat::Anthropic)
                .unwrap(),
            "https://api.example.com/anthropic/v1/messages"
        );
        assert_eq!(
            normalize_endpoint("https://api.example.com/v1", AiApiFormat::Responses).unwrap(),
            "https://api.example.com/v1/responses"
        );
        assert_eq!(
            normalize_endpoint(
                "https://api.example.com/v1/chat/completions",
                AiApiFormat::OpenaiCompatible
            )
            .unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_endpoint(
                "https://api.example.com/v1/messages",
                AiApiFormat::Anthropic
            )
            .unwrap(),
            "https://api.example.com/v1/messages"
        );
        assert_eq!(
            normalize_models_endpoint("https://api.example.com/v1", AiApiFormat::OpenaiCompatible)
                .unwrap(),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            normalize_models_endpoint(
                "https://api.example.com/v1/chat/completions",
                AiApiFormat::OpenaiCompatible
            )
            .unwrap(),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            normalize_models_endpoint("https://api.example.com/anthropic", AiApiFormat::Anthropic)
                .unwrap(),
            "https://api.example.com/anthropic/v1/models"
        );
        assert_eq!(
            normalize_models_endpoint(
                "https://api.example.com/v1/messages",
                AiApiFormat::Anthropic
            )
            .unwrap(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn parses_provider_model_lists() {
        let openai = serde_json::json!({
            "object": "list",
            "data": [
                {
                    "id": "gpt-4.1-mini",
                    "owned_by": "openai",
                    "reasoning": {
                        "levels": [
                            { "value": "low", "label": "Low" },
                            { "value": "high", "label": "High" }
                        ],
                        "defaultLevel": "low"
                    }
                },
                { "id": "gpt-4.1", "owned_by": "openai" }
            ]
        });
        let anthropic = serde_json::json!({
            "data": [
                {
                    "id": "claude-sonnet-4-20250514",
                    "display_name": "Claude Sonnet 4",
                    "created_at": "2025-05-14T00:00:00Z",
                    "type": "model"
                }
            ]
        });

        let openai_models = parse_openai_models_list(&openai).unwrap();
        assert_eq!(openai_models.len(), 2);
        assert_eq!(openai_models[0].id, "gpt-4.1");
        assert_eq!(
            openai_models[1].reasoning_levels.as_deref(),
            Some(["low".to_string(), "high".to_string()].as_slice())
        );
        assert_eq!(
            openai_models[1].reasoning_default_level.as_deref(),
            Some("low")
        );

        let anthropic_models = parse_anthropic_models_list(&anthropic).unwrap();
        assert_eq!(anthropic_models.len(), 1);
        assert_eq!(
            anthropic_models[0].display_name.as_deref(),
            Some("Claude Sonnet 4")
        );
    }

    #[test]
    fn reasoning_metadata_uses_explicit_capabilities_and_builtin_defaults() {
        let (levels, default_level) = reasoning_metadata(
            &serde_json::json!({
                "supports_reasoning": true,
                "reasoning_effort": "high"
            }),
            "gateway-model",
        );
        assert_eq!(levels, Some(known_reasoning_levels()));
        assert_eq!(default_level.as_deref(), Some("high"));

        let (levels, default_level) =
            reasoning_metadata(&serde_json::json!({}), "deepseek/deepseek-v4.1-flash");
        assert_eq!(
            levels,
            Some(
                ["disabled", "low", "high", "max"]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            )
        );
        assert_eq!(default_level.as_deref(), Some("max"));

        let (levels, default_level) = reasoning_metadata(&serde_json::json!({}), "GLM-5.3-Flash");
        assert_eq!(
            levels,
            Some(
                ["low", "high", "max"]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            )
        );
        assert_eq!(default_level.as_deref(), Some("max"));

        let (levels, default_level) = reasoning_metadata(&serde_json::json!({}), "gpt-5.4-pro");
        assert_eq!(
            levels,
            Some(
                ["medium", "high", "xhigh"]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
            )
        );
        assert_eq!(default_level.as_deref(), Some("xhigh"));

        let (levels, default_level) =
            reasoning_metadata(&serde_json::json!({}), "MiniMax-M3.1-Flash-Preview");
        assert_eq!(levels, Some(default_reasoning_levels()));
        assert_eq!(default_level.as_deref(), Some("enabled"));

        let (levels, default_level) = reasoning_metadata(&serde_json::json!({}), "gpt-4.1-mini");
        assert_eq!(levels, Some(default_reasoning_levels()));
        assert_eq!(default_level.as_deref(), Some("enabled"));
    }

    #[test]
    fn adds_openai_system_prompt() {
        let messages = openai_messages_with_system(vec![AiModelMessage {
            role: "user".to_string(),
            content: "帮我分析报错".to_string(),
        }]);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("终端排障"));
        assert_eq!(messages[1].role, "user");
    }

    #[test]
    fn redacts_sensitive_provider_error_body() {
        let body = sanitize_provider_error_body(
            r#"{"error":"invalid","Authorization":"Bearer sk-example"}"#,
        );
        assert!(!body.contains("sk-example"));
        assert!(body.contains("redacted"));
    }

    #[test]
    fn provider_config_preserves_key_when_not_touched() {
        let (repository, secrets) = temp_repository("ai-provider-preserve");
        let saved = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some("cfg-preserve".to_string()),
                name: "MiniMax".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com/anthropic".to_string(),
                model: "MiniMax-M3".to_string(),
                models: Vec::new(),
                api_key: Some("secret-one".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1000",
        )
        .unwrap();
        assert!(saved.api_key_saved);

        let updated = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some(saved.id.clone()),
                name: "MiniMax Updated".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com/anthropic".to_string(),
                model: "MiniMax-M3-latest".to_string(),
                models: Vec::new(),
                api_key: None,
                api_key_touched: false,
                thinking_mode: None,
            },
            "1001",
        )
        .unwrap();
        let stored = load_stored_provider_config(&repository, &updated.id)
            .unwrap()
            .unwrap();
        let slot_id = stored.secret_slot_id.as_deref().unwrap();

        assert!(updated.api_key_saved);
        assert_eq!(
            secrets.get_secret(&ai_api_key_reference(slot_id)).unwrap(),
            "secret-one"
        );

        let settings_json: String = repository
            .sqlite_connection()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![AI_PROVIDER_CONFIGS_KEY],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!settings_json.contains("secret-one"));
    }

    #[test]
    fn provider_config_reveals_key_on_demand_without_metadata_leak() {
        let (repository, _secrets) = temp_repository("ai-provider-reveal");
        let saved = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some("cfg-reveal".to_string()),
                name: "MiniMax".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com/anthropic".to_string(),
                model: "MiniMax-M3".to_string(),
                models: Vec::new(),
                api_key: Some("secret-reveal".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1000",
        )
        .unwrap();

        let revealed =
            reveal_provider_config_api_key(&repository, AiProviderConfigIdRequest { id: saved.id })
                .unwrap();
        assert_eq!(revealed.api_key, "secret-reveal");

        let settings_json: String = repository
            .sqlite_connection()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![AI_PROVIDER_CONFIGS_KEY],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!settings_json.contains("secret-reveal"));
    }

    #[test]
    fn provider_config_test_uses_saved_key_when_field_untouched() {
        let (repository, _secrets) = temp_repository("ai-provider-test-saved-key");
        let saved = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some("cfg-test-saved".to_string()),
                name: "MiniMax".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com/anthropic".to_string(),
                model: "MiniMax-M3".to_string(),
                models: Vec::new(),
                api_key: Some("secret-test-saved".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1000",
        )
        .unwrap();

        let resolved = resolve_request_api_key(
            &repository,
            &AiProviderConfigInput {
                id: Some(saved.id),
                name: "".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com/anthropic".to_string(),
                model: "MiniMax-M3".to_string(),
                models: Vec::new(),
                api_key: None,
                api_key_touched: false,
                thinking_mode: None,
            },
        )
        .unwrap();

        assert_eq!(resolved, "secret-test-saved");
    }

    #[test]
    fn provider_config_test_accepts_unsaved_draft_key() {
        let (repository, _secrets) = temp_repository("ai-provider-test-draft-key");
        let resolved = resolve_request_api_key(
            &repository,
            &AiProviderConfigInput {
                id: None,
                name: "".to_string(),
                provider: AiProviderKind::Openai,
                api_format: AiApiFormat::OpenaiCompatible,
                endpoint: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                models: Vec::new(),
                api_key: Some("draft-secret".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
        )
        .unwrap();

        assert_eq!(resolved, "draft-secret");
    }

    #[test]
    fn provider_config_touched_blank_deletes_key() {
        let (repository, _secrets) = temp_repository("ai-provider-clear");
        let saved = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some("cfg-clear".to_string()),
                name: "OpenAI".to_string(),
                provider: AiProviderKind::Openai,
                api_format: AiApiFormat::OpenaiCompatible,
                endpoint: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                models: Vec::new(),
                api_key: Some("secret-two".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1000",
        )
        .unwrap();

        let updated = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some(saved.id.clone()),
                name: "OpenAI".to_string(),
                provider: AiProviderKind::Openai,
                api_format: AiApiFormat::OpenaiCompatible,
                endpoint: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                models: Vec::new(),
                api_key: Some("  ".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1001",
        )
        .unwrap();
        let stored = load_stored_provider_config(&repository, &updated.id)
            .unwrap()
            .unwrap();

        assert!(!updated.api_key_saved);
        assert_eq!(
            api_key_for_config(&repository, &stored).unwrap_err().code,
            "ai_api_key_missing"
        );
    }

    #[test]
    fn deleting_provider_removes_secret_and_keeps_old_sessions() {
        let (repository, secrets) = temp_repository("ai-provider-delete");
        let saved = save_provider_config(
            &repository,
            AiProviderConfigInput {
                id: Some("cfg-delete".to_string()),
                name: "Claude".to_string(),
                provider: AiProviderKind::Claude,
                api_format: AiApiFormat::Anthropic,
                endpoint: "https://api.example.com".to_string(),
                model: "claude-test".to_string(),
                models: Vec::new(),
                api_key: Some("secret-three".to_string()),
                api_key_touched: true,
                thinking_mode: None,
            },
            "1000",
        )
        .unwrap();
        repository
            .sqlite_connection()
            .execute(
                "INSERT INTO ai_chat_sessions(id, title, provider_config_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params!["session-1", "旧会话", saved.id, "1001"],
            )
            .unwrap();
        let stored = load_stored_provider_config(&repository, "cfg-delete")
            .unwrap()
            .unwrap();
        let slot_id = stored.secret_slot_id.clone().unwrap();

        delete_provider_config(
            &repository,
            AiProviderConfigIdRequest {
                id: "cfg-delete".to_string(),
            },
        )
        .unwrap();

        assert!(list_provider_configs(&repository).unwrap().is_empty());
        assert_eq!(
            secrets
                .get_secret(&ai_api_key_reference(&slot_id))
                .unwrap_err()
                .code,
            "secret_missing"
        );
        let provider_config_id: Option<String> = repository
            .sqlite_connection()
            .query_row(
                "SELECT provider_config_id FROM ai_chat_sessions WHERE id = ?1",
                params!["session-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(provider_config_id, None);
    }

    #[test]
    fn chat_messages_with_same_timestamp_keep_insert_order() {
        let (repository, _secrets) = temp_repository("ai-message-order");
        repository
            .sqlite_connection()
            .execute(
                "INSERT INTO ai_chat_sessions(id, title, provider_config_id, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?3)",
                params!["session-order", "排序", "1000"],
            )
            .unwrap();
        insert_chat_message(
            &repository,
            InsertChatMessage {
                id: "z-user",
                session_id: "session-order",
                role: "user",
                content: "先问",
                contexts: &[],
                commands: &[],
                status: "complete",
                now: "1001",
            },
        )
        .unwrap();
        insert_chat_message(
            &repository,
            InsertChatMessage {
                id: "a-assistant",
                session_id: "session-order",
                role: "assistant",
                content: "后答",
                contexts: &[],
                commands: &[],
                status: "complete",
                now: "1001",
            },
        )
        .unwrap();

        let messages = list_chat_messages(&repository, "session-order").unwrap();
        assert_eq!(messages[0].id, "z-user");
        assert_eq!(messages[1].id, "a-assistant");
        let summary = list_chat_sessions(&repository).unwrap().remove(0);
        assert_eq!(summary.last_message_preview.as_deref(), Some("后答"));
    }

    #[test]
    fn assistant_tool_calls_persist_and_replay_as_history_summary() {
        let (repository, _secrets) = temp_repository("ai-tool-calls");
        repository
            .sqlite_connection()
            .execute(
                "INSERT INTO ai_chat_sessions(id, title, provider_config_id, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?3)",
                params!["session-tools", "工具", "1000"],
            )
            .unwrap();
        insert_chat_message(
            &repository,
            InsertChatMessage {
                id: "assistant-tools",
                session_id: "session-tools",
                role: "assistant",
                content: "",
                contexts: &[],
                commands: &[],
                status: "streaming",
                now: "1001",
            },
        )
        .unwrap();
        assert!(list_chat_messages(&repository, "session-tools").unwrap()[0]
            .tool_calls
            .is_empty());

        let mut completed = AiToolCallRecord::new("call_1", TOOL_RUN_COMMAND, 0);
        completed.command = Some("df -h".to_string());
        completed.status = "completed".to_string();
        completed.exit_status = Some(0);
        completed.output = "/dev/sda1 80%".to_string();
        let mut rejected = AiToolCallRecord::new("call_2", TOOL_RUN_COMMAND, 4);
        rejected.command = Some("rm -rf /tmp/cache".to_string());
        rejected.status = "rejected".to_string();
        save_assistant_message(
            &repository,
            "session-tools",
            "assistant-tools",
            "磁盘已满",
            "",
            "complete",
            &[completed, rejected],
        )
        .unwrap();

        let messages = list_chat_messages(&repository, "session-tools").unwrap();
        assert_eq!(messages[0].tool_calls.len(), 2);
        assert_eq!(messages[0].tool_calls[1].text_offset, 4);
        let history = model_messages_from_history(messages);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].content, "磁盘已满");
    }

    #[test]
    fn legacy_tool_call_summary_is_removed_before_model_replay() {
        let content =
            "结论\n\n[本轮工具调用记录]\n- run_command → 退出码 0\n- server_monitor → 已完成"
                .to_string();
        assert_eq!(strip_tool_call_summary(content), "结论");
    }

    #[test]
    fn history_keeps_assistant_turns_that_only_ran_tools() {
        let mut call = AiToolCallRecord::new("call_1", "server_monitor", 0);
        call.status = "failed".to_string();
        call.error = Some("连接失败".to_string());
        let summary = append_tool_call_summary(String::new(), &[call]);
        assert_eq!(
            summary,
            "[本轮工具调用记录]\n- server_monitor → 失败：连接失败"
        );
    }

    fn temp_repository(name: &str) -> (StorageRepository, Arc<InMemorySecretStore>) {
        let root =
            std::env::temp_dir().join(format!("mxterm-ai-repo-{name}-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("mxterm.db");
        let secrets = Arc::new(InMemorySecretStore::default());
        let repository = StorageRepository::open(db_path, secrets.clone()).unwrap();
        (repository, secrets)
    }
}
