use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::app_error::AppError;
use crate::ssh_config::{resolve_saved_connection, RuntimeCredentialInput};
use crate::storage::{load_json_document, write_json_document, JsonStoreErrorLabels};
use crate::storage_repository::StorageRepository;
use crate::terminal::session::{
    RemoteForwardEvent, RemoteForwardEventHandler, ReusableForwardSession,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelStatus {
    Stopped,
    Starting,
    Running,
    Failed,
    CredentialRequired,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TunnelRule {
    pub id: String,
    pub name: String,
    pub kind: TunnelKind,
    pub connection_id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct TunnelRuleInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub kind: TunnelKind,
    pub connection_id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TunnelStartRequest {
    pub rule_id: String,
    #[serde(default)]
    pub runtime_credential: Option<RuntimeCredentialInput>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TunnelRuleIdRequest {
    pub rule_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TunnelRuntimeState {
    pub rule_id: String,
    pub status: TunnelStatus,
    pub bound_host: Option<String>,
    pub bound_port: Option<u16>,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_error_code: Option<String>,
    pub active_connections: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct TunnelRuleWithState {
    pub rule: TunnelRule,
    pub state: TunnelRuntimeState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct TunnelStoreDocument {
    version: u16,
    rules: Vec<TunnelRule>,
}

#[allow(dead_code)]
pub struct TunnelStore {
    path: PathBuf,
    document: TunnelStoreDocument,
}

#[derive(Clone, Default)]
pub struct TunnelManager {
    store_lock: Arc<Mutex<()>>,
    states: Arc<RwLock<HashMap<String, TunnelRuntimeState>>>,
    running: Arc<Mutex<HashMap<String, RunningTunnel>>>,
}

struct RunningTunnel {
    rule: TunnelRule,
    session: Arc<ReusableForwardSession>,
    task: JoinHandle<()>,
    remote_forward: Option<RemoteForwardBinding>,
}

struct RemoteForwardBinding {
    host: String,
    port: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Socks5ConnectTarget {
    host: String,
    port: u16,
}

fn tunnel_store_error_labels() -> JsonStoreErrorLabels {
    JsonStoreErrorLabels {
        create_dir_code: "tunnel_store_create_dir_failed",
        create_dir_message: "隧道规则目录创建失败。",
        parse_code: "tunnel_store_parse_failed",
        parse_message: "隧道规则文件格式无效。",
        read_code: "tunnel_store_read_failed",
        read_message: "隧道规则读取失败。",
        serialize_code: "tunnel_store_serialize_failed",
        serialize_message: "隧道规则序列化失败。",
        write_code: "tunnel_store_write_failed",
        write_message: "隧道规则写入失败。",
    }
}

impl Default for TunnelKind {
    fn default() -> Self {
        Self::Local
    }
}

#[allow(dead_code)]
impl TunnelStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = load_json_document(
            &path,
            || TunnelStoreDocument {
                version: 1,
                rules: Vec::new(),
            },
            tunnel_store_error_labels(),
        )?;
        document.version = 1;

        Ok(Self { path, document })
    }

    pub fn list(&self) -> Vec<TunnelRule> {
        self.document.rules.clone()
    }

    pub fn get(&self, id: &str) -> Option<TunnelRule> {
        self.document
            .rules
            .iter()
            .find(|rule| rule.id == id)
            .cloned()
    }

    pub fn upsert(&mut self, input: TunnelRuleInput, now: &str) -> Result<TunnelRule, AppError> {
        let validated = validate_tunnel_rule_input(input)?;
        let id = validated
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing_index = self.document.rules.iter().position(|rule| rule.id == id);
        let created_at = existing_index
            .and_then(|index| self.document.rules.get(index))
            .map(|rule| rule.created_at.clone())
            .unwrap_or_else(|| now.to_string());
        let name = validated
            .name
            .clone()
            .unwrap_or_else(|| default_tunnel_rule_name(&validated));
        let rule = TunnelRule {
            id,
            name,
            kind: validated.kind,
            connection_id: validated.connection_id,
            local_host: validated.local_host,
            local_port: validated.local_port,
            remote_host: validated.remote_host,
            remote_port: validated.remote_port,
            auto_start: validated.auto_start,
            created_at,
            updated_at: now.to_string(),
        };

        if let Some(index) = existing_index {
            self.document.rules[index] = rule.clone();
        } else {
            self.document.rules.push(rule.clone());
        }

        self.save()?;
        Ok(rule)
    }

    fn save(&self) -> Result<(), AppError> {
        write_json_document(
            &self.path,
            &TunnelStoreDocument {
                version: 1,
                rules: self.document.rules.clone(),
            },
            tunnel_store_error_labels(),
        )
    }
}

impl TunnelManager {
    pub async fn list(&self, app: &AppHandle) -> Result<Vec<TunnelRuleWithState>, AppError> {
        let _guard = self.store_lock.lock().await;
        let rules = StorageRepository::open_app(app)?.tunnel_list()?;
        Ok(self.attach_states(rules).await)
    }

    pub async fn upsert(
        &self,
        app: &AppHandle,
        input: TunnelRuleInput,
    ) -> Result<TunnelRuleWithState, AppError> {
        if let Some(rule_id) = normalized_optional_id(input.id.as_deref()) {
            let has_running = { self.running.lock().await.contains_key(&rule_id) };
            let status = self
                .states
                .read()
                .await
                .get(&rule_id)
                .map(|state| state.status.clone());
            if has_running || matches!(status, Some(TunnelStatus::Starting | TunnelStatus::Running))
            {
                return Err(AppError::new(
                    "tunnel_update_running",
                    "请先停止隧道，再编辑规则。",
                    format!("rule_id={rule_id}"),
                    true,
                ));
            }
        }

        let _guard = self.store_lock.lock().await;
        let rule = StorageRepository::open_app(app)?.tunnel_upsert(input, &now_timestamp()?)?;
        self.attach_state(rule).await
    }

    pub async fn delete(&self, app: &AppHandle, rule_id: &str) -> Result<(), AppError> {
        let rule_id = normalize_rule_id(rule_id)?;
        let _ = self.stop_running(&rule_id).await;

        let _guard = self.store_lock.lock().await;
        StorageRepository::open_app(app)?.tunnel_delete(&rule_id)?;
        self.states.write().await.remove(&rule_id);
        Ok(())
    }

    pub async fn start(
        &self,
        app: &AppHandle,
        request: TunnelStartRequest,
    ) -> Result<TunnelRuleWithState, AppError> {
        let rule_id = normalize_rule_id(&request.rule_id)?;
        self.start_rule(app, &rule_id, request.runtime_credential, false)
            .await
    }

    pub async fn stop(
        &self,
        app: &AppHandle,
        rule_id: &str,
    ) -> Result<TunnelRuleWithState, AppError> {
        let rule_id = normalize_rule_id(rule_id)?;
        let stopped_running_rule = self.stop_running(&rule_id).await;
        let rule = resolve_stopped_rule(self.load_rule(app, &rule_id).await, stopped_running_rule)?;
        self.set_state(stopped_state(&rule_id)).await;
        self.attach_state(rule).await
    }

    pub async fn autostart(&self, app: &AppHandle) -> Result<Vec<TunnelRuleWithState>, AppError> {
        let rules = {
            let _guard = self.store_lock.lock().await;
            StorageRepository::open_app(app)?.tunnel_list()?
        };

        let mut tasks = Vec::new();
        for rule in rules.iter().filter(|rule| rule.auto_start) {
            let app = app.clone();
            let manager = self.clone();
            let rule_id = rule.id.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                let _ = manager.start_rule(&app, &rule_id, None, true).await;
            }));
        }
        for task in tasks {
            let _ = task.await;
        }

        self.list(app).await
    }

    async fn start_rule(
        &self,
        app: &AppHandle,
        rule_id: &str,
        runtime_credential: Option<RuntimeCredentialInput>,
        suppress_prompt_error: bool,
    ) -> Result<TunnelRuleWithState, AppError> {
        let rule = {
            let _guard = self.store_lock.lock().await;
            StorageRepository::open_app(app)?
                .tunnel_get(rule_id)?
                .ok_or_else(|| {
                    AppError::new(
                        "tunnel_rule_missing",
                        "隧道规则不存在。",
                        format!("rule_id={rule_id}"),
                        false,
                    )
                })?
        };

        let has_running = { self.running.lock().await.contains_key(rule_id) };
        if has_running {
            let status = self
                .states
                .read()
                .await
                .get(rule_id)
                .map(|state| state.status.clone());
            if should_replace_existing_runtime(status.as_ref()) {
                let _ = self.stop_running(rule_id).await;
            } else {
                return self.attach_state(rule).await;
            }
        }

        self.set_state(starting_state(&rule)).await;
        let config = match resolve_saved_connection(app, &rule.connection_id, runtime_credential) {
            Ok(config) => config,
            Err(error) if error.code == "credential_prompt_required" => {
                self.set_state(credential_required_state(&rule, &error))
                    .await;
                if suppress_prompt_error {
                    return self.attach_state(rule).await;
                }
                return Err(error);
            }
            Err(error) => {
                self.set_state(failed_state(&rule, &error)).await;
                return Err(error);
            }
        };

        if rule.kind == TunnelKind::Remote {
            let session = match ReusableForwardSession::connect_resolved(app, &config).await {
                Ok(session) => Arc::new(session),
                Err(error) => {
                    self.set_state(failed_state(&rule, &error)).await;
                    return Err(error);
                }
            };

            if let Err(error) = self.load_rule(app, rule_id).await {
                session.close().await;
                self.states.write().await.remove(rule_id);
                return Err(error);
            }

            if self.running.lock().await.contains_key(rule_id) {
                session.close().await;
                return self.attach_state(rule).await;
            }

            let states_for_events = Arc::clone(&self.states);
            let rule_id_for_events = rule.id.clone();
            let event_handler: RemoteForwardEventHandler = Arc::new(move |event| {
                let states = Arc::clone(&states_for_events);
                let rule_id = rule_id_for_events.clone();
                tauri::async_runtime::spawn(async move {
                    match event {
                        RemoteForwardEvent::Started => {
                            increment_active_connections(&states, &rule_id).await;
                        }
                        RemoteForwardEvent::Finished { error } => {
                            decrement_active_connections(&states, &rule_id, error).await;
                        }
                    }
                });
            });
            session
                .set_remote_forward_target(
                    rule.local_host.clone(),
                    rule.local_port,
                    Some(event_handler),
                )
                .await;
            let bound_port = match session
                .request_remote_forward(&rule.remote_host, rule.remote_port)
                .await
            {
                Ok(port) => port,
                Err(error) => {
                    session.clear_remote_forward_target().await;
                    session.close().await;
                    self.set_state(failed_state(&rule, &error)).await;
                    return Err(error);
                }
            };

            let running_state =
                running_state(&rule, Some(rule.remote_host.clone()), Some(bound_port))?;
            self.set_state(running_state).await;
            let task = tauri::async_runtime::spawn(std::future::pending::<()>());
            self.running.lock().await.insert(
                rule_id.to_string(),
                RunningTunnel {
                    rule: rule.clone(),
                    session,
                    task,
                    remote_forward: Some(RemoteForwardBinding {
                        host: rule.remote_host.clone(),
                        port: bound_port,
                    }),
                },
            );
            return self.attach_state(rule).await;
        }

        let bind_address = format!("{}:{}", rule.local_host, rule.local_port);
        let listener = match TcpListener::bind(bind_address.as_str()).await {
            Ok(listener) => listener,
            Err(error) => {
                let error = AppError::new(
                    "tunnel_local_bind_failed",
                    "本地监听端口绑定失败。",
                    format!("{bind_address}: {error}"),
                    true,
                );
                self.set_state(failed_state(&rule, &error)).await;
                return Err(error);
            }
        };
        let local_addr = listener.local_addr().ok();
        let session = match ReusableForwardSession::connect_resolved(app, &config).await {
            Ok(session) => Arc::new(session),
            Err(error) => {
                self.set_state(failed_state(&rule, &error)).await;
                return Err(error);
            }
        };

        if let Err(error) = self.load_rule(app, rule_id).await {
            session.close().await;
            self.states.write().await.remove(rule_id);
            return Err(error);
        }

        if self.running.lock().await.contains_key(rule_id) {
            session.close().await;
            return self.attach_state(rule).await;
        }

        let running_state = running_state(
            &rule,
            local_addr.as_ref().map(|addr| addr.ip().to_string()),
            local_addr.map(|addr| addr.port()),
        )?;
        self.set_state(running_state).await;
        let states = Arc::clone(&self.states);
        let running = Arc::clone(&self.running);
        let session_for_task = Arc::clone(&session);
        let rule_for_task = rule.clone();
        let task = tauri::async_runtime::spawn(async move {
            run_tunnel_accept_loop(rule_for_task, listener, session_for_task, states, running)
                .await;
        });

        self.running.lock().await.insert(
            rule_id.to_string(),
            RunningTunnel {
                rule: rule.clone(),
                session,
                task,
                remote_forward: None,
            },
        );
        self.attach_state(rule).await
    }

    async fn load_rule(&self, app: &AppHandle, rule_id: &str) -> Result<TunnelRule, AppError> {
        let _guard = self.store_lock.lock().await;
        StorageRepository::open_app(app)?
            .tunnel_get(rule_id)?
            .ok_or_else(|| {
                AppError::new(
                    "tunnel_rule_missing",
                    "隧道规则不存在。",
                    format!("rule_id={rule_id}"),
                    false,
                )
            })
    }

    async fn stop_running(&self, rule_id: &str) -> Option<TunnelRule> {
        let running = self.running.lock().await.remove(rule_id);
        if let Some(running) = running {
            let rule = running.rule;
            running.task.abort();
            if let Some(binding) = running.remote_forward.as_ref() {
                let _ = running
                    .session
                    .cancel_remote_forward(&binding.host, binding.port)
                    .await;
                running.session.clear_remote_forward_target().await;
            }
            running.session.close().await;
            Some(rule)
        } else {
            None
        }
    }

    async fn attach_states(&self, rules: Vec<TunnelRule>) -> Vec<TunnelRuleWithState> {
        let states = self.states.read().await;
        rules
            .into_iter()
            .map(|rule| {
                let state = states
                    .get(&rule.id)
                    .cloned()
                    .unwrap_or_else(|| stopped_state(&rule.id));
                TunnelRuleWithState { rule, state }
            })
            .collect()
    }

    async fn attach_state(&self, rule: TunnelRule) -> Result<TunnelRuleWithState, AppError> {
        let state = self
            .states
            .read()
            .await
            .get(&rule.id)
            .cloned()
            .unwrap_or_else(|| stopped_state(&rule.id));
        Ok(TunnelRuleWithState { rule, state })
    }

    async fn set_state(&self, state: TunnelRuntimeState) {
        self.states
            .write()
            .await
            .insert(state.rule_id.clone(), state);
    }
}

async fn run_tunnel_accept_loop(
    rule: TunnelRule,
    listener: TcpListener,
    session: Arc<ReusableForwardSession>,
    states: Arc<RwLock<HashMap<String, TunnelRuntimeState>>>,
    running: Arc<Mutex<HashMap<String, RunningTunnel>>>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                increment_active_connections(&states, &rule.id).await;
                let session = Arc::clone(&session);
                let states = Arc::clone(&states);
                let rule_id = rule.id.clone();
                let remote_host = rule.remote_host.clone();
                let remote_port = rule.remote_port;
                let kind = rule.kind.clone();
                tauri::async_runtime::spawn(async move {
                    let result = match kind {
                        TunnelKind::Local => {
                            session
                                .forward_tcp_stream(stream, &remote_host, remote_port)
                                .await
                        }
                        TunnelKind::Dynamic => forward_socks5_stream(session, stream).await,
                        TunnelKind::Remote => Ok(()),
                    };
                    decrement_active_connections(&states, &rule_id, result.err()).await;
                });
            }
            Err(error) => {
                let app_error = AppError::new(
                    "tunnel_accept_failed",
                    "本地隧道连接接入失败。",
                    error,
                    true,
                );
                set_failed_state(&states, &rule, &app_error).await;
                break;
            }
        }
    }
    running.lock().await.remove(&rule.id);
    session.close().await;
}

async fn forward_socks5_stream(
    session: Arc<ReusableForwardSession>,
    mut local_stream: TcpStream,
) -> Result<(), AppError> {
    let target = read_socks5_connect_target(&mut local_stream).await?;
    let peer_addr = local_stream.peer_addr().ok();
    let source_host = peer_addr
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let source_port = peer_addr.map(|address| address.port()).unwrap_or(0);
    let mut remote_stream = match session
        .open_direct_tcpip_stream(&target.host, target.port, source_host, source_port)
        .await
    {
        Ok(stream) => stream,
        Err(error) => {
            let _ = write_socks5_reply(&mut local_stream, 0x05).await;
            return Err(error);
        }
    };
    write_socks5_reply(&mut local_stream, 0x00).await?;
    tokio::io::copy_bidirectional(&mut local_stream, &mut remote_stream)
        .await
        .map_err(|error| {
            AppError::new(
                "tunnel_stream_copy_failed",
                "SSH 隧道数据转发失败。",
                error,
                true,
            )
        })?;
    let _ = remote_stream.shutdown().await;
    let _ = local_stream.shutdown().await;
    Ok(())
}

async fn read_socks5_connect_target(
    stream: &mut TcpStream,
) -> Result<Socks5ConnectTarget, AppError> {
    let mut greeting = [0u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|error| socks_handshake_error("SOCKS5 握手读取失败。", error))?;
    if greeting[0] != 0x05 {
        return Err(socks_handshake_error(
            "SOCKS5 版本不受支持。",
            format!("version={}", greeting[0]),
        ));
    }
    let method_count = usize::from(greeting[1]);
    if method_count == 0 {
        let _ = stream.write_all(&[0x05, 0xff]).await;
        return Err(socks_handshake_error(
            "SOCKS5 客户端未提供认证方式。",
            "method count is zero",
        ));
    }
    let mut methods = vec![0u8; method_count];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|error| socks_handshake_error("SOCKS5 认证方式读取失败。", error))?;
    if let Err(error) = select_socks5_no_auth_method(&methods) {
        let _ = stream.write_all(&[0x05, 0xff]).await;
        return Err(error);
    }
    stream
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| socks_handshake_error("SOCKS5 握手响应失败。", error))?;

    let mut request = vec![0u8; 4];
    stream
        .read_exact(&mut request)
        .await
        .map_err(|error| socks_handshake_error("SOCKS5 请求读取失败。", error))?;
    let extra_len = match request[3] {
        0x01 => 6,
        0x03 => {
            let mut length = [0u8; 1];
            stream
                .read_exact(&mut length)
                .await
                .map_err(|error| socks_target_error("SOCKS5 域名长度读取失败。", error))?;
            request.push(length[0]);
            usize::from(length[0]).saturating_add(2)
        }
        0x04 => 18,
        atyp => {
            return Err(socks_handshake_error(
                "SOCKS5 地址类型不受支持。",
                format!("atyp={atyp}"),
            ));
        }
    };
    let mut extra = vec![0u8; extra_len];
    stream
        .read_exact(&mut extra)
        .await
        .map_err(|error| socks_target_error("SOCKS5 目标读取失败。", error))?;
    request.extend(extra);
    parse_socks5_connect_target(&request)
}

async fn write_socks5_reply(stream: &mut TcpStream, reply: u8) -> Result<(), AppError> {
    stream
        .write_all(&[0x05, reply, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await
        .map_err(|error| socks_handshake_error("SOCKS5 响应发送失败。", error))
}

async fn increment_active_connections(
    states: &Arc<RwLock<HashMap<String, TunnelRuntimeState>>>,
    rule_id: &str,
) {
    if let Some(state) = states.write().await.get_mut(rule_id) {
        state.active_connections = state.active_connections.saturating_add(1);
    }
}

async fn decrement_active_connections(
    states: &Arc<RwLock<HashMap<String, TunnelRuntimeState>>>,
    rule_id: &str,
    error: Option<AppError>,
) {
    if let Some(state) = states.write().await.get_mut(rule_id) {
        state.active_connections = state.active_connections.saturating_sub(1);
        if let Some(error) = error {
            state.last_error = Some(error.message);
            state.last_error_code = Some(error.code);
        }
    }
}

async fn set_failed_state(
    states: &Arc<RwLock<HashMap<String, TunnelRuntimeState>>>,
    rule: &TunnelRule,
    error: &AppError,
) {
    states
        .write()
        .await
        .insert(rule.id.clone(), failed_state(rule, error));
}

fn should_replace_existing_runtime(status: Option<&TunnelStatus>) -> bool {
    matches!(
        status,
        Some(TunnelStatus::Failed | TunnelStatus::CredentialRequired | TunnelStatus::Stopped)
    )
}

fn resolve_stopped_rule(
    load_result: Result<TunnelRule, AppError>,
    stopped_running_rule: Option<TunnelRule>,
) -> Result<TunnelRule, AppError> {
    match load_result {
        Ok(rule) => Ok(rule),
        Err(error) if error.code == "tunnel_rule_missing" => stopped_running_rule.ok_or(error),
        Err(error) => Err(error),
    }
}

pub(crate) fn validate_tunnel_rule_input(
    input: TunnelRuleInput,
) -> Result<TunnelRuleInput, AppError> {
    let connection_id = trim_required(
        input.connection_id,
        "tunnel_connection_missing",
        "请选择 SSH 连接。",
        "connection_id is empty",
    )?;
    let (local_host, local_port, remote_host, remote_port) = match input.kind {
        TunnelKind::Local => {
            let local_host = trim_required(
                input.local_host,
                "tunnel_local_host_missing",
                "请填写本地监听地址。",
                "local_host is empty",
            )?;
            let remote_host = trim_required(
                input.remote_host,
                "tunnel_remote_host_missing",
                "请填写远端目标地址。",
                "remote_host is empty",
            )?;
            validate_port(
                input.local_port,
                "tunnel_local_port_invalid",
                "本地监听端口无效。",
            )?;
            validate_port(
                input.remote_port,
                "tunnel_remote_port_invalid",
                "远端目标端口无效。",
            )?;
            (local_host, input.local_port, remote_host, input.remote_port)
        }
        TunnelKind::Dynamic => {
            let local_host = trim_required(
                input.local_host,
                "tunnel_local_host_missing",
                "请填写本地 SOCKS 监听地址。",
                "local_host is empty",
            )?;
            validate_port(
                input.local_port,
                "tunnel_local_port_invalid",
                "本地 SOCKS 端口无效。",
            )?;
            (local_host, input.local_port, String::new(), 1)
        }
        TunnelKind::Remote => {
            let local_host = trim_required(
                input.local_host,
                "tunnel_local_host_missing",
                "请填写本机目标地址。",
                "local_host is empty",
            )?;
            let remote_host = trim_required(
                input.remote_host,
                "tunnel_remote_host_missing",
                "请填写远端监听地址。",
                "remote_host is empty",
            )?;
            validate_port(
                input.local_port,
                "tunnel_local_port_invalid",
                "本机目标端口无效。",
            )?;
            validate_port(
                input.remote_port,
                "tunnel_remote_port_invalid",
                "远端监听端口无效。",
            )?;
            (local_host, input.local_port, remote_host, input.remote_port)
        }
    };

    Ok(TunnelRuleInput {
        id: normalized_optional_id(input.id.as_deref()),
        name: input
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        kind: input.kind,
        connection_id,
        local_host,
        local_port,
        remote_host,
        remote_port,
        auto_start: input.auto_start,
    })
}

pub(crate) fn default_tunnel_rule_name(input: &TunnelRuleInput) -> String {
    match input.kind {
        TunnelKind::Local => format!(
            "L {}:{} -> {}:{}",
            input.local_host, input.local_port, input.remote_host, input.remote_port
        ),
        TunnelKind::Dynamic => format!("D {}:{} SOCKS", input.local_host, input.local_port),
        TunnelKind::Remote => format!(
            "R {}:{} -> {}:{}",
            input.remote_host, input.remote_port, input.local_host, input.local_port
        ),
    }
}

pub(crate) fn select_socks5_no_auth_method(methods: &[u8]) -> Result<(), AppError> {
    if methods.iter().any(|method| *method == 0x00) {
        return Ok(());
    }
    Err(socks_handshake_error(
        "SOCKS5 客户端不支持无认证方式。",
        "no supported no-auth method",
    ))
}

pub(crate) fn parse_socks5_connect_target(request: &[u8]) -> Result<Socks5ConnectTarget, AppError> {
    if request.len() < 7 {
        return Err(socks_target_error(
            "SOCKS5 请求目标不完整。",
            "request too short",
        ));
    }
    if request[0] != 0x05 {
        return Err(socks_handshake_error(
            "SOCKS5 版本不受支持。",
            format!("version={}", request[0]),
        ));
    }
    if request[1] != 0x01 {
        return Err(socks_handshake_error(
            "SOCKS5 暂只支持 CONNECT 请求。",
            format!("command={}", request[1]),
        ));
    }
    if request[2] != 0x00 {
        return Err(socks_handshake_error(
            "SOCKS5 请求格式无效。",
            format!("reserved={}", request[2]),
        ));
    }

    match request[3] {
        0x01 => parse_socks5_ipv4_target(request),
        0x03 => parse_socks5_domain_target(request),
        0x04 => parse_socks5_ipv6_target(request),
        atyp => Err(socks_handshake_error(
            "SOCKS5 地址类型不受支持。",
            format!("atyp={atyp}"),
        )),
    }
}

fn parse_socks5_ipv4_target(request: &[u8]) -> Result<Socks5ConnectTarget, AppError> {
    if request.len() < 10 {
        return Err(socks_target_error(
            "SOCKS5 IPv4 目标不完整。",
            "ipv4 request too short",
        ));
    }
    let host = Ipv4Addr::new(request[4], request[5], request[6], request[7]).to_string();
    let port = socks5_port(request[8], request[9])?;
    Ok(Socks5ConnectTarget { host, port })
}

fn parse_socks5_domain_target(request: &[u8]) -> Result<Socks5ConnectTarget, AppError> {
    let domain_len = usize::from(request[4]);
    let port_start = 5usize.saturating_add(domain_len);
    if domain_len == 0 || request.len() < port_start.saturating_add(2) {
        return Err(socks_target_error(
            "SOCKS5 域名目标不完整。",
            "domain request too short",
        ));
    }
    let domain = String::from_utf8(request[5..port_start].to_vec())
        .map_err(|error| socks_target_error("SOCKS5 域名目标无效。", error))?;
    let port = socks5_port(request[port_start], request[port_start + 1])?;
    Ok(Socks5ConnectTarget { host: domain, port })
}

fn parse_socks5_ipv6_target(request: &[u8]) -> Result<Socks5ConnectTarget, AppError> {
    if request.len() < 22 {
        return Err(socks_target_error(
            "SOCKS5 IPv6 目标不完整。",
            "ipv6 request too short",
        ));
    }
    let mut octets = [0u8; 16];
    octets.copy_from_slice(&request[4..20]);
    let host = Ipv6Addr::from(octets).to_string();
    let port = socks5_port(request[20], request[21])?;
    Ok(Socks5ConnectTarget { host, port })
}

fn socks5_port(high: u8, low: u8) -> Result<u16, AppError> {
    let port = u16::from_be_bytes([high, low]);
    if port == 0 {
        return Err(socks_target_error("SOCKS5 目标端口无效。", "port is zero"));
    }
    Ok(port)
}

fn socks_handshake_error(message: &str, raw_message: impl ToString) -> AppError {
    AppError::new("tunnel_socks_handshake_failed", message, raw_message, true)
}

fn socks_target_error(message: &str, raw_message: impl ToString) -> AppError {
    AppError::new("tunnel_socks_target_missing", message, raw_message, true)
}

fn normalized_optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_rule_id(value: &str) -> Result<String, AppError> {
    let rule_id = value.trim();
    if rule_id.is_empty() {
        return Err(AppError::new(
            "tunnel_rule_missing",
            "隧道规则不存在。",
            "rule_id is empty",
            false,
        ));
    }
    Ok(rule_id.to_string())
}

fn trim_required(
    value: String,
    code: &str,
    message: &str,
    raw_message: &str,
) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(code, message, raw_message, true));
    }
    Ok(trimmed.to_string())
}

fn validate_port(port: u16, code: &str, message: &str) -> Result<(), AppError> {
    if port == 0 {
        return Err(AppError::new(code, message, "port must be 1..=65535", true));
    }
    Ok(())
}

fn starting_state(rule: &TunnelRule) -> TunnelRuntimeState {
    TunnelRuntimeState {
        rule_id: rule.id.clone(),
        status: TunnelStatus::Starting,
        bound_host: None,
        bound_port: None,
        started_at: None,
        last_error: None,
        last_error_code: None,
        active_connections: 0,
    }
}

fn running_state(
    rule: &TunnelRule,
    bound_host: Option<String>,
    bound_port: Option<u16>,
) -> Result<TunnelRuntimeState, AppError> {
    Ok(TunnelRuntimeState {
        rule_id: rule.id.clone(),
        status: TunnelStatus::Running,
        bound_host: bound_host.or_else(|| Some(rule.local_host.clone())),
        bound_port: bound_port.or(Some(rule.local_port)),
        started_at: Some(now_timestamp()?),
        last_error: None,
        last_error_code: None,
        active_connections: 0,
    })
}

fn credential_required_state(rule: &TunnelRule, error: &AppError) -> TunnelRuntimeState {
    TunnelRuntimeState {
        rule_id: rule.id.clone(),
        status: TunnelStatus::CredentialRequired,
        bound_host: None,
        bound_port: None,
        started_at: None,
        last_error: Some(error.message.clone()),
        last_error_code: Some(error.code.clone()),
        active_connections: 0,
    }
}

fn failed_state(rule: &TunnelRule, error: &AppError) -> TunnelRuntimeState {
    TunnelRuntimeState {
        rule_id: rule.id.clone(),
        status: TunnelStatus::Failed,
        bound_host: None,
        bound_port: None,
        started_at: None,
        last_error: Some(error.message.clone()),
        last_error_code: Some(error.code.clone()),
        active_connections: 0,
    }
}

fn stopped_state(rule_id: &str) -> TunnelRuntimeState {
    TunnelRuntimeState {
        rule_id: rule_id.to_string(),
        status: TunnelStatus::Stopped,
        bound_host: None,
        bound_port: None,
        started_at: None,
        last_error: None,
        last_error_code: None,
        active_connections: 0,
    }
}

fn now_timestamp() -> Result<String, AppError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::new("tunnel_clock_invalid", "系统时间异常。", error, false))?;
    Ok(duration.as_secs().to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn valid_input() -> TunnelRuleInput {
        TunnelRuleInput {
            id: Some("rule-001".to_string()),
            name: Some("数据库".to_string()),
            kind: TunnelKind::Local,
            connection_id: "conn-001".to_string(),
            local_host: " 127.0.0.1 ".to_string(),
            local_port: 15432,
            remote_host: " 10.0.0.8 ".to_string(),
            remote_port: 5432,
            auto_start: true,
        }
    }

    #[test]
    fn tunnel_rule_validation_trims_addresses_and_names() {
        let validated = validate_tunnel_rule_input(valid_input()).unwrap();

        assert_eq!(validated.id.as_deref(), Some("rule-001"));
        assert_eq!(validated.name.as_deref(), Some("数据库"));
        assert_eq!(validated.connection_id, "conn-001");
        assert_eq!(validated.local_host, "127.0.0.1");
        assert_eq!(validated.remote_host, "10.0.0.8");
        assert!(validated.auto_start);
    }

    #[test]
    fn tunnel_rule_validation_rejects_empty_required_fields() {
        let mut input = valid_input();
        input.remote_host = "  ".to_string();

        let error = validate_tunnel_rule_input(input).unwrap_err();

        assert_eq!(error.code, "tunnel_remote_host_missing");
    }

    #[test]
    fn tunnel_rule_validation_rejects_zero_ports() {
        let mut input = valid_input();
        input.local_port = 0;

        let error = validate_tunnel_rule_input(input).unwrap_err();

        assert_eq!(error.code, "tunnel_local_port_invalid");
    }

    #[test]
    fn tunnel_rule_validation_accepts_dynamic_without_remote_target() {
        let mut input = valid_input();
        input.kind = TunnelKind::Dynamic;
        input.name = None;
        input.remote_host = "  ".to_string();
        input.remote_port = 0;

        let validated = validate_tunnel_rule_input(input).unwrap();

        assert_eq!(validated.kind, TunnelKind::Dynamic);
        assert_eq!(validated.remote_host, "");
        assert_eq!(validated.remote_port, 1);
    }

    #[test]
    fn tunnel_rule_validation_accepts_remote_forward_with_remote_listener_and_local_target() {
        let mut input = valid_input();
        input.kind = TunnelKind::Remote;
        input.local_host = " 127.0.0.1 ".to_string();
        input.local_port = 8080;
        input.remote_host = " 0.0.0.0 ".to_string();
        input.remote_port = 18080;

        let validated = validate_tunnel_rule_input(input).unwrap();

        assert_eq!(validated.kind, TunnelKind::Remote);
        assert_eq!(validated.local_host, "127.0.0.1");
        assert_eq!(validated.local_port, 8080);
        assert_eq!(validated.remote_host, "0.0.0.0");
        assert_eq!(validated.remote_port, 18080);
    }

    #[test]
    fn tunnel_rule_validation_rejects_remote_forward_missing_listener_or_target() {
        let mut missing_target = valid_input();
        missing_target.kind = TunnelKind::Remote;
        missing_target.local_host = " ".to_string();

        let error = validate_tunnel_rule_input(missing_target).unwrap_err();

        assert_eq!(error.code, "tunnel_local_host_missing");

        let mut missing_listener = valid_input();
        missing_listener.kind = TunnelKind::Remote;
        missing_listener.remote_host = " ".to_string();

        let error = validate_tunnel_rule_input(missing_listener).unwrap_err();

        assert_eq!(error.code, "tunnel_remote_host_missing");
    }

    #[test]
    fn tunnel_store_generates_default_names_by_kind() {
        let root = std::env::temp_dir().join(format!("mxterm-tunnels-{}", Uuid::new_v4()));
        let path = root.join("tunnels.json");
        let mut store = TunnelStore::load(path).unwrap();

        let mut dynamic = valid_input();
        dynamic.id = Some("dynamic-rule".to_string());
        dynamic.name = None;
        dynamic.kind = TunnelKind::Dynamic;
        dynamic.local_port = 1080;
        dynamic.remote_host = String::new();
        dynamic.remote_port = 1;

        let mut remote = valid_input();
        remote.id = Some("remote-rule".to_string());
        remote.name = None;
        remote.kind = TunnelKind::Remote;
        remote.local_port = 8080;
        remote.remote_host = "0.0.0.0".to_string();
        remote.remote_port = 18080;

        let dynamic = store.upsert(dynamic, "2026-06-20T00:00:00+08:00").unwrap();
        let remote = store.upsert(remote, "2026-06-20T00:00:00+08:00").unwrap();

        assert_eq!(dynamic.name, "D 127.0.0.1:1080 SOCKS");
        assert_eq!(remote.name, "R 0.0.0.0:18080 -> 127.0.0.1:8080");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn socks5_method_selection_requires_no_auth() {
        assert!(select_socks5_no_auth_method(&[0x02, 0x00]).is_ok());

        let error = select_socks5_no_auth_method(&[0x02]).unwrap_err();

        assert_eq!(error.code, "tunnel_socks_handshake_failed");
    }

    #[test]
    fn socks5_connect_parser_supports_ipv4_domain_and_ipv6() {
        let ipv4 = parse_socks5_connect_target(&[0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x15, 0x38])
            .unwrap();
        let domain = parse_socks5_connect_target(&[
            0x05, 0x01, 0x00, 0x03, 11, b'e', b'x', b'a', b'm', b'p', b'l', b'e', b'.', b'c', b'o',
            b'm', 0x01, 0xbb,
        ])
        .unwrap();
        let ipv6 = parse_socks5_connect_target(&[
            0x05, 0x01, 0x00, 0x04, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
            0x04, 0xd2,
        ])
        .unwrap();

        assert_eq!(ipv4.host, "127.0.0.1");
        assert_eq!(ipv4.port, 5432);
        assert_eq!(domain.host, "example.com");
        assert_eq!(domain.port, 443);
        assert_eq!(ipv6.host, "2001:db8::1");
        assert_eq!(ipv6.port, 1234);
    }

    #[test]
    fn socks5_connect_parser_rejects_unsupported_command() {
        let error =
            parse_socks5_connect_target(&[0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0x15, 0x38])
                .unwrap_err();

        assert_eq!(error.code, "tunnel_socks_handshake_failed");
    }

    #[test]
    fn tunnel_store_roundtrips_rules() {
        let root = std::env::temp_dir().join(format!("mxterm-tunnels-{}", Uuid::new_v4()));
        let path = root.join("tunnels.json");
        let mut store = TunnelStore::load(path.clone()).unwrap();

        let created = store
            .upsert(valid_input(), "2026-06-20T00:00:00+08:00")
            .unwrap();
        let reloaded = TunnelStore::load(path).unwrap();

        assert_eq!(created.id, "rule-001");
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.get("rule-001").unwrap().remote_port, 5432);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_or_stopped_runtime_can_be_replaced() {
        assert!(should_replace_existing_runtime(Some(&TunnelStatus::Failed)));
        assert!(should_replace_existing_runtime(Some(
            &TunnelStatus::CredentialRequired
        )));
        assert!(should_replace_existing_runtime(Some(
            &TunnelStatus::Stopped
        )));

        assert!(!should_replace_existing_runtime(Some(
            &TunnelStatus::Starting
        )));
        assert!(!should_replace_existing_runtime(Some(
            &TunnelStatus::Running
        )));
        assert!(!should_replace_existing_runtime(None));
    }

    #[test]
    fn stopped_rule_resolution_uses_removed_running_rule_when_store_entry_is_missing() {
        let running_rule = sample_rule("rule-removed");
        let missing = AppError::new(
            "tunnel_rule_missing",
            "隧道规则不存在。",
            "rule_id=rule-removed",
            false,
        );

        let resolved = resolve_stopped_rule(Err(missing), Some(running_rule.clone())).unwrap();

        assert_eq!(resolved.id, running_rule.id);
    }

    #[test]
    fn stopped_rule_resolution_keeps_missing_error_without_removed_running_rule() {
        let missing = AppError::new(
            "tunnel_rule_missing",
            "隧道规则不存在。",
            "rule_id=missing",
            false,
        );

        let error = resolve_stopped_rule(Err(missing), None).unwrap_err();

        assert_eq!(error.code, "tunnel_rule_missing");
    }

    fn sample_rule(id: &str) -> TunnelRule {
        TunnelRule {
            id: id.to_string(),
            name: "测试隧道".to_string(),
            kind: TunnelKind::Local,
            connection_id: "conn-001".to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: 15432,
            remote_host: "127.0.0.1".to_string(),
            remote_port: 5432,
            auto_start: false,
            created_at: "2026-06-20T00:00:00+08:00".to_string(),
            updated_at: "2026-06-20T00:00:00+08:00".to_string(),
        }
    }
}
