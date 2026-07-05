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

use crate::app_error::AppError;
use crate::events::{AiChatStreamEvent, AI_CHAT_STREAM_EVENT};
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretKind, SecretReference, VAULT_SERVICE};

const AI_PROVIDER_CONFIGS_KEY: &str = "ai.provider_configs.v1";
const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
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
    pub api_key_saved: bool,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredAiProviderConfig {
    id: String,
    name: String,
    provider: AiProviderKind,
    api_format: AiApiFormat,
    endpoint: String,
    model: String,
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

#[derive(Clone, Debug, Serialize)]
pub struct AiChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub contexts: Vec<AiContextBlock>,
    pub commands: Vec<AiCommandSuggestion>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AiChatSessionSummary {
    pub id: String,
    pub title: String,
    pub provider_config_id: Option<String>,
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
struct AiModelMessage {
    role: String,
    content: String,
}

#[derive(Clone)]
pub struct AiChatStreamManager {
    streams: Arc<AsyncMutex<HashMap<String, AiChatStreamHandle>>>,
}

struct AiChatStreamHandle {
    session_id: String,
    message_id: String,
    content: Arc<StdMutex<String>>,
    stopped: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

struct PreparedAiStream {
    config: StoredAiProviderConfig,
    api_key: String,
    messages: Vec<AiModelMessage>,
    response: AiChatStreamStartResponse,
}

struct ValidatedAiProviderConfigInput {
    id: Option<String>,
    name: Option<String>,
    provider: AiProviderKind,
    api_format: AiApiFormat,
    endpoint: String,
    model: Option<String>,
}

impl Default for AiChatStreamManager {
    fn default() -> Self {
        Self {
            streams: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }
}

impl AiChatStreamManager {
    async fn start(&self, app: AppHandle, prepared: PreparedAiStream) -> Result<(), AppError> {
        let stream_id = prepared.response.stream_id.clone();
        let session_id = prepared.response.session_id.clone();
        let message_id = prepared.response.assistant_message_id.clone();
        let content = Arc::new(StdMutex::new(String::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = self.clone();
        let task_content = Arc::clone(&content);
        let task_stopped = Arc::clone(&stopped);
        let task_stream_id = stream_id.clone();
        let task_session_id = session_id.clone();
        let task_message_id = message_id.clone();

        let task = tokio::spawn(async move {
            let result = run_provider_stream(
                &prepared.config,
                &prepared.api_key,
                prepared.messages,
                Arc::clone(&task_stopped),
                |delta| {
                    if delta.is_empty() {
                        return;
                    }
                    if let Ok(mut current) = task_content.lock() {
                        current.push_str(&delta);
                    }
                    emit_chat_stream_event(
                        &app,
                        AiChatStreamEvent {
                            kind: "chunk".to_string(),
                            stream_id: task_stream_id.clone(),
                            session_id: task_session_id.clone(),
                            message_id: task_message_id.clone(),
                            delta: Some(delta),
                            content: None,
                            error: None,
                        },
                    );
                },
            )
            .await;

            if task_stopped.load(Ordering::SeqCst) {
                manager.finish_stream(&task_stream_id).await;
                return;
            }

            let final_content = locked_string(&task_content);
            match result {
                Ok(()) => {
                    let _ = update_assistant_message(
                        &app,
                        &task_session_id,
                        &task_message_id,
                        &final_content,
                        "complete",
                    );
                    emit_chat_stream_event(
                        &app,
                        AiChatStreamEvent {
                            kind: "finished".to_string(),
                            stream_id: task_stream_id.clone(),
                            session_id: task_session_id.clone(),
                            message_id: task_message_id.clone(),
                            delta: None,
                            content: Some(final_content),
                            error: None,
                        },
                    );
                }
                Err(error) => {
                    let _ = update_assistant_message(
                        &app,
                        &task_session_id,
                        &task_message_id,
                        &final_content,
                        "error",
                    );
                    emit_chat_stream_event(
                        &app,
                        AiChatStreamEvent {
                            kind: "error".to_string(),
                            stream_id: task_stream_id.clone(),
                            session_id: task_session_id.clone(),
                            message_id: task_message_id.clone(),
                            delta: None,
                            content: Some(final_content),
                            error: Some(error.message),
                        },
                    );
                }
            }

            manager.finish_stream(&task_stream_id).await;
        });

        let previous = {
            let mut streams = self.streams.lock().await;
            streams.insert(
                stream_id,
                AiChatStreamHandle {
                    session_id,
                    message_id,
                    content,
                    stopped,
                    task,
                },
            )
        };
        close_stream_handle(previous);

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
        let _ = update_assistant_message(
            app,
            &handle.session_id,
            &handle.message_id,
            &content,
            "stopped",
        );
        emit_chat_stream_event(
            app,
            AiChatStreamEvent {
                kind: "stopped".to_string(),
                stream_id: stream_id.to_string(),
                session_id: handle.session_id,
                message_id: handle.message_id,
                delta: None,
                content: Some(content),
                error: None,
            },
        );
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
    let config = load_stored_provider_config(&repository, &provider_config_id)?
        .ok_or_else(ai_provider_config_missing)?;
    let api_key = api_key_for_config(&repository, &config)?;
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
                    "INSERT INTO ai_chat_sessions(id, title, provider_config_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![
                        next_id,
                        chat_title_from_content(&user_content),
                        provider_config_id,
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
        response: AiChatStreamStartResponse {
            stream_id,
            session_id,
            user_message_id,
            assistant_message_id,
        },
    })
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
    let validated = validate_provider_config_input(&request, true, true)?;
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
    let _ = normalize_endpoint(&endpoint, request.api_format)?;
    Ok(ValidatedAiProviderConfigInput {
        id: trim_optional(request.id.clone()),
        name,
        provider: request.provider,
        api_format: request.api_format,
        endpoint,
        model,
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
            vec![AiModelMessage {
                role: "user".to_string(),
                content: "请仅回复 OK。".to_string(),
            }],
            stopped,
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
            AiApiFormat::OpenaiCompatible => list_openai_models(&client, config, api_key).await,
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
            Some(AiProviderModelOption {
                id,
                display_name: None,
                subtitle,
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
            Some(AiProviderModelOption {
                id,
                display_name,
                subtitle,
            })
        })
        .collect::<Vec<_>>();
    sort_models(&mut models);
    Ok(models)
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
    Ok(AiProviderConfig {
        id: stored.id,
        name: stored.name,
        provider: stored.provider,
        api_format: stored.api_format,
        endpoint: stored.endpoint,
        model: stored.model,
        api_key_saved,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
    })
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
        let count: i64 = row.get(5).map_err(sqlite_ai_error)?;
        let preview: Option<String> = row.get(6).map_err(sqlite_ai_error)?;
        sessions.push(AiChatSessionSummary {
            id: row.get(0).map_err(sqlite_ai_error)?,
            title: row.get(1).map_err(sqlite_ai_error)?,
            provider_config_id: row.get(2).map_err(sqlite_ai_error)?,
            created_at: row.get(3).map_err(sqlite_ai_error)?,
            updated_at: row.get(4).map_err(sqlite_ai_error)?,
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
            "SELECT id, session_id, role, content, contexts_json, commands_json, status, created_at, updated_at
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
        messages.push(AiChatMessage {
            id: row.get(0).map_err(sqlite_ai_error)?,
            session_id: row.get(1).map_err(sqlite_ai_error)?,
            role: row.get(2).map_err(sqlite_ai_error)?,
            content: row.get(3).map_err(sqlite_ai_error)?,
            contexts: serde_json::from_str(&contexts_json).unwrap_or_default(),
            commands: serde_json::from_str(&commands_json).unwrap_or_default(),
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
    status: &str,
) -> Result<(), AppError> {
    let repository = StorageRepository::open_app(app)?;
    let now = now_timestamp()?;
    let commands = extract_command_suggestions(content);
    let commands_json = serde_json::to_string(&commands).map_err(json_ai_error)?;
    repository
        .sqlite_connection()
        .execute(
            "UPDATE ai_chat_messages
                SET content = ?2, commands_json = ?3, status = ?4, updated_at = ?5
              WHERE id = ?1 AND role = 'assistant'",
            params![message_id, content, commands_json, status, now],
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
            if message.role == "assistant" && message.content.trim().is_empty() {
                return None;
            }
            let content = if message.role == "user" {
                format_user_message_for_model(&message.content, &message.contexts)
            } else {
                message.content
            };
            Some(AiModelMessage {
                role: message.role,
                content,
            })
        })
        .collect()
}

async fn run_provider_stream<F>(
    config: &StoredAiProviderConfig,
    api_key: &str,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    mut on_delta: F,
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let client = Client::new();
    match config.api_format {
        AiApiFormat::OpenaiCompatible => {
            run_openai_stream(&client, config, api_key, messages, stopped, &mut on_delta).await
        }
        AiApiFormat::Anthropic => {
            run_anthropic_stream(&client, config, api_key, messages, stopped, &mut on_delta).await
        }
    }
}

async fn run_openai_stream<F>(
    client: &Client,
    config: &StoredAiProviderConfig,
    api_key: &str,
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    on_delta: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let endpoint = normalize_endpoint(&config.endpoint, AiApiFormat::OpenaiCompatible)?;
    let messages = openai_messages_with_system(messages);
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.model,
            "stream": true,
            "messages": messages,
        }))
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    read_sse_events(response, stopped, |data| {
        match parse_openai_sse_delta(data)? {
            ParsedSseDelta::Delta(delta) => on_delta(delta),
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
    messages: Vec<AiModelMessage>,
    stopped: Arc<AtomicBool>,
    on_delta: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(String) + Send,
{
    let endpoint = normalize_endpoint(&config.endpoint, AiApiFormat::Anthropic)?;
    let (system, anthropic_messages) = split_system_message(messages);
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", DEFAULT_ANTHROPIC_VERSION)
        .json(&json!({
            "model": config.model,
            "stream": true,
            "max_tokens": 4096,
            "system": system,
            "messages": anthropic_messages,
        }))
        .send()
        .await
        .map_err(provider_request_error)?;
    let response = ensure_provider_response(response).await?;
    read_sse_events(response, stopped, |data| {
        match parse_anthropic_sse_delta(data)? {
            ParsedSseDelta::Delta(delta) => on_delta(delta),
            ParsedSseDelta::Done => return Ok(true),
            ParsedSseDelta::None => {}
        }
        Ok(false)
    })
    .await
}

async fn ensure_provider_response(response: Response) -> Result<Response, AppError> {
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

async fn read_sse_events<F>(
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
    Done,
    None,
}

fn parse_openai_sse_delta(data: &str) -> Result<ParsedSseDelta, AppError> {
    if data == "[DONE]" {
        return Ok(ParsedSseDelta::Done);
    }
    let value: Value = serde_json::from_str(data).map_err(stream_parse_error)?;
    if let Some(error) = value.get("error") {
        return Err(AppError::new(
            "ai_provider_stream_error",
            "AI 服务返回流式错误。",
            truncate_chars(&error.to_string(), MAX_SSE_ERROR_BODY_CHARS),
            true,
        ));
    }
    let delta = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default();
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
            let delta = value
                .get("delta")
                .and_then(|delta| delta.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default();
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
        "error" => Err(AppError::new(
            "ai_provider_stream_error",
            "AI 服务返回流式错误。",
            truncate_chars(&value.to_string(), MAX_SSE_ERROR_BODY_CHARS),
            true,
        )),
        _ => Ok(ParsedSseDelta::None),
    }
}

fn normalize_endpoint(endpoint: &str, api_format: AiApiFormat) -> Result<String, AppError> {
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

fn assess_command(command: &str) -> AiCommandAssessment {
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

fn emit_chat_stream_event(app: &AppHandle, event: AiChatStreamEvent) {
    let _ = app.emit(AI_CHAT_STREAM_EVENT, event);
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

fn provider_request_error(error: reqwest::Error) -> AppError {
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

fn stream_parse_error(error: serde_json::Error) -> AppError {
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
    fn parses_openai_stream_delta() {
        let delta =
            parse_openai_sse_delta(r#"{"choices":[{"delta":{"content":"hello"}}]}"#).unwrap();
        assert!(matches!(delta, ParsedSseDelta::Delta(value) if value == "hello"));
        assert!(matches!(
            parse_openai_sse_delta("[DONE]").unwrap(),
            ParsedSseDelta::Done
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
                { "id": "gpt-4.1-mini", "owned_by": "openai" },
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

        let anthropic_models = parse_anthropic_models_list(&anthropic).unwrap();
        assert_eq!(anthropic_models.len(), 1);
        assert_eq!(
            anthropic_models[0].display_name.as_deref(),
            Some("Claude Sonnet 4")
        );
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
                api_key: Some("secret-one".to_string()),
                api_key_touched: true,
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
                api_key: None,
                api_key_touched: false,
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
                api_key: Some("secret-reveal".to_string()),
                api_key_touched: true,
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
                api_key: Some("secret-test-saved".to_string()),
                api_key_touched: true,
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
                api_key: None,
                api_key_touched: false,
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
                api_key: Some("draft-secret".to_string()),
                api_key_touched: true,
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
                api_key: Some("secret-two".to_string()),
                api_key_touched: true,
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
                api_key: Some("  ".to_string()),
                api_key_touched: true,
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
                api_key: Some("secret-three".to_string()),
                api_key_touched: true,
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

    fn temp_repository(name: &str) -> (StorageRepository, Arc<InMemorySecretStore>) {
        let root =
            std::env::temp_dir().join(format!("mxterm-ai-repo-{name}-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("mxterm.db");
        let secrets = Arc::new(InMemorySecretStore::default());
        let repository = StorageRepository::open(db_path, secrets.clone()).unwrap();
        (repository, secrets)
    }
}
