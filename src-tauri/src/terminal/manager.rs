use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use russh::{ChannelMsg, ChannelReadHalf};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::commands::{
    LocalTerminalOpenRequest, TerminalConnectRequest, TerminalResizeRequest, TerminalWriteRequest,
};
use crate::events::{TerminalConnectProgressEvent, TerminalOutputEvent, TerminalStateChangedEvent};
use crate::terminal::local::{LocalTerminalSession, OpenLocalSession};
use crate::terminal::serial::{
    OpenSerialSession, SerialTerminalOpenRequest, SerialTerminalSession,
};
use crate::terminal::session::{
    OpenProgress, TerminalOutputBatcher, TerminalOutputDecoder, TerminalSession,
};
use crate::terminal::telnet::{
    OpenTelnetSession, TelnetTerminalOpenRequest, TelnetTerminalSession,
};

#[derive(Clone)]
enum ManagedTerminalSession {
    Ssh(Arc<TerminalSession>),
    Local(Arc<LocalTerminalSession>),
    Telnet(Arc<TelnetTerminalSession>),
    Serial(Arc<SerialTerminalSession>),
}

type SessionStore = Arc<Mutex<HashMap<String, ManagedTerminalSession>>>;
const TERMINAL_RING_LIMIT: usize = 128 * 1024;

#[derive(Default)]
struct OutputStore {
    buffers: HashMap<String, OutputBuffer>,
}

struct OutputBuffer {
    bytes: Vec<u8>,
    total: u64,
    connection_id: Option<String>,
    updated_at_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalRecentOutput {
    pub session_id: String,
    pub data: String,
    pub total_bytes: usize,
    pub truncated: bool,
    pub cursor: u64,
    pub retained_from: u64,
    pub updated_at_ms: u128,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: SessionStore,
    output: Arc<StdMutex<OutputStore>>,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct TerminalRecentOutputRequest {
    pub session_id: String,
    #[serde(default)]
    pub max_chars: Option<usize>,
    #[serde(default)]
    pub connection_id: Option<String>,
}

impl TerminalManager {
    pub fn recent_output(
        &self,
        request: TerminalRecentOutputRequest,
    ) -> Result<TerminalRecentOutput, AppError> {
        let max_chars = request.max_chars.unwrap_or(20_000).clamp(200, 20_000);
        let store = self.output.lock().map_err(|_| {
            AppError::new(
                "terminal_output_lock_failed",
                "读取终端输出失败。",
                "output lock poisoned",
                true,
            )
        })?;
        let buffer = store.buffers.get(&request.session_id).ok_or_else(|| {
            AppError::new(
                "terminal_session_missing",
                "终端会话不存在或已关闭。",
                "no live buffer",
                true,
            )
        })?;
        if buffer.connection_id != request.connection_id {
            return Err(AppError::new(
                "terminal_scope_mismatch",
                "终端与 Agent 工作区不属于同一连接。",
                "connection binding mismatch",
                true,
            ));
        }
        let bytes = &buffer.bytes;
        let text = String::from_utf8_lossy(bytes).to_string();
        let chars: Vec<char> = text.chars().collect();
        let truncated = chars.len() > max_chars || buffer.total > bytes.len() as u64;
        let data = if chars.len() > max_chars {
            chars[chars.len() - max_chars..].iter().collect()
        } else {
            text
        };
        Ok(TerminalRecentOutput {
            session_id: request.session_id,
            data,
            total_bytes: bytes.len(),
            truncated,
            cursor: buffer.total,
            retained_from: buffer.total.saturating_sub(bytes.len() as u64),
            updated_at_ms: buffer.updated_at_ms,
        })
    }

    fn record_output(&self, session_id: &str, data: &[u8]) {
        let Ok(mut store) = self.output.lock() else {
            return;
        };
        let Some(buffer) = store.buffers.get_mut(session_id) else {
            return;
        };
        buffer.total += data.len() as u64;
        buffer.updated_at_ms = crate::ai_agent::now_millis();
        buffer.bytes.extend_from_slice(data);
        if buffer.bytes.len() > TERMINAL_RING_LIMIT {
            let drop_count = buffer.bytes.len() - TERMINAL_RING_LIMIT;
            buffer.bytes.drain(..drop_count);
        }
    }
    fn register_output(&self, id: &str, connection_id: Option<String>) {
        if let Ok(mut store) = self.output.lock() {
            store.buffers.insert(
                id.into(),
                OutputBuffer {
                    bytes: vec![],
                    total: 0,
                    connection_id,
                    updated_at_ms: crate::ai_agent::now_millis(),
                },
            );
        }
    }
    pub async fn connect(
        &self,
        app: AppHandle,
        request: TerminalConnectRequest,
    ) -> Result<String, AppError> {
        validate_connect_request(&request)?;

        let request_id = request
            .request_id
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let progress = request_id.clone().map(|request_id| {
            let progress_app = app.clone();
            OpenProgress::new(move |stage, message| {
                let _ = progress_app.emit(
                    crate::events::TERMINAL_CONNECT_PROGRESS,
                    TerminalConnectProgressEvent {
                        request_id: request_id.clone(),
                        stage: stage.to_string(),
                        message: message.to_string(),
                    },
                );
            })
        });
        let connection_id = request.connection_id.clone();
        let (session, reader) = TerminalSession::open(app.clone(), request, progress).await?;
        let session_id = session.id.clone();
        self.register_output(&session_id, connection_id);
        let terminal_encoding = session.terminal_encoding().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedTerminalSession::Ssh(Arc::new(session)),
        );
        spawn_reader(
            app,
            session_id.clone(),
            request_id,
            reader,
            self.sessions.clone(),
            terminal_encoding,
        );

        Ok(session_id)
    }

    pub async fn connect_local(
        &self,
        app: AppHandle,
        request: LocalTerminalOpenRequest,
    ) -> Result<String, AppError> {
        let OpenLocalSession {
            session,
            reader,
            request_id,
        } = LocalTerminalSession::open(request)?;
        let session_id = session.id.clone();
        self.register_output(&session_id, None);
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedTerminalSession::Local(session.clone()),
        );
        spawn_local_reader(
            app,
            session_id.clone(),
            request_id,
            reader,
            session,
            self.sessions.clone(),
        );
        Ok(session_id)
    }

    pub async fn connect_telnet(
        &self,
        app: AppHandle,
        request: TelnetTerminalOpenRequest,
    ) -> Result<String, AppError> {
        let OpenTelnetSession {
            session,
            reader,
            request_id,
        } = TelnetTerminalSession::open(request).await?;
        let session_id = session.id.clone();
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), ManagedTerminalSession::Telnet(session));
        spawn_telnet_reader(
            app,
            session_id.clone(),
            request_id,
            reader,
            self.sessions.clone(),
        );
        Ok(session_id)
    }

    pub async fn connect_serial(
        &self,
        app: AppHandle,
        request: SerialTerminalOpenRequest,
    ) -> Result<String, AppError> {
        let OpenSerialSession {
            session,
            reader,
            request_id,
        } = SerialTerminalSession::open(request)?;
        let session_id = session.id.clone();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedTerminalSession::Serial(session.clone()),
        );
        spawn_serial_reader(
            app,
            session_id.clone(),
            request_id,
            reader,
            session,
            self.sessions.clone(),
        );
        Ok(session_id)
    }

    pub async fn write(&self, request: TerminalWriteRequest) -> Result<(), AppError> {
        match self.session(&request.session_id).await? {
            ManagedTerminalSession::Ssh(session) => session.write(request.data).await,
            ManagedTerminalSession::Local(session) => session.write(request.data).await,
            ManagedTerminalSession::Telnet(session) => session.write(request.data).await,
            ManagedTerminalSession::Serial(session) => session.write(request.data).await,
        }
    }

    pub async fn resize(&self, request: TerminalResizeRequest) -> Result<(), AppError> {
        validate_session_id(&request.session_id)?;
        crate::terminal::pty::validate_size(request.cols, request.rows)?;

        match self.session(&request.session_id).await? {
            ManagedTerminalSession::Ssh(session) => {
                session.resize(request.cols, request.rows).await
            }
            ManagedTerminalSession::Local(session) => {
                session.resize(request.cols, request.rows).await
            }
            ManagedTerminalSession::Telnet(session) => {
                session.resize(request.cols, request.rows).await
            }
            ManagedTerminalSession::Serial(session) => {
                session.resize(request.cols, request.rows).await
            }
        }
    }

    pub async fn close(&self, session_id: String) -> Result<(), AppError> {
        validate_session_id(&session_id)?;

        let session = self
            .sessions
            .lock()
            .await
            .remove(&session_id)
            .ok_or_else(|| {
                AppError::new(
                    "terminal_session_missing",
                    "终端会话不存在。",
                    format!("session_id={session_id}"),
                    false,
                )
            })?;

        match session {
            ManagedTerminalSession::Ssh(session) => session.close().await,
            ManagedTerminalSession::Local(session) => session.close().await,
            ManagedTerminalSession::Telnet(session) => session.close().await,
            ManagedTerminalSession::Serial(session) => session.close().await,
        }
    }

    async fn session(&self, session_id: &str) -> Result<ManagedTerminalSession, AppError> {
        validate_session_id(session_id)?;
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                AppError::new(
                    "terminal_session_missing",
                    "终端会话不存在。",
                    format!("session_id={session_id}"),
                    false,
                )
            })
    }
}

pub fn validate_connect_request(request: &TerminalConnectRequest) -> Result<(), AppError> {
    if request.host.trim().is_empty() {
        return Err(AppError::new(
            "terminal_host_missing",
            "请填写 SSH 主机。",
            "host is empty",
            true,
        ));
    }

    if request.username.trim().is_empty() {
        return Err(AppError::new(
            "terminal_username_missing",
            "请填写 SSH 用户名。",
            "username is empty",
            true,
        ));
    }

    if request.port == 0 {
        return Err(AppError::new(
            "terminal_port_invalid",
            "SSH 端口无效。",
            "port is 0",
            true,
        ));
    }

    let has_password = request
        .password
        .as_ref()
        .is_some_and(|password| !password.trim().is_empty());
    let has_private_key = request
        .private_key_path
        .as_ref()
        .is_some_and(|path| !path.trim().is_empty());
    if !has_password && !has_private_key {
        return Err(AppError::new(
            "terminal_auth_missing",
            "请填写密码或选择私钥。",
            "password and private_key_path are both empty",
            true,
        ));
    }

    crate::terminal::pty::validate_size(request.cols, request.rows)?;
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), AppError> {
    if session_id.trim().is_empty() {
        return Err(AppError::new(
            "terminal_session_missing",
            "终端会话不存在。",
            "session_id is empty",
            false,
        ));
    }

    Ok(())
}

fn spawn_reader(
    app: AppHandle,
    session_id: String,
    request_id: Option<String>,
    mut reader: ChannelReadHalf,
    sessions: SessionStore,
    terminal_encoding: String,
) {
    tauri::async_runtime::spawn(async move {
        let mut exit_status = None;
        let mut decoder = match TerminalOutputDecoder::new(&terminal_encoding) {
            Ok(decoder) => decoder,
            Err(error) => {
                emit_terminal_error(&app, &session_id, &request_id, &error);
                sessions.lock().await.remove(&session_id);
                let _ = app.emit(
                    crate::events::TERMINAL_STATE_CHANGED,
                    TerminalStateChangedEvent {
                        session_id,
                        request_id,
                        state: "closed".to_string(),
                        exit_status: None,
                    },
                );
                return;
            }
        };
        let mut decode_error = None;
        let mut output_batcher = TerminalOutputBatcher::new();

        loop {
            let message = if let Some(deadline) = output_batcher.deadline() {
                match tokio::time::timeout_at(deadline, reader.wait()).await {
                    Ok(message) => message,
                    Err(_) => {
                        if let Some(batch) = output_batcher.flush() {
                            emit_terminal_output(&app, &session_id, &request_id, batch);
                        }
                        continue;
                    }
                }
            } else {
                reader.wait().await
            };
            let Some(message) = message else {
                break;
            };
            match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    match decoder.decode(&data, false) {
                        Ok(decoded) => {
                            for batch in output_batcher.push(&decoded) {
                                emit_terminal_output(&app, &session_id, &request_id, batch);
                            }
                        }
                        Err(error) => {
                            decode_error = Some(error);
                            break;
                        }
                    }
                }
                ChannelMsg::ExitStatus { exit_status: code } => {
                    exit_status = Some(code);
                }
                ChannelMsg::Eof => {}
                ChannelMsg::Close => break,
                _ => {}
            }
        }

        match decode_error {
            Some(error) => {
                if let Some(batch) = output_batcher.flush() {
                    emit_terminal_output(&app, &session_id, &request_id, batch);
                }
                emit_terminal_error(&app, &session_id, &request_id, &error);
            }
            None => match decoder.decode(&[], true) {
                Ok(tail) => {
                    for batch in output_batcher.push(&tail) {
                        emit_terminal_output(&app, &session_id, &request_id, batch);
                    }
                    if let Some(batch) = output_batcher.flush() {
                        emit_terminal_output(&app, &session_id, &request_id, batch);
                    }
                }
                Err(error) => {
                    if let Some(batch) = output_batcher.flush() {
                        emit_terminal_output(&app, &session_id, &request_id, batch);
                    }
                    emit_terminal_error(&app, &session_id, &request_id, &error);
                }
            },
        }

        sessions.lock().await.remove(&session_id);
        let _ = app.emit(
            crate::events::TERMINAL_STATE_CHANGED,
            TerminalStateChangedEvent {
                session_id,
                request_id,
                state: "closed".to_string(),
                exit_status,
            },
        );
    });
}

fn spawn_local_reader(
    app: AppHandle,
    session_id: String,
    request_id: Option<String>,
    reader: Box<dyn std::io::Read + Send>,
    session: Arc<LocalTerminalSession>,
    sessions: SessionStore,
) {
    let app_for_thread = app.clone();
    let session_id_for_thread = session_id.clone();
    let request_id_for_thread = request_id.clone();

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = vec![0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    emit_terminal_output(
                        &app_for_thread,
                        &session_id_for_thread,
                        &request_id_for_thread,
                        buffer[..read].to_vec(),
                    );
                }
                Err(error) => {
                    emit_terminal_output(
                        &app_for_thread,
                        &session_id_for_thread,
                        &request_id_for_thread,
                        format!("\r\n{}\r\n", error).into_bytes(),
                    );
                    break;
                }
            }
        }

        let exit_status = session.wait_exit_status();
        tauri::async_runtime::spawn(async move {
            sessions.lock().await.remove(&session_id);
            let _ = app.emit(
                crate::events::TERMINAL_STATE_CHANGED,
                TerminalStateChangedEvent {
                    session_id,
                    request_id,
                    state: "closed".to_string(),
                    exit_status,
                },
            );
        });
    });
}

fn spawn_telnet_reader(
    app: AppHandle,
    session_id: String,
    request_id: Option<String>,
    mut reader: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    sessions: SessionStore,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(data) = reader.recv().await {
            emit_terminal_output(&app, &session_id, &request_id, data);
        }

        sessions.lock().await.remove(&session_id);
        let _ = app.emit(
            crate::events::TERMINAL_STATE_CHANGED,
            TerminalStateChangedEvent {
                session_id,
                request_id,
                state: "closed".to_string(),
                exit_status: None,
            },
        );
    });
}

fn spawn_serial_reader(
    app: AppHandle,
    session_id: String,
    request_id: Option<String>,
    mut reader: Box<dyn serialport::SerialPort>,
    session: Arc<SerialTerminalSession>,
    sessions: SessionStore,
) {
    let app_for_thread = app.clone();
    let session_id_for_thread = session_id.clone();
    let request_id_for_thread = request_id.clone();

    std::thread::spawn(move || {
        let mut buffer = vec![0_u8; 8192];
        while !session.is_closed() {
            match reader.read(&mut buffer) {
                Ok(0) => {}
                Ok(read) => {
                    emit_terminal_output(
                        &app_for_thread,
                        &session_id_for_thread,
                        &request_id_for_thread,
                        buffer[..read].to_vec(),
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => {
                    emit_terminal_output(
                        &app_for_thread,
                        &session_id_for_thread,
                        &request_id_for_thread,
                        format!("\r\n{}\r\n", error).into_bytes(),
                    );
                    break;
                }
            }
        }

        tauri::async_runtime::spawn(async move {
            sessions.lock().await.remove(&session_id);
            let _ = app.emit(
                crate::events::TERMINAL_STATE_CHANGED,
                TerminalStateChangedEvent {
                    session_id,
                    request_id,
                    state: "closed".to_string(),
                    exit_status: None,
                },
            );
        });
    });
}

fn emit_terminal_output(
    app: &AppHandle,
    session_id: &str,
    request_id: &Option<String>,
    data: Vec<u8>,
) {
    if let Some(manager) = app.try_state::<TerminalManager>() {
        manager.record_output(session_id, &data);
    }
    let _ = app.emit(
        crate::events::TERMINAL_OUTPUT,
        TerminalOutputEvent {
            session_id: session_id.to_string(),
            request_id: request_id.clone(),
            data,
        },
    );
}

fn emit_terminal_error(
    app: &AppHandle,
    session_id: &str,
    request_id: &Option<String>,
    error: &AppError,
) {
    emit_terminal_output(
        app,
        session_id,
        request_id,
        format!("\r\n{}\r\n", error.message).into_bytes(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_ring_keeps_only_the_bounded_tail() {
        let manager = TerminalManager::default();
        manager.register_output("session", None);
        manager.record_output("session", &vec![b'a'; TERMINAL_RING_LIMIT + 10]);
        let result = manager
            .recent_output(TerminalRecentOutputRequest {
                session_id: "session".to_string(),
                max_chars: Some(200),
                connection_id: None,
            })
            .unwrap();
        assert_eq!(result.total_bytes, TERMINAL_RING_LIMIT);
        assert!(result.truncated);
        assert_eq!(result.data.chars().count(), 200);
    }

    fn valid_request() -> TerminalConnectRequest {
        TerminalConnectRequest {
            request_id: None,
            connection_id: None,
            host: "127.0.0.1".to_string(),
            port: 22,
            username: "root".to_string(),
            auth_kind: None,
            password: Some("secret".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            cols: 80,
            rows: 24,
            runtime_config: None,
        }
    }

    #[test]
    fn connect_rejects_blank_host() {
        let request = TerminalConnectRequest {
            host: "  ".to_string(),
            ..valid_request()
        };

        let error = validate_connect_request(&request).unwrap_err();

        assert_eq!(error.code, "terminal_host_missing");
    }

    #[test]
    fn connect_rejects_missing_auth() {
        let request = TerminalConnectRequest {
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
            ..valid_request()
        };

        let error = validate_connect_request(&request).unwrap_err();

        assert_eq!(error.code, "terminal_auth_missing");
    }
}
