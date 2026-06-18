use std::collections::HashMap;
use std::sync::Arc;

use russh::{ChannelMsg, ChannelReadHalf};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::commands::{
    LocalTerminalOpenRequest, TerminalConnectRequest, TerminalResizeRequest, TerminalWriteRequest,
};
use crate::events::{TerminalConnectProgressEvent, TerminalOutputEvent, TerminalStateChangedEvent};
use crate::terminal::local::{LocalTerminalSession, OpenLocalSession};
use crate::terminal::session::{OpenProgress, TerminalOutputDecoder, TerminalSession};

#[derive(Clone)]
enum ManagedTerminalSession {
    Ssh(Arc<TerminalSession>),
    Local(Arc<LocalTerminalSession>),
}

type SessionStore = Arc<Mutex<HashMap<String, ManagedTerminalSession>>>;

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: SessionStore,
}

impl TerminalManager {
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
        let (session, reader) = TerminalSession::open(app.clone(), request, progress).await?;
        let session_id = session.id.clone();
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

    pub async fn write(&self, request: TerminalWriteRequest) -> Result<(), AppError> {
        match self.session(&request.session_id).await? {
            ManagedTerminalSession::Ssh(session) => session.write(request.data).await,
            ManagedTerminalSession::Local(session) => session.write(request.data).await,
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

        while let Some(message) = reader.wait().await {
            match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    match decoder.decode(&data, false) {
                        Ok(decoded) => {
                            emit_terminal_output(&app, &session_id, &request_id, decoded);
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
            Some(error) => emit_terminal_error(&app, &session_id, &request_id, &error),
            None => match decoder.decode(&[], true) {
                Ok(tail) if !tail.is_empty() => {
                    emit_terminal_output(&app, &session_id, &request_id, tail);
                }
                Ok(_) => {}
                Err(error) => emit_terminal_error(&app, &session_id, &request_id, &error),
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

fn emit_terminal_output(
    app: &AppHandle,
    session_id: &str,
    request_id: &Option<String>,
    data: Vec<u8>,
) {
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
