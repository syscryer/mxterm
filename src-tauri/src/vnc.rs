use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

use crate::app_error::AppError;
use crate::connections::{
    ConnectionProfile, ConnectionProtocol, VncConnectionConfig, VncRenderMode, VncRunnerConfig,
    VncRunnerKind,
};
use crate::storage_repository::StorageRepository;

#[derive(Clone, Debug, Deserialize)]
pub struct VncConnectionRequest {
    pub connection_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct VncRunnerProbeRequest {
    #[serde(default)]
    pub config: Option<VncRunnerConfig>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct VncSessionRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VncPlatform {
    Windows,
    Linux,
    Macos,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct VncRunnerProbeResult {
    pub platform: VncPlatform,
    pub available_runners: Vec<VncRunnerKind>,
    pub default_runner: Option<VncRunnerKind>,
    pub default_executable: Option<String>,
    pub supports_embedded: bool,
    pub supports_clipboard: bool,
    pub supports_resize_session: bool,
    pub setup_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VncLaunchPreview {
    pub connection_id: String,
    pub runner: Option<VncRunnerKind>,
    pub render_mode: VncRenderMode,
    pub embedded: bool,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub websocket_url: Option<String>,
    pub fallback_reason: Option<String>,
    pub setup_hint: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VncLaunchResult {
    pub session_id: String,
    pub connection_id: String,
    pub launched: bool,
    pub embedded: bool,
    pub runner: VncRunnerKind,
    pub websocket_url: Option<String>,
    pub password: Option<String>,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub process_id: Option<u32>,
    pub fallback_reason: Option<String>,
    pub setup_hint: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VncSessionCloseResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct VncSessionManager {
    sessions: Mutex<std::collections::HashMap<String, ManagedVncSession>>,
}

#[derive(Debug)]
struct ManagedVncSession {
    bridge_handle: JoinHandle<()>,
}

struct ResolvedVncConnection {
    profile: ConnectionProfile,
    vnc: VncConnectionConfig,
    password: Option<String>,
}

struct SelectedVncRunner {
    runner: VncRunnerKind,
    executable: Option<PathBuf>,
    fallback_reason: Option<String>,
}

impl VncSessionManager {
    fn insert(&self, session_id: String, session: ManagedVncSession) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().map_err(|error| {
            AppError::new(
                "vnc_session_lock_failed",
                "VNC 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        sessions.insert(session_id, session);
        Ok(())
    }

    fn remove(&self, session_id: &str) -> Result<Option<ManagedVncSession>, AppError> {
        let mut sessions = self.sessions.lock().map_err(|error| {
            AppError::new(
                "vnc_session_lock_failed",
                "VNC 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        Ok(sessions.remove(session_id))
    }
}

pub fn probe_runner(request: VncRunnerProbeRequest) -> Result<VncRunnerProbeResult, AppError> {
    let config = request.config.unwrap_or_default();
    let platform = current_platform();
    let mut available_runners = vec![VncRunnerKind::Novnc];
    let mut default_runner = Some(VncRunnerKind::Novnc);
    let mut default_executable = None;

    if let Some(custom) = config
        .custom_executable
        .as_deref()
        .and_then(find_custom_executable)
    {
        available_runners.push(VncRunnerKind::Custom);
        if matches!(config.render_mode, VncRenderMode::Custom) {
            default_runner = Some(VncRunnerKind::Custom);
            default_executable = Some(custom.to_string_lossy().to_string());
        }
    }

    if let Some(viewer) = find_first_executable(&viewer_candidates(platform.clone())) {
        let runner = match platform {
            VncPlatform::Windows => VncRunnerKind::Realvnc,
            _ => VncRunnerKind::Tigervnc,
        };
        available_runners.push(runner.clone());
        if default_executable.is_none() && !matches!(config.render_mode, VncRenderMode::Embedded) {
            default_runner = Some(runner);
            default_executable = Some(viewer.to_string_lossy().to_string());
        }
    }

    Ok(VncRunnerProbeResult {
        platform,
        available_runners,
        default_runner,
        default_executable,
        supports_embedded: true,
        supports_clipboard: true,
        supports_resize_session: true,
        setup_hint: None,
    })
}

pub fn preview_launch(
    app: &AppHandle,
    request: VncConnectionRequest,
) -> Result<VncLaunchPreview, AppError> {
    let resolved = resolve_vnc_connection(app, &request.connection_id)?;
    let selected = select_runner(&resolved.vnc)?;
    let warnings = preview_warnings(&resolved.vnc, selected.runner.clone());
    if matches!(selected.runner, VncRunnerKind::Novnc) {
        return Ok(VncLaunchPreview {
            connection_id: resolved.profile.id,
            runner: Some(VncRunnerKind::Novnc),
            render_mode: resolved.vnc.runner.render_mode,
            embedded: true,
            executable: None,
            args: Vec::new(),
            websocket_url: Some("ws://127.0.0.1:<port>/vnc/<session>/<token>".to_string()),
            fallback_reason: selected.fallback_reason,
            setup_hint: None,
            warnings,
        });
    }

    let plan = build_external_launch_plan(&resolved, &selected, true)?;
    Ok(VncLaunchPreview {
        connection_id: resolved.profile.id,
        runner: Some(selected.runner),
        render_mode: resolved.vnc.runner.render_mode,
        embedded: false,
        executable: selected
            .executable
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        args: plan,
        websocket_url: None,
        fallback_reason: selected.fallback_reason,
        setup_hint: None,
        warnings,
    })
}

pub async fn launch_connection(
    app: &AppHandle,
    manager: &VncSessionManager,
    request: VncConnectionRequest,
) -> Result<VncLaunchResult, AppError> {
    let resolved = resolve_vnc_connection(app, &request.connection_id)?;
    let selected = select_runner(&resolved.vnc)?;
    if matches!(selected.runner, VncRunnerKind::Novnc) {
        return launch_embedded_bridge(manager, resolved, selected).await;
    }
    launch_external_runner(resolved, selected)
}

pub fn close_session(
    manager: &VncSessionManager,
    request: VncSessionRequest,
) -> VncSessionCloseResult {
    match manager.remove(&request.session_id) {
        Ok(Some(session)) => {
            session.bridge_handle.abort();
            VncSessionCloseResult {
                ok: true,
                message: format!("VNC 会话 {} 已关闭。", request.session_id),
            }
        }
        Ok(None) => VncSessionCloseResult {
            ok: false,
            message: format!("VNC 会话 {} 不存在或已关闭。", request.session_id),
        },
        Err(error) => VncSessionCloseResult {
            ok: false,
            message: error.message,
        },
    }
}

async fn launch_embedded_bridge(
    manager: &VncSessionManager,
    resolved: ResolvedVncConnection,
    selected: SelectedVncRunner,
) -> Result<VncLaunchResult, AppError> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|error| {
        AppError::new(
            "vnc_bridge_bind_failed",
            "VNC 本地桥接端口绑定失败。",
            error.to_string(),
            true,
        )
    })?;
    let address = listener.local_addr().map_err(|error| {
        AppError::new(
            "vnc_bridge_bind_failed",
            "VNC 本地桥接端口读取失败。",
            error.to_string(),
            true,
        )
    })?;
    let session_id = format!("vnc-{}", uuid::Uuid::new_v4());
    let token = uuid::Uuid::new_v4().to_string();
    let path = format!("/vnc/{session_id}/{token}");
    let websocket_url = format!("ws://127.0.0.1:{}{path}", address.port());
    let target_host = resolved.profile.host.clone();
    let target_port = resolved.profile.port;
    let bridge_handle = tokio::spawn(async move {
        run_bridge(listener, path, target_host, target_port).await;
    });

    manager.insert(session_id.clone(), ManagedVncSession { bridge_handle })?;

    Ok(VncLaunchResult {
        session_id,
        connection_id: resolved.profile.id,
        launched: true,
        embedded: true,
        runner: VncRunnerKind::Novnc,
        websocket_url: Some(websocket_url),
        password: resolved.password,
        executable: None,
        args: Vec::new(),
        process_id: None,
        fallback_reason: selected.fallback_reason,
        setup_hint: None,
        warnings: preview_warnings(&resolved.vnc, VncRunnerKind::Novnc),
    })
}

fn launch_external_runner(
    resolved: ResolvedVncConnection,
    selected: SelectedVncRunner,
) -> Result<VncLaunchResult, AppError> {
    let args = build_external_launch_plan(&resolved, &selected, false)?;
    let executable = selected.executable.ok_or_else(|| {
        AppError::new(
            "vnc_runner_missing",
            "未找到可用的 VNC 客户端。",
            "external runner executable is missing",
            true,
        )
    })?;
    let mut command = Command::new(&executable);
    command.args(&args);
    let child = command.spawn().map_err(|error| {
        AppError::new(
            "vnc_launch_failed",
            "VNC 客户端启动失败。",
            format!("executable={}, error={error}", executable.display()),
            true,
        )
    })?;
    let process_id = child.id();
    drop(child);

    Ok(VncLaunchResult {
        session_id: format!("vnc-{}", uuid::Uuid::new_v4()),
        connection_id: resolved.profile.id,
        launched: true,
        embedded: false,
        runner: selected.runner.clone(),
        websocket_url: None,
        password: None,
        executable: Some(executable.to_string_lossy().to_string()),
        args,
        process_id: Some(process_id),
        fallback_reason: selected.fallback_reason,
        setup_hint: None,
        warnings: preview_warnings(&resolved.vnc, selected.runner),
    })
}

async fn run_bridge(
    listener: TcpListener,
    expected_path: String,
    target_host: String,
    target_port: u16,
) {
    loop {
        let Ok((browser_stream, _)) = listener.accept().await else {
            break;
        };
        let expected_path = expected_path.clone();
        let target_host = target_host.clone();
        tokio::spawn(async move {
            let _ =
                relay_single_client(browser_stream, expected_path, target_host, target_port).await;
        });
    }
}

async fn relay_single_client(
    browser_stream: TcpStream,
    expected_path: String,
    target_host: String,
    target_port: u16,
) -> Result<(), AppError> {
    let websocket = accept_hdr_async(browser_stream, |request: &Request, response: Response| {
        if request.uri().path() == expected_path {
            return Ok(response);
        }
        let mut error = ErrorResponse::new(Some("invalid vnc session token".to_string()));
        *error.status_mut() = StatusCode::FORBIDDEN;
        Err(error)
    })
    .await
    .map_err(|error| {
        AppError::new(
            "vnc_bridge_websocket_failed",
            "VNC WebSocket 握手失败。",
            error.to_string(),
            true,
        )
    })?;
    let tcp = TcpStream::connect((target_host.as_str(), target_port))
        .await
        .map_err(|error| {
            AppError::new(
                "vnc_target_connect_failed",
                "VNC 目标主机连接失败。",
                format!("target={target_host}:{target_port}, error={error}"),
                true,
            )
        })?;

    let (mut ws_sink, mut ws_stream) = websocket.split();
    let (mut tcp_reader, mut tcp_writer) = tcp.into_split();

    let browser_to_target = async {
        while let Some(message) = ws_stream.next().await {
            let message = message.map_err(vnc_websocket_error)?;
            if message.is_binary() {
                let data = message.into_data();
                tcp_writer.write_all(&data).await.map_err(vnc_io_error)?;
            } else if message.is_close() {
                break;
            }
        }
        let _ = tcp_writer.shutdown().await;
        Ok::<(), AppError>(())
    };

    let target_to_browser = async {
        let mut buffer = [0_u8; 8192];
        loop {
            let read = tcp_reader.read(&mut buffer).await.map_err(vnc_io_error)?;
            if read == 0 {
                break;
            }
            ws_sink
                .send(Message::Binary(buffer[..read].to_vec().into()))
                .await
                .map_err(vnc_websocket_error)?;
        }
        let _ = ws_sink.close().await;
        Ok::<(), AppError>(())
    };

    tokio::select! {
        result = browser_to_target => result,
        result = target_to_browser => result,
    }
}

fn resolve_vnc_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ResolvedVncConnection, AppError> {
    let repository = StorageRepository::open_app(app)?;
    let profile = repository.connection_get(connection_id)?.ok_or_else(|| {
        AppError::new(
            "vnc_connection_missing",
            "VNC 连接不存在。",
            format!("connection_id={connection_id}"),
            false,
        )
    })?;
    if profile.protocol != ConnectionProtocol::Vnc {
        return Err(AppError::new(
            "vnc_protocol_required",
            "该操作仅支持 VNC 连接。",
            format!(
                "connection_id={connection_id}, protocol={:?}",
                profile.protocol
            ),
            true,
        ));
    }
    let vnc = profile.vnc.clone().unwrap_or_default();
    let password = repository.resolve_vnc_connection_secret(connection_id)?;
    Ok(ResolvedVncConnection {
        profile,
        vnc,
        password,
    })
}

fn select_runner(vnc: &VncConnectionConfig) -> Result<SelectedVncRunner, AppError> {
    if matches!(vnc.runner.render_mode, VncRenderMode::Embedded) {
        return Ok(SelectedVncRunner {
            runner: VncRunnerKind::Novnc,
            executable: None,
            fallback_reason: None,
        });
    }
    if matches!(vnc.runner.render_mode, VncRenderMode::Custom) {
        let executable = vnc
            .runner
            .custom_executable
            .as_deref()
            .and_then(find_custom_executable)
            .ok_or_else(|| {
                AppError::new(
                    "vnc_custom_runner_missing",
                    "未找到自定义 VNC 客户端。",
                    "custom executable missing",
                    true,
                )
            })?;
        return Ok(SelectedVncRunner {
            runner: VncRunnerKind::Custom,
            executable: Some(executable),
            fallback_reason: Some(
                "外部 VNC 客户端不会接收 MXterm 保存的密码，将由客户端自行提示。".to_string(),
            ),
        });
    }

    let candidates = viewer_candidates(current_platform());
    let executable = find_first_executable(&candidates).ok_or_else(|| {
        AppError::new(
            "vnc_runner_missing",
            "未找到可用的 VNC 客户端。",
            "no external vnc viewer found",
            true,
        )
    })?;
    Ok(SelectedVncRunner {
        runner: vnc
            .runner
            .preferred_runner
            .clone()
            .filter(|runner| !matches!(runner, VncRunnerKind::Novnc))
            .unwrap_or(VncRunnerKind::Vncviewer),
        executable: Some(executable),
        fallback_reason: Some(
            "外部 VNC 客户端不会接收 MXterm 保存的密码，将由客户端自行提示。".to_string(),
        ),
    })
}

fn build_external_launch_plan(
    resolved: &ResolvedVncConnection,
    selected: &SelectedVncRunner,
    preview: bool,
) -> Result<Vec<String>, AppError> {
    let target = format!("{}::{}", resolved.profile.host, resolved.profile.port);
    let mut args = vec![target];
    if resolved.vnc.input.view_only {
        args.push("-ViewOnly".to_string());
    }
    if !resolved.vnc.input.shared {
        args.push("-Shared=0".to_string());
    }
    if let Some(raw) = resolved.vnc.raw_runner_args.as_deref() {
        args.extend(split_runner_args(raw));
    }
    if matches!(selected.runner, VncRunnerKind::Custom) {
        if let Some(template) = resolved.vnc.runner.custom_args_template.as_deref() {
            let rendered = template
                .replace("{host}", &resolved.profile.host)
                .replace("{port}", &resolved.profile.port.to_string())
                .replace(
                    "{target}",
                    &format!("{}:{}", resolved.profile.host, resolved.profile.port),
                );
            args = split_runner_args(&rendered);
        }
    }
    if preview {
        args.iter_mut().for_each(|arg| {
            if arg.to_ascii_lowercase().contains("password") {
                *arg = "<redacted>".to_string();
            }
        });
    }
    Ok(args)
}

fn preview_warnings(vnc: &VncConnectionConfig, runner: VncRunnerKind) -> Vec<String> {
    let mut warnings = Vec::new();
    if !matches!(runner, VncRunnerKind::Novnc) {
        warnings.push("外部 VNC 客户端不会接收 MXterm 保存的密码。".to_string());
    }
    if matches!(vnc.runner.render_mode, VncRenderMode::Embedded)
        && !matches!(runner, VncRunnerKind::Novnc)
    {
        warnings.push("嵌入式 noVNC 不可用时才会回退到外部客户端。".to_string());
    }
    warnings
}

fn current_platform() -> VncPlatform {
    if cfg!(target_os = "windows") {
        VncPlatform::Windows
    } else if cfg!(target_os = "linux") {
        VncPlatform::Linux
    } else if cfg!(target_os = "macos") {
        VncPlatform::Macos
    } else {
        VncPlatform::Unknown
    }
}

fn viewer_candidates(platform: VncPlatform) -> Vec<&'static str> {
    match platform {
        VncPlatform::Windows => vec![
            "vncviewer.exe",
            "C:\\Program Files\\TigerVNC\\vncviewer.exe",
            "C:\\Program Files\\RealVNC\\VNC Viewer\\vncviewer.exe",
        ],
        VncPlatform::Linux => vec!["vncviewer", "xtigervncviewer", "tigervnc-viewer"],
        VncPlatform::Macos => vec![
            "/Applications/TigerVNC Viewer.app/Contents/MacOS/TigerVNC Viewer",
            "/Applications/VNC Viewer.app/Contents/MacOS/vncviewer",
        ],
        VncPlatform::Unknown => vec!["vncviewer"],
    }
}

fn find_first_executable(candidates: &[&str]) -> Option<PathBuf> {
    candidates.iter().find_map(|candidate| {
        let path = PathBuf::from(candidate);
        if path.components().count() > 1 && path.is_file() {
            return Some(path);
        }
        find_on_path(candidate)
    })
}

fn find_custom_executable(value: &str) -> Option<PathBuf> {
    let path = PathBuf::from(value.trim());
    if path.is_file() {
        Some(path)
    } else {
        find_on_path(value.trim())
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || Path::new(name).components().count() > 1 {
        return None;
    }
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths).find_map(|path| {
            let candidate = path.join(name);
            candidate.is_file().then_some(candidate)
        })
    })
}

fn split_runner_args(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn vnc_io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "vnc_bridge_io_failed",
        "VNC 桥接读写失败。",
        error.to_string(),
        true,
    )
}

fn vnc_websocket_error(error: tokio_tungstenite::tungstenite::Error) -> AppError {
    AppError::new(
        "vnc_bridge_websocket_failed",
        "VNC WebSocket 转发失败。",
        error.to_string(),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::split_runner_args;

    #[test]
    fn split_runner_args_drops_blank_segments() {
        assert_eq!(
            split_runner_args("  -ViewOnly   -Shared=0  "),
            vec!["-ViewOnly".to_string(), "-Shared=0".to_string()]
        );
    }
}
