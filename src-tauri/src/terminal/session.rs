use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use encoding_rs::{CoderResult, Decoder, Encoding};
use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::{Channel, ChannelMsg, ChannelReadHalf, ChannelStream, ChannelWriteHalf, Disconnect};
use russh_sftp::client::SftpSession;
use std::future::Future;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::app_error::AppError;
use crate::commands::TerminalConnectRequest;
use crate::connections::{
    normalize_terminal_encoding, ConnectionAdvancedConfig, ConnectionJumpConfig,
    ConnectionJumpKind, ConnectionProxyConfig, ConnectionProxyKind,
};
use crate::known_hosts::{host_key_info, KnownHostCheck};
use crate::ssh_config::{
    app_error_for_host_key_changed, app_error_for_host_key_unknown, ResolvedSshConfig,
};
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretStore, VaultState};

const REMOTE_EXEC_TRANSFER_CHUNK_BYTES: usize = 256 * 1024;

type SshHandle = client::Handle<KnownHostClient>;
type ChannelWriter = ChannelWriteHalf<client::Msg>;

#[derive(Clone)]
struct KnownHostClient {
    host: String,
    port: u16,
    app_data_dir: std::path::PathBuf,
    secret_store: Arc<dyn SecretStore>,
    remote_forward: RemoteForwardState,
}

#[derive(Clone, Debug)]
struct RemoteForwardTarget {
    host: String,
    port: u16,
}

#[derive(Clone)]
pub enum RemoteForwardEvent {
    Started,
    Finished { error: Option<AppError> },
}

pub type RemoteForwardEventHandler = Arc<dyn Fn(RemoteForwardEvent) + Send + Sync + 'static>;

#[derive(Clone, Default)]
struct RemoteForwardState {
    target: Arc<RwLock<Option<RemoteForwardTarget>>>,
    event_handler: Arc<RwLock<Option<RemoteForwardEventHandler>>>,
}

impl client::Handler for KnownHostClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let host_key = host_key_info(&self.host, self.port, server_public_key);
        let store =
            StorageRepository::open_root(self.app_data_dir.clone(), Arc::clone(&self.secret_store))
                .map_err(to_russh_error)?;
        match store
            .known_host_check(&self.host, self.port, host_key)
            .map_err(to_russh_error)?
        {
            KnownHostCheck::Trusted { .. } => Ok(true),
            KnownHostCheck::Unknown { host_key } => {
                Err(to_russh_error(app_error_for_host_key_unknown(&host_key)))
            }
            KnownHostCheck::Changed { current, host_key } => Err(to_russh_error(
                app_error_for_host_key_changed(&current.fingerprint_sha256, &host_key),
            )),
        }
    }

    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let remote_forward = self.remote_forward.clone();
        async move {
            tauri::async_runtime::spawn(async move {
                remote_forward.handle_forwarded_tcpip(channel).await;
            });
            Ok(())
        }
    }
}

impl RemoteForwardState {
    async fn set_target(
        &self,
        host: String,
        port: u16,
        event_handler: Option<RemoteForwardEventHandler>,
    ) {
        *self.target.write().await = Some(RemoteForwardTarget { host, port });
        *self.event_handler.write().await = event_handler;
    }

    async fn clear_target(&self) {
        *self.target.write().await = None;
        *self.event_handler.write().await = None;
    }

    async fn emit(&self, event: RemoteForwardEvent) {
        if let Some(handler) = self.event_handler.read().await.as_ref().cloned() {
            handler(event);
        }
    }

    async fn handle_forwarded_tcpip(&self, channel: Channel<client::Msg>) {
        let target = self.target.read().await.clone();
        let Some(target) = target else {
            let mut remote_stream = channel.into_stream();
            let _ = remote_stream.shutdown().await;
            return;
        };

        self.emit(RemoteForwardEvent::Started).await;
        let result = forward_channel_to_local_target(channel, &target).await;
        self.emit(RemoteForwardEvent::Finished {
            error: result.err(),
        })
        .await;
    }
}

async fn forward_channel_to_local_target(
    channel: Channel<client::Msg>,
    target: &RemoteForwardTarget,
) -> Result<(), AppError> {
    let mut remote_stream = channel.into_stream();
    let mut local_stream = TcpStream::connect((target.host.as_str(), target.port))
        .await
        .map_err(|error| {
            AppError::new(
                "tunnel_remote_target_connect_failed",
                "远程转发回连本机目标失败。",
                format!("{}:{}: {error}", target.host, target.port),
                true,
            )
        })?;
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

fn vault_secret_store(app: &AppHandle) -> Result<Arc<dyn SecretStore>, AppError> {
    app.state::<VaultState>().secret_store()
}

fn ssh_app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "sqlite_store_path_failed",
            "SQLite 存储路径获取失败。",
            error,
            true,
        )
    })
}

#[derive(Clone)]
pub struct SshConnectionContext {
    app_data_dir: std::path::PathBuf,
    secret_store: Arc<dyn SecretStore>,
}

impl SshConnectionContext {
    pub fn from_app(app: &AppHandle) -> Result<Self, AppError> {
        Ok(Self {
            app_data_dir: ssh_app_data_dir(app)?,
            secret_store: vault_secret_store(app)?,
        })
    }

    pub fn from_parts(
        app_data_dir: impl Into<std::path::PathBuf>,
        secret_store: Arc<dyn SecretStore>,
    ) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
            secret_store,
        }
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
    terminal_encoding: String,
    client: SshHandle,
    jump_client: Option<SshHandle>,
    writer: Mutex<ChannelWriter>,
}

pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_status: Option<u32>,
}

pub type ExecProgressCallback = Arc<dyn Fn(u64) + Send + Sync>;
pub type ExecOutputChunkCallback = Arc<dyn Fn(&[u8]) + Send + Sync>;

enum ExecStdin<'a> {
    Bytes(&'a [u8]),
    File(&'a Path),
}

pub struct ReusableExecSession {
    client: SshHandle,
    jump_client: Option<SshHandle>,
}

pub struct ReusableSftpSession {
    client: SshHandle,
    jump_client: Option<SshHandle>,
    sftp: SftpSession,
}

pub struct ReusableForwardSession {
    client: SshHandle,
    jump_client: Option<SshHandle>,
    remote_forward: RemoteForwardState,
}

pub(crate) struct TerminalOutputDecoder {
    decoder: Decoder,
    terminal_encoding: String,
}

impl TerminalSession {
    pub async fn open(
        app: AppHandle,
        request: TerminalConnectRequest,
        progress: Option<OpenProgress>,
    ) -> Result<(Self, ChannelReadHalf), AppError> {
        let config = resolved_config_from_request(&request);
        let host = config.host.clone();
        let port = config.port;
        let username = config.username.clone();
        let terminal_encoding = normalize_terminal_encoding(&config.advanced.terminal_encoding)?;
        let auth_method = auth_method(&config)?;
        terminal_encoding_for_label(&terminal_encoding)?;

        let ssh_config = Arc::new(client::Config {
            keepalive_interval: Some(duration_from_ms(config.advanced.keepalive_interval_ms)),
            keepalive_max: 3,
            nodelay: true,
            ..<_>::default()
        });
        let context = SshConnectionContext::from_app(&app)?;
        let host_key_handler = KnownHostClient {
            host: host.clone(),
            port,
            app_data_dir: context.app_data_dir.clone(),
            secret_store: Arc::clone(&context.secret_store),
            remote_forward: RemoteForwardState::default(),
        };

        emit_progress(&progress, "tcp_connecting", "正在建立 SSH TCP 连接...");
        let (mut client, jump_client) = run_with_timeout(
            "terminal_connect_timeout",
            "SSH 连接超时。",
            duration_from_ms(config.advanced.connect_timeout_ms),
            connect_target_client(&context, ssh_config, &config, host_key_handler),
        )
        .await?
        .map_err(|error| {
            app_error_from_russh(error, "terminal_connect_failed", "SSH 连接失败。")
        })?;
        emit_progress(&progress, "tcp_connected", "SSH TCP 已连接。");

        emit_progress(&progress, "authenticating", "SSH 认证中...");
        let auth_result = run_with_timeout(
            "terminal_auth_timeout",
            "SSH 认证超时。",
            duration_from_ms(config.advanced.auth_timeout_ms),
            authenticate(&mut client, &username, auth_method),
        )
        .await;
        auth_result??;
        emit_progress(&progress, "authenticated", "SSH 认证通过。");

        emit_progress(&progress, "channel_opening", "正在打开 SSH 终端通道...");
        let channel = run_with_timeout(
            "terminal_channel_open_timeout",
            "SSH 终端通道打开超时。",
            Duration::from_secs(20),
            client.channel_open_session(),
        )
        .await;
        let channel = channel?.map_err(|error| {
            AppError::new(
                "terminal_channel_open_failed",
                "SSH 终端通道打开失败。",
                error,
                true,
            )
        })?;

        emit_progress(&progress, "pty_requesting", "正在初始化远程 PTY...");
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
        pty_result?.map_err(|error| {
            AppError::new("terminal_pty_failed", "远程终端初始化失败。", error, true)
        })?;
        emit_progress(&progress, "pty_ready", "远程 PTY 已就绪。");

        emit_progress(&progress, "shell_starting", "正在启动远程 Shell...");
        let shell_result = run_with_timeout(
            "terminal_shell_timeout",
            "远程 Shell 启动超时。",
            Duration::from_secs(20),
            channel.request_shell(true),
        )
        .await;
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

        Ok((
            Self {
                id: Uuid::new_v4().to_string(),
                host,
                port,
                username,
                terminal_encoding,
                client,
                jump_client,
                writer: Mutex::new(writer),
            },
            reader,
        ))
    }

    pub(crate) fn terminal_encoding(&self) -> &str {
        &self.terminal_encoding
    }

    pub async fn write(&self, data: String) -> Result<(), AppError> {
        let bytes = encode_terminal_input(&self.terminal_encoding, &data)?;
        let writer = self.writer.lock().await;
        writer.data_bytes(bytes).await.map_err(|error| {
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
            })?;
        if let Some(jump_client) = self.jump_client.as_ref() {
            let _ = jump_client
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
        Ok(())
    }
}

impl TerminalOutputDecoder {
    pub(crate) fn new(terminal_encoding: &str) -> Result<Self, AppError> {
        let terminal_encoding = normalize_terminal_encoding(terminal_encoding)?;
        let encoding = terminal_encoding_for_label(&terminal_encoding)?;

        Ok(Self {
            decoder: encoding.new_decoder_without_bom_handling(),
            terminal_encoding,
        })
    }

    pub(crate) fn decode(&mut self, data: &[u8], last: bool) -> Result<Vec<u8>, AppError> {
        decode_terminal_output_with_decoder(&mut self.decoder, &self.terminal_encoding, data, last)
    }
}

impl ReusableExecSession {
    pub async fn connect_resolved(
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<Self, AppError> {
        let context = SshConnectionContext::from_app(app)?;
        Self::connect_resolved_with_context(&context, config).await
    }

    pub async fn connect_resolved_with_context(
        context: &SshConnectionContext,
        config: &ResolvedSshConfig,
    ) -> Result<Self, AppError> {
        let username = config.username.clone();
        let auth_method = auth_method(config)?;
        let ssh_config = Arc::new(client::Config {
            keepalive_interval: Some(duration_from_ms(config.advanced.keepalive_interval_ms)),
            keepalive_max: 1,
            nodelay: true,
            ..<_>::default()
        });
        let host_key_handler = KnownHostClient {
            host: config.host.clone(),
            port: config.port,
            app_data_dir: context.app_data_dir.clone(),
            secret_store: Arc::clone(&context.secret_store),
            remote_forward: RemoteForwardState::default(),
        };

        let (mut client, jump_client) = run_with_timeout(
            "remote_exec_connect_timeout",
            "SSH 命令连接超时。",
            duration_from_ms(config.advanced.connect_timeout_ms),
            connect_target_client(context, ssh_config, config, host_key_handler),
        )
        .await?
        .map_err(|error| {
            app_error_from_russh(error, "remote_exec_connect_failed", "SSH 命令连接失败。")
        })?;

        run_with_timeout(
            "remote_exec_auth_timeout",
            "SSH 命令认证超时。",
            duration_from_ms(config.advanced.auth_timeout_ms),
            authenticate(&mut client, &username, auth_method),
        )
        .await??;

        Ok(Self {
            client,
            jump_client,
        })
    }

    pub async fn exec(&self, command: &str) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, None, None, None, None).await
    }

    pub async fn exec_with_stdin(
        &self,
        command: &str,
        stdin: &[u8],
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, Some(ExecStdin::Bytes(stdin)), None, None, None)
            .await
    }

    pub async fn exec_with_stdin_progress(
        &self,
        command: &str,
        stdin: &[u8],
        progress: ExecProgressCallback,
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(
            command,
            Some(ExecStdin::Bytes(stdin)),
            Some(progress),
            None,
            None,
        )
        .await
    }

    pub async fn exec_with_stdin_file_progress(
        &self,
        command: &str,
        path: &Path,
        progress: ExecProgressCallback,
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(
            command,
            Some(ExecStdin::File(path)),
            Some(progress),
            None,
            None,
        )
        .await
    }

    pub async fn exec_with_stdout_progress(
        &self,
        command: &str,
        progress: ExecProgressCallback,
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, None, None, Some(progress), None)
            .await
    }

    pub async fn exec_with_stdout_chunks(
        &self,
        command: &str,
        chunks: ExecOutputChunkCallback,
    ) -> Result<ExecOutput, AppError> {
        self.exec_inner(command, None, None, None, Some(chunks))
            .await
    }

    async fn exec_inner(
        &self,
        command: &str,
        stdin: Option<ExecStdin<'_>>,
        stdin_progress: Option<ExecProgressCallback>,
        stdout_progress: Option<ExecProgressCallback>,
        stdout_chunks: Option<ExecOutputChunkCallback>,
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
            match stdin {
                ExecStdin::Bytes(bytes) => {
                    let mut sent = 0usize;
                    while sent < bytes.len() {
                        let next = (sent + REMOTE_EXEC_TRANSFER_CHUNK_BYTES).min(bytes.len());
                        send_stdin_chunk(&mut channel, &bytes[sent..next]).await?;
                        sent = next;
                        if let Some(progress) = stdin_progress.as_ref() {
                            progress(sent as u64);
                        }
                    }
                }
                ExecStdin::File(path) => {
                    let mut file = std::fs::File::open(path).map_err(|error| {
                        AppError::new(
                            "remote_exec_stdin_file_open_failed",
                            "本地上传临时文件打开失败。",
                            error,
                            true,
                        )
                    })?;
                    let mut buffer = vec![0u8; REMOTE_EXEC_TRANSFER_CHUNK_BYTES];
                    let mut sent = 0u64;
                    loop {
                        let read = file.read(&mut buffer).map_err(|error| {
                            AppError::new(
                                "remote_exec_stdin_file_read_failed",
                                "本地上传临时文件读取失败。",
                                error,
                                true,
                            )
                        })?;
                        if read == 0 {
                            break;
                        }
                        send_stdin_chunk(&mut channel, &buffer[..read]).await?;
                        sent += read as u64;
                        if let Some(progress) = stdin_progress.as_ref() {
                            progress(sent);
                        }
                    }
                }
            }
            channel.eof().await.map_err(|error| {
                AppError::new(
                    "remote_exec_stdin_eof_failed",
                    "远程命令输入结束失败。",
                    error,
                    true,
                )
            })?;
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    if let Some(chunks) = stdout_chunks.as_ref() {
                        chunks(&data);
                    }
                    stdout.extend_from_slice(&data);
                    if let Some(progress) = stdout_progress.as_ref() {
                        progress(stdout.len() as u64);
                    }
                }
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
        if let Some(jump_client) = self.jump_client.as_ref() {
            let _ = jump_client
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
    }
}

impl ReusableForwardSession {
    pub async fn connect_resolved(
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<Self, AppError> {
        let context = SshConnectionContext::from_app(app)?;
        let username = config.username.clone();
        let auth_method = auth_method(config).map_err(map_tunnel_auth_error)?;
        let ssh_config = Arc::new(client::Config {
            keepalive_interval: Some(duration_from_ms(config.advanced.keepalive_interval_ms)),
            keepalive_max: 1,
            nodelay: true,
            ..<_>::default()
        });
        let remote_forward = RemoteForwardState::default();
        let host_key_handler = KnownHostClient {
            host: config.host.clone(),
            port: config.port,
            app_data_dir: context.app_data_dir.clone(),
            secret_store: Arc::clone(&context.secret_store),
            remote_forward: remote_forward.clone(),
        };

        let (mut client, jump_client) = run_with_timeout(
            "tunnel_ssh_connect_timeout",
            "SSH 隧道连接超时。",
            duration_from_ms(config.advanced.connect_timeout_ms),
            connect_target_client(&context, ssh_config, config, host_key_handler),
        )
        .await?
        .map_err(|error| {
            app_error_from_russh(error, "tunnel_ssh_connect_failed", "SSH 隧道连接失败。")
        })?;

        run_with_timeout(
            "tunnel_ssh_auth_timeout",
            "SSH 隧道认证超时。",
            duration_from_ms(config.advanced.auth_timeout_ms),
            authenticate(&mut client, &username, auth_method),
        )
        .await?
        .map_err(map_tunnel_auth_error)?;

        Ok(Self {
            client,
            jump_client,
            remote_forward,
        })
    }

    pub async fn forward_tcp_stream(
        &self,
        mut local_stream: TcpStream,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<(), AppError> {
        let peer_addr = local_stream.peer_addr().ok();
        let source_host = peer_addr
            .map(|address| address.ip().to_string())
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let source_port = peer_addr.map(|address| address.port()).unwrap_or(0);
        let mut remote_stream = self
            .open_direct_tcpip_stream(remote_host, remote_port, source_host, source_port)
            .await?;
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

    pub async fn open_direct_tcpip_stream(
        &self,
        remote_host: &str,
        remote_port: u16,
        source_host: String,
        source_port: u16,
    ) -> Result<ChannelStream<client::Msg>, AppError> {
        let channel = run_with_timeout(
            "tunnel_direct_tcpip_timeout",
            "SSH 隧道通道打开超时。",
            Duration::from_secs(20),
            self.client.channel_open_direct_tcpip(
                remote_host.to_string(),
                u32::from(remote_port),
                source_host,
                u32::from(source_port),
            ),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "tunnel_direct_tcpip_failed",
                "SSH 隧道目标连接失败。",
                error,
                true,
            )
        })?;
        Ok(channel.into_stream())
    }

    pub async fn set_remote_forward_target(
        &self,
        local_host: String,
        local_port: u16,
        event_handler: Option<RemoteForwardEventHandler>,
    ) {
        self.remote_forward
            .set_target(local_host, local_port, event_handler)
            .await;
    }

    pub async fn clear_remote_forward_target(&self) {
        self.remote_forward.clear_target().await;
    }

    pub async fn request_remote_forward(
        &self,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<u16, AppError> {
        let requested_port = u32::from(remote_port);
        let bound_port = run_with_timeout(
            "tunnel_remote_forward_timeout",
            "远程端口转发请求超时。",
            Duration::from_secs(20),
            self.client
                .tcpip_forward(remote_host.to_string(), requested_port),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "tunnel_remote_forward_denied",
                "SSH 服务器拒绝远程端口转发。",
                error,
                true,
            )
        })?;
        let effective_port = if requested_port == 0 {
            bound_port
        } else {
            requested_port
        };
        u16::try_from(effective_port).map_err(|error| {
            AppError::new(
                "tunnel_remote_port_invalid",
                "远端监听端口无效。",
                error,
                true,
            )
        })
    }

    pub async fn cancel_remote_forward(
        &self,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<(), AppError> {
        run_with_timeout(
            "tunnel_remote_forward_cancel_timeout",
            "取消远程端口转发超时。",
            Duration::from_secs(20),
            self.client
                .cancel_tcpip_forward(remote_host.to_string(), u32::from(remote_port)),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "tunnel_remote_forward_cancel_failed",
                "取消远程端口转发失败。",
                error,
                true,
            )
        })
    }

    pub async fn close(&self) {
        let _ = self
            .client
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
        if let Some(jump_client) = self.jump_client.as_ref() {
            let _ = jump_client
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
    }
}

impl ReusableSftpSession {
    pub async fn connect_resolved(
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<Self, AppError> {
        let context = SshConnectionContext::from_app(app)?;
        Self::connect_resolved_with_context(&context, config).await
    }

    pub async fn connect_resolved_with_context(
        context: &SshConnectionContext,
        config: &ResolvedSshConfig,
    ) -> Result<Self, AppError> {
        let username = config.username.clone();
        let auth_method = auth_method(config)?;
        let ssh_config = Arc::new(client::Config {
            keepalive_interval: Some(duration_from_ms(config.advanced.keepalive_interval_ms)),
            keepalive_max: 1,
            nodelay: true,
            ..<_>::default()
        });
        let host_key_handler = KnownHostClient {
            host: config.host.clone(),
            port: config.port,
            app_data_dir: context.app_data_dir.clone(),
            secret_store: Arc::clone(&context.secret_store),
            remote_forward: RemoteForwardState::default(),
        };

        let (mut client, jump_client) = run_with_timeout(
            "remote_sftp_connect_timeout",
            "SFTP 连接超时。",
            duration_from_ms(config.advanced.connect_timeout_ms),
            connect_target_client(context, ssh_config, config, host_key_handler),
        )
        .await?
        .map_err(|error| {
            app_error_from_russh(error, "remote_sftp_connect_failed", "SFTP 连接失败。")
        })?;

        run_with_timeout(
            "remote_sftp_auth_timeout",
            "SFTP 认证超时。",
            duration_from_ms(config.advanced.auth_timeout_ms),
            authenticate(&mut client, &username, auth_method),
        )
        .await??;

        let channel = run_with_timeout(
            "remote_sftp_channel_timeout",
            "SFTP 通道打开超时。",
            Duration::from_secs(20),
            client.channel_open_session(),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "remote_sftp_channel_failed",
                "SFTP 通道打开失败。",
                error,
                true,
            )
        })?;

        run_with_timeout(
            "remote_sftp_subsystem_timeout",
            "SFTP 子系统启动超时。",
            Duration::from_secs(20),
            channel.request_subsystem(true, "sftp"),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "remote_sftp_subsystem_failed",
                "SFTP 子系统启动失败。",
                error,
                true,
            )
        })?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_sftp_init_failed",
                    "SFTP 会话初始化失败。",
                    error,
                    true,
                )
            })?;

        Ok(Self {
            client,
            jump_client,
            sftp,
        })
    }

    pub fn sftp(&self) -> &SftpSession {
        &self.sftp
    }

    pub async fn close(&self) {
        let _ = self.sftp.close().await;
        let _ = self
            .client
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
        if let Some(jump_client) = self.jump_client.as_ref() {
            let _ = jump_client
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
    }
}

async fn send_stdin_chunk(
    channel: &mut russh::Channel<client::Msg>,
    chunk: &[u8],
) -> Result<(), AppError> {
    channel.data_bytes(chunk.to_vec()).await.map_err(|error| {
        AppError::new(
            "remote_exec_stdin_failed",
            "远程命令输入发送失败。",
            error,
            true,
        )
    })
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

fn auth_method(config: &ResolvedSshConfig) -> Result<AuthMethod, AppError> {
    if let Some(password) = config.password.as_ref() {
        if !password.trim().is_empty() {
            return Ok(AuthMethod::Password(password.clone()));
        }
    }

    if let Some(path) = config.private_key_path.as_ref() {
        if !path.trim().is_empty() {
            return Ok(AuthMethod::PrivateKey {
                path: path.trim().to_string(),
                passphrase: config
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

fn resolved_config_from_request(request: &TerminalConnectRequest) -> ResolvedSshConfig {
    request
        .runtime_config
        .clone()
        .unwrap_or_else(|| ResolvedSshConfig {
            connection_id: request.connection_id.clone().unwrap_or_default(),
            host: request.host.trim().to_string(),
            port: request.port,
            username: request.username.trim().to_string(),
            auth_kind: if request
                .private_key_path
                .as_ref()
                .is_some_and(|path| !path.trim().is_empty())
            {
                crate::connections::ConnectionAuthKind::PrivateKey
            } else {
                crate::connections::ConnectionAuthKind::Password
            },
            password: request.password.clone(),
            private_key_path: request.private_key_path.clone(),
            private_key_passphrase: request.private_key_passphrase.clone(),
            proxy: ConnectionProxyConfig::default(),
            jump: crate::connections::ConnectionJumpConfig::default(),
            advanced: ConnectionAdvancedConfig::default(),
        })
}

async fn connect_ssh_client(
    config: Arc<client::Config>,
    request: &ResolvedSshConfig,
    handler: KnownHostClient,
) -> Result<SshHandle, russh::Error> {
    match request.proxy.kind {
        ConnectionProxyKind::None => {
            client::connect(config, (request.host.as_str(), request.port), handler).await
        }
        _ => {
            let stream = open_proxy_stream(request).await.map_err(to_russh_error)?;
            client::connect_stream(config, stream, handler).await
        }
    }
}

async fn connect_target_client(
    context: &SshConnectionContext,
    config: Arc<client::Config>,
    request: &ResolvedSshConfig,
    handler: KnownHostClient,
) -> Result<(SshHandle, Option<SshHandle>), russh::Error> {
    match request.jump.kind {
        ConnectionJumpKind::None => connect_ssh_client(config, request, handler)
            .await
            .map(|client| (client, None)),
        ConnectionJumpKind::SshJump => {
            let jump = resolve_jump_config(context, request).map_err(to_russh_error)?;
            let jump_auth_method = auth_method(&jump).map_err(to_russh_error)?;
            let jump_ssh_config = Arc::new(client::Config {
                keepalive_interval: Some(duration_from_ms(jump.advanced.keepalive_interval_ms)),
                keepalive_max: 1,
                nodelay: true,
                ..<_>::default()
            });
            let jump_host_key_handler = KnownHostClient {
                host: jump.host.clone(),
                port: jump.port,
                app_data_dir: context.app_data_dir.clone(),
                secret_store: Arc::clone(&context.secret_store),
                remote_forward: RemoteForwardState::default(),
            };

            let mut jump_client = run_with_timeout(
                "jump_connect_timeout",
                "跳板机连接超时。",
                duration_from_ms(jump.advanced.connect_timeout_ms),
                connect_ssh_client(jump_ssh_config, &jump, jump_host_key_handler),
            )
            .await
            .map_err(to_russh_error)?
            .map_err(|error| {
                to_russh_error(app_error_from_russh(
                    error,
                    "jump_connect_failed",
                    "跳板机连接失败。",
                ))
            })?;

            run_with_timeout(
                "jump_auth_timeout",
                "跳板机认证超时。",
                duration_from_ms(jump.advanced.auth_timeout_ms),
                authenticate(&mut jump_client, &jump.username, jump_auth_method),
            )
            .await
            .map_err(to_russh_error)?
            .map_err(|error| to_russh_error(map_jump_auth_error(error)))?;

            let channel = run_with_timeout(
                "jump_direct_tcpip_timeout",
                "跳板机通道打开超时。",
                duration_from_ms(request.advanced.connect_timeout_ms),
                jump_client.channel_open_direct_tcpip(
                    request.host.clone(),
                    u32::from(request.port),
                    "127.0.0.1",
                    0,
                ),
            )
            .await
            .map_err(to_russh_error)?
            .map_err(|error| {
                to_russh_error(AppError::new(
                    "jump_direct_tcpip_failed",
                    "跳板机通道打开失败。",
                    error,
                    true,
                ))
            })?;

            let client = client::connect_stream(config, channel.into_stream(), handler).await?;
            Ok((client, Some(jump_client)))
        }
    }
}

fn resolve_jump_config(
    context: &SshConnectionContext,
    request: &ResolvedSshConfig,
) -> Result<ResolvedSshConfig, AppError> {
    let jump_connection_id = request
        .jump
        .jump_connection_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "connection_jump_missing",
                "请选择 SSH 跳板机连接。",
                "jump_connection_id is empty",
                true,
            )
        })?;

    if jump_connection_id == request.connection_id {
        return Err(AppError::new(
            "connection_jump_self_reference",
            "跳板机不能引用自身连接。",
            format!("connection_id={jump_connection_id}"),
            true,
        ));
    }

    let repository = StorageRepository::open_root(
        context.app_data_dir.clone(),
        Arc::clone(&context.secret_store),
    )?;
    let jump = repository.resolve_saved_connection(jump_connection_id, None)?;
    validate_jump_runtime(&request.connection_id, &request.jump, Some(&jump.jump))?;
    Ok(jump)
}

fn validate_jump_runtime(
    target_connection_id: &str,
    jump: &ConnectionJumpConfig,
    jump_target_jump: Option<&ConnectionJumpConfig>,
) -> Result<(), AppError> {
    match jump.kind {
        ConnectionJumpKind::None => Ok(()),
        ConnectionJumpKind::SshJump => {
            let jump_connection_id = jump
                .jump_connection_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "connection_jump_missing",
                        "请选择 SSH 跳板机连接。",
                        "jump_connection_id is empty",
                        true,
                    )
                })?;

            if jump_connection_id == target_connection_id {
                return Err(AppError::new(
                    "connection_jump_self_reference",
                    "跳板机不能引用自身连接。",
                    format!("connection_id={jump_connection_id}"),
                    true,
                ));
            }

            if jump_target_jump
                .is_some_and(|target_jump| target_jump.kind == ConnectionJumpKind::SshJump)
            {
                return Err(AppError::new(
                    "connection_jump_nested_unsupported",
                    "跳板机暂不支持多级链路。",
                    format!("jump_connection_id={jump_connection_id}"),
                    true,
                ));
            }

            Ok(())
        }
    }
}

async fn open_proxy_stream(request: &ResolvedSshConfig) -> Result<TcpStream, AppError> {
    match request.proxy.kind {
        ConnectionProxyKind::None => run_with_timeout(
            "terminal_tcp_connect_timeout",
            "SSH TCP 连接超时。",
            duration_from_ms(request.advanced.connect_timeout_ms),
            TcpStream::connect((request.host.as_str(), request.port)),
        )
        .await?
        .map_err(|error| {
            AppError::new(
                "terminal_tcp_connect_failed",
                "SSH TCP 连接失败。",
                error,
                true,
            )
        }),
        ConnectionProxyKind::HttpConnect => open_http_connect_stream(request).await,
        ConnectionProxyKind::Socks5 => open_socks5_stream(request).await,
    }
}

async fn open_http_connect_stream(request: &ResolvedSshConfig) -> Result<TcpStream, AppError> {
    let proxy_host = request.proxy.host.as_deref().unwrap_or_default();
    let proxy_port = request.proxy.port.unwrap_or(0);
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|error| AppError::new("proxy_connect_failed", "代理连接失败。", error, true))?;
    let target = format!("{}:{}", request.host, request.port);
    let auth = match (
        request.proxy.username.as_deref(),
        request.proxy.password.as_deref(),
    ) {
        (Some(username), Some(password)) if !username.is_empty() => {
            let encoded = base64_simple(&format!("{username}:{password}"));
            format!("Proxy-Authorization: Basic {encoded}\r\n")
        }
        _ => String::new(),
    };
    let connect = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{auth}\r\n");
    stream
        .write_all(connect.as_bytes())
        .await
        .map_err(|error| {
            AppError::new(
                "proxy_connect_failed",
                "HTTP CONNECT 发送失败。",
                error,
                true,
            )
        })?;
    let response = read_http_proxy_response(&mut stream).await?;
    if !response.starts_with("HTTP/1.1 2") && !response.starts_with("HTTP/1.0 2") {
        return Err(AppError::new(
            "proxy_connect_rejected",
            "HTTP CONNECT 代理拒绝连接。",
            response.lines().next().unwrap_or("").trim(),
            true,
        ));
    }
    Ok(stream)
}

async fn read_http_proxy_response(stream: &mut TcpStream) -> Result<String, AppError> {
    let mut buffer = Vec::new();
    let mut byte = [0_u8; 1];
    while buffer.len() < 8192 {
        let read = stream.read(&mut byte).await.map_err(|error| {
            AppError::new(
                "proxy_connect_failed",
                "HTTP CONNECT 响应读取失败。",
                error,
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        buffer.push(byte[0]);
        if buffer.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

async fn open_socks5_stream(request: &ResolvedSshConfig) -> Result<TcpStream, AppError> {
    let proxy_host = request.proxy.host.as_deref().unwrap_or_default();
    let proxy_port = request.proxy.port.unwrap_or(0);
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|error| AppError::new("proxy_connect_failed", "代理连接失败。", error, true))?;
    let use_auth = request
        .proxy
        .username
        .as_ref()
        .is_some_and(|value| !value.is_empty());
    let methods = if use_auth {
        vec![0x05, 0x02, 0x00, 0x02]
    } else {
        vec![0x05, 0x01, 0x00]
    };
    stream
        .write_all(&methods)
        .await
        .map_err(|error| AppError::new("proxy_connect_failed", "SOCKS5 握手失败。", error, true))?;
    let mut method_response = [0_u8; 2];
    stream
        .read_exact(&mut method_response)
        .await
        .map_err(|error| {
            AppError::new(
                "proxy_connect_failed",
                "SOCKS5 握手响应读取失败。",
                error,
                true,
            )
        })?;
    match method_response {
        [0x05, 0x00] => {}
        [0x05, 0x02] => authenticate_socks5_proxy(&mut stream, request).await?,
        [0x05, 0xff] => {
            return Err(AppError::new(
                "proxy_auth_rejected",
                "SOCKS5 代理不接受当前认证方式。",
                "no acceptable auth method",
                true,
            ));
        }
        _ => {
            return Err(AppError::new(
                "proxy_connect_rejected",
                "SOCKS5 代理握手失败。",
                format!("{method_response:?}"),
                true,
            ));
        }
    }

    let host_bytes = request.host.as_bytes();
    if host_bytes.len() > 255 {
        return Err(AppError::new(
            "proxy_target_invalid",
            "SOCKS5 目标主机过长。",
            &request.host,
            true,
        ));
    }
    let mut connect = vec![0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8];
    connect.extend_from_slice(host_bytes);
    connect.extend_from_slice(&request.port.to_be_bytes());
    stream.write_all(&connect).await.map_err(|error| {
        AppError::new(
            "proxy_connect_failed",
            "SOCKS5 CONNECT 发送失败。",
            error,
            true,
        )
    })?;
    read_socks5_connect_response(&mut stream).await?;
    Ok(stream)
}

async fn authenticate_socks5_proxy(
    stream: &mut TcpStream,
    request: &ResolvedSshConfig,
) -> Result<(), AppError> {
    let username = request.proxy.username.as_deref().unwrap_or("");
    let password = request.proxy.password.as_deref().unwrap_or("");
    if username.len() > 255 || password.len() > 255 {
        return Err(AppError::new(
            "proxy_auth_invalid",
            "SOCKS5 代理用户名或密码过长。",
            "credential length > 255",
            true,
        ));
    }
    let mut packet = vec![0x01, username.len() as u8];
    packet.extend_from_slice(username.as_bytes());
    packet.push(password.len() as u8);
    packet.extend_from_slice(password.as_bytes());
    stream.write_all(&packet).await.map_err(|error| {
        AppError::new("proxy_auth_failed", "SOCKS5 代理认证失败。", error, true)
    })?;
    let mut response = [0_u8; 2];
    stream.read_exact(&mut response).await.map_err(|error| {
        AppError::new(
            "proxy_auth_failed",
            "SOCKS5 代理认证响应读取失败。",
            error,
            true,
        )
    })?;
    if response == [0x01, 0x00] {
        Ok(())
    } else {
        Err(AppError::new(
            "proxy_auth_rejected",
            "SOCKS5 代理认证未通过。",
            format!("{response:?}"),
            true,
        ))
    }
}

async fn read_socks5_connect_response(stream: &mut TcpStream) -> Result<(), AppError> {
    let mut head = [0_u8; 4];
    stream.read_exact(&mut head).await.map_err(|error| {
        AppError::new(
            "proxy_connect_failed",
            "SOCKS5 CONNECT 响应读取失败。",
            error,
            true,
        )
    })?;
    if head[0] != 0x05 || head[1] != 0x00 {
        return Err(AppError::new(
            "proxy_connect_rejected",
            "SOCKS5 代理拒绝连接目标主机。",
            format!("{head:?}"),
            true,
        ));
    }
    let remaining = match head[3] {
        0x01 => 4 + 2,
        0x03 => {
            let mut len = [0_u8; 1];
            stream.read_exact(&mut len).await.map_err(|error| {
                AppError::new("proxy_connect_failed", "SOCKS5 响应读取失败。", error, true)
            })?;
            usize::from(len[0]) + 2
        }
        0x04 => 16 + 2,
        _ => {
            return Err(AppError::new(
                "proxy_connect_rejected",
                "SOCKS5 代理响应地址类型无效。",
                format!("{head:?}"),
                true,
            ));
        }
    };
    let mut discard = vec![0_u8; remaining];
    stream.read_exact(&mut discard).await.map_err(|error| {
        AppError::new("proxy_connect_failed", "SOCKS5 响应读取失败。", error, true)
    })?;
    Ok(())
}

fn duration_from_ms(ms: u64) -> Duration {
    Duration::from_millis(ms.max(1))
}

fn terminal_encoding_for_label(label: &str) -> Result<&'static Encoding, AppError> {
    let normalized = normalize_terminal_encoding(label)?;
    Encoding::for_label_no_replacement(normalized.as_bytes()).ok_or_else(|| {
        AppError::new(
            "connection_terminal_encoding_invalid",
            "终端显示编码无效。",
            format!("terminal_encoding={normalized}"),
            true,
        )
    })
}

#[cfg(test)]
fn decode_terminal_output(
    terminal_encoding: &str,
    data: &[u8],
    last: bool,
) -> Result<Vec<u8>, AppError> {
    let mut decoder = TerminalOutputDecoder::new(terminal_encoding)?;
    decoder.decode(data, last)
}

fn decode_terminal_output_with_decoder(
    decoder: &mut Decoder,
    terminal_encoding: &str,
    data: &[u8],
    last: bool,
) -> Result<Vec<u8>, AppError> {
    let capacity = decoder
        .max_utf8_buffer_length(data.len())
        .ok_or_else(|| terminal_encoding_buffer_error(terminal_encoding))?;
    let mut output = String::with_capacity(capacity);
    let (result, read, had_errors) = decoder.decode_to_string(data, &mut output, last);

    if result == CoderResult::OutputFull || read != data.len() {
        return Err(terminal_encoding_buffer_error(terminal_encoding));
    }

    if had_errors {
        return Err(AppError::new(
            "terminal_encoding_decode_failed",
            "终端输出解码失败。",
            format!(
                "terminal_encoding={terminal_encoding}; data_len={}",
                data.len()
            ),
            true,
        ));
    }

    Ok(output.into_bytes())
}

fn encode_terminal_input(terminal_encoding: &str, data: &str) -> Result<Vec<u8>, AppError> {
    let encoding = terminal_encoding_for_label(terminal_encoding)?;
    let (encoded, _, had_errors) = encoding.encode(data);
    if had_errors {
        return Err(AppError::new(
            "terminal_encoding_encode_failed",
            "终端输入编码失败。",
            format!(
                "terminal_encoding={}; input_len={}",
                normalize_terminal_encoding(terminal_encoding)?,
                data.len()
            ),
            true,
        ));
    }

    Ok(encoded.into_owned())
}

fn terminal_encoding_buffer_error(terminal_encoding: &str) -> AppError {
    AppError::new(
        "terminal_encoding_buffer_failed",
        "终端编码缓冲区计算失败。",
        format!("terminal_encoding={terminal_encoding}"),
        true,
    )
}

fn to_russh_error(error: AppError) -> russh::Error {
    russh::Error::IO(std::io::Error::new(
        std::io::ErrorKind::Other,
        serde_json::to_string(&error).unwrap_or_else(|_| error.message),
    ))
}

fn app_error_from_russh(
    error: russh::Error,
    fallback_code: &str,
    fallback_message: &str,
) -> AppError {
    if let russh::Error::IO(io_error) = &error {
        if let Ok(app_error) = serde_json::from_str::<AppError>(&io_error.to_string()) {
            return app_error;
        }
    }

    AppError::new(fallback_code, fallback_message, error, true)
}

fn map_tunnel_auth_error(error: AppError) -> AppError {
    match error.code.as_str() {
        "terminal_auth_missing" => AppError::new(
            "tunnel_auth_missing",
            "请填写密码或选择私钥。",
            error.raw_message,
            error.recoverable,
        ),
        "terminal_auth_failed" => AppError::new(
            "tunnel_ssh_auth_failed",
            "SSH 隧道认证失败。",
            error.raw_message,
            error.recoverable,
        ),
        "terminal_auth_rejected" => AppError::new(
            "tunnel_ssh_auth_rejected",
            "SSH 隧道认证未通过。",
            error.raw_message,
            error.recoverable,
        ),
        "terminal_private_key_invalid" => AppError::new(
            "tunnel_private_key_invalid",
            "SSH 隧道私钥读取失败。",
            error.raw_message,
            error.recoverable,
        ),
        _ => error,
    }
}

fn map_jump_auth_error(error: AppError) -> AppError {
    match error.code.as_str() {
        "terminal_auth_failed" => AppError::new(
            "jump_auth_failed",
            "跳板机认证失败。",
            error.raw_message,
            error.recoverable,
        ),
        "terminal_auth_rejected" => AppError::new(
            "jump_auth_rejected",
            "跳板机认证未通过。",
            error.raw_message,
            error.recoverable,
        ),
        "terminal_private_key_invalid" => AppError::new(
            "jump_private_key_invalid",
            "跳板机私钥读取失败。",
            error.raw_message,
            error.recoverable,
        ),
        _ => error,
    }
}

fn base64_simple(value: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = value.as_bytes();
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = bytes.get(index + 1).copied().unwrap_or(0);
        let b2 = bytes.get(index + 2).copied().unwrap_or(0);
        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if index + 1 < bytes.len() {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if index + 2 < bytes.len() {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
        index += 3;
    }
    output
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
    use std::time::Duration;

    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionCredentialMode,
        ConnectionJumpConfig, ConnectionJumpKind, ConnectionProfile, ConnectionProtocol,
        ConnectionProxyConfig,
    };

    use super::*;

    fn jump_profile(jump: ConnectionJumpConfig) -> ConnectionProfile {
        ConnectionProfile {
            id: "jump-001".to_string(),
            name: "jump".to_string(),
            protocol: ConnectionProtocol::Ssh,
            group: None,
            host: "jump.example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            credential_mode: ConnectionCredentialMode::Inline,
            credential_id: None,
            inline_auth_kind: Some(ConnectionAuthKind::Password),
            inline_password: Some("secret".to_string()),
            inline_private_key_path: None,
            inline_private_key_passphrase: None,
            prompt_auth_kind: None,
            proxy: ConnectionProxyConfig::default(),
            jump,
            advanced: ConnectionAdvancedConfig::default(),
            rdp: None,
            vnc: None,
            telnet: None,
            serial: None,
            notes: None,
            is_favorite: false,
            last_connected_at: None,
            remote_os_id: None,
            remote_os_name: None,
            remote_os_version: None,
            created_at: "2026-06-18T00:00:00+08:00".to_string(),
            updated_at: "2026-06-18T00:00:00+08:00".to_string(),
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        }
    }

    #[test]
    fn jump_runtime_rejects_self_reference() {
        let jump = ConnectionJumpConfig {
            kind: ConnectionJumpKind::SshJump,
            jump_connection_id: Some("target-001".to_string()),
        };

        let error = validate_jump_runtime("target-001", &jump, None).unwrap_err();

        assert_eq!(error.code, "connection_jump_self_reference");
    }

    #[test]
    fn jump_runtime_rejects_nested_jump() {
        let jump = ConnectionJumpConfig {
            kind: ConnectionJumpKind::SshJump,
            jump_connection_id: Some("jump-001".to_string()),
        };

        let error = validate_jump_runtime(
            "target-001",
            &jump,
            Some(
                &jump_profile(ConnectionJumpConfig {
                    kind: ConnectionJumpKind::SshJump,
                    jump_connection_id: Some("jump-002".to_string()),
                })
                .jump,
            ),
        )
        .unwrap_err();

        assert_eq!(error.code, "connection_jump_nested_unsupported");
    }

    #[test]
    fn jump_runtime_rejects_missing_jump_connection() {
        let jump = ConnectionJumpConfig {
            kind: ConnectionJumpKind::SshJump,
            jump_connection_id: None,
        };

        let error = validate_jump_runtime("target-001", &jump, None).unwrap_err();

        assert_eq!(error.code, "connection_jump_missing");
    }

    #[test]
    fn jump_auth_mapping_uses_jump_specific_codes() {
        let failed = map_jump_auth_error(AppError::new(
            "terminal_auth_failed",
            "SSH 认证失败。",
            "network error",
            true,
        ));
        let rejected = map_jump_auth_error(AppError::new(
            "terminal_auth_rejected",
            "SSH 认证未通过。",
            "auth result",
            true,
        ));
        let key_invalid = map_jump_auth_error(AppError::new(
            "terminal_private_key_invalid",
            "私钥读取失败。",
            "bad key",
            true,
        ));

        assert_eq!(failed.code, "jump_auth_failed");
        assert_eq!(failed.raw_message, "network error");
        assert_eq!(rejected.code, "jump_auth_rejected");
        assert_eq!(key_invalid.code, "jump_private_key_invalid");
    }

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
    fn russh_app_error_mapping_preserves_recoverable_code() {
        let original = AppError::new(
            "host_key_unknown",
            "首次连接该主机，需要确认主机密钥。",
            r#"{"fingerprint_sha256":"SHA256:test"}"#,
            true,
        );

        let mapped = app_error_from_russh(
            to_russh_error(original.clone()),
            "terminal_connect_failed",
            "SSH 连接失败。",
        );

        assert_eq!(mapped.code, original.code);
        assert_eq!(mapped.message, original.message);
        assert_eq!(mapped.raw_message, original.raw_message);
        assert!(mapped.recoverable);
    }

    #[test]
    fn terminal_output_decodes_gbk_to_utf8_bytes() {
        let decoded = decode_terminal_output("gbk", &[0xc4, 0xe3, 0xba, 0xc3], false).unwrap();

        assert_eq!(decoded, "你好".as_bytes());
    }

    #[test]
    fn terminal_input_encodes_unicode_to_gbk_bytes() {
        let encoded = encode_terminal_input("gbk", "你好").unwrap();

        assert_eq!(encoded, vec![0xc4, 0xe3, 0xba, 0xc3]);
    }
}
