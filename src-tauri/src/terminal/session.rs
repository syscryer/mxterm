use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{ChannelReadHalf, ChannelWriteHalf, Disconnect};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::app_error::AppError;
use crate::commands::TerminalConnectRequest;

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

#[allow(dead_code)]
pub struct TerminalSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    client: SshHandle,
    writer: Mutex<ChannelWriter>,
}

impl TerminalSession {
    pub async fn open(
        request: TerminalConnectRequest,
    ) -> Result<(Self, ChannelReadHalf), AppError> {
        let host = request.host.trim().to_string();
        let port = request.port;
        let username = request.username.trim().to_string();
        let auth_method = auth_method(&request)?;

        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(20)),
            keepalive_max: 3,
            nodelay: true,
            ..<_>::default()
        });

        let mut client = client::connect(config, (host.as_str(), port), TrustingClient)
            .await
            .map_err(|error| {
                AppError::new("terminal_connect_failed", "SSH 连接失败。", error, true)
            })?;

        authenticate(&mut client, &username, auth_method).await?;

        let channel = client.channel_open_session().await.map_err(|error| {
            AppError::new(
                "terminal_channel_open_failed",
                "SSH 终端通道打开失败。",
                error,
                true,
            )
        })?;

        channel
            .request_pty(
                true,
                "xterm-256color",
                u32::from(request.cols),
                u32::from(request.rows),
                0,
                0,
                &[],
            )
            .await
            .map_err(|error| {
                AppError::new(
                    "terminal_pty_failed",
                    "远程终端初始化失败。",
                    error,
                    true,
                )
            })?;

        channel.request_shell(true).await.map_err(|error| {
            AppError::new(
                "terminal_shell_failed",
                "远程 Shell 启动失败。",
                error,
                true,
            )
        })?;

        let (reader, writer) = channel.split();

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
                AppError::new("terminal_private_key_invalid", "私钥读取失败。", error, true)
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
    #[ignore = "requires MXTERM_SSH_HOST, MXTERM_SSH_USER and MXTERM_SSH_PASSWORD"]
    fn opens_real_shell_with_password_auth() {
        tauri::async_runtime::block_on(async {
            let host = env::var("MXTERM_SSH_HOST").expect("MXTERM_SSH_HOST is required");
            let username = env::var("MXTERM_SSH_USER").expect("MXTERM_SSH_USER is required");
            let password =
                env::var("MXTERM_SSH_PASSWORD").expect("MXTERM_SSH_PASSWORD is required");
            let marker = "__MXTERM_SMOKE_READY__";

            let request = TerminalConnectRequest {
                host,
                port: 22,
                username,
                password: Some(password),
                private_key_path: None,
                private_key_passphrase: None,
                cols: 80,
                rows: 24,
            };
            let (session, mut reader) = TerminalSession::open(request).await.unwrap();

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
                            ChannelMsg::Data { data }
                            | ChannelMsg::ExtendedData { data, .. } => {
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
