use std::io::Write;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect};
use std::future::Future;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::app_error::AppError;
use crate::commands::TerminalConnectRequest;

static TRACE_LOCK: StdMutex<()> = StdMutex::new(());

fn trace(stage: &str, message: &str) {
    let _guard = TRACE_LOCK.lock().ok();
    let path = std::env::temp_dir().join("mxterm-connect-trace.log");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "[{now}ms] {stage}: {message}");
    }
}

type SshHandle = client::Handle<TrustingClient>;
type ChannelWriter = ChannelWriteHalf<client::Msg>;

#[derive(Clone, Debug)]
struct TrustingClient;

impl client::Handler for TrustingClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

enum AuthMethod {
    Password(String),
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
}

#[derive(Clone)]
pub struct OpenProgress {
    emit: Arc<dyn Fn(&str, &str) + Send + Sync>,
}

impl OpenProgress {
    pub fn new(emit: impl Fn(&str, &str) + Send + Sync + 'static) -> Self {
        Self {
            emit: Arc::new(emit),
        }
    }

    fn emit(&self, stage: &str, message: &str) {
        (self.emit)(stage, message);
    }
}

#[allow(dead_code)]
pub struct TerminalSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    client: SshHandle,
    writer: Mutex<ChannelWriter>,
}

pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_status: Option<u32>,
}

pub struct ReusableExecSession {
    client: SshHandle,
}

impl TerminalSession {
    pub async fn open(
        request: TerminalConnectRequest,
        progress: Option<OpenProgress>,
    ) -> Result<(Self, ChannelReadHalf), AppError> {
        let host = request.host.trim().to_string();
        let port = request.port;
        let username = request.username.trim().to_string();
        trace(
            "open.entry",
            &format!(
                "host={host} port={port} user={username} cols={} rows={} request_id={:?} connection_id={:?} has_password={} has_key={}",
                request.cols,
                request.rows,
                request.request_id,
                request.connection_id,
                request.password.as_ref().is_some(),
                request.private_key_path.as_ref().is_some(),
            ),
        );
        let auth_method = auth_method(&request)?;
        trace("open.auth_method", "ok");

        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(20)),
            keepalive_max: 3,
            nodelay: true,
            ..<_>::default()
        });

        emit_progress(&progress, "tcp_connecting", "正在建立 SSH TCP 连接...");
        trace("tcp.before_connect", "calling client::connect");
        let client_result = run_with_timeout(
            "terminal_connect_timeout",
            "SSH 连接超时。",
            Duration::from_secs(30),
            client::connect(config, (host.as_str(), port), TrustingClient),
        )
        .await;
        match &client_result {
            Ok(Ok(_)) => trace("tcp.after_connect", "tcp+handshake ok"),
            Ok(Err(e)) => trace("tcp.after_connect", &format!("russh err: {e}")),
            Err(e) => trace("tcp.after_connect", &format!("outer err: {e:?}")),
        }
        let mut client = client_result?.map_err(|error| {
            AppError::new("terminal_connect_failed", "SSH 连接失败。", error, true)
        })?;
        emit_progress(&progress, "tcp_connected", "SSH TCP 已连接。");

        emit_progress(&progress, "authenticating", "SSH 认证中...");
        trace("auth.before", "calling authenticate");
        let auth_result = run_with_timeout(
            "terminal_auth_timeout",
            "SSH 认证超时。",
            Duration::from_secs(45),
            authenticate(&mut client, &username, auth_method),
        )
        .await;
        match &auth_result {
            Ok(Ok(())) => trace("auth.after", "ok"),
            Ok(Err(e)) => trace("auth.after", &format!("err: {e:?}")),
            Err(e) => trace("auth.after", &format!("outer err: {e:?}")),
        }
        auth_result??;
        emit_progress(&progress, "authenticated", "SSH 认证通过。");

        emit_progress(&progress, "channel_opening", "正在打开 SSH 终端通道...");
        trace("channel.before", "calling channel_open_session");
        let channel = run_with_timeout(
            "terminal_channel_open_timeout",
            "SSH 终端通道打开超时。",
            Duration::from_secs(20),
            client.channel_open_session(),
        )
        .await;
        match &channel {
            Ok(Ok(_)) => trace("channel.after", "ok"),
            Ok(Err(e)) => trace("channel.after", &format!("err: {e}")),
            Err(e) => trace("channel.after", &format!("outer err: {e:?}")),
        }
        let channel = channel?.map_err(|error| {
            AppError::new(
                "terminal_channel_open_failed",
                "SSH 终端通道打开失败。",
                error,
                true,
            )
        })?;

        emit_progress(&progress, "pty_requesting", "正在初始化远程 PTY...");
        trace(
            "pty.before",
            &format!("cols={} rows={}", request.cols, request.rows),
        );
        let pty_result = run_with_timeout(
            "terminal_pty_timeout",
            "远程终端初始化超时。",
            Duration::from_secs(20),
            channel.request_pty(
                true,
                "xterm-256color",
                u32::from(request.cols),
                u32::from(request.rows),
                0,
                0,
                &[],
            ),
        )
        .await;
        match &pty_result {
            Ok(Ok(_)) => trace("pty.after", "ok"),
            Ok(Err(e)) => trace("pty.after", &format!("err: {e}")),
            Err(e) => trace("pty.after", &format!("outer err: {e:?}")),
        }
        pty_result?.map_err(|error| {
            AppError::new("terminal_pty_failed", "远程终端初始化失败。", error, true)
        })?;
        emit_progress(&progress, "pty_ready", "远程 PTY 已就绪。");

        emit_progress(&progress, "shell_starting", "正在启动远程 Shell...");
        trace("shell.before", "calling request_shell");
        let shell_result = run_with_timeout(
            "terminal_shell_timeout",
            "远程 Shell 启动超时。",
            Duration::from_secs(20),
            channel.request_shell(true),
        )
        .await;
        match &shell_result {
            Ok(Ok(_)) => trace("shell.after", "ok"),
            Ok(Err(e)) => trace("shell.after", &format!("err: {e}")),
            Err(e) => trace("shell.after", &format!("outer err: {e:?}")),
        }
        shell_result?.map_err(|error| {
            AppError::new(
                "terminal_shell_failed",
                "远程 Shell 启动失败。",
                error,
                true,
            )
        })?;
        emit_progress(&progress, "shell_ready", "远程 Shell 已启动。");

        let (reader, writer) = channel.split();
        trace("open.exit", "session ready");

        Ok((
            Self {
                id: Uuid::new_v4().to_string(),
                host,
                port,
                username,
                client,
                writer: Mutex::new(writer),
            },
            reader,
        ))
    }

    pub async fn write(&self, data: String) -> Result<(), AppError> {
        let writer = self.writer.lock().await;
        writer.data_bytes(data.into_bytes()).await.map_err(|error| {
            AppError::new("terminal_write_failed", "终端输入发送失败。", error, true)
        })
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        let writer = self.writer.lock().await;
        writer
            .window_change(u32::from(cols), u32::from(rows), 0, 0)
            .await
            .map_err(|error| {
                AppError::new("terminal_resize_failed", "终端尺寸同步失败。", error, true)
            })
    }

    pub async fn close(&self) -> Result<(), AppError> {
        let writer = self.writer.lock().await;
        let _ = writer.close().await;
        self.client
            .disconnect(Disconnect::ByApplication, "", "English")
            .await
            .map_err(|error| {
                AppError::new("terminal_close_failed", "终端连接关闭失败。", error, true)
            })
    }

}

impl ReusableExecSession {
    pub async fn connect(request: &TerminalConnectRequest) -> Result<Self, AppError> {
        let host = request.host.trim().to_string();
        let port = request.port;
        let username = request.username.trim().to_string();
        let auth_method = auth_method(request)?;
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(20)),
            keepalive_max: 1,
            nodelay: true,
            ..<_>::default()
        });

        let mut client = run_with_timeout(
            "remote_exec_connect_timeout",
            "SSH 命令连接超时。",
            Duration::from_secs(30),
            client::connect(config, (host.as_str(), port), TrustingClient),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "remote_exec_connect_failed",
                "SSH 命令连接失败。",
                error,
                true,
            )
        })?;

        run_with_timeout(
            "remote_exec_auth_timeout",
            "SSH 命令认证超时。",
            Duration::from_secs(45),
            authenticate(&mut client, &username, auth_method),
        )
        .await??;

        Ok(Self { client })
    }

    pub async fn exec(&self, command: &str) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, None).await
    }

    pub async fn exec_with_stdin(
        &self,
        command: &str,
        stdin: &[u8],
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, Some(stdin)).await
    }

    async fn exec_inner(
        &self,
        command: &str,
        stdin: Option<&[u8]>,
    ) -> Result<ExecOutput, AppError> {
        let mut channel = run_with_timeout(
            "remote_exec_channel_timeout",
            "SSH 命令通道打开超时。",
            Duration::from_secs(20),
            self.client.channel_open_session(),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "remote_exec_channel_failed",
                "SSH 命令通道打开失败。",
                error,
                true,
            )
        })?;

        run_with_timeout(
            "remote_exec_start_timeout",
            "远程命令启动超时。",
            Duration::from_secs(20),
            channel.exec(true, command),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "remote_exec_start_failed",
                "远程命令启动失败。",
                error,
                true,
            )
        })?;

        if let Some(stdin) = stdin {
            channel.data_bytes(stdin.to_vec()).await.map_err(|error| {
                AppError::new("remote_exec_stdin_failed", "远程命令输入发送失败。", error, true)
            })?;
            channel.eof().await.map_err(|error| {
                AppError::new("remote_exec_stdin_eof_failed", "远程命令输入结束失败。", error, true)
            })?;
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status: code } => exit_status = Some(code),
                ChannelMsg::Close => break,
                _ => {}
            }
        }

        let _ = channel.close().await;

        Ok(ExecOutput {
            stdout,
            stderr,
            exit_status,
        })
    }

    pub async fn close(&self) {
        let _ = self
            .client
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
    }
}

fn emit_progress(progress: &Option<OpenProgress>, stage: &str, message: &str) {
    if let Some(progress) = progress {
        progress.emit(stage, message);
    }
}

async fn run_with_timeout<T, F>(
    code: &str,
    message: &str,
    duration: Duration,
    future: F,
) -> Result<T, AppError>
where
    F: Future<Output = T>,
{
    tokio::time::timeout(duration, future)
        .await
        .map_err(|_| AppError::new(code, message, format!("timeout after {duration:?}"), true))
}

fn auth_method(request: &TerminalConnectRequest) -> Result<AuthMethod, AppError> {
    if let Some(password) = request.password.as_ref() {
        if !password.trim().is_empty() {
            return Ok(AuthMethod::Password(password.clone()));
        }
    }

    if let Some(path) = request.private_key_path.as_ref() {
        if !path.trim().is_empty() {
            return Ok(AuthMethod::PrivateKey {
                path: path.trim().to_string(),
                passphrase: request
                    .private_key_passphrase
                    .as_ref()
                    .filter(|value| !value.is_empty())
                    .cloned(),
            });
        }
    }

    Err(AppError::new(
        "terminal_auth_missing",
        "请填写密码或选择私钥。",
        "password and private_key_path are both empty",
        true,
    ))
}

async fn authenticate(
    client: &mut SshHandle,
    username: &str,
    auth_method: AuthMethod,
) -> Result<(), AppError> {
    let result = match auth_method {
        AuthMethod::Password(password) => client
            .authenticate_password(username.to_string(), password)
            .await
            .map_err(|error| {
                AppError::new("terminal_auth_failed", "SSH 认证失败。", error, true)
            })?,
        AuthMethod::PrivateKey { path, passphrase } => {
            let key = load_secret_key(path, passphrase.as_deref()).map_err(|error| {
                AppError::new(
                    "terminal_private_key_invalid",
                    "私钥读取失败。",
                    error,
                    true,
                )
            })?;
            let hash_alg = client
                .best_supported_rsa_hash()
                .await
                .map_err(|error| {
                    AppError::new("terminal_auth_failed", "SSH 认证失败。", error, true)
                })?
                .flatten();

            client
                .authenticate_publickey(
                    username.to_string(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|error| {
                    AppError::new("terminal_auth_failed", "SSH 认证失败。", error, true)
                })?
        }
    };

    if result.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "terminal_auth_rejected",
            "SSH 认证未通过。",
            format!("{result:?}"),
            true,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::time::Duration;

    use russh::ChannelMsg;

    use super::*;

    #[test]
    fn ssh_step_timeout_returns_stage_error() {
        tauri::async_runtime::block_on(async {
            let result = run_with_timeout(
                "terminal_auth_timeout",
                "SSH 认证超时。",
                Duration::from_millis(1),
                async {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    Ok::<(), AppError>(())
                },
            )
            .await;

            let error = result.unwrap_err();

            assert_eq!(error.code, "terminal_auth_timeout");
            assert_eq!(error.message, "SSH 认证超时。");
        });
    }

    #[test]
    #[ignore = "requires MXTERM_SSH_HOST, MXTERM_SSH_USER and MXTERM_SSH_PASSWORD"]
    fn opens_real_shell_with_password_auth() {
        tauri::async_runtime::block_on(async {
            let host = env::var("MXTERM_SSH_HOST").expect("MXTERM_SSH_HOST is required");
            let username = env::var("MXTERM_SSH_USER").expect("MXTERM_SSH_USER is required");
            let password =
                env::var("MXTERM_SSH_PASSWORD").expect("MXTERM_SSH_PASSWORD is required");
            let marker = "__MXTERM_SMOKE_READY__";

            let request = TerminalConnectRequest {
                request_id: None,
                connection_id: None,
                host,
                port: 22,
                username,
                password: Some(password),
                private_key_path: None,
                private_key_passphrase: None,
                cols: 80,
                rows: 24,
            };
            let (session, mut reader) = TerminalSession::open(request, None).await.unwrap();

            session.resize(100, 30).await.unwrap();
            session
                .write(format!(
                    "pwd\n\
                     ls -la | head -5\n\
                     seq 1 5000 | tail -1\n\
                     (top -b -n1 | head -3) 2>/dev/null || true\n\
                     (vim --version | head -1) 2>/dev/null || true\n\
                     tmp=\"/tmp/mxterm-tail-smoke-$$\"; echo tail-ok > \"$tmp\"; (timeout 2s tail -f \"$tmp\") 2>/dev/null || true; rm -f \"$tmp\"\n\
                     printf '{marker}:%s\\n' \"$PWD\"\n"
                ))
                .await
                .unwrap();

            let mut output = String::new();
            let result = tokio::time::timeout(Duration::from_secs(10), async {
                while !output.contains(marker) {
                    if let Some(message) = reader.wait().await {
                        match message {
                            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                                output.push_str(&String::from_utf8_lossy(&data));
                            }
                            ChannelMsg::Close | ChannelMsg::Eof => break,
                            _ => {}
                        }
                    }
                }
            })
            .await;

            let _ = session.close().await;

            result.expect("SSH smoke command timed out");
            assert!(
                output.contains(marker),
                "SSH smoke marker missing from output: {output:?}"
            );
            assert!(
                output.contains("5000"),
                "SSH large output check missing from output: {output:?}"
            );
        });
    }
}
