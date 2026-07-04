use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::{general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::app_error::AppError;
use crate::connections::{
    ConnectionAuthKind, ConnectionCredentialMode, ConnectionJumpKind, ConnectionProfile,
    ConnectionProtocol, ConnectionProxyKind, RdpCertificatePolicy, RdpDisplayMode, RdpGatewayMode,
    RdpRenderMode, RdpRunnerKind, RdpSecurityCredentialMode, VncPerformancePreset, VncRenderMode,
    VncRunnerKind, VncScaleMode, VncSecurityCredentialMode,
};
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::ssh_config::{ResolvedSshConfig, RuntimeCredentialInput};
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretStore, VaultState};
use crate::terminal::serial::{
    SerialBackspaceMode, SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits,
};
use crate::terminal::session::{ReusableSftpSession, SshConnectionContext};
use crate::terminal::telnet::{TelnetBackspaceMode, TelnetEnterMode};
use crate::webdav_sync::WebDavSyncService;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const MCP_SETTINGS_KEY: &str = "mcp.default";
pub const DEFAULT_REMOTE_HOST: &str = "0.0.0.0";
pub const DEFAULT_REMOTE_PORT: u16 = 8765;
const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MAX_TIMEOUT_SECONDS: u64 = 300;
const DEFAULT_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static MCP_EXEC_SESSION_POOL: OnceLock<RemoteExecSessionPool> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct McpSettings {
    pub enabled: bool,
    pub expose_connections: bool,
    pub ssh_operations_enabled: bool,
    pub allow_dangerous_commands: bool,
    #[serde(default)]
    pub remote_enabled: bool,
    #[serde(default = "default_remote_host")]
    pub remote_host: String,
    #[serde(default = "default_remote_port")]
    pub remote_port: u16,
    #[serde(default)]
    pub remote_token: Option<String>,
    #[serde(default)]
    pub remote_token_hash: Option<String>,
    #[serde(default)]
    pub remote_token_preview: Option<String>,
    #[serde(default = "default_connection_exposure_mode")]
    pub connection_exposure_mode: McpConnectionExposureMode,
    #[serde(default)]
    pub exposed_connection_ids: Vec<String>,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            expose_connections: false,
            ssh_operations_enabled: false,
            allow_dangerous_commands: false,
            remote_enabled: false,
            remote_host: DEFAULT_REMOTE_HOST.to_string(),
            remote_port: DEFAULT_REMOTE_PORT,
            remote_token: None,
            remote_token_hash: None,
            remote_token_preview: None,
            connection_exposure_mode: McpConnectionExposureMode::All,
            exposed_connection_ids: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct McpSettingsInput {
    pub enabled: bool,
    pub expose_connections: bool,
    pub ssh_operations_enabled: bool,
    pub allow_dangerous_commands: bool,
    #[serde(default)]
    pub remote_enabled: bool,
    #[serde(default = "default_remote_host")]
    pub remote_host: String,
    #[serde(default = "default_remote_port")]
    pub remote_port: u16,
    #[serde(default)]
    pub remote_token: Option<String>,
    #[serde(default = "default_connection_exposure_mode")]
    pub connection_exposure_mode: McpConnectionExposureMode,
    #[serde(default)]
    pub exposed_connection_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpConnectionExposureMode {
    All,
    Custom,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub expose_connections: bool,
    pub ssh_operations_enabled: bool,
    pub allow_dangerous_commands: bool,
    pub stdio_only: bool,
    pub remote_enabled: bool,
    pub remote_host: String,
    pub remote_port: u16,
    pub tools: Vec<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpRemoteServiceStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub sse_url: String,
    pub pid: Option<u32>,
    pub token_saved: bool,
    pub token_preview: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpSettingsOutput {
    pub enabled: bool,
    pub expose_connections: bool,
    pub ssh_operations_enabled: bool,
    pub allow_dangerous_commands: bool,
    pub remote_enabled: bool,
    pub remote_host: String,
    pub remote_port: u16,
    pub remote_token: Option<String>,
    pub remote_token_saved: bool,
    pub remote_token_preview: Option<String>,
    pub generated_remote_token: Option<String>,
    pub remote_status: McpRemoteServiceStatus,
    pub connection_exposure_mode: McpConnectionExposureMode,
    pub exposed_connection_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpLocalNetworkInfo {
    pub primary_ip: Option<String>,
    pub ip_addresses: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpConnectionDto {
    pub id: String,
    pub name: String,
    pub protocol: ConnectionProtocol,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential_mode: ConnectionCredentialMode,
    pub auth_kind: Option<ConnectionAuthKind>,
    pub credential_id: Option<String>,
    pub has_inline_secret: bool,
    pub has_saved_credential: bool,
    pub private_key_path_saved: bool,
    pub proxy: McpProxyDto,
    pub jump: McpJumpDto,
    pub rdp: Option<McpRdpDto>,
    pub vnc: Option<McpVncDto>,
    pub telnet: Option<McpTelnetDto>,
    pub serial: Option<McpSerialDto>,
    pub notes: Option<String>,
    pub is_favorite: bool,
    pub last_connected_at: Option<String>,
    pub remote_os_id: Option<String>,
    pub remote_os_name: Option<String>,
    pub remote_os_version: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub redacted: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpProxyDto {
    pub kind: ConnectionProxyKind,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username_saved: bool,
    pub password_saved: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpJumpDto {
    pub kind: ConnectionJumpKind,
    pub jump_connection_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpRdpDto {
    pub domain: Option<String>,
    pub display_mode: RdpDisplayMode,
    pub use_multimon: bool,
    pub dynamic_resize: bool,
    pub render_mode: RdpRenderMode,
    pub preferred_runner: Option<RdpRunnerKind>,
    pub credential_mode: RdpSecurityCredentialMode,
    pub certificate_policy: RdpCertificatePolicy,
    pub gateway_mode: Option<RdpGatewayMode>,
    pub remote_app_enabled: bool,
    pub raw_rdp_settings_saved: bool,
    pub raw_runner_args_saved: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpVncDto {
    pub scale_mode: VncScaleMode,
    pub resize_session: bool,
    pub clip_viewport: bool,
    pub view_only: bool,
    pub clipboard: bool,
    pub shared: bool,
    pub performance_preset: VncPerformancePreset,
    pub quality_level: Option<u8>,
    pub compression_level: Option<u8>,
    pub render_mode: VncRenderMode,
    pub preferred_runner: Option<VncRunnerKind>,
    pub credential_mode: VncSecurityCredentialMode,
    pub raw_runner_args_saved: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpTelnetDto {
    pub enter_mode: TelnetEnterMode,
    pub backspace_mode: TelnetBackspaceMode,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpSerialDto {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: SerialDataBits,
    pub parity: SerialParity,
    pub stop_bits: SerialStopBits,
    pub flow_control: SerialFlowControl,
    pub backspace_mode: SerialBackspaceMode,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpCommandResult {
    pub connection_id: String,
    pub command: String,
    pub exit_status: Option<u32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpTransferResult {
    pub connection_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub directory: bool,
    pub ok: bool,
    pub bytes_transferred: u64,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
pub struct DangerousCommand {
    pub reason: &'static str,
}

pub fn load_settings(repository: &StorageRepository) -> Result<McpSettings, AppError> {
    Ok(repository
        .app_setting_get::<McpSettings>(MCP_SETTINGS_KEY)?
        .unwrap_or_default())
}

pub fn save_settings(
    repository: &StorageRepository,
    input: McpSettingsInput,
    now: &str,
) -> Result<(McpSettings, Option<String>), AppError> {
    let existing = load_settings(repository).unwrap_or_default();
    let remote_host = normalize_remote_host(input.remote_host)?;
    let remote_port = validate_remote_port(input.remote_port)?;
    let (remote_token, remote_token_hash, remote_token_preview, generated_token) =
        next_remote_token_state(&existing, input.remote_enabled, input.remote_token)?;
    let settings = McpSettings {
        enabled: input.enabled,
        expose_connections: input.expose_connections,
        ssh_operations_enabled: input.ssh_operations_enabled,
        allow_dangerous_commands: input.allow_dangerous_commands,
        remote_enabled: input.remote_enabled,
        remote_host,
        remote_port,
        remote_token,
        remote_token_hash,
        remote_token_preview,
        connection_exposure_mode: input.connection_exposure_mode,
        exposed_connection_ids: normalize_connection_ids(input.exposed_connection_ids),
    };
    repository.app_setting_set(MCP_SETTINGS_KEY, &settings, now)?;
    Ok((settings, generated_token))
}

fn default_connection_exposure_mode() -> McpConnectionExposureMode {
    McpConnectionExposureMode::All
}

fn default_remote_host() -> String {
    DEFAULT_REMOTE_HOST.to_string()
}

fn default_remote_port() -> u16 {
    DEFAULT_REMOTE_PORT
}

fn normalize_remote_host(host: String) -> Result<String, AppError> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "mcp_remote_host_missing",
            "请输入远程 MCP 监听地址。",
            "remote_host is empty",
            true,
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_remote_port(port: u16) -> Result<u16, AppError> {
    if port == 0 {
        return Err(AppError::new(
            "mcp_remote_port_invalid",
            "远程 MCP 端口必须在 1 到 65535 之间。",
            "remote_port is 0",
            true,
        ));
    }
    Ok(port)
}

fn next_remote_token_state(
    existing: &McpSettings,
    remote_enabled: bool,
    input_token: Option<String>,
) -> Result<
    (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ),
    AppError,
> {
    if let Some(token) = input_token.map(|value| value.trim().to_string()) {
        if token.is_empty() {
            return Err(AppError::new(
                "mcp_remote_token_missing",
                "请输入远程 MCP token。",
                "remote_token is empty",
                true,
            ));
        }
        return Ok((
            Some(token.clone()),
            Some(hash_remote_token(&token)),
            Some(remote_token_preview(&token)),
            None,
        ));
    }

    if !remote_enabled || existing.remote_token_hash.is_some() {
        return Ok((
            existing.remote_token.clone(),
            existing.remote_token_hash.clone(),
            existing.remote_token_preview.clone(),
            None,
        ));
    }
    let token = generate_remote_token()?;
    Ok((
        Some(token.clone()),
        Some(hash_remote_token(&token)),
        Some(remote_token_preview(&token)),
        Some(token),
    ))
}

pub fn generate_remote_token() -> Result<String, AppError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| {
        AppError::new(
            "mcp_remote_token_generate_failed",
            "远程 MCP token 生成失败。",
            error,
            true,
        )
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn hash_remote_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn remote_token_preview(token: &str) -> String {
    let suffix = token
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("...{suffix}")
}

pub fn verify_remote_token(token: &str, expected_hash: &str) -> bool {
    let actual = hash_remote_token(token.trim());
    constant_time_eq(actual.as_bytes(), expected_hash.trim().as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

pub fn local_network_info() -> McpLocalNetworkInfo {
    let mut addresses = BTreeSet::new();
    for target in [
        SocketAddr::from((Ipv4Addr::new(8, 8, 8, 8), 80)),
        SocketAddr::from((Ipv4Addr::new(1, 1, 1, 1), 80)),
    ] {
        if let Some(ip) = local_ip_for_target(target) {
            addresses.insert(ip.to_string());
        }
    }
    let ip_addresses = addresses.into_iter().collect::<Vec<_>>();
    McpLocalNetworkInfo {
        primary_ip: ip_addresses.first().cloned(),
        ip_addresses,
    }
}

fn local_ip_for_target(target: SocketAddr) -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect(target).ok()?;
    let local = socket.local_addr().ok()?.ip();
    is_remote_usable_ip(&local).then_some(local)
}

fn is_remote_usable_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            !value.is_loopback()
                && !value.is_unspecified()
                && !value.is_broadcast()
                && !value.is_link_local()
        }
        IpAddr::V6(value) => !value.is_loopback() && !value.is_unspecified(),
    }
}

fn normalize_connection_ids(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn status(settings: &McpSettings) -> McpStatus {
    let mut tools = vec!["get_mxterm_mcp_status"];
    if settings.enabled && settings.expose_connections {
        tools.extend(["list_connections", "search_connections", "get_connection"]);
    }
    if settings.enabled && settings.ssh_operations_enabled {
        tools.extend([
            "test_connection",
            "execute_command",
            "server_monitor",
            "upload_file",
            "download_file",
            "upload_directory",
            "download_directory",
            "execute_script",
        ]);
    }
    McpStatus {
        enabled: settings.enabled,
        expose_connections: settings.expose_connections,
        ssh_operations_enabled: settings.ssh_operations_enabled,
        allow_dangerous_commands: settings.allow_dangerous_commands,
        stdio_only: true,
        remote_enabled: settings.remote_enabled,
        remote_host: settings.remote_host.clone(),
        remote_port: settings.remote_port,
        tools,
    }
}

pub fn redacted_connection(profile: ConnectionProfile) -> McpConnectionDto {
    let auth_kind = match profile.credential_mode {
        ConnectionCredentialMode::Saved => None,
        ConnectionCredentialMode::Inline => profile.inline_auth_kind.clone(),
        ConnectionCredentialMode::Prompt => profile.prompt_auth_kind.clone(),
    };
    let rdp = profile.rdp.as_ref().map(|rdp| McpRdpDto {
        domain: rdp.domain.clone(),
        display_mode: rdp.display.mode.clone(),
        use_multimon: rdp.display.use_multimon,
        dynamic_resize: rdp.display.dynamic_resize,
        render_mode: rdp.runner.render_mode.clone(),
        preferred_runner: rdp.runner.preferred_runner.clone(),
        credential_mode: rdp.security.credential_mode.clone(),
        certificate_policy: rdp.security.certificate_policy.clone(),
        gateway_mode: rdp.gateway.as_ref().map(|gateway| gateway.mode.clone()),
        remote_app_enabled: rdp.remote_app.enabled,
        raw_rdp_settings_saved: rdp.raw_rdp_settings.is_some(),
        raw_runner_args_saved: rdp.raw_runner_args.is_some(),
    });
    let vnc = profile.vnc.as_ref().map(|vnc| McpVncDto {
        scale_mode: vnc.display.scale_mode.clone(),
        resize_session: vnc.display.resize_session,
        clip_viewport: vnc.display.clip_viewport,
        view_only: vnc.input.view_only,
        clipboard: vnc.input.clipboard,
        shared: vnc.input.shared,
        performance_preset: vnc.performance.preset.clone(),
        quality_level: vnc.performance.quality_level,
        compression_level: vnc.performance.compression_level,
        render_mode: vnc.runner.render_mode.clone(),
        preferred_runner: vnc.runner.preferred_runner.clone(),
        credential_mode: vnc.security.credential_mode.clone(),
        raw_runner_args_saved: vnc.raw_runner_args.is_some(),
    });
    let telnet = profile.telnet.as_ref().map(|telnet| McpTelnetDto {
        enter_mode: telnet.enter_mode,
        backspace_mode: telnet.backspace_mode,
    });
    let serial = profile.serial.as_ref().map(|serial| McpSerialDto {
        port_name: serial.port_name.clone(),
        baud_rate: serial.baud_rate,
        data_bits: serial.data_bits,
        parity: serial.parity,
        stop_bits: serial.stop_bits,
        flow_control: serial.flow_control,
        backspace_mode: serial.backspace_mode,
    });
    McpConnectionDto {
        id: profile.id,
        name: profile.name,
        protocol: profile.protocol,
        group: profile.group,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        credential_mode: profile.credential_mode.clone(),
        auth_kind,
        credential_id: profile.credential_id.clone(),
        has_inline_secret: profile.credential_mode == ConnectionCredentialMode::Inline
            && profile.inline_auth_kind.is_some(),
        has_saved_credential: profile.credential_mode == ConnectionCredentialMode::Saved
            && profile.credential_id.is_some(),
        private_key_path_saved: profile.inline_private_key_path.is_some(),
        proxy: McpProxyDto {
            kind: profile.proxy.kind,
            host: profile.proxy.host,
            port: profile.proxy.port,
            username_saved: profile.proxy.username.is_some(),
            password_saved: profile.proxy.password.is_some(),
        },
        jump: McpJumpDto {
            kind: profile.jump.kind,
            jump_connection_id: profile.jump.jump_connection_id,
        },
        rdp,
        vnc,
        telnet,
        serial,
        notes: profile.notes,
        is_favorite: profile.is_favorite,
        last_connected_at: profile.last_connected_at,
        remote_os_id: profile.remote_os_id,
        remote_os_name: profile.remote_os_name,
        remote_os_version: profile.remote_os_version,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        redacted: true,
    }
}

pub fn search_matches(connection: &McpConnectionDto, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    [
        connection.id.as_str(),
        connection.name.as_str(),
        match connection.protocol {
            ConnectionProtocol::Ssh => "ssh",
            ConnectionProtocol::Rdp => "rdp",
            ConnectionProtocol::Vnc => "vnc",
            ConnectionProtocol::Telnet => "telnet",
            ConnectionProtocol::Serial => "serial",
        },
        connection.host.as_str(),
        connection.username.as_str(),
        connection.group.as_deref().unwrap_or_default(),
        connection.notes.as_deref().unwrap_or_default(),
        connection.remote_os_id.as_deref().unwrap_or_default(),
        connection.remote_os_name.as_deref().unwrap_or_default(),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&query))
}

pub fn connection_is_exposed(settings: &McpSettings, connection_id: &str) -> bool {
    match settings.connection_exposure_mode {
        McpConnectionExposureMode::All => true,
        McpConnectionExposureMode::Custom => settings
            .exposed_connection_ids
            .iter()
            .any(|id| id == connection_id),
    }
}

pub fn connection_is_supported(connection: &ConnectionProfile) -> bool {
    connection.protocol == ConnectionProtocol::Ssh
}

pub fn exposed_connections(
    settings: &McpSettings,
    connections: Vec<ConnectionProfile>,
) -> Vec<ConnectionProfile> {
    connections
        .into_iter()
        .filter(connection_is_supported)
        .filter(|connection| connection_is_exposed(settings, &connection.id))
        .collect()
}

pub fn default_app_data_dir() -> Result<PathBuf, AppError> {
    if let Ok(value) = env::var("MXTERM_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    #[cfg(windows)]
    {
        let appdata = env::var_os("APPDATA").ok_or_else(|| {
            AppError::new(
                "mcp_data_dir_missing",
                "无法定位 MXterm 数据目录。",
                "APPDATA missing",
                true,
            )
        })?;
        return Ok(PathBuf::from(appdata).join("com.mxterm.app"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").ok_or_else(|| {
            AppError::new(
                "mcp_data_dir_missing",
                "无法定位 MXterm 数据目录。",
                "HOME missing",
                true,
            )
        })?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.mxterm.app"));
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            .ok_or_else(|| {
                AppError::new(
                    "mcp_data_dir_missing",
                    "无法定位 MXterm 数据目录。",
                    "HOME missing",
                    true,
                )
            })?;
        Ok(base.join("com.mxterm.app"))
    }
}

pub fn local_secret_store(root: &Path) -> Result<Arc<dyn SecretStore>, AppError> {
    let state = VaultState::default();
    state.unlock_local(root)?;
    state.secret_store()
}

pub fn repository_for_metadata(root: &Path) -> Result<StorageRepository, AppError> {
    StorageRepository::open_root(
        root,
        Arc::new(crate::storage_vault::InMemorySecretStore::default()),
    )
}

pub fn repository_for_ssh(root: &Path) -> Result<StorageRepository, AppError> {
    StorageRepository::open_root(root, local_secret_store(root)?)
}

pub fn ensure_enabled(settings: &McpSettings) -> Result<(), AppError> {
    if settings.enabled {
        Ok(())
    } else {
        Err(AppError::new(
            "mcp_disabled",
            "MXterm MCP 尚未启用。",
            "mcp.enabled=false",
            true,
        ))
    }
}

pub fn ensure_connections_enabled(settings: &McpSettings) -> Result<(), AppError> {
    ensure_enabled(settings)?;
    if settings.expose_connections {
        Ok(())
    } else {
        Err(AppError::new(
            "mcp_connections_disabled",
            "MCP 连接信息暴露尚未启用。",
            "mcp.expose_connections=false",
            true,
        ))
    }
}

pub fn ensure_ssh_enabled(settings: &McpSettings) -> Result<(), AppError> {
    ensure_enabled(settings)?;
    if settings.ssh_operations_enabled {
        Ok(())
    } else {
        Err(AppError::new(
            "mcp_ssh_disabled",
            "MCP SSH 操作尚未启用。",
            "mcp.ssh_operations_enabled=false",
            true,
        ))
    }
}

pub fn ensure_connection_exposed(
    settings: &McpSettings,
    connection_id: &str,
) -> Result<(), AppError> {
    if connection_is_exposed(settings, connection_id.trim()) {
        Ok(())
    } else {
        Err(AppError::new(
            "mcp_connection_not_exposed",
            "该连接未开放给 MCP。",
            format!("connection_id={}", connection_id.trim()),
            true,
        ))
    }
}

pub fn reject_plaintext_credential_args(args: &Value) -> Result<(), AppError> {
    let Some(object) = args.as_object() else {
        return Ok(());
    };
    for forbidden in [
        "host",
        "user",
        "username",
        "password",
        "passphrase",
        "private_key",
        "private_key_content",
    ] {
        if object.contains_key(forbidden) {
            return Err(AppError::new(
                "mcp_plaintext_credentials_rejected",
                "MCP 工具只允许使用 MXterm 已保存的 connection_id。",
                format!("forbidden argument: {forbidden}"),
                true,
            ));
        }
    }
    Ok(())
}

pub fn detect_dangerous_command(command: &str) -> Option<DangerousCommand> {
    let normalized = command.to_lowercase();
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let checks: [(&str, &str); 13] = [
        ("rm -rf /", "recursive delete from root"),
        ("rm -fr /", "recursive delete from root"),
        ("mkfs", "filesystem format command"),
        ("dd if=/dev/zero", "raw disk overwrite"),
        ("dd if=/dev/random", "raw disk overwrite"),
        ("shutdown", "system shutdown"),
        ("reboot", "system reboot"),
        ("halt", "system halt"),
        (":(){", "fork bomb"),
        ("chmod -r 777 /", "recursive root permission change"),
        ("chown -r", "recursive ownership change"),
        ("> /dev/", "direct device write"),
        ("wipefs", "filesystem signature wipe"),
    ];
    checks
        .iter()
        .find(|(needle, _)| compact.contains(needle))
        .map(|(_, reason)| DangerousCommand { reason })
}

pub fn normalize_timeout(seconds: Option<u64>) -> Duration {
    Duration::from_secs(
        seconds
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
            .clamp(1, MAX_TIMEOUT_SECONDS),
    )
}

pub fn normalize_output_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_OUTPUT_BYTES)
        .clamp(1024, MAX_OUTPUT_BYTES)
}

fn mcp_exec_session_pool() -> &'static RemoteExecSessionPool {
    MCP_EXEC_SESSION_POOL.get_or_init(RemoteExecSessionPool::default)
}

pub async fn execute_command(
    root: &Path,
    connection_id: &str,
    command: &str,
    timeout_seconds: Option<u64>,
    max_output_bytes: Option<usize>,
    confirm_dangerous: bool,
    settings: &McpSettings,
) -> Result<McpCommandResult, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    let command = require_command(command)?;
    if let Some(danger) = detect_dangerous_command(command) {
        if !settings.allow_dangerous_commands || !confirm_dangerous {
            return Err(AppError::new(
                "mcp_dangerous_command_rejected",
                "命令被危险命令策略拦截。",
                danger.reason,
                true,
            ));
        }
    }
    let started = now_millis();
    let (config, context) = resolve_ssh(root, connection_id)?;
    let timeout = normalize_timeout(timeout_seconds);
    let pool = mcp_exec_session_pool();
    let result = tokio::time::timeout(
        timeout,
        pool.exec_with_context(&context, &config, command, RemoteExecRetry::ReconnectOnce),
    )
    .await;
    let output = match result {
        Ok(output) => output?,
        Err(_) => {
            pool.invalidate_connection(&config.connection_id).await;
            return Err(AppError::new(
                "mcp_command_timeout",
                "MCP SSH 命令执行超时。",
                format!("timeout_seconds={}", timeout.as_secs()),
                true,
            ));
        }
    };
    let limit = normalize_output_limit(max_output_bytes);
    let (stdout, stdout_truncated) = bytes_to_limited_string(&output.stdout, limit);
    let (stderr, stderr_truncated) = bytes_to_limited_string(&output.stderr, limit);
    let result = McpCommandResult {
        connection_id: config.connection_id,
        command: command.to_string(),
        exit_status: output.exit_status,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        duration_ms: now_millis().saturating_sub(started),
    };
    audit(
        root,
        "execute_command",
        &result.connection_id,
        true,
        json!({
            "command": command,
            "exit_status": result.exit_status,
            "duration_ms": result.duration_ms,
        }),
    );
    Ok(result)
}

pub async fn test_connection(
    root: &Path,
    connection_id: &str,
    settings: &McpSettings,
) -> Result<Value, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    let (config, context) = resolve_ssh(root, connection_id)?;
    mcp_exec_session_pool()
        .warm_with_context(&context, &config)
        .await?;
    audit(
        root,
        "test_connection",
        &config.connection_id,
        true,
        json!({}),
    );
    Ok(json!({ "ok": true, "connection_id": config.connection_id }))
}

pub async fn server_monitor(
    root: &Path,
    connection_id: &str,
    settings: &McpSettings,
) -> Result<McpCommandResult, AppError> {
    let command = "printf 'HOSTNAME\\0'; hostname 2>/dev/null; printf '\\nUPTIME\\0'; uptime 2>/dev/null; printf '\\nMEMORY\\0'; free -h 2>/dev/null; printf '\\nDISK\\0'; df -h 2>/dev/null | head -20";
    execute_command(
        root,
        connection_id,
        command,
        Some(20),
        Some(128 * 1024),
        false,
        settings,
    )
    .await
}

pub async fn upload_file(
    root: &Path,
    connection_id: &str,
    local_path: &Path,
    remote_path: &str,
    settings: &McpSettings,
) -> Result<McpTransferResult, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    validate_local_read_path(local_path, false)?;
    let remote_path = require_remote_path(remote_path)?;
    let started = now_millis();
    let (config, context) = resolve_ssh(root, connection_id)?;
    let session = ReusableSftpSession::connect_resolved_with_context(&context, &config).await?;
    let bytes_transferred = upload_file_inner(session.sftp(), local_path, remote_path).await?;
    session.close().await;
    let duration_ms = now_millis().saturating_sub(started);
    audit(
        root,
        "upload_file",
        &config.connection_id,
        true,
        json!({ "remote_path": remote_path, "bytes_transferred": bytes_transferred, "duration_ms": duration_ms }),
    );
    Ok(McpTransferResult {
        connection_id: config.connection_id,
        local_path: local_path.to_string_lossy().to_string(),
        remote_path: remote_path.to_string(),
        directory: false,
        ok: true,
        bytes_transferred,
        duration_ms,
    })
}

pub async fn download_file(
    root: &Path,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    settings: &McpSettings,
) -> Result<McpTransferResult, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    validate_local_write_path(local_path)?;
    let remote_path = require_remote_path(remote_path)?;
    let started = now_millis();
    let (config, context) = resolve_ssh(root, connection_id)?;
    let session = ReusableSftpSession::connect_resolved_with_context(&context, &config).await?;
    let bytes_transferred = download_file_inner(session.sftp(), remote_path, local_path).await?;
    session.close().await;
    let duration_ms = now_millis().saturating_sub(started);
    audit(
        root,
        "download_file",
        &config.connection_id,
        true,
        json!({ "remote_path": remote_path, "bytes_transferred": bytes_transferred, "duration_ms": duration_ms }),
    );
    Ok(McpTransferResult {
        connection_id: config.connection_id,
        local_path: local_path.to_string_lossy().to_string(),
        remote_path: remote_path.to_string(),
        directory: false,
        ok: true,
        bytes_transferred,
        duration_ms,
    })
}

pub async fn upload_directory(
    root: &Path,
    connection_id: &str,
    local_path: &Path,
    remote_path: &str,
    settings: &McpSettings,
) -> Result<McpTransferResult, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    validate_local_read_path(local_path, true)?;
    let remote_path = require_remote_path(remote_path)?;
    let started = now_millis();
    let (config, context) = resolve_ssh(root, connection_id)?;
    let session = ReusableSftpSession::connect_resolved_with_context(&context, &config).await?;
    let bytes_transferred = upload_directory_inner(session.sftp(), local_path, remote_path).await?;
    session.close().await;
    let duration_ms = now_millis().saturating_sub(started);
    audit(
        root,
        "upload_directory",
        &config.connection_id,
        true,
        json!({ "remote_path": remote_path, "bytes_transferred": bytes_transferred, "duration_ms": duration_ms }),
    );
    Ok(McpTransferResult {
        connection_id: config.connection_id,
        local_path: local_path.to_string_lossy().to_string(),
        remote_path: remote_path.to_string(),
        directory: true,
        ok: true,
        bytes_transferred,
        duration_ms,
    })
}

pub async fn download_directory(
    root: &Path,
    connection_id: &str,
    remote_path: &str,
    local_path: &Path,
    settings: &McpSettings,
) -> Result<McpTransferResult, AppError> {
    ensure_ssh_enabled(settings)?;
    ensure_connection_exposed(settings, connection_id)?;
    validate_local_directory_target(local_path)?;
    let remote_path = require_remote_path(remote_path)?;
    let started = now_millis();
    let (config, context) = resolve_ssh(root, connection_id)?;
    let session = ReusableSftpSession::connect_resolved_with_context(&context, &config).await?;
    let bytes_transferred =
        download_directory_inner(session.sftp(), remote_path, local_path).await?;
    session.close().await;
    let duration_ms = now_millis().saturating_sub(started);
    audit(
        root,
        "download_directory",
        &config.connection_id,
        true,
        json!({ "remote_path": remote_path, "bytes_transferred": bytes_transferred, "duration_ms": duration_ms }),
    );
    Ok(McpTransferResult {
        connection_id: config.connection_id,
        local_path: local_path.to_string_lossy().to_string(),
        remote_path: remote_path.to_string(),
        directory: true,
        ok: true,
        bytes_transferred,
        duration_ms,
    })
}

pub async fn execute_script(
    root: &Path,
    connection_id: &str,
    script_path: &Path,
    interpreter: Option<&str>,
    args: Option<&str>,
    timeout_seconds: Option<u64>,
    max_output_bytes: Option<usize>,
    settings: &McpSettings,
) -> Result<McpCommandResult, AppError> {
    validate_local_read_path(script_path, false)?;
    let name = script_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("script.sh")
        .replace(['/', '\\', ' ', '\'', '"'], "_");
    let remote_path = format!("/tmp/mxterm-mcp-{}-{name}", now_millis());
    upload_file(root, connection_id, script_path, &remote_path, settings).await?;
    let interpreter = interpreter.unwrap_or("sh").trim();
    let args = args.unwrap_or("").trim();
    let command = format!(
        "chmod +x {} && {} {} {} ; status=$?; rm -f {}; exit $status",
        shell_quote(&remote_path),
        shell_quote(interpreter),
        shell_quote(&remote_path),
        args,
        shell_quote(&remote_path)
    );
    execute_command(
        root,
        connection_id,
        &command,
        timeout_seconds,
        max_output_bytes,
        true,
        settings,
    )
    .await
}

fn resolve_ssh(
    root: &Path,
    connection_id: &str,
) -> Result<(ResolvedSshConfig, SshConnectionContext), AppError> {
    let store = local_secret_store(root)?;
    let repo = StorageRepository::open_root(root, Arc::clone(&store))?;
    let config =
        repo.resolve_saved_connection(connection_id.trim(), None::<RuntimeCredentialInput>)?;
    Ok((
        config,
        SshConnectionContext::from_parts(root.to_path_buf(), store),
    ))
}

fn require_command(command: &str) -> Result<&str, AppError> {
    let command = command.trim();
    if command.is_empty() {
        Err(AppError::new(
            "mcp_command_missing",
            "请输入要执行的命令。",
            "command is empty",
            true,
        ))
    } else {
        Ok(command)
    }
}

fn require_remote_path(path: &str) -> Result<&str, AppError> {
    let path = path.trim();
    if path.is_empty() || path == "/" {
        Err(AppError::new(
            "mcp_remote_path_invalid",
            "远程路径不能为空或根目录。",
            path,
            true,
        ))
    } else {
        Ok(path)
    }
}

fn validate_local_read_path(path: &Path, directory: bool) -> Result<(), AppError> {
    let meta = fs::metadata(path).map_err(|error| {
        AppError::new("mcp_local_path_missing", "本地路径不存在。", error, true)
    })?;
    if directory && !meta.is_dir() {
        return Err(AppError::new(
            "mcp_local_path_invalid",
            "本地路径不是目录。",
            path.display(),
            true,
        ));
    }
    if !directory && !meta.is_file() {
        return Err(AppError::new(
            "mcp_local_path_invalid",
            "本地路径不是文件。",
            path.display(),
            true,
        ));
    }
    Ok(())
}

fn validate_local_write_path(path: &Path) -> Result<(), AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::new(
            "mcp_local_path_invalid",
            "本地路径不能为空。",
            "empty path",
            true,
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                "mcp_local_path_create_failed",
                "本地父目录创建失败。",
                error,
                true,
            )
        })?;
    }
    Ok(())
}

fn validate_local_directory_target(path: &Path) -> Result<(), AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::new(
            "mcp_local_path_invalid",
            "本地目录不能为空。",
            "empty path",
            true,
        ));
    }
    fs::create_dir_all(path).map_err(|error| {
        AppError::new(
            "mcp_local_path_create_failed",
            "本地目录创建失败。",
            error,
            true,
        )
    })
}

fn mcp_remote_part_path(remote_path: &str, timestamp_ms: u128) -> String {
    let trimmed = remote_path.trim_end_matches('/');
    let (parent, file_name) = trimmed
        .rsplit_once('/')
        .map_or(("", trimmed), |(parent, name)| {
            if parent.is_empty() {
                ("/", name)
            } else {
                (parent, name)
            }
        });
    let file_name = if file_name.is_empty() {
        "target"
    } else {
        file_name
    };
    let part_name = format!(".mxterm-mcp-transfer-{timestamp_ms}-{file_name}.part");
    if parent.is_empty() {
        part_name
    } else if parent == "/" {
        format!("/{part_name}")
    } else {
        format!("{parent}/{part_name}")
    }
}

fn mcp_local_part_path(local_path: &Path, timestamp_ms: u128) -> PathBuf {
    let file_name = local_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    let part_name = format!(".mxterm-mcp-transfer-{timestamp_ms}-{file_name}.part");
    local_path
        .parent()
        .map(|parent| parent.join(&part_name))
        .unwrap_or_else(|| PathBuf::from(part_name))
}

async fn upload_file_inner(
    sftp: &russh_sftp::client::SftpSession,
    local_path: &Path,
    remote_path: &str,
) -> Result<u64, AppError> {
    let mut local = tokio::fs::File::open(local_path).await.map_err(|error| {
        AppError::new(
            "mcp_upload_local_open_failed",
            "本地文件打开失败。",
            error,
            true,
        )
    })?;
    let part_path = mcp_remote_part_path(remote_path, now_millis());
    let mut remote = sftp.create(part_path.clone()).await.map_err(|error| {
        AppError::new(
            "mcp_upload_remote_create_failed",
            "远程临时文件创建失败。",
            error,
            true,
        )
    })?;
    let copied = match tokio::io::copy(&mut local, &mut remote).await {
        Ok(copied) => copied,
        Err(error) => {
            let _ = sftp.remove_file(part_path).await;
            return Err(AppError::new(
                "mcp_upload_failed",
                "文件上传失败。",
                error,
                true,
            ));
        }
    };
    if let Err(error) = remote.shutdown().await {
        let _ = sftp.remove_file(part_path).await;
        return Err(AppError::new(
            "mcp_upload_flush_failed",
            "远程临时文件写入完成失败。",
            error,
            true,
        ));
    }

    let _ = sftp.remove_file(remote_path.to_string()).await;
    if let Err(error) = sftp
        .rename(part_path.clone(), remote_path.to_string())
        .await
    {
        let _ = sftp.remove_file(part_path).await;
        return Err(AppError::new(
            "mcp_upload_rename_failed",
            "远程临时文件重命名失败。",
            error,
            true,
        ));
    }
    Ok(copied)
}

async fn download_file_inner(
    sftp: &russh_sftp::client::SftpSession,
    remote_path: &str,
    local_path: &Path,
) -> Result<u64, AppError> {
    let mut remote = sftp.open(remote_path.to_string()).await.map_err(|error| {
        AppError::new(
            "mcp_download_remote_open_failed",
            "远程文件打开失败。",
            error,
            true,
        )
    })?;
    let part_path = mcp_local_part_path(local_path, now_millis());
    let mut local = tokio::fs::File::create(&part_path).await.map_err(|error| {
        AppError::new(
            "mcp_download_local_create_failed",
            "本地临时文件创建失败。",
            error,
            true,
        )
    })?;
    let copied = match tokio::io::copy(&mut remote, &mut local).await {
        Ok(copied) => copied,
        Err(error) => {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(AppError::new(
                "mcp_download_failed",
                "文件下载失败。",
                error,
                true,
            ));
        }
    };
    if let Err(error) = local.shutdown().await {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(AppError::new(
            "mcp_download_flush_failed",
            "本地临时文件写入完成失败。",
            error,
            true,
        ));
    }
    drop(local);

    if local_path.exists() {
        let _ = tokio::fs::remove_file(local_path).await;
    }
    if let Err(error) = tokio::fs::rename(&part_path, local_path).await {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(AppError::new(
            "mcp_download_rename_failed",
            "本地临时文件重命名失败。",
            error,
            true,
        ));
    }
    Ok(copied)
}

async fn upload_directory_inner(
    sftp: &russh_sftp::client::SftpSession,
    local_path: &Path,
    remote_path: &str,
) -> Result<u64, AppError> {
    let mut stack = vec![(local_path.to_path_buf(), remote_path.to_string())];
    let mut bytes_transferred = 0_u64;
    while let Some((local_dir, remote_dir)) = stack.pop() {
        let _ = sftp.create_dir(remote_dir.clone()).await;
        for entry in fs::read_dir(&local_dir).map_err(|error| {
            AppError::new(
                "mcp_upload_directory_read_failed",
                "本地目录读取失败。",
                error,
                true,
            )
        })? {
            let entry = entry.map_err(|error| {
                AppError::new(
                    "mcp_upload_directory_read_failed",
                    "本地目录读取失败。",
                    error,
                    true,
                )
            })?;
            let local_child = entry.path();
            let remote_child = format!(
                "{}/{}",
                remote_dir.trim_end_matches('/'),
                entry.file_name().to_string_lossy()
            );
            if entry
                .file_type()
                .map_err(|error| {
                    AppError::new(
                        "mcp_upload_directory_read_failed",
                        "本地目录读取失败。",
                        error,
                        true,
                    )
                })?
                .is_dir()
            {
                stack.push((local_child, remote_child));
            } else {
                bytes_transferred += upload_file_inner(sftp, &local_child, &remote_child).await?;
            }
        }
    }
    Ok(bytes_transferred)
}

async fn download_directory_inner(
    sftp: &russh_sftp::client::SftpSession,
    remote_path: &str,
    local_path: &Path,
) -> Result<u64, AppError> {
    let mut stack = vec![(remote_path.to_string(), local_path.to_path_buf())];
    let mut bytes_transferred = 0_u64;
    while let Some((remote_dir, local_dir)) = stack.pop() {
        tokio::fs::create_dir_all(&local_dir)
            .await
            .map_err(|error| {
                AppError::new(
                    "mcp_download_directory_create_failed",
                    "本地目录创建失败。",
                    error,
                    true,
                )
            })?;
        let entries = sftp.read_dir(remote_dir.clone()).await.map_err(|error| {
            AppError::new(
                "mcp_download_directory_read_failed",
                "远程目录读取失败。",
                error,
                true,
            )
        })?;
        for entry in entries {
            let name = entry.file_name();
            let remote_child = format!("{}/{}", remote_dir.trim_end_matches('/'), name);
            let local_child = local_dir.join(name);
            if entry.file_type().is_dir() {
                stack.push((remote_child, local_child));
            } else {
                bytes_transferred += download_file_inner(sftp, &remote_child, &local_child).await?;
            }
        }
    }
    Ok(bytes_transferred)
}

fn bytes_to_limited_string(bytes: &[u8], limit: usize) -> (String, bool) {
    let truncated = bytes.len() > limit;
    let slice = if truncated { &bytes[..limit] } else { bytes };
    (String::from_utf8_lossy(slice).to_string(), truncated)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn now_timestamp() -> Result<String, AppError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::new("mcp_clock_invalid", "系统时间异常。", error, false))?
        .as_secs()
        .to_string())
}

pub fn sidecar_executable_path() -> Result<PathBuf, AppError> {
    let current_exe = env::current_exe().map_err(|error| {
        AppError::new(
            "mcp_executable_path_failed",
            "无法定位 MXterm MCP 可执行文件路径。",
            error,
            true,
        )
    })?;
    let parent = current_exe.parent().ok_or_else(|| {
        AppError::new(
            "mcp_executable_path_failed",
            "无法定位 MXterm MCP 可执行文件路径。",
            current_exe.display(),
            true,
        )
    })?;
    Ok(parent.join(sidecar_executable_name()))
}

fn sidecar_executable_name() -> &'static str {
    if cfg!(windows) {
        "mxterm-mcp.exe"
    } else {
        "mxterm-mcp"
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn audit(root: &Path, operation: &str, connection_id: &str, success: bool, detail: Value) {
    let dir = root.join("logs");
    let _ = fs::create_dir_all(&dir);
    let line = json!({
        "timestamp_ms": now_millis(),
        "operation": operation,
        "connection_id": connection_id,
        "success": success,
        "detail": detail,
    })
    .to_string();
    let path = dir.join("mcp_audit.log");
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| {
            use std::io::Write as _;
            writeln!(file, "{line}")
        });
}

pub fn connection_summary(
    repository: &StorageRepository,
    settings: &McpSettings,
) -> Result<Value, AppError> {
    let now = now_timestamp()?;
    let webdav = WebDavSyncService::load_settings(repository, &now).ok();
    let exposed_connection_count =
        exposed_connections(settings, repository.connection_list()?).len();
    Ok(json!({
        "connections": exposed_connection_count,
        "webdav": webdav.map(|settings| json!({
            "enabled": settings.enabled,
            "base_url_saved": !settings.base_url.trim().is_empty(),
            "username_saved": settings.username.is_some(),
            "password_saved": settings.password_saved,
        })),
    }))
}

#[derive(Default)]
pub struct McpRemoteServiceManager {
    state: Mutex<McpRemoteServiceRuntime>,
}

#[derive(Default)]
struct McpRemoteServiceRuntime {
    child: Option<Child>,
    signature: Option<String>,
    last_error: Option<String>,
}

impl McpRemoteServiceManager {
    pub fn reconcile(&self, app: &AppHandle, settings: &McpSettings) -> McpRemoteServiceStatus {
        let mut runtime = self.lock_runtime();
        refresh_remote_child(settings, &mut runtime);
        if !settings.remote_enabled {
            stop_remote_child(&mut runtime);
            runtime.last_error = None;
            return remote_service_status(settings, &runtime);
        }

        let Some(token_hash) = settings.remote_token_hash.as_deref() else {
            stop_remote_child(&mut runtime);
            runtime.last_error = Some("远程 MCP token 尚未生成。".to_string());
            return remote_service_status(settings, &runtime);
        };
        let signature = remote_service_signature(app, settings, token_hash);
        if runtime.child.is_some() && runtime.signature.as_deref() == Some(signature.as_str()) {
            return remote_service_status(settings, &runtime);
        }

        stop_remote_child(&mut runtime);
        match spawn_remote_child(app, settings, token_hash) {
            Ok(child) => {
                runtime.child = Some(child);
                runtime.signature = Some(signature);
                runtime.last_error = None;
            }
            Err(error) => {
                runtime.last_error = Some(error.message);
            }
        }
        remote_service_status(settings, &runtime)
    }

    pub fn status(&self, settings: &McpSettings) -> McpRemoteServiceStatus {
        let mut runtime = self.lock_runtime();
        refresh_remote_child(settings, &mut runtime);
        remote_service_status(settings, &runtime)
    }

    pub fn stop(&self, settings: &McpSettings) -> McpRemoteServiceStatus {
        let mut runtime = self.lock_runtime();
        stop_remote_child(&mut runtime);
        runtime.last_error = None;
        remote_service_status(settings, &runtime)
    }

    pub fn restart(&self, app: &AppHandle, settings: &McpSettings) -> McpRemoteServiceStatus {
        {
            let mut runtime = self.lock_runtime();
            stop_remote_child(&mut runtime);
            runtime.last_error = None;
        }
        self.reconcile(app, settings)
    }

    fn lock_runtime(&self) -> std::sync::MutexGuard<'_, McpRemoteServiceRuntime> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for McpRemoteServiceManager {
    fn drop(&mut self) {
        if let Ok(runtime) = self.state.get_mut() {
            stop_remote_child(runtime);
        }
    }
}

fn remote_service_signature(app: &AppHandle, settings: &McpSettings, token_hash: &str) -> String {
    let data_dir = app_data_dir(app)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    format!(
        "{}:{}:{}:{}",
        settings.remote_host, settings.remote_port, token_hash, data_dir
    )
}

fn spawn_remote_child(
    app: &AppHandle,
    settings: &McpSettings,
    token_hash: &str,
) -> Result<Child, AppError> {
    let executable = sidecar_executable_path()?;
    let data_dir = app_data_dir(app)?;
    let mut command = Command::new(&executable);
    command
        .arg("serve")
        .arg("--host")
        .arg(&settings.remote_host)
        .arg("--port")
        .arg(settings.remote_port.to_string())
        .arg("--token-sha256")
        .arg(token_hash)
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map_err(|error| {
        AppError::new(
            "mcp_remote_service_start_failed",
            "远程 MCP 服务启动失败。",
            format!("{}: {error}", executable.display()),
            true,
        )
    })
}

fn refresh_remote_child(settings: &McpSettings, runtime: &mut McpRemoteServiceRuntime) {
    let Some(child) = runtime.child.as_mut() else {
        return;
    };
    match child.try_wait() {
        Ok(Some(status)) => {
            runtime.child = None;
            runtime.signature = None;
            if settings.remote_enabled {
                runtime.last_error = Some(format!("远程 MCP 服务已退出：{status}"));
            }
        }
        Ok(None) => {}
        Err(error) => {
            runtime.child = None;
            runtime.signature = None;
            runtime.last_error = Some(format!("远程 MCP 服务状态读取失败：{error}"));
        }
    }
}

fn stop_remote_child(runtime: &mut McpRemoteServiceRuntime) {
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.signature = None;
}

fn remote_service_status(
    settings: &McpSettings,
    runtime: &McpRemoteServiceRuntime,
) -> McpRemoteServiceStatus {
    let running = runtime.child.is_some();
    let host = settings.remote_host.clone();
    let port = settings.remote_port;
    let base = format!("http://{host}:{port}");
    McpRemoteServiceStatus {
        enabled: settings.remote_enabled,
        running,
        host,
        port,
        url: format!("{base}/mcp"),
        sse_url: format!("{base}/sse"),
        pid: runtime.child.as_ref().map(Child::id),
        token_saved: settings.remote_token_hash.is_some(),
        token_preview: settings.remote_token_preview.clone(),
        error: runtime.last_error.clone(),
    }
}

pub fn mcp_settings_output(
    settings: McpSettings,
    generated_remote_token: Option<String>,
    remote_status: McpRemoteServiceStatus,
) -> McpSettingsOutput {
    McpSettingsOutput {
        enabled: settings.enabled,
        expose_connections: settings.expose_connections,
        ssh_operations_enabled: settings.ssh_operations_enabled,
        allow_dangerous_commands: settings.allow_dangerous_commands,
        remote_enabled: settings.remote_enabled,
        remote_host: settings.remote_host,
        remote_port: settings.remote_port,
        remote_token: settings.remote_token,
        remote_token_saved: settings.remote_token_hash.is_some(),
        remote_token_preview: settings.remote_token_preview,
        generated_remote_token,
        remote_status,
        connection_exposure_mode: settings.connection_exposure_mode,
        exposed_connection_ids: settings.exposed_connection_ids,
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "mcp_data_dir_missing",
            "无法定位 MXterm 数据目录。",
            error,
            true,
        )
    })
}

fn settings_repository_for_app(app: &AppHandle) -> Result<StorageRepository, AppError> {
    repository_for_metadata(&app_data_dir(app)?)
}

pub fn start_remote_service_from_settings(
    app: &AppHandle,
    manager: &McpRemoteServiceManager,
) -> Result<McpRemoteServiceStatus, AppError> {
    let repository = settings_repository_for_app(app)?;
    let settings = load_settings(&repository)?;
    Ok(manager.reconcile(app, &settings))
}

#[tauri::command]
pub fn mcp_settings_get(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpSettingsOutput, AppError> {
    let settings = load_settings(&settings_repository_for_app(&app)?)?;
    let status = manager.status(&settings);
    Ok(mcp_settings_output(settings, None, status))
}

#[tauri::command]
pub fn mcp_settings_save(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
    request: McpSettingsInput,
) -> Result<McpSettingsOutput, AppError> {
    let repository = settings_repository_for_app(&app)?;
    let (settings, generated_token) = save_settings(&repository, request, &now_timestamp()?)?;
    let status = manager.reconcile(&app, &settings);
    Ok(mcp_settings_output(settings, generated_token, status))
}

#[tauri::command]
pub fn mcp_executable_path() -> Result<String, AppError> {
    Ok(sidecar_executable_path()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn mcp_local_network_info() -> McpLocalNetworkInfo {
    local_network_info()
}

#[tauri::command]
pub fn mcp_remote_service_status(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpRemoteServiceStatus, AppError> {
    let settings = load_settings(&settings_repository_for_app(&app)?)?;
    Ok(manager.status(&settings))
}

#[tauri::command]
pub fn mcp_remote_service_start(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpRemoteServiceStatus, AppError> {
    let settings = load_settings(&settings_repository_for_app(&app)?)?;
    Ok(manager.reconcile(&app, &settings))
}

#[tauri::command]
pub fn mcp_remote_service_stop(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpRemoteServiceStatus, AppError> {
    let settings = load_settings(&settings_repository_for_app(&app)?)?;
    Ok(manager.stop(&settings))
}

#[tauri::command]
pub fn mcp_remote_service_restart(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpRemoteServiceStatus, AppError> {
    let settings = load_settings(&settings_repository_for_app(&app)?)?;
    Ok(manager.restart(&app, &settings))
}

#[tauri::command]
pub fn mcp_remote_token_rotate(
    app: AppHandle,
    manager: State<'_, McpRemoteServiceManager>,
) -> Result<McpSettingsOutput, AppError> {
    let repository = settings_repository_for_app(&app)?;
    let mut settings = load_settings(&repository)?;
    let token = generate_remote_token()?;
    settings.remote_token = Some(token.clone());
    settings.remote_token_hash = Some(hash_remote_token(&token));
    settings.remote_token_preview = Some(remote_token_preview(&token));
    repository.app_setting_set(MCP_SETTINGS_KEY, &settings, &now_timestamp()?)?;
    let status = manager.restart(&app, &settings);
    Ok(mcp_settings_output(settings, Some(token), status))
}

pub fn tool_schemas() -> Vec<Value> {
    vec![
        tool(
            "get_mxterm_mcp_status",
            "Get MXterm MCP status.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool(
            "list_connections",
            "List redacted saved MXterm connections.",
            json!({ "type": "object", "properties": {} }),
        ),
        tool(
            "search_connections",
            "Search redacted saved MXterm connections.",
            json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }),
        ),
        tool(
            "get_connection",
            "Get one redacted saved connection by id.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" } }, "required": ["connection_id"] }),
        ),
        tool(
            "test_connection",
            "Test a saved SSH connection.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" } }, "required": ["connection_id"] }),
        ),
        tool(
            "execute_command",
            "Execute a controlled SSH command on a saved connection.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "command": { "type": "string" }, "timeout_seconds": { "type": "integer" }, "max_output_bytes": { "type": "integer" }, "confirm_dangerous": { "type": "boolean" } }, "required": ["connection_id", "command"] }),
        ),
        tool(
            "server_monitor",
            "Collect a server monitor snapshot.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" } }, "required": ["connection_id"] }),
        ),
        tool(
            "upload_file",
            "Upload a local file to a saved SSH connection.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "local_path": { "type": "string" }, "remote_path": { "type": "string" } }, "required": ["connection_id", "local_path", "remote_path"] }),
        ),
        tool(
            "download_file",
            "Download a remote file to a local path.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "remote_path": { "type": "string" }, "local_path": { "type": "string" } }, "required": ["connection_id", "remote_path", "local_path"] }),
        ),
        tool(
            "upload_directory",
            "Upload a local directory recursively.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "local_path": { "type": "string" }, "remote_path": { "type": "string" } }, "required": ["connection_id", "local_path", "remote_path"] }),
        ),
        tool(
            "download_directory",
            "Download a remote directory recursively.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "remote_path": { "type": "string" }, "local_path": { "type": "string" } }, "required": ["connection_id", "remote_path", "local_path"] }),
        ),
        tool(
            "execute_script",
            "Upload and execute a local script.",
            json!({ "type": "object", "properties": { "connection_id": { "type": "string" }, "script_path": { "type": "string" }, "interpreter": { "type": "string" }, "args": { "type": "string" }, "timeout_seconds": { "type": "integer" }, "max_output_bytes": { "type": "integer" } }, "required": ["connection_id", "script_path"] }),
        ),
    ]
}

pub fn tool_schemas_for_settings(settings: &McpSettings) -> Vec<Value> {
    let allowed = status(settings).tools;
    tool_schemas()
        .into_iter()
        .filter(|tool| {
            tool.get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| allowed.contains(&name))
        })
        .collect()
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema,
    })
}

pub fn value_get_str<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, AppError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("mcp_argument_missing", "MCP 参数缺失。", key, true))
}

pub fn value_get_u64(arguments: &Value, key: &str) -> Option<u64> {
    arguments.get(key).and_then(Value::as_u64)
}

pub fn value_get_usize(arguments: &Value, key: &str) -> Option<usize> {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

pub fn value_get_bool(arguments: &Value, key: &str) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub fn settings_as_map(settings: &McpSettings) -> BTreeMap<&'static str, bool> {
    BTreeMap::from([
        ("enabled", settings.enabled),
        ("expose_connections", settings.expose_connections),
        ("ssh_operations_enabled", settings.ssh_operations_enabled),
        (
            "allow_dangerous_commands",
            settings.allow_dangerous_commands,
        ),
        ("remote_enabled", settings.remote_enabled),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionJumpConfig, ConnectionProxyConfig,
    };
    use crate::storage_vault::InMemorySecretStore;

    #[test]
    fn default_settings_only_expose_status_tool() {
        let settings = McpSettings::default();

        assert!(!settings.enabled);
        assert_eq!(status(&settings).tools, vec!["get_mxterm_mcp_status"]);
        let tool_names = tool_schemas_for_settings(&settings)
            .into_iter()
            .filter_map(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        assert_eq!(tool_names, vec!["get_mxterm_mcp_status"]);
    }

    #[test]
    fn enabled_settings_expose_connection_and_ssh_tools() {
        let settings = McpSettings {
            enabled: true,
            expose_connections: true,
            ssh_operations_enabled: true,
            allow_dangerous_commands: false,
            ..Default::default()
        };

        let tool_names = tool_schemas_for_settings(&settings)
            .into_iter()
            .filter_map(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();

        assert!(tool_names.contains(&"list_connections".to_string()));
        assert!(tool_names.contains(&"get_connection".to_string()));
        assert!(tool_names.contains(&"execute_command".to_string()));
        assert!(tool_names.contains(&"upload_directory".to_string()));
        assert_eq!(tool_names.len(), status(&settings).tools.len());
    }

    #[test]
    fn exposed_connections_only_include_ssh_profiles() {
        let settings = McpSettings {
            enabled: true,
            expose_connections: true,
            connection_exposure_mode: McpConnectionExposureMode::All,
            ..Default::default()
        };

        let connections = exposed_connections(
            &settings,
            vec![
                test_connection_profile("ssh-1", ConnectionProtocol::Ssh),
                test_connection_profile("rdp-1", ConnectionProtocol::Rdp),
                test_connection_profile("vnc-1", ConnectionProtocol::Vnc),
            ],
        );

        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0].id, "ssh-1");
    }

    #[test]
    fn transfer_temp_paths_stay_next_to_targets() {
        let remote_part = mcp_remote_part_path("/opt/app/archive.tar.gz", 42);
        assert!(remote_part.starts_with("/opt/app/.mxterm-mcp-transfer-42-"));
        assert!(remote_part.ends_with("-archive.tar.gz.part"));

        let local_part = mcp_local_part_path(Path::new("C:/tmp/archive.tar.gz"), 42);
        assert_eq!(
            local_part.file_name().and_then(|value| value.to_str()),
            Some(".mxterm-mcp-transfer-42-archive.tar.gz.part")
        );
    }

    #[test]
    fn transfer_result_serializes_bytes_and_duration() {
        let result = McpTransferResult {
            connection_id: "conn".to_string(),
            local_path: "C:/tmp/a.bin".to_string(),
            remote_path: "/tmp/a.bin".to_string(),
            directory: false,
            ok: true,
            bytes_transferred: 128,
            duration_ms: 12,
        };

        let serialized = serde_json::to_value(result).unwrap();
        assert_eq!(serialized["bytes_transferred"], json!(128));
        assert_eq!(serialized["duration_ms"], json!(12));
    }

    #[test]
    fn plaintext_credential_arguments_are_rejected() {
        let error = reject_plaintext_credential_args(&json!({
            "connection_id": "saved",
            "password": "secret",
        }))
        .unwrap_err();

        assert_eq!(error.code, "mcp_plaintext_credentials_rejected");
    }

    #[test]
    fn dangerous_command_detector_catches_destructive_patterns() {
        let detected = detect_dangerous_command("sudo rm -rf / --no-preserve-root");

        assert_eq!(
            detected.map(|item| item.reason),
            Some("recursive delete from root")
        );
        assert!(detect_dangerous_command("uptime && df -h").is_none());
    }

    #[test]
    fn remote_token_hash_verifies_without_plaintext_sidecar_arg() {
        let token = "mx_test_token";
        let hash = hash_remote_token(token);

        assert!(verify_remote_token(token, &hash));
        assert!(!verify_remote_token("wrong-token", &hash));
        assert!(!hash.contains(token));
    }

    #[test]
    fn remote_ip_filter_rejects_local_only_addresses() {
        assert!(!is_remote_usable_ip(&IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(!is_remote_usable_ip(&IpAddr::V4(Ipv4Addr::UNSPECIFIED)));
        assert!(!is_remote_usable_ip(&IpAddr::V4(Ipv4Addr::new(
            169, 254, 1, 1
        ))));
        assert!(is_remote_usable_ip(&IpAddr::V4(Ipv4Addr::new(
            192, 168, 1, 20
        ))));
    }

    #[test]
    fn enabling_remote_service_generates_token_once() {
        let root =
            std::env::temp_dir().join(format!("mxterm-mcp-settings-{}", uuid::Uuid::new_v4()));
        let repository =
            StorageRepository::open_root(&root, Arc::new(InMemorySecretStore::default())).unwrap();
        let request = McpSettingsInput {
            enabled: true,
            expose_connections: false,
            ssh_operations_enabled: false,
            allow_dangerous_commands: false,
            remote_enabled: true,
            remote_host: "0.0.0.0".to_string(),
            remote_port: 8765,
            remote_token: None,
            connection_exposure_mode: McpConnectionExposureMode::All,
            exposed_connection_ids: Vec::new(),
        };

        let (settings, generated) = save_settings(&repository, request.clone(), "1").unwrap();
        let token = generated.expect("remote token should be returned once");
        assert_eq!(settings.remote_token.as_deref(), Some(token.as_str()));
        assert!(settings.remote_token_hash.is_some());
        assert!(settings.remote_token_preview.is_some());
        assert!(verify_remote_token(
            &token,
            settings.remote_token_hash.as_deref().unwrap()
        ));

        let (settings_again, generated_again) = save_settings(&repository, request, "2").unwrap();
        assert!(generated_again.is_none());
        assert_eq!(settings_again.remote_token, settings.remote_token);
        assert_eq!(settings_again.remote_token_hash, settings.remote_token_hash);

        drop(repository);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_remote_token_replaces_hash_and_preview() {
        let root =
            std::env::temp_dir().join(format!("mxterm-mcp-custom-token-{}", uuid::Uuid::new_v4()));
        let repository =
            StorageRepository::open_root(&root, Arc::new(InMemorySecretStore::default())).unwrap();
        let request = McpSettingsInput {
            enabled: true,
            expose_connections: false,
            ssh_operations_enabled: false,
            allow_dangerous_commands: false,
            remote_enabled: true,
            remote_host: "0.0.0.0".to_string(),
            remote_port: 8765,
            remote_token: Some("custom-token-value".to_string()),
            connection_exposure_mode: McpConnectionExposureMode::All,
            exposed_connection_ids: Vec::new(),
        };

        let (settings, generated) = save_settings(&repository, request, "1").unwrap();

        assert!(generated.is_none());
        assert_eq!(settings.remote_token.as_deref(), Some("custom-token-value"));
        assert!(verify_remote_token(
            "custom-token-value",
            settings.remote_token_hash.as_deref().unwrap()
        ));
        assert_eq!(settings.remote_token_preview.as_deref(), Some("...-value"));

        drop(repository);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn redacted_connection_serialization_excludes_secret_material() {
        let profile = ConnectionProfile {
            id: "conn-1".to_string(),
            name: "prod".to_string(),
            protocol: ConnectionProtocol::Ssh,
            group: Some("ops".to_string()),
            host: "10.0.0.10".to_string(),
            port: 22,
            username: "root".to_string(),
            credential_mode: ConnectionCredentialMode::Inline,
            credential_id: None,
            inline_auth_kind: Some(ConnectionAuthKind::PrivateKey),
            inline_password: Some("inline-password-secret".to_string()),
            inline_private_key_path: Some("C:/Users/me/.ssh/prod.pem".to_string()),
            inline_private_key_passphrase: Some("private-key-passphrase-secret".to_string()),
            prompt_auth_kind: None,
            proxy: ConnectionProxyConfig {
                kind: ConnectionProxyKind::Socks5,
                host: Some("proxy.local".to_string()),
                port: Some(1080),
                username: Some("proxy-user".to_string()),
                password: Some("proxy-password-secret".to_string()),
            },
            jump: Default::default(),
            advanced: ConnectionAdvancedConfig::default(),
            rdp: None,
            vnc: None,
            telnet: None,
            serial: None,
            notes: Some("linux".to_string()),
            is_favorite: true,
            last_connected_at: Some("123".to_string()),
            remote_os_id: Some("ubuntu".to_string()),
            remote_os_name: Some("Ubuntu".to_string()),
            remote_os_version: Some("24.04".to_string()),
            created_at: "1".to_string(),
            updated_at: "2".to_string(),
            auth_kind: None,
            password: Some("legacy-password-secret".to_string()),
            private_key_path: Some("legacy-key-path-secret".to_string()),
            private_key_passphrase: Some("legacy-passphrase-secret".to_string()),
        };

        let serialized = serde_json::to_string(&redacted_connection(profile)).unwrap();

        for secret in [
            "inline-password-secret",
            "private-key-passphrase-secret",
            "proxy-password-secret",
            "legacy-password-secret",
            "legacy-key-path-secret",
            "legacy-passphrase-secret",
            "prod.pem",
        ] {
            assert!(
                !serialized.contains(secret),
                "{secret} leaked in {serialized}"
            );
        }
        assert!(serialized.contains("\"redacted\":true"));
        assert!(serialized.contains("\"private_key_path_saved\":true"));
        assert!(serialized.contains("\"password_saved\":true"));
    }

    fn test_connection_profile(id: &str, protocol: ConnectionProtocol) -> ConnectionProfile {
        ConnectionProfile {
            id: id.to_string(),
            name: id.to_string(),
            protocol,
            group: None,
            host: "127.0.0.1".to_string(),
            port: 22,
            username: "root".to_string(),
            credential_mode: ConnectionCredentialMode::Prompt,
            credential_id: None,
            inline_auth_kind: None,
            inline_password: None,
            inline_private_key_path: None,
            inline_private_key_passphrase: None,
            prompt_auth_kind: None,
            proxy: ConnectionProxyConfig::default(),
            jump: ConnectionJumpConfig::default(),
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
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        }
    }
}
