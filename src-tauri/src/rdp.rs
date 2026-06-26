use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::app_error::AppError;
use crate::connections::{
    ConnectionProfile, ConnectionProtocol, RdpAudioMode, RdpCertificatePolicy, RdpConnectionConfig,
    RdpDisplayMode, RdpGatewayMode, RdpNetworkLevelAuthentication, RdpPerformanceConfig,
    RdpPerformancePreset, RdpRenderMode, RdpRunnerConfig, RdpRunnerKind,
};
use crate::storage_repository::StorageRepository;

#[derive(Clone, Debug, Deserialize)]
pub struct RdpConnectionRequest {
    pub connection_id: String,
    #[serde(default)]
    pub bounds: Option<RdpEmbeddedBounds>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RdpRunnerProbeRequest {
    #[serde(default)]
    pub config: Option<RdpRunnerConfig>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RdpSessionRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RdpEmbeddedBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RdpResizeRequest {
    pub session_id: String,
    pub bounds: RdpEmbeddedBounds,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RdpPlatform {
    Windows,
    Linux,
    Macos,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpRunnerProbeResult {
    pub platform: RdpPlatform,
    pub available_runners: Vec<RdpRunnerKind>,
    pub default_runner: Option<RdpRunnerKind>,
    pub default_executable: Option<String>,
    pub supports_embedded: bool,
    pub supports_remote_app: bool,
    pub supports_dynamic_resize: bool,
    pub setup_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpLaunchPreview {
    pub connection_id: String,
    pub runner: Option<RdpRunnerKind>,
    pub render_mode: RdpRenderMode,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub rdp_file_content: Option<String>,
    pub fallback_reason: Option<String>,
    pub setup_hint: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpLaunchResult {
    pub session_id: String,
    pub connection_id: String,
    pub launched: bool,
    pub embedded: bool,
    pub runner: RdpRunnerKind,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub process_id: Option<u32>,
    pub rdp_file_path: Option<String>,
    pub fallback_reason: Option<String>,
    pub setup_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpSessionCloseResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpSessionResizeResult {
    pub ok: bool,
    pub applied: bool,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct RdpSessionManager {
    sessions: Mutex<std::collections::HashMap<String, ManagedRdpSession>>,
    native_host: Mutex<Option<NativeRdpHostHandle>>,
}

#[derive(Debug)]
struct ManagedRdpSession {
    hwnd: isize,
    session_hwnd: Option<isize>,
    parent_hwnd: Option<isize>,
    process_id: Option<u32>,
    cleanup_path: Option<PathBuf>,
    embedded: bool,
}

#[cfg(windows)]
#[derive(Clone)]
struct NativeRdpHostHandle {
    hwnd: isize,
    owner_hwnd: isize,
    command_tx: Sender<NativeRdpHostCommand>,
    command_rx_ptr: usize,
    atl_ptr: isize,
}

#[cfg(not(windows))]
#[derive(Clone)]
struct NativeRdpHostHandle;

impl std::fmt::Debug for NativeRdpHostHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        #[cfg(windows)]
        {
            formatter
                .debug_struct("NativeRdpHostHandle")
                .field("hwnd", &self.hwnd)
                .field("owner_hwnd", &self.owner_hwnd)
                .field("command_rx_ptr", &self.command_rx_ptr)
                .field("atl_ptr", &self.atl_ptr)
                .finish_non_exhaustive()
        }
        #[cfg(not(windows))]
        {
            formatter.debug_struct("NativeRdpHostHandle").finish()
        }
    }
}

#[cfg(windows)]
enum NativeRdpHostCommand {
    AddSession {
        session_id: String,
        config: ActiveXRdpConfig,
        response: SyncSender<Result<HostedRdpSession, AppError>>,
    },
    CloseSession {
        session_id: String,
    },
    Resize {
        bounds: RdpEmbeddedBounds,
    },
}

#[cfg(windows)]
const MX_RDP_HOST_PROCESS_COMMANDS: u32 = windows::Win32::UI::WindowsAndMessaging::WM_APP + 42;

#[cfg(windows)]
const MX_RDP_CHROME_HEIGHT_DIP: i32 = 36;

#[cfg(windows)]
const MX_RDP_TAB_HEIGHT_DIP: i32 = 26;

#[cfg(windows)]
const MX_RDP_LOGIN_RESIZE_TIMER_ID: usize = 0x4d58_5244;

#[cfg(windows)]
const MX_RDP_LOGIN_RESIZE_TICKS: u32 = 20;

#[cfg(windows)]
const MX_RDP_LOGIN_RESIZE_INTERVAL_MS: u32 = 300;

#[cfg(windows)]
const MX_RDP_CONTROL_RESIZE_SUBCLASS_ID: usize = 0x4d58_5244_5052_535a;

impl RdpSessionManager {
    #[cfg(windows)]
    fn native_host_for_owner(
        &self,
        owner_hwnd: isize,
    ) -> Result<Option<NativeRdpHostHandle>, AppError> {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::IsWindow;

        let mut host = self.native_host.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        if let Some(handle) = host.as_ref() {
            let hwnd = HWND(handle.hwnd as *mut std::ffi::c_void);
            if handle.owner_hwnd == owner_hwnd && unsafe { IsWindow(Some(hwnd)).as_bool() } {
                return Ok(Some(handle.clone()));
            }
        }
        *host = None;
        Ok(None)
    }

    #[cfg(windows)]
    fn set_native_host(&self, handle: NativeRdpHostHandle) -> Result<(), AppError> {
        let mut host = self.native_host.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        *host = Some(handle);
        Ok(())
    }

    #[cfg(windows)]
    fn native_host_by_hwnd(
        &self,
        host_hwnd: isize,
    ) -> Result<Option<NativeRdpHostHandle>, AppError> {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::IsWindow;

        let mut host = self.native_host.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        if let Some(handle) = host.as_ref() {
            let hwnd = HWND(handle.hwnd as *mut std::ffi::c_void);
            if handle.hwnd == host_hwnd && unsafe { IsWindow(Some(hwnd)).as_bool() } {
                return Ok(Some(handle.clone()));
            }
        }
        if host.as_ref().is_some_and(|handle| handle.hwnd == host_hwnd) {
            *host = None;
        }
        Ok(None)
    }

    #[cfg(windows)]
    fn clear_native_host_if(&self, hwnd: isize) -> Result<(), AppError> {
        let mut host = self.native_host.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        if host.as_ref().is_some_and(|handle| handle.hwnd == hwnd) {
            *host = None;
        }
        Ok(())
    }

    fn insert(&self, session_id: String, session: ManagedRdpSession) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        sessions.insert(session_id, session);
        Ok(())
    }

    fn get(&self, session_id: &str) -> Result<Option<ManagedRdpSession>, AppError> {
        let sessions = self.sessions.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        Ok(sessions.get(session_id).cloned())
    }

    fn remove(&self, session_id: &str) -> Result<Option<ManagedRdpSession>, AppError> {
        let mut sessions = self.sessions.lock().map_err(|error| {
            AppError::new(
                "rdp_session_lock_failed",
                "RDP 会话状态访问失败。",
                error.to_string(),
                true,
            )
        })?;
        Ok(sessions.remove(session_id))
    }
}

impl Clone for ManagedRdpSession {
    fn clone(&self) -> Self {
        Self {
            hwnd: self.hwnd,
            session_hwnd: self.session_hwnd,
            parent_hwnd: self.parent_hwnd,
            process_id: self.process_id,
            cleanup_path: self.cleanup_path.clone(),
            embedded: self.embedded,
        }
    }
}

struct ResolvedRdpConnection {
    profile: ConnectionProfile,
    rdp: RdpConnectionConfig,
    password: Option<String>,
}

struct SelectedRunner {
    runner: RdpRunnerKind,
    executable: PathBuf,
    fallback_reason: Option<String>,
}

pub fn probe_runner(request: RdpRunnerProbeRequest) -> Result<RdpRunnerProbeResult, AppError> {
    let config = request.config.unwrap_or_default();
    let platform = current_platform();
    let mut available_runners = Vec::new();
    let mut default_runner = None;
    let mut default_executable = None;
    let mut setup_hint = None;

    if let Some(custom) = config
        .custom_executable
        .as_deref()
        .and_then(find_custom_executable)
    {
        available_runners.push(RdpRunnerKind::Custom);
        if matches!(config.render_mode, RdpRenderMode::Custom) {
            default_runner = Some(RdpRunnerKind::Custom);
            default_executable = Some(custom.to_string_lossy().to_string());
        }
    }

    match platform {
        RdpPlatform::Windows => {
            if let Some(mstscax) = find_windows_mstscax() {
                available_runners.push(RdpRunnerKind::MstscActiveX);
                if default_runner.is_none() && matches!(config.render_mode, RdpRenderMode::Embedded)
                {
                    default_runner = Some(RdpRunnerKind::MstscActiveX);
                    default_executable = Some(mstscax.to_string_lossy().to_string());
                }
            }
            if let Some(mstsc) = find_windows_mstsc() {
                available_runners.push(RdpRunnerKind::Mstsc);
                if default_runner.is_none() {
                    default_runner = Some(RdpRunnerKind::Mstsc);
                    default_executable = Some(mstsc.to_string_lossy().to_string());
                }
            } else {
                setup_hint = Some("未找到 mstsc.exe，请确认系统远程桌面客户端可用。".to_string());
            }
            if !available_runners.contains(&RdpRunnerKind::MstscActiveX) {
                setup_hint =
                    Some("未找到 mstscax.dll，嵌入式 RDP 将回退到外部 mstsc.exe。".to_string());
            }
        }
        RdpPlatform::Linux => {
            if let Some(freerdp) = find_first_executable(&["wlfreerdp", "xfreerdp"]) {
                available_runners.push(RdpRunnerKind::Freerdp);
                if default_runner.is_none() {
                    default_runner = Some(RdpRunnerKind::Freerdp);
                    default_executable = Some(freerdp.to_string_lossy().to_string());
                }
            } else {
                setup_hint =
                    Some("未找到 wlfreerdp 或 xfreerdp，请安装 FreeRDP 客户端。".to_string());
            }
        }
        RdpPlatform::Macos => {
            if default_runner.is_none() {
                setup_hint = Some("macOS RDP 客户端适配将在后续按平台单独启用。".to_string());
            }
        }
        RdpPlatform::Unknown => {
            setup_hint = Some("当前平台的 RDP 客户端适配将在后续按平台单独启用。".to_string());
        }
    }

    let supports_embedded = matches!(platform, RdpPlatform::Windows)
        && available_runners.contains(&RdpRunnerKind::MstscActiveX);

    Ok(RdpRunnerProbeResult {
        platform,
        available_runners,
        default_runner,
        default_executable,
        supports_embedded,
        supports_remote_app: true,
        supports_dynamic_resize: true,
        setup_hint,
    })
}

pub fn preview_launch(
    app: &AppHandle,
    request: RdpConnectionRequest,
) -> Result<RdpLaunchPreview, AppError> {
    let resolved = resolve_rdp_connection(app, &request.connection_id)?;
    let selected = select_runner(&resolved.rdp)?;
    let plan = build_launch_plan(app, &resolved, &selected, true)?;
    Ok(RdpLaunchPreview {
        connection_id: resolved.profile.id,
        runner: Some(selected.runner),
        render_mode: resolved.rdp.runner.render_mode,
        executable: Some(selected.executable.to_string_lossy().to_string()),
        args: plan.args,
        rdp_file_content: plan.rdp_file_content,
        fallback_reason: selected.fallback_reason,
        setup_hint: None,
        warnings: plan.warnings,
    })
}

pub async fn launch_connection(
    app: &AppHandle,
    manager: &RdpSessionManager,
    request: RdpConnectionRequest,
) -> Result<RdpLaunchResult, AppError> {
    let resolved = resolve_rdp_connection(app, &request.connection_id)?;
    let requested_bounds = request.bounds.clone();
    let selected = select_runner(&resolved.rdp)?;

    if matches!(selected.runner, RdpRunnerKind::MstscActiveX) {
        if let Some(reason) = embedded_fallback_reason(&resolved.rdp, requested_bounds.as_ref()) {
            let fallback = select_windows_mstsc_runner()?;
            return launch_external_runner(app, &resolved, &fallback, Some(reason));
        }

        let session_id = format!("rdp-{}", uuid::Uuid::new_v4());
        match host_activex_session(
            app,
            manager,
            session_id.clone(),
            &resolved,
            requested_bounds.as_ref(),
        )
        .await
        {
            Ok(host) => {
                manager.insert(
                    session_id.clone(),
                    ManagedRdpSession {
                        hwnd: host.hwnd,
                        session_hwnd: host.session_hwnd,
                        parent_hwnd: host.parent_hwnd,
                        process_id: None,
                        cleanup_path: None,
                        embedded: true,
                    },
                )?;

                return Ok(RdpLaunchResult {
                    session_id,
                    connection_id: resolved.profile.id,
                    launched: true,
                    embedded: false,
                    runner: RdpRunnerKind::MstscActiveX,
                    executable: Some(selected.executable.to_string_lossy().to_string()),
                    args: Vec::new(),
                    process_id: None,
                    rdp_file_path: None,
                    fallback_reason: Some(
                        "已打开 MXterm 原生 RDP 子窗口，密码会通过 Windows ActiveX 内存通道注入。"
                            .to_string(),
                    ),
                    setup_hint: None,
                });
            }
            Err(error) => {
                let fallback = select_windows_mstsc_runner()?;
                return launch_external_runner(
                    app,
                    &resolved,
                    &fallback,
                    Some(format!(
                        "RDP ActiveX 原生子窗口初始化失败，已回退到外部 mstsc.exe：{}",
                        rdp_launch_error_summary(&error)
                    )),
                );
            }
        }
    }

    let fallback_reason = selected
        .fallback_reason
        .clone()
        .or_else(|| embedded_fallback_reason(&resolved.rdp, requested_bounds.as_ref()));

    launch_external_runner(app, &resolved, &selected, fallback_reason)
}

fn launch_external_runner(
    app: &AppHandle,
    resolved: &ResolvedRdpConnection,
    selected: &SelectedRunner,
    fallback_reason: Option<String>,
) -> Result<RdpLaunchResult, AppError> {
    let plan = build_launch_plan(app, resolved, selected, false)?;
    let mut command = Command::new(&selected.executable);
    command.args(&plan.args);
    let child = command.spawn().map_err(|error| {
        AppError::new(
            "rdp_launch_failed",
            "RDP 客户端启动失败。",
            format!(
                "executable={}, error={error}",
                selected.executable.display()
            ),
            true,
        )
    })?;
    let process_id = child.id();
    drop(child);

    if let Some(path) = plan.cleanup_path.clone() {
        schedule_temp_file_cleanup(path);
    }

    Ok(RdpLaunchResult {
        session_id: format!("rdp-{}", uuid::Uuid::new_v4()),
        connection_id: resolved.profile.id.clone(),
        launched: true,
        embedded: false,
        runner: selected.runner.clone(),
        executable: Some(selected.executable.to_string_lossy().to_string()),
        args: plan.args,
        process_id: Some(process_id),
        rdp_file_path: plan
            .rdp_file_path
            .map(|path| path.to_string_lossy().to_string()),
        fallback_reason,
        setup_hint: None,
    })
}

pub fn close_session(
    manager: &RdpSessionManager,
    request: RdpSessionRequest,
) -> RdpSessionCloseResult {
    match manager.remove(&request.session_id) {
        Ok(Some(session)) if session.embedded => {
            close_hosted_window(manager, session.hwnd, &request.session_id);
            if let Some(path) = session.cleanup_path {
                let _ = fs::remove_file(path);
            }
            RdpSessionCloseResult {
                ok: true,
                message: format!("RDP 会话 {} 已请求关闭。", request.session_id),
            }
        }
        Ok(Some(_)) | Ok(None) => RdpSessionCloseResult {
            ok: false,
            message: format!(
                "RDP 会话 {} 当前由外部客户端管理，请在客户端窗口中关闭。",
                request.session_id
            ),
        },
        Err(error) => RdpSessionCloseResult {
            ok: false,
            message: error.message,
        },
    }
}

pub fn resize_embedded_session(
    manager: &RdpSessionManager,
    request: RdpResizeRequest,
) -> RdpSessionResizeResult {
    match manager.get(&request.session_id) {
        Ok(Some(session)) if session.embedded => {
            resize_hosted_window(manager, session.hwnd, session.parent_hwnd, &request.bounds);
            RdpSessionResizeResult {
                ok: true,
                applied: true,
                message: format!(
                    "已调整 RDP 会话 {} 到 {}x{}@{},{}。",
                    request.session_id,
                    request.bounds.width,
                    request.bounds.height,
                    request.bounds.x,
                    request.bounds.y
                ),
            }
        }
        Ok(Some(_)) | Ok(None) => RdpSessionResizeResult {
            ok: false,
            applied: false,
            message: format!("RDP 会话 {} 没有可调整的嵌入窗口。", request.session_id),
        },
        Err(error) => RdpSessionResizeResult {
            ok: false,
            applied: false,
            message: error.message,
        },
    }
}

fn resolve_rdp_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ResolvedRdpConnection, AppError> {
    let connection_id = connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "rdp_connection_missing",
            "请选择 RDP 连接。",
            "connection_id is empty",
            true,
        ));
    }

    let repository = StorageRepository::open_app(app)?;
    let profile = repository.connection_get(connection_id)?.ok_or_else(|| {
        AppError::new(
            "connection_missing",
            "连接不存在。",
            format!("connection_id={connection_id}"),
            false,
        )
    })?;
    if profile.protocol != ConnectionProtocol::Rdp {
        return Err(AppError::new(
            "rdp_protocol_required",
            "该操作仅支持 RDP 连接。",
            format!(
                "connection_id={}, protocol={:?}",
                profile.id, profile.protocol
            ),
            true,
        ));
    }
    let rdp = profile.rdp.clone().unwrap_or_default();
    let password = repository.resolve_rdp_connection_secret(connection_id)?;
    Ok(ResolvedRdpConnection {
        profile,
        rdp,
        password,
    })
}

fn select_runner(rdp: &RdpConnectionConfig) -> Result<SelectedRunner, AppError> {
    if matches!(rdp.runner.render_mode, RdpRenderMode::Custom) {
        return select_custom_runner(&rdp.runner);
    }

    if matches!(rdp.runner.preferred_runner, Some(RdpRunnerKind::Custom)) {
        return select_custom_runner(&rdp.runner);
    }

    match current_platform() {
        RdpPlatform::Windows => {
            if matches!(rdp.runner.render_mode, RdpRenderMode::Embedded) {
                if let Some(executable) = find_windows_mstscax() {
                    return Ok(SelectedRunner {
                        runner: RdpRunnerKind::MstscActiveX,
                        executable,
                        fallback_reason: None,
                    });
                }
            }
            let executable = find_windows_mstsc().ok_or_else(|| {
                AppError::new(
                    "rdp_runner_missing",
                    "未找到 mstsc.exe。",
                    "mstsc.exe is missing",
                    true,
                )
            })?;
            Ok(SelectedRunner {
                runner: RdpRunnerKind::Mstsc,
                executable,
                fallback_reason: None,
            })
        }
        RdpPlatform::Linux => {
            let executable =
                find_first_executable(&["wlfreerdp", "xfreerdp"]).ok_or_else(|| {
                    AppError::new(
                        "rdp_runner_missing",
                        "未找到 FreeRDP 客户端。",
                        "wlfreerdp/xfreerdp missing",
                        true,
                    )
                })?;
            Ok(SelectedRunner {
                runner: RdpRunnerKind::Freerdp,
                executable,
                fallback_reason: None,
            })
        }
        RdpPlatform::Macos | RdpPlatform::Unknown => select_custom_runner(&rdp.runner),
    }
}

fn select_custom_runner(runner: &RdpRunnerConfig) -> Result<SelectedRunner, AppError> {
    let executable = runner
        .custom_executable
        .as_deref()
        .and_then(find_custom_executable)
        .ok_or_else(|| {
            AppError::new(
                "rdp_custom_runner_missing",
                "请先配置自定义 RDP 客户端路径。",
                "custom executable is missing",
                true,
            )
        })?;
    Ok(SelectedRunner {
        runner: RdpRunnerKind::Custom,
        executable,
        fallback_reason: None,
    })
}

fn select_windows_mstsc_runner() -> Result<SelectedRunner, AppError> {
    let executable = find_windows_mstsc().ok_or_else(|| {
        AppError::new(
            "rdp_runner_missing",
            "未找到 mstsc.exe。",
            "mstsc.exe is missing",
            true,
        )
    })?;
    Ok(SelectedRunner {
        runner: RdpRunnerKind::Mstsc,
        executable,
        fallback_reason: None,
    })
}

fn embedded_fallback_reason(
    rdp: &RdpConnectionConfig,
    _bounds: Option<&RdpEmbeddedBounds>,
) -> Option<String> {
    if !matches!(rdp.runner.render_mode, RdpRenderMode::Embedded) {
        return None;
    }
    if !matches!(current_platform(), RdpPlatform::Windows) {
        return Some("当前平台不支持 Windows RDP 嵌入式宿主，已使用外部 runner。".to_string());
    }
    if rdp.remote_app.enabled {
        return Some("RemoteApp 暂走 mstsc.exe 外部模式，避免嵌入宿主兼容性问题。".to_string());
    }
    None
}

fn rdp_launch_error_summary(error: &AppError) -> String {
    let raw = error.raw_message.trim();
    if raw.is_empty() || raw == error.message {
        return error.message.clone();
    }

    format!("{}；{}", error.message, truncate_rdp_detail(raw, 420))
}

fn truncate_rdp_detail(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }

    let mut truncated = value.chars().take(limit).collect::<String>();
    truncated.push_str("...");
    truncated
}

struct LaunchPlan {
    args: Vec<String>,
    rdp_file_content: Option<String>,
    rdp_file_path: Option<PathBuf>,
    cleanup_path: Option<PathBuf>,
    warnings: Vec<String>,
}

fn build_launch_plan(
    app: &AppHandle,
    resolved: &ResolvedRdpConnection,
    selected: &SelectedRunner,
    preview: bool,
) -> Result<LaunchPlan, AppError> {
    match selected.runner {
        RdpRunnerKind::MstscActiveX => Ok(LaunchPlan {
            args: Vec::new(),
            rdp_file_content: None,
            rdp_file_path: None,
            cleanup_path: None,
            warnings: vec![
                "Windows 嵌入式模式使用 MSTSC ActiveX 原生宿主，不通过命令行传递密码。".to_string(),
            ],
        }),
        RdpRunnerKind::Mstsc => build_mstsc_plan(app, resolved, preview),
        RdpRunnerKind::Freerdp => build_freerdp_plan(resolved),
        RdpRunnerKind::Custom => build_custom_plan(app, resolved, preview),
        RdpRunnerKind::MacosApp => Err(AppError::new(
            "rdp_runner_unsupported",
            "该 RDP runner 暂未启用。",
            format!("runner={:?}", selected.runner),
            true,
        )),
    }
}

fn build_mstsc_plan(
    app: &AppHandle,
    resolved: &ResolvedRdpConnection,
    preview: bool,
) -> Result<LaunchPlan, AppError> {
    let content = serialize_rdp_file(&resolved.profile, &resolved.rdp)?;
    if preview {
        return Ok(LaunchPlan {
            args: vec!["<temp.rdp>".to_string()],
            rdp_file_content: Some(content),
            rdp_file_path: None,
            cleanup_path: None,
            warnings: Vec::new(),
        });
    }
    let path = write_temp_rdp_file(app, &resolved.profile.id, &content)?;
    Ok(LaunchPlan {
        args: vec![path.to_string_lossy().to_string()],
        rdp_file_content: None,
        rdp_file_path: Some(path.clone()),
        cleanup_path: Some(path),
        warnings: Vec::new(),
    })
}

fn build_freerdp_plan(resolved: &ResolvedRdpConnection) -> Result<LaunchPlan, AppError> {
    let mut args = vec![
        format!("/v:{}:{}", resolved.profile.host, resolved.profile.port),
        format!("/u:{}", resolved.profile.username),
    ];
    if let Some(domain) = resolved.rdp.domain.as_deref() {
        args.push(format!("/d:{domain}"));
    }
    if resolved.rdp.display.dynamic_resize {
        args.push("/dynamic-resolution".to_string());
    } else if let (Some(width), Some(height)) =
        (resolved.rdp.display.width, resolved.rdp.display.height)
    {
        args.push(format!("/size:{}x{}", width, height));
    }
    if resolved.rdp.resources.clipboard {
        args.push("/clipboard".to_string());
    }
    if resolved.rdp.display.use_multimon {
        args.push("/multimon".to_string());
    }
    match resolved.rdp.resources.audio {
        RdpAudioMode::Local => args.push("/sound".to_string()),
        RdpAudioMode::Remote => args.push("/audio-mode:1".to_string()),
        RdpAudioMode::Disabled => args.push("/audio-mode:2".to_string()),
    }
    if resolved.rdp.resources.drives {
        args.push("/drive:home,~".to_string());
    }
    if let Some(raw) = resolved.rdp.raw_runner_args.as_deref() {
        args.extend(split_runner_args(raw)?);
    }

    Ok(LaunchPlan {
        args,
        rdp_file_content: None,
        rdp_file_path: None,
        cleanup_path: None,
        warnings: vec![
            "外部 FreeRDP runner 将自行提示凭据，MXterm 不会通过命令行传递密码。".to_string(),
        ],
    })
}

fn build_custom_plan(
    app: &AppHandle,
    resolved: &ResolvedRdpConnection,
    preview: bool,
) -> Result<LaunchPlan, AppError> {
    let content = serialize_rdp_file(&resolved.profile, &resolved.rdp)?;
    let template = resolved
        .rdp
        .runner
        .custom_args_template
        .as_deref()
        .unwrap_or("{rdp_file}");
    let path = if preview {
        PathBuf::from("<temp.rdp>")
    } else {
        write_temp_rdp_file(app, &resolved.profile.id, &content)?
    };
    let rendered = template
        .replace("{rdp_file}", &path.to_string_lossy())
        .replace("{host}", &resolved.profile.host)
        .replace("{port}", &resolved.profile.port.to_string())
        .replace("{username}", &resolved.profile.username)
        .replace(
            "{domain}",
            resolved.rdp.domain.as_deref().unwrap_or_default(),
        );
    let args = split_runner_args(&rendered)?;
    Ok(LaunchPlan {
        args,
        rdp_file_content: preview.then_some(content),
        rdp_file_path: (!preview).then_some(path.clone()),
        cleanup_path: (!preview).then_some(path),
        warnings: vec!["自定义 runner 参数模板已禁用密码占位符，请让客户端提示凭据。".to_string()],
    })
}

fn serialize_rdp_file(
    profile: &ConnectionProfile,
    rdp: &RdpConnectionConfig,
) -> Result<String, AppError> {
    let mut lines = Vec::new();
    let experience = rdp_experience_settings(&rdp.performance);
    lines.push(format!("full address:s:{}:{}", profile.host, profile.port));
    lines.push(format!("username:s:{}", profile.username));
    if let Some(domain) = rdp.domain.as_deref() {
        lines.push(format!("domain:s:{domain}"));
    }
    lines.push(format!(
        "screen mode id:i:{}",
        if matches!(
            rdp.display.mode,
            RdpDisplayMode::Fullscreen | RdpDisplayMode::AllMonitors
        ) {
            2
        } else {
            1
        }
    ));
    if let Some(width) = rdp.display.width {
        lines.push(format!("desktopwidth:i:{width}"));
    }
    if let Some(height) = rdp.display.height {
        lines.push(format!("desktopheight:i:{height}"));
    }
    lines.push(format!(
        "use multimon:i:{}",
        if rdp.display.use_multimon { 1 } else { 0 }
    ));
    lines.push(format!("session bpp:i:{}", experience.session_bpp));
    lines.push(format!("connection type:i:{}", experience.connection_type));
    lines.push("networkautodetect:i:0".to_string());
    lines.push("bandwidthautodetect:i:0".to_string());
    lines.push(format!(
        "disable wallpaper:i:{}",
        bool_i32(experience.disable_wallpaper)
    ));
    lines.push(format!(
        "allow font smoothing:i:{}",
        bool_i32(experience.allow_font_smoothing)
    ));
    lines.push(format!(
        "allow desktop composition:i:{}",
        bool_i32(experience.allow_desktop_composition)
    ));
    lines.push(format!(
        "disable full window drag:i:{}",
        bool_i32(experience.disable_full_window_drag)
    ));
    lines.push(format!(
        "disable menu anims:i:{}",
        bool_i32(experience.disable_menu_anims)
    ));
    lines.push(format!(
        "disable themes:i:{}",
        bool_i32(experience.disable_themes)
    ));
    lines.push(format!(
        "disable cursor setting:i:{}",
        bool_i32(experience.disable_cursor_setting)
    ));
    lines.push("bitmapcachepersistenable:i:1".to_string());
    lines.push(format!(
        "redirectclipboard:i:{}",
        if rdp.resources.clipboard { 1 } else { 0 }
    ));
    lines.push(format!(
        "audiomode:i:{}",
        match rdp.resources.audio {
            RdpAudioMode::Local => 0,
            RdpAudioMode::Remote => 1,
            RdpAudioMode::Disabled => 2,
        }
    ));
    lines.push(format!(
        "redirectdrives:i:{}",
        if rdp.resources.drives { 1 } else { 0 }
    ));
    lines.push(format!(
        "redirectprinters:i:{}",
        if rdp.resources.printers { 1 } else { 0 }
    ));
    lines.push(format!(
        "redirectsmartcards:i:{}",
        if rdp.resources.smart_cards { 1 } else { 0 }
    ));
    lines.push(format!(
        "enablecredsspsupport:i:{}",
        match rdp.security.nla {
            RdpNetworkLevelAuthentication::Disabled => 0,
            RdpNetworkLevelAuthentication::Auto | RdpNetworkLevelAuthentication::Enabled => 1,
        }
    ));
    lines.push(format!(
        "authentication level:i:{}",
        match rdp.security.certificate_policy {
            RdpCertificatePolicy::Trust => 0,
            RdpCertificatePolicy::Strict => 1,
            RdpCertificatePolicy::Prompt => 2,
        }
    ));
    lines.push("prompt for credentials:i:1".to_string());
    if let Some(gateway) = rdp.gateway.as_ref() {
        if let Some(host) = gateway.host.as_deref() {
            lines.push(format!("gatewayhostname:s:{host}"));
        }
        lines.push(format!(
            "gatewayusagemethod:i:{}",
            match gateway.mode {
                RdpGatewayMode::Disabled => 0,
                RdpGatewayMode::Explicit => 1,
                RdpGatewayMode::Auto => 2,
            }
        ));
        lines.push("gatewaycredentialssource:i:4".to_string());
    }
    if rdp.remote_app.enabled {
        lines.push("remoteapplicationmode:i:1".to_string());
        if let Some(program) = rdp.remote_app.program.as_deref() {
            lines.push(format!("remoteapplicationprogram:s:{program}"));
        }
        if let Some(working_dir) = rdp.remote_app.working_dir.as_deref() {
            lines.push(format!("remoteapplicationcmdline:s:{working_dir}"));
        }
        if let Some(args) = rdp.remote_app.args.as_deref() {
            lines.push(format!("remoteapplicationexpandcmdline:s:{args}"));
        }
    }
    if let Some(raw) = rdp.raw_rdp_settings.as_deref() {
        lines.extend(
            raw.lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty()),
        );
    }
    Ok(format!("{}\r\n", lines.join("\r\n")))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RdpExperienceSettings {
    session_bpp: u16,
    connection_type: u8,
    allow_font_smoothing: bool,
    allow_desktop_composition: bool,
    disable_full_window_drag: bool,
    disable_menu_anims: bool,
    disable_themes: bool,
    disable_wallpaper: bool,
    disable_cursor_setting: bool,
}

impl RdpExperienceSettings {
    #[cfg(windows)]
    fn performance_flags(self) -> i32 {
        let mut flags = 0i32;
        if self.disable_wallpaper {
            flags |= 0x0000_0001;
        }
        if self.disable_full_window_drag {
            flags |= 0x0000_0002;
        }
        if self.disable_menu_anims {
            flags |= 0x0000_0004;
        }
        if self.disable_themes {
            flags |= 0x0000_0008;
        }
        if self.disable_cursor_setting {
            flags |= 0x0000_0040;
        }
        if self.allow_font_smoothing {
            flags |= 0x0000_0080;
        }
        if self.allow_desktop_composition {
            flags |= 0x0000_0100;
        }
        flags
    }
}

fn rdp_experience_settings(performance: &RdpPerformanceConfig) -> RdpExperienceSettings {
    let allow_font_smoothing = performance.font_smoothing;
    let allow_desktop_composition = performance.visual_styles;
    let disable_themes = !performance.visual_styles;
    let disable_wallpaper = !performance.desktop_background;

    match performance.preset {
        RdpPerformancePreset::LowBandwidth => RdpExperienceSettings {
            session_bpp: 16,
            connection_type: 2,
            allow_font_smoothing,
            allow_desktop_composition: false,
            disable_full_window_drag: true,
            disable_menu_anims: true,
            disable_themes: true,
            disable_wallpaper: true,
            disable_cursor_setting: true,
        },
        RdpPerformancePreset::Balanced => RdpExperienceSettings {
            session_bpp: 24,
            connection_type: 3,
            allow_font_smoothing,
            allow_desktop_composition,
            disable_full_window_drag: true,
            disable_menu_anims: true,
            disable_themes,
            disable_wallpaper,
            disable_cursor_setting: true,
        },
        RdpPerformancePreset::Auto | RdpPerformancePreset::Lan => RdpExperienceSettings {
            session_bpp: 32,
            connection_type: 7,
            allow_font_smoothing,
            allow_desktop_composition,
            disable_full_window_drag: false,
            disable_menu_anims: false,
            disable_themes,
            disable_wallpaper,
            disable_cursor_setting: false,
        },
    }
}

fn bool_i32(value: bool) -> i32 {
    if value {
        1
    } else {
        0
    }
}

fn write_temp_rdp_file(
    app: &AppHandle,
    connection_id: &str,
    content: &str,
) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| {
            AppError::new(
                "rdp_temp_path_failed",
                "RDP 临时目录获取失败。",
                error,
                true,
            )
        })?
        .join("rdp");
    fs::create_dir_all(&dir).map_err(|error| {
        AppError::new(
            "rdp_temp_write_failed",
            "RDP 临时目录创建失败。",
            error,
            true,
        )
    })?;
    let file_name = format!(
        "{}-{}.rdp",
        sanitize_file_stem(connection_id),
        uuid::Uuid::new_v4()
    );
    let path = dir.join(file_name);
    fs::write(&path, content).map_err(|error| {
        AppError::new(
            "rdp_temp_write_failed",
            "RDP 临时文件写入失败。",
            error,
            true,
        )
    })?;
    Ok(path)
}

fn sanitize_file_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if stem.is_empty() {
        "connection".to_string()
    } else {
        stem
    }
}

fn schedule_temp_file_cleanup(path: PathBuf) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let _ = tokio::fs::remove_file(path).await;
    });
}

fn split_runner_args(value: &str) -> Result<Vec<String>, AppError> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        match quote {
            Some(active) if ch == active => quote = None,
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    reject_secret_arg(&current)?;
                    args.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }
    if quote.is_some() {
        return Err(AppError::new(
            "rdp_runner_args_invalid",
            "RDP runner 参数引号未闭合。",
            "unterminated quote",
            true,
        ));
    }
    if !current.is_empty() {
        reject_secret_arg(&current)?;
        args.push(current);
    }
    Ok(args)
}

fn reject_secret_arg(value: &str) -> Result<(), AppError> {
    let lowered = value.to_ascii_lowercase();
    for forbidden in ["password", "passwd", "/p:", "/pass:"] {
        if lowered.contains(forbidden) {
            return Err(AppError::new(
                "rdp_runner_args_secret_forbidden",
                "RDP runner 参数不能包含密码字段。",
                format!("arg contains {forbidden}"),
                true,
            ));
        }
    }
    Ok(())
}

fn current_platform() -> RdpPlatform {
    match env::consts::OS {
        "windows" => RdpPlatform::Windows,
        "linux" => RdpPlatform::Linux,
        "macos" => RdpPlatform::Macos,
        _ => RdpPlatform::Unknown,
    }
}

fn find_windows_mstsc() -> Option<PathBuf> {
    if let Some(path) = find_first_executable(&["mstsc.exe", "mstsc"]) {
        return Some(path);
    }
    env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32").join("mstsc.exe"))
        .filter(|path| path.is_file())
}

fn find_windows_mstscax() -> Option<PathBuf> {
    env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32").join("mstscax.dll"))
        .filter(|path| path.is_file())
        .or_else(|| find_first_executable(&["mstscax.dll"]))
}

fn find_custom_executable(value: &str) -> Option<PathBuf> {
    let path = PathBuf::from(value);
    if path.is_file() {
        return Some(path);
    }
    find_first_executable(&[value])
}

fn find_first_executable(names: &[&str]) -> Option<PathBuf> {
    names.iter().find_map(|name| find_executable(name))
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.components().count() > 1 && path.is_file() {
        return Some(path.to_path_buf());
    }
    let path_exts = executable_extensions();
    let path_value = env::var_os("PATH")?;
    env::split_paths(&path_value)
        .flat_map(|dir| candidate_executables(&dir, name, &path_exts))
        .find(|candidate| candidate.is_file())
}

fn executable_extensions() -> Vec<OsString> {
    if cfg!(windows) {
        env::var_os("PATHEXT")
            .map(|value| {
                env::split_paths(&value)
                    .map(|item| item.into_os_string())
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
            .unwrap_or_else(|| {
                vec![
                    OsString::from(".EXE"),
                    OsString::from(".BAT"),
                    OsString::from(".CMD"),
                ]
            })
    } else {
        vec![OsString::new()]
    }
}

fn candidate_executables(dir: &Path, name: &str, extensions: &[OsString]) -> Vec<PathBuf> {
    let base = dir.join(name);
    if Path::new(name).extension().is_some() || !cfg!(windows) {
        return vec![base];
    }
    extensions
        .iter()
        .map(|extension| {
            let mut candidate = base.clone().into_os_string();
            candidate.push(extension);
            PathBuf::from(candidate)
        })
        .collect()
}

struct HostedRdpSession {
    hwnd: isize,
    session_hwnd: Option<isize>,
    parent_hwnd: Option<isize>,
    command_rx_ptr: Option<usize>,
    atl_ptr: Option<isize>,
}

#[cfg(windows)]
#[derive(Clone)]
struct ActiveXRdpConfig {
    title: String,
    host: String,
    port: u16,
    username: String,
    domain: Option<String>,
    width: u32,
    height: u32,
    dynamic_resize: bool,
    use_multimon: bool,
    desktop_scale_factor: u32,
    clipboard: bool,
    audio: RdpAudioMode,
    drives: bool,
    printers: bool,
    smart_cards: bool,
    nla: RdpNetworkLevelAuthentication,
    certificate_policy: RdpCertificatePolicy,
    performance: RdpPerformanceConfig,
    gateway_mode: Option<RdpGatewayMode>,
    gateway_host: Option<String>,
    password: Option<String>,
    rdp_file_content: String,
}

#[cfg(windows)]
impl ActiveXRdpConfig {
    fn from_resolved(
        resolved: &ResolvedRdpConnection,
        bounds: Option<&RdpEmbeddedBounds>,
    ) -> Result<Self, AppError> {
        let fallback_width = bounds.map(|item| item.width).unwrap_or(1440);
        let fallback_height = bounds.map(|item| item.height).unwrap_or(900);
        let width = resolved
            .rdp
            .display
            .width
            .map(u32::from)
            .unwrap_or(fallback_width);
        let height = resolved
            .rdp
            .display
            .height
            .map(u32::from)
            .unwrap_or(fallback_height);
        let mut rdp_for_host = resolved.rdp.clone();
        rdp_for_host.display.width = Some(width.min(u16::MAX as u32) as u16);
        rdp_for_host.display.height = Some(height.min(u16::MAX as u32) as u16);
        let rdp_file_content = serialize_rdp_file(&resolved.profile, &rdp_for_host)?;

        Ok(Self {
            title: format!(
                "MXterm RDP - {}",
                if resolved.profile.name.trim().is_empty() {
                    resolved.profile.host.as_str()
                } else {
                    resolved.profile.name.as_str()
                }
            ),
            host: resolved.profile.host.clone(),
            port: resolved.profile.port,
            username: resolved.profile.username.clone(),
            domain: resolved.rdp.domain.clone(),
            width,
            height,
            dynamic_resize: resolved.rdp.display.dynamic_resize,
            use_multimon: resolved.rdp.display.use_multimon
                || matches!(resolved.rdp.display.mode, RdpDisplayMode::AllMonitors),
            desktop_scale_factor: 100,
            clipboard: resolved.rdp.resources.clipboard,
            audio: resolved.rdp.resources.audio.clone(),
            drives: resolved.rdp.resources.drives,
            printers: resolved.rdp.resources.printers,
            smart_cards: resolved.rdp.resources.smart_cards,
            nla: resolved.rdp.security.nla.clone(),
            certificate_policy: resolved.rdp.security.certificate_policy.clone(),
            performance: resolved.rdp.performance.clone(),
            gateway_mode: resolved
                .rdp
                .gateway
                .as_ref()
                .map(|gateway| gateway.mode.clone()),
            gateway_host: resolved
                .rdp
                .gateway
                .as_ref()
                .and_then(|gateway| gateway.host.clone()),
            password: resolved.password.clone(),
            rdp_file_content,
        })
    }
}

#[cfg(windows)]
fn native_session_window_bounds(
    owner_hwnd: windows::Win32::Foundation::HWND,
    config: &ActiveXRdpConfig,
    bounds: Option<&RdpEmbeddedBounds>,
) -> RdpEmbeddedBounds {
    let width = config.width.max(640);
    let height = rdp_outer_height_for_content_height_dpi(
        config.height.max(480) as i32,
        window_dpi_for_window(owner_hwnd),
    ) as u32;
    if let Some(bounds) = bounds {
        return RdpEmbeddedBounds {
            x: bounds.x,
            y: bounds.y,
            width,
            height,
        };
    }

    RdpEmbeddedBounds {
        x: i32::MIN,
        y: i32::MIN,
        width,
        height,
    }
}

#[cfg(windows)]
async fn host_activex_session(
    app: &AppHandle,
    manager: &RdpSessionManager,
    session_id: String,
    resolved: &ResolvedRdpConnection,
    bounds: Option<&RdpEmbeddedBounds>,
) -> Result<HostedRdpSession, AppError> {
    let owner = main_window_hwnd(app)?;
    let config = ActiveXRdpConfig::from_resolved(resolved, bounds)?;
    let bounds = native_session_window_bounds(owner, &config, bounds);
    let owner_hwnd = owner.0 as isize;

    if let Some(host) = manager.native_host_for_owner(owner_hwnd)? {
        let (response_tx, response_rx) = mpsc::sync_channel(1);
        let command_rx = host.command_rx_ptr;
        let atl = host.atl_ptr;
        host.command_tx
            .send(NativeRdpHostCommand::AddSession {
                session_id,
                config,
                response: response_tx,
            })
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_host_unavailable",
                    "RDP ActiveX 原生宿主不可用。",
                    error,
                    true,
                )
            })?;
        post_native_host_command_message(host.hwnd, command_rx, atl);
        return response_rx
            .recv_timeout(Duration::from_secs(12))
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_start_timeout",
                    "RDP ActiveX 宿主启动超时。",
                    error,
                    true,
                )
            })?;
    }

    let (tx, rx) = mpsc::sync_channel(1);
    let (command_tx, command_rx) = mpsc::channel();
    let host_app = app.clone();

    std::thread::Builder::new()
        .name("mxterm-rdp-host".to_string())
        .spawn(move || {
            if let Err(error) = run_activex_host(
                host_app,
                owner_hwnd,
                bounds,
                session_id,
                config,
                command_rx,
                tx.clone(),
            ) {
                let _ = tx.send(Err(error));
            }
        })
        .map_err(|error| {
            AppError::new(
                "rdp_activex_thread_failed",
                "RDP ActiveX 宿主线程创建失败。",
                error,
                true,
            )
        })?;

    let hosted = rx.recv_timeout(Duration::from_secs(12)).map_err(|error| {
        AppError::new(
            "rdp_activex_start_timeout",
            "RDP ActiveX 宿主启动超时。",
            error,
            true,
        )
    })??;
    let command_rx_ptr = hosted.command_rx_ptr.ok_or_else(|| {
        AppError::new(
            "rdp_activex_host_unavailable",
            "RDP ActiveX 原生宿主不可用。",
            "host command receiver pointer missing",
            true,
        )
    })?;
    let atl_ptr = hosted.atl_ptr.ok_or_else(|| {
        AppError::new(
            "rdp_activex_host_unavailable",
            "RDP ActiveX 原生宿主不可用。",
            "host ATL pointer missing",
            true,
        )
    })?;
    manager.set_native_host(NativeRdpHostHandle {
        hwnd: hosted.hwnd,
        owner_hwnd,
        command_tx,
        command_rx_ptr,
        atl_ptr,
    })?;
    Ok(hosted)
}

#[cfg(not(windows))]
async fn host_activex_session(
    _app: &AppHandle,
    _manager: &RdpSessionManager,
    _session_id: String,
    _resolved: &ResolvedRdpConnection,
    _bounds: Option<&RdpEmbeddedBounds>,
) -> Result<HostedRdpSession, AppError> {
    Err(AppError::new(
        "rdp_embedded_unsupported",
        "当前平台不支持嵌入式 RDP 宿主。",
        "windows-only mstsc ActiveX path",
        true,
    ))
}

#[cfg(windows)]
fn close_hosted_window(manager: &RdpSessionManager, hwnd: isize, session_id: &str) {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

    if let Ok(Some(host)) = manager.native_host_by_hwnd(hwnd) {
        if host.hwnd == hwnd {
            let _ = host.command_tx.send(NativeRdpHostCommand::CloseSession {
                session_id: session_id.to_string(),
            });
            post_native_host_command_message(host.hwnd, host.command_rx_ptr, host.atl_ptr);
            return;
        }
    }

    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    unsafe {
        let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
    let _ = manager.clear_native_host_if(hwnd.0 as isize);
}

#[cfg(not(windows))]
fn close_hosted_window(_manager: &RdpSessionManager, _hwnd: isize, _session_id: &str) {}

#[cfg(windows)]
fn resize_hosted_window(
    manager: &RdpSessionManager,
    hwnd: isize,
    parent_hwnd: Option<isize>,
    bounds: &RdpEmbeddedBounds,
) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SET_WINDOW_POS_FLAGS, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
    };

    if let Ok(Some(host)) = manager.native_host_by_hwnd(hwnd) {
        if host.hwnd == hwnd {
            let _ = host.command_tx.send(NativeRdpHostCommand::Resize {
                bounds: bounds.clone(),
            });
            post_native_host_command_message(host.hwnd, host.command_rx_ptr, host.atl_ptr);
            return;
        }
    }

    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    let _ = (parent_hwnd, bounds);
    let width = safe_i32(bounds.width.max(120));
    let height = safe_i32(bounds.height.max(90));
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            bounds.x,
            bounds.y,
            width,
            height,
            SET_WINDOW_POS_FLAGS(SWP_NOOWNERZORDER.0 | SWP_SHOWWINDOW.0),
        );
    }
}

#[cfg(not(windows))]
fn resize_hosted_window(
    _manager: &RdpSessionManager,
    _hwnd: isize,
    _parent_hwnd: Option<isize>,
    _bounds: &RdpEmbeddedBounds,
) {
}

#[cfg(windows)]
fn post_native_host_command_message(hwnd: isize, command_rx_ptr: usize, atl_ptr: isize) {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    unsafe {
        let _ = PostMessageW(
            Some(hwnd),
            MX_RDP_HOST_PROCESS_COMMANDS,
            WPARAM(command_rx_ptr),
            LPARAM(atl_ptr),
        );
    }
}

#[cfg(windows)]
fn main_window_hwnd(app: &AppHandle) -> Result<windows::Win32::Foundation::HWND, AppError> {
    use windows::Win32::UI::WindowsAndMessaging::GetParent;

    let window = app.get_webview_window("main").ok_or_else(|| {
        AppError::new(
            "rdp_main_window_missing",
            "主窗口不可用，无法创建嵌入式 RDP 宿主。",
            "main window not found",
            true,
        )
    })?;
    let mut hwnd = window.hwnd().map_err(|error| {
        AppError::new(
            "rdp_main_window_handle_failed",
            "主窗口句柄获取失败，无法创建嵌入式 RDP 宿主。",
            error.to_string(),
            true,
        )
    })?;

    unsafe {
        while let Ok(parent) = GetParent(hwnd) {
            if parent.is_invalid() {
                break;
            }
            hwnd = parent;
        }
    }

    Ok(hwnd)
}

#[cfg(windows)]
struct ActiveXHostWindowState {
    app: AppHandle,
    sessions: Vec<ActiveXHostSession>,
    resize_grips: Vec<NativeHostResizeGrip>,
    active_index: usize,
    login_resize_ticks_remaining: u32,
    chrome_hot_button: Option<RdpHostChromeButton>,
    chrome_pressed_button: Option<RdpHostChromeButton>,
    chrome_hot_tab_close: Option<usize>,
    chrome_pressed_tab_close: Option<usize>,
}

#[cfg(windows)]
struct NativeHostResizeGrip {
    hwnd: windows::Win32::Foundation::HWND,
    kind: NativeHostResizeGripKind,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
enum NativeHostResizeGripKind {
    Left,
    Right,
    Bottom,
    BottomLeft,
    BottomRight,
}

#[cfg(windows)]
struct ActiveXHostSession {
    session_id: String,
    title: String,
    control_hwnd: windows::Win32::Foundation::HWND,
    client: HostedActiveXClient,
    dynamic_resize: bool,
    last_width: u32,
    last_height: u32,
    last_scale_factor: u32,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RdpHostChromeButton {
    Minimize,
    Maximize,
    Close,
}

#[cfg(windows)]
fn process_native_host_commands(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    command_rx: &Receiver<NativeRdpHostCommand>,
    atl: &AtlAxHost,
) -> bool {
    let mut keep_running = true;
    while let Ok(command) = command_rx.try_recv() {
        match command {
            NativeRdpHostCommand::AddSession {
                session_id,
                mut config,
                response,
            } => {
                config.desktop_scale_factor = desktop_scale_factor_for_window(hwnd);
                let result = add_activex_host_session(hwnd, state, atl, session_id, config);
                let _ = response.send(result);
            }
            NativeRdpHostCommand::CloseSession { session_id } => {
                close_activex_host_session(hwnd, state, &session_id, false);
                keep_running = !state.sessions.is_empty();
            }
            NativeRdpHostCommand::Resize { bounds } => {
                resize_activex_host_window(hwnd, &bounds);
            }
        }
    }
    keep_running
}

#[cfg(windows)]
fn prepare_activex_config_for_viewport(
    hwnd: windows::Win32::Foundation::HWND,
    config: &mut ActiveXRdpConfig,
    width: i32,
    height: i32,
) {
    config.desktop_scale_factor = desktop_scale_factor_for_window(hwnd);
    if !config.dynamic_resize || width <= 0 || height <= 0 {
        return;
    }
    let width = width as u32;
    let height = height as u32;
    config.width = width;
    config.height = height;
    config.rdp_file_content =
        rdp_file_content_with_display_size(&config.rdp_file_content, width, height);
}

#[cfg(windows)]
fn rdp_file_content_with_display_size(content: &str, width: u32, height: u32) -> String {
    let mut lines = content
        .lines()
        .filter(|line| !is_rdp_display_dimension_line(line))
        .map(str::to_string)
        .collect::<Vec<_>>();
    lines.push(format!("desktopwidth:i:{width}"));
    lines.push(format!("desktopheight:i:{height}"));
    format!("{}\r\n", lines.join("\r\n"))
}

#[cfg(windows)]
fn is_rdp_display_dimension_line(line: &str) -> bool {
    let line = line.trim_start();
    line.get(.."desktopwidth:i:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("desktopwidth:i:"))
        || line
            .get(.."desktopheight:i:".len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("desktopheight:i:"))
}

#[cfg(windows)]
fn schedule_activex_login_resize(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
) {
    use windows::Win32::UI::WindowsAndMessaging::SetTimer;

    state.login_resize_ticks_remaining = state
        .login_resize_ticks_remaining
        .max(MX_RDP_LOGIN_RESIZE_TICKS);
    unsafe {
        let _ = SetTimer(
            Some(hwnd),
            MX_RDP_LOGIN_RESIZE_TIMER_ID,
            MX_RDP_LOGIN_RESIZE_INTERVAL_MS,
            None,
        );
    }
}

#[cfg(windows)]
fn add_activex_host_session(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    atl: &AtlAxHost,
    session_id: String,
    mut config: ActiveXRdpConfig,
) -> Result<HostedRdpSession, AppError> {
    use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;

    let (width, height) = rdp_content_size_for_window(hwnd).unwrap_or((800, 600));
    prepare_activex_config_for_viewport(hwnd, &mut config, width, height);
    let control = create_configured_activex_control(atl, hwnd, width, height, &config)?;
    install_activex_resize_subclasses(control.hwnd, hwnd);
    let session = ActiveXHostSession {
        session_id: session_id.clone(),
        title: rdp_tab_title(&config),
        control_hwnd: control.hwnd,
        client: control.client.clone(),
        dynamic_resize: config.dynamic_resize,
        last_width: 0,
        last_height: 0,
        last_scale_factor: 0,
    };
    if let Err(error) = connect_activex_client(&session.client) {
        unsafe {
            remove_activex_resize_subclasses(control.hwnd);
            let _ = DestroyWindow(control.hwnd);
        }
        return Err(with_activex_control_context(control.name, "connect", error));
    }

    state.sessions.push(session);
    state.active_index = state.sessions.len().saturating_sub(1);
    layout_activex_host_sessions(hwnd, state, true);
    update_native_host_title(hwnd, state);
    invalidate_activex_host_window(hwnd);
    schedule_activex_login_resize(hwnd, state);

    Ok(HostedRdpSession {
        hwnd: hwnd.0 as isize,
        session_hwnd: Some(control.hwnd.0 as isize),
        parent_hwnd: None,
        command_rx_ptr: None,
        atl_ptr: None,
    })
}

#[cfg(windows)]
fn close_activex_host_session(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    session_id: &str,
    emit_closed: bool,
) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyWindow, PostMessageW, WM_CLOSE};

    let Some(index) = state
        .sessions
        .iter()
        .position(|session| session.session_id == session_id)
    else {
        return;
    };
    let session = state.sessions.remove(index);
    let closed_session_id = session.session_id.clone();
    let previous_active_index = state.active_index;
    let _ = disconnect_activex_client(&session.client);
    unsafe {
        remove_activex_resize_subclasses(session.control_hwnd);
        let _ = DestroyWindow(session.control_hwnd);
    }
    if emit_closed {
        emit_rdp_session_closed(&state.app, closed_session_id);
    }
    if !state.sessions.is_empty() {
        state.active_index = if index < previous_active_index {
            previous_active_index.saturating_sub(1)
        } else {
            previous_active_index.min(state.sessions.len().saturating_sub(1))
        };
        layout_activex_host_sessions(hwnd, state, true);
        update_native_host_title(hwnd, state);
        invalidate_activex_host_window(hwnd);
    }
    if state.sessions.is_empty() {
        update_native_host_title(hwnd, state);
        invalidate_activex_host_window(hwnd);
        if emit_closed {
            unsafe {
                let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
    }
}

#[cfg(windows)]
fn emit_rdp_session_closed(app: &AppHandle, session_id: String) {
    let _ = app.emit(
        crate::events::RDP_SESSION_CLOSED,
        crate::events::RdpSessionClosedEvent { session_id },
    );
}

#[cfg(windows)]
fn activate_activex_tab(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    index: usize,
) {
    if index < state.sessions.len() {
        state.active_index = index;
        layout_activex_host_sessions(hwnd, state, true);
        update_native_host_title(hwnd, state);
        invalidate_activex_host_window(hwnd);
    }
}

#[cfg(windows)]
fn layout_activex_host_sessions(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    force_display_sync: bool,
) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_TOP, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOZORDER,
        SW_HIDE, SW_SHOW,
    };

    let Some((client_x, content_y, content_width, content_height)) =
        rdp_content_rect_for_window(hwnd)
    else {
        return;
    };
    let active_index = state.active_index;
    for (index, session) in state.sessions.iter_mut().enumerate() {
        let visible = index == active_index;
        unsafe {
            let _ = SetWindowPos(
                session.control_hwnd,
                Some(HWND_TOP),
                client_x,
                content_y,
                content_width,
                content_height,
                SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_NOZORDER.0),
            );
            let _ = ShowWindow(
                session.control_hwnd,
                if visible { SW_SHOW } else { SW_HIDE },
            );
        }
        if visible {
            install_activex_resize_subclasses(session.control_hwnd, hwnd);
            sync_activex_session_display(hwnd, session, force_display_sync);
        }
    }
    layout_native_host_resize_grips(hwnd, &state.resize_grips);
    update_native_host_title(hwnd, state);
}

#[cfg(windows)]
fn resize_activex_host_window(hwnd: windows::Win32::Foundation::HWND, bounds: &RdpEmbeddedBounds) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SET_WINDOW_POS_FLAGS, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
    };

    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            bounds.x,
            bounds.y,
            safe_i32(bounds.width.max(120)),
            rdp_outer_height_for_content_height(safe_i32(bounds.height.max(90)), hwnd),
            SET_WINDOW_POS_FLAGS(SWP_NOOWNERZORDER.0 | SWP_SHOWWINDOW.0),
        );
    }
}

#[cfg(windows)]
fn rdp_tab_title(config: &ActiveXRdpConfig) -> String {
    let title = config
        .title
        .strip_prefix("MXterm RDP - ")
        .unwrap_or(config.title.as_str())
        .trim();
    if title.is_empty() {
        config.host.clone()
    } else {
        title.to_string()
    }
}

#[cfg(windows)]
fn run_activex_host(
    app: AppHandle,
    owner_hwnd: isize,
    bounds: RdpEmbeddedBounds,
    session_id: String,
    mut config: ActiveXRdpConfig,
    command_rx: Receiver<NativeRdpHostCommand>,
    started: SyncSender<Result<HostedRdpSession, AppError>>,
) -> Result<(), AppError> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW,
        RegisterClassW, SetWindowLongPtrW, TranslateMessage, WINDOW_EX_STYLE, WNDCLASSW,
        WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    let owner = HWND(owner_hwnd as *mut std::ffi::c_void);
    let coinit = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
    if coinit.is_err() {
        return Err(activex_error(
            "rdp_activex_com_init_failed",
            "RDP ActiveX COM 初始化失败。",
            coinit,
        ));
    }

    let run_result = (|| {
        let atl = load_atl_host()?;
        unsafe {
            if !(atl.init)().as_bool() {
                return Err(AppError::new(
                    "rdp_activex_atl_init_failed",
                    "RDP ActiveX ATL 宿主初始化失败。",
                    "AtlAxWinInit returned false",
                    true,
                ));
            }
        }

        let class_name = to_wide_null("mXtermRdpActiveXHost");
        let instance = unsafe { GetModuleHandleW(None) }.map_err(|error| {
            AppError::new(
                "rdp_activex_module_failed",
                "RDP ActiveX 宿主模块句柄获取失败。",
                error.to_string(),
                true,
            )
        })?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(rdp_activex_host_wndproc),
            hInstance: instance.into(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        unsafe {
            let _ = RegisterClassW(&class);
        }

        let width = bounds.width.min(i32::MAX as u32) as i32;
        let height = bounds.height.min(i32::MAX as u32) as i32;
        let x = if bounds.x == i32::MIN {
            windows::Win32::UI::WindowsAndMessaging::CW_USEDEFAULT
        } else {
            bounds.x
        };
        let y = if bounds.y == i32::MIN {
            windows::Win32::UI::WindowsAndMessaging::CW_USEDEFAULT
        } else {
            bounds.y
        };
        let title = to_wide_null(&config.title);
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                x,
                y,
                width,
                height,
                Some(owner),
                None,
                Some(instance.into()),
                None::<*const c_void>,
            )
        }
        .map_err(|error| {
            AppError::new(
                "rdp_activex_window_failed",
                "RDP ActiveX 宿主窗口创建失败。",
                error.to_string(),
                true,
            )
        })?;
        configure_native_host_frame(hwnd);
        config.desktop_scale_factor = desktop_scale_factor_for_window(hwnd);
        let resize_grips = create_native_host_resize_grips(hwnd);

        let mut state = Box::new(ActiveXHostWindowState {
            app,
            sessions: Vec::new(),
            resize_grips,
            active_index: 0,
            login_resize_ticks_remaining: 0,
            chrome_hot_button: None,
            chrome_pressed_button: None,
            chrome_hot_tab_close: None,
            chrome_pressed_tab_close: None,
        });
        unsafe {
            SetWindowLongPtrW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA,
                {
                    let raw: *mut ActiveXHostWindowState = state.as_mut();
                    raw as isize
                },
            );
        }

        let hosted = add_activex_host_session(hwnd, state.as_mut(), &atl, session_id, config)?;
        let _ = started.send(Ok(HostedRdpSession {
            hwnd: hwnd.0 as isize,
            session_hwnd: hosted.session_hwnd,
            parent_hwnd: Some(owner_hwnd),
            command_rx_ptr: Some((&command_rx as *const Receiver<NativeRdpHostCommand>) as usize),
            atl_ptr: Some((&atl as *const AtlAxHost) as isize),
        }));

        unsafe {
            let _ = PostMessageW(
                Some(hwnd),
                MX_RDP_HOST_PROCESS_COMMANDS,
                windows::Win32::Foundation::WPARAM(
                    (&command_rx as *const Receiver<NativeRdpHostCommand>) as usize,
                ),
                windows::Win32::Foundation::LPARAM((&atl as *const AtlAxHost) as isize),
            );
            let mut message = windows::Win32::UI::WindowsAndMessaging::MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            let closing_session_ids = state
                .sessions
                .iter()
                .map(|session| session.session_id.clone())
                .collect::<Vec<_>>();
            for session in &state.sessions {
                let _ = disconnect_activex_client(&session.client);
                let _ = DestroyWindow(session.control_hwnd);
            }
            for session_id in closing_session_ids {
                emit_rdp_session_closed(&state.app, session_id);
            }
            let _ = DestroyWindow(hwnd);
            drop(state);
        }

        Ok(())
    })();

    unsafe {
        CoUninitialize();
    }

    run_result
}

#[cfg(windows)]
unsafe extern "system" fn rdp_activex_host_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Controls::WM_MOUSELEAVE;
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, GetWindowLongPtrW, KillTimer, PostQuitMessage, SetWindowLongPtrW,
        GWLP_USERDATA, HTCAPTION, WM_CAPTURECHANGED, WM_DPICHANGED, WM_ERASEBKGND,
        WM_GETMINMAXINFO, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
        WM_NCCALCSIZE, WM_NCDESTROY, WM_NCHITTEST, WM_NCLBUTTONDBLCLK, WM_PAINT, WM_SIZE, WM_TIMER,
    };

    if message == MX_RDP_HOST_PROCESS_COMMANDS {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() {
            let command_rx = wparam.0 as *const Receiver<NativeRdpHostCommand>;
            let atl = lparam.0 as *const AtlAxHost;
            if !command_rx.is_null()
                && !atl.is_null()
                && !process_native_host_commands(hwnd, &mut *state, &*command_rx, &*atl)
            {
                PostQuitMessage(0);
            }
        }
    } else if message == WM_NCCALCSIZE {
        if wparam.0 != 0 {
            adjust_native_host_maximized_client_rect(hwnd, lparam);
        }
        return windows::Win32::Foundation::LRESULT(0);
    } else if message == WM_NCHITTEST {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() {
            let result = hit_test_native_host(hwnd, &*state, lparam);
            if result.0 != 0 {
                return result;
            }
        }
    } else if message == WM_SIZE || message == WM_DPICHANGED {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() {
            layout_activex_host_sessions(hwnd, &mut *state, message == WM_DPICHANGED);
            invalidate_activex_host_window(hwnd);
        }
    } else if message == WM_GETMINMAXINFO {
        update_native_host_minmax_info(hwnd, lparam);
    } else if message == WM_MOUSEMOVE {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && update_native_host_hover_state(hwnd, &mut *state, lparam) {
            invalidate_activex_host_window(hwnd);
        }
    } else if message == WM_MOUSELEAVE {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && clear_native_host_hover_state(&mut *state) {
            invalidate_activex_host_window(hwnd);
        }
    } else if message == WM_CAPTURECHANGED {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && clear_native_host_press_state(&mut *state) {
            invalidate_activex_host_window(hwnd);
        }
    } else if message == WM_LBUTTONDOWN {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && handle_native_host_left_button_down(hwnd, &mut *state, lparam) {
            return windows::Win32::Foundation::LRESULT(0);
        }
    } else if message == WM_LBUTTONUP {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && handle_native_host_left_button_up(hwnd, &mut *state, lparam) {
            return windows::Win32::Foundation::LRESULT(0);
        }
    } else if message == WM_LBUTTONDBLCLK {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() && handle_native_host_left_double_click(hwnd, &mut *state, lparam) {
            return windows::Win32::Foundation::LRESULT(0);
        }
    } else if message == WM_NCLBUTTONDBLCLK {
        if wparam.0 as u32 == HTCAPTION {
            toggle_native_host_maximize(hwnd);
            return windows::Win32::Foundation::LRESULT(0);
        }
    } else if message == WM_TIMER && wparam.0 == MX_RDP_LOGIN_RESIZE_TIMER_ID {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() {
            layout_activex_host_sessions(hwnd, &mut *state, true);
            if (*state).login_resize_ticks_remaining > 0 {
                (*state).login_resize_ticks_remaining -= 1;
            }
            if (*state).login_resize_ticks_remaining == 0 {
                let _ = KillTimer(Some(hwnd), MX_RDP_LOGIN_RESIZE_TIMER_ID);
            }
        }
        return windows::Win32::Foundation::LRESULT(0);
    } else if message == WM_ERASEBKGND {
        return windows::Win32::Foundation::LRESULT(1);
    } else if message == WM_PAINT {
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ActiveXHostWindowState;
        if !state.is_null() {
            paint_native_host_window(hwnd, &*state);
            return windows::Win32::Foundation::LRESULT(0);
        }
    } else if message == WM_NCDESTROY {
        let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        PostQuitMessage(0);
    }

    DefWindowProcW(hwnd, message, wparam, lparam)
}

#[cfg(windows)]
struct AtlAxHost {
    init: unsafe extern "system" fn() -> windows::core::BOOL,
    get_control: unsafe extern "system" fn(
        windows::Win32::Foundation::HWND,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[derive(Clone)]
enum HostedActiveXClient {
    Modern(windows::Win32::System::RemoteDesktop::IRemoteDesktopClient),
    Classic(windows::Win32::System::Com::IDispatch),
}

#[cfg(windows)]
windows::core::imp::define_interface!(
    IMsTscNonScriptable,
    IMsTscNonScriptable_Vtbl,
    0xc1e6743a_41c1_4a74_832a_0dd06c1c7a0e
);

#[cfg(windows)]
windows::core::imp::interface_hierarchy!(IMsTscNonScriptable, windows::core::IUnknown);

#[cfg(windows)]
windows::core::imp::define_interface!(
    IMsRdpClientNonScriptable3,
    IMsRdpClientNonScriptable3_Vtbl,
    0xb3378d90_0728_45c7_8ed7_b6159fb92219
);

#[cfg(windows)]
windows::core::imp::interface_hierarchy!(
    IMsRdpClientNonScriptable3,
    windows::core::IUnknown,
    IMsTscNonScriptable
);

#[cfg(windows)]
windows::core::imp::define_interface!(
    IMsRdpClientNonScriptable4,
    IMsRdpClientNonScriptable4_Vtbl,
    0xf50fa8aa_1c7d_4f59_b15c_a90cacae1fcb
);

#[cfg(windows)]
windows::core::imp::interface_hierarchy!(
    IMsRdpClientNonScriptable4,
    windows::core::IUnknown,
    IMsTscNonScriptable,
    IMsRdpClientNonScriptable3
);

#[cfg(windows)]
windows::core::imp::define_interface!(
    IMsRdpClientNonScriptable5,
    IMsRdpClientNonScriptable5_Vtbl,
    0x4f6996d5_d7b1_412c_b0ff_063718566907
);

#[cfg(windows)]
windows::core::imp::interface_hierarchy!(
    IMsRdpClientNonScriptable5,
    windows::core::IUnknown,
    IMsTscNonScriptable,
    IMsRdpClientNonScriptable3,
    IMsRdpClientNonScriptable4
);

#[cfg(windows)]
#[repr(C)]
#[doc(hidden)]
#[allow(non_snake_case)]
pub struct IMsTscNonScriptable_Vtbl {
    pub base__: windows::core::IUnknown_Vtbl,
    pub ClearTextPassword: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub SetPortablePassword: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetPortablePassword: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub SetPortableSalt: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetPortableSalt: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub SetBinaryPassword: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetBinaryPassword: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub SetBinarySalt: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetBinarySalt: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub ResetPassword: unsafe extern "system" fn(*mut std::ffi::c_void) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[repr(C)]
#[doc(hidden)]
#[allow(non_snake_case)]
pub struct IMsRdpClientNonScriptable3_Vtbl {
    pub base__: IMsTscNonScriptable_Vtbl,
    pub NotifyRedirectDeviceChange: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::WPARAM,
        windows::Win32::Foundation::LPARAM,
    ) -> windows::core::HRESULT,
    pub SendKeys: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        i32,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
        *mut i32,
    ) -> windows::core::HRESULT,
    pub SetUIParentWindowHandle:
        unsafe extern "system" fn(*mut std::ffi::c_void, isize) -> windows::core::HRESULT,
    pub GetUIParentWindowHandle:
        unsafe extern "system" fn(*mut std::ffi::c_void, *mut isize) -> windows::core::HRESULT,
    pub SetShowRedirectionWarningDialog: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetShowRedirectionWarningDialog: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetPromptForCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetPromptForCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetNegotiateSecurityLayer: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetNegotiateSecurityLayer: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetEnableCredSspSupport: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetEnableCredSspSupport: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetRedirectDynamicDrives: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetRedirectDynamicDrives: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetRedirectDynamicDevices: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetRedirectDynamicDevices: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetDeviceCollection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetDriveCollection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub SetWarnAboutSendingCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetWarnAboutSendingCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetWarnAboutClipboardRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetWarnAboutClipboardRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetConnectionBarText: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
    pub GetConnectionBarText: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut *mut std::ffi::c_void,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[repr(C)]
#[doc(hidden)]
#[allow(non_snake_case)]
pub struct IMsRdpClientNonScriptable4_Vtbl {
    pub base__: IMsRdpClientNonScriptable3_Vtbl,
    pub SetRedirectionWarningType:
        unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> windows::core::HRESULT,
    pub GetRedirectionWarningType:
        unsafe extern "system" fn(*mut std::ffi::c_void, *mut i32) -> windows::core::HRESULT,
    pub SetMarkRdpSettingsSecure: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetMarkRdpSettingsSecure: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetPublisherCertificateChain: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::System::Variant::VARIANT,
    ) -> windows::core::HRESULT,
    pub GetPublisherCertificateChain: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::System::Variant::VARIANT,
    ) -> windows::core::HRESULT,
    pub SetWarnAboutPrinterRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetWarnAboutPrinterRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetAllowCredentialSaving: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetAllowCredentialSaving: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetPromptForCredsOnClient: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetPromptForCredsOnClient: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetLaunchedViaClientShellInterface: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    )
        -> windows::core::HRESULT,
    pub GetLaunchedViaClientShellInterface: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    )
        -> windows::core::HRESULT,
    pub SetTrustedZoneSite: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetTrustedZoneSite: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
#[repr(C)]
#[doc(hidden)]
#[allow(non_snake_case)]
pub struct IMsRdpClientNonScriptable5_Vtbl {
    pub base__: IMsRdpClientNonScriptable4_Vtbl,
    pub SetUseMultimon: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetUseMultimon: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetRemoteMonitorCount:
        unsafe extern "system" fn(*mut std::ffi::c_void, *mut u32) -> windows::core::HRESULT,
    pub GetRemoteMonitorsBoundingBox: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut i32,
        *mut i32,
        *mut i32,
        *mut i32,
    ) -> windows::core::HRESULT,
    pub GetRemoteMonitorLayoutMatchesLocal: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    )
        -> windows::core::HRESULT,
    pub DisableConnectionBar:
        unsafe extern "system" fn(*mut std::ffi::c_void) -> windows::core::HRESULT,
    pub SetDisableRemoteAppCapsCheck: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetDisableRemoteAppCapsCheck: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetWarnAboutDirectXRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetWarnAboutDirectXRedirection: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub SetAllowPromptingForCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
    pub GetAllowPromptingForCredentials: unsafe extern "system" fn(
        *mut std::ffi::c_void,
        *mut windows::Win32::Foundation::VARIANT_BOOL,
    ) -> windows::core::HRESULT,
}

#[cfg(windows)]
impl IMsTscNonScriptable {
    unsafe fn set_clear_text_password(
        &self,
        password: &windows::core::BSTR,
    ) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).ClearTextPassword)(
                windows::core::Interface::as_raw(self),
                std::mem::transmute_copy(password),
            )
            .ok()
        }
    }
}

#[cfg(windows)]
impl IMsRdpClientNonScriptable3 {
    unsafe fn set_prompt_for_credentials(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetPromptForCredentials)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }

    unsafe fn set_enable_credssp_support(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetEnableCredSspSupport)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }

    unsafe fn set_warn_about_sending_credentials(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetWarnAboutSendingCredentials)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }
}

#[cfg(windows)]
impl IMsRdpClientNonScriptable4 {
    unsafe fn set_allow_credential_saving(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetAllowCredentialSaving)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }

    unsafe fn set_prompt_for_creds_on_client(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetPromptForCredsOnClient)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }
}

#[cfg(windows)]
impl IMsRdpClientNonScriptable5 {
    unsafe fn set_allow_prompting_for_credentials(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetAllowPromptingForCredentials)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }

    unsafe fn set_use_multimon(&self, value: bool) -> windows::core::Result<()> {
        unsafe {
            (windows::core::Interface::vtable(self).SetUseMultimon)(
                windows::core::Interface::as_raw(self),
                variant_bool(value),
            )
            .ok()
        }
    }
}

#[cfg(windows)]
fn variant_bool(value: bool) -> windows::Win32::Foundation::VARIANT_BOOL {
    if value {
        windows::Win32::Foundation::VARIANT_TRUE
    } else {
        windows::Win32::Foundation::VARIANT_FALSE
    }
}

#[cfg(windows)]
struct HostedActiveXControl {
    hwnd: windows::Win32::Foundation::HWND,
    name: &'static str,
    client: HostedActiveXClient,
}

#[cfg(windows)]
enum ActiveXControlFlavor {
    Modern,
    Classic,
}

#[cfg(windows)]
struct ActiveXControlSpec {
    name: &'static str,
    flavor: ActiveXControlFlavor,
}

#[cfg(windows)]
fn load_atl_host() -> Result<AtlAxHost, AppError> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;

    let dll = to_wide_null("atl.dll");
    let module = unsafe { LoadLibraryW(PCWSTR(dll.as_ptr())) }.map_err(|error| {
        AppError::new(
            "rdp_activex_atl_missing",
            "未能加载 atl.dll，无法创建 RDP ActiveX 宿主。",
            error.to_string(),
            true,
        )
    })?;

    unsafe fn load_proc<T>(
        module: windows::Win32::Foundation::HMODULE,
        name: &'static [u8],
    ) -> Result<T, AppError> {
        use windows::core::PCSTR;
        use windows::Win32::System::LibraryLoader::GetProcAddress;

        let proc = unsafe { GetProcAddress(module, PCSTR(name.as_ptr())) }.ok_or_else(|| {
            AppError::new(
                "rdp_activex_atl_proc_missing",
                "atl.dll 缺少 ActiveX 宿主入口。",
                String::from_utf8_lossy(name).trim_end_matches('\0'),
                true,
            )
        })?;
        Ok(unsafe { std::mem::transmute_copy::<_, T>(&proc) })
    }

    let init = unsafe {
        load_proc::<unsafe extern "system" fn() -> windows::core::BOOL>(module, b"AtlAxWinInit\0")?
    };
    let get_control = unsafe {
        load_proc::<
            unsafe extern "system" fn(
                windows::Win32::Foundation::HWND,
                *mut *mut c_void,
            ) -> windows::core::HRESULT,
        >(module, b"AtlAxGetControl\0")?
    };

    Ok(AtlAxHost { init, get_control })
}

#[cfg(windows)]
fn create_configured_activex_control(
    atl: &AtlAxHost,
    parent: windows::Win32::Foundation::HWND,
    width: i32,
    height: i32,
    config: &ActiveXRdpConfig,
) -> Result<HostedActiveXControl, AppError> {
    use std::ffi::c_void;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
    };

    let class_name = to_wide_null("AtlAxWin");
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|error| {
        AppError::new(
            "rdp_activex_module_failed",
            "RDP ActiveX 控件模块句柄获取失败。",
            error.to_string(),
            true,
        )
    })?;
    let specs = [
        ActiveXControlSpec {
            name: "{EAB16C5D-EED1-4E95-868B-0FBA1B42C092}",
            flavor: ActiveXControlFlavor::Modern,
        },
        ActiveXControlSpec {
            name: "RemoteDesktopClient.RemoteDesktopClient.1",
            flavor: ActiveXControlFlavor::Modern,
        },
        ActiveXControlSpec {
            name: "RemoteDesktopClient.RemoteDesktopClient",
            flavor: ActiveXControlFlavor::Modern,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx.13",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{1DF7C823-B2D4-4B54-975A-F2AC5D7CF8B8}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx.12",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{A0C63C30-F08D-4AB4-907C-34905D770C7D}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx.11",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{8B918B82-7985-4C24-89DF-C33AD2BBFBCD}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx.10",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx.9",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{3F859AA3-C2D4-4FAA-B0E4-FD0C9C4E5E3A}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsRDP.MsRDP.12",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{945EE98E-B376-4EC2-B2E5-64C9410F93B7}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsRDP.MsRDP.11",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{22A7E88C-5BF5-4DE6-B687-60F7331DF190}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsRDP.MsRDP.10",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{C0EFA91A-EEB7-41C7-97FA-F0ED645EFB24}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsRDP.MsRDP.9",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "{301B94BA-5D25-4A12-BFFE-3B6E7A616585}",
            flavor: ActiveXControlFlavor::Classic,
        },
        ActiveXControlSpec {
            name: "MsTscAx.MsTscAx",
            flavor: ActiveXControlFlavor::Classic,
        },
    ];
    let mut errors = Vec::new();

    for spec in specs {
        let title = to_wide_null(spec.name);
        let child = match unsafe {
            CreateWindowExW(
                Default::default(),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                0,
                0,
                width,
                height,
                Some(parent),
                None,
                Some(instance.into()),
                None::<*const c_void>,
            )
        } {
            Ok(child) => child,
            Err(error) => {
                errors.push(format!("{}: CreateWindowExW failed {error}", spec.name));
                continue;
            }
        };

        let mut raw_control: *mut c_void = std::ptr::null_mut();
        let control_result = unsafe { (atl.get_control)(child, &mut raw_control) };
        if control_result.is_err() || raw_control.is_null() {
            errors.push(format!(
                "{}: AtlAxGetControl failed {control_result:?}",
                spec.name
            ));
            unsafe {
                let _ = DestroyWindow(child);
            }
            continue;
        }

        let unknown = unsafe { windows::core::IUnknown::from_raw(raw_control) };
        let client = match spec.flavor {
            ActiveXControlFlavor::Modern => {
                match unknown.cast::<windows::Win32::System::RemoteDesktop::IRemoteDesktopClient>()
                {
                    Ok(client) => HostedActiveXClient::Modern(client),
                    Err(error) => {
                        errors.push(format!(
                            "{}: IRemoteDesktopClient cast failed {error}",
                            spec.name
                        ));
                        unsafe {
                            let _ = DestroyWindow(child);
                        }
                        continue;
                    }
                }
            }
            ActiveXControlFlavor::Classic => {
                match unknown.cast::<windows::Win32::System::Com::IDispatch>() {
                    Ok(dispatch) => HostedActiveXClient::Classic(dispatch),
                    Err(error) => {
                        errors.push(format!(
                            "{spec_name}: IDispatch cast failed {error}",
                            spec_name = spec.name
                        ));
                        unsafe {
                            let _ = DestroyWindow(child);
                        }
                        continue;
                    }
                }
            }
        };
        if let Err(error) = configure_activex_client(&client, config)
            .map_err(|error| with_activex_control_context(spec.name, "configure", error))
        {
            errors.push(format!(
                "{}: configure failed {} ({})",
                spec.name, error.message, error.raw_message
            ));
            drop(client);
            unsafe {
                let _ = DestroyWindow(child);
            }
            continue;
        }

        return Ok(HostedActiveXControl {
            hwnd: child,
            name: spec.name,
            client,
        });
    }

    Err(AppError::new(
        "rdp_activex_control_failed",
        "MSTSC ActiveX 控件创建或配置失败。",
        if errors.is_empty() {
            "no RDP ActiveX ProgID or CLSID created and configured successfully".to_string()
        } else {
            errors.join(" | ")
        },
        true,
    ))
}

#[cfg(windows)]
fn configure_activex_client(
    client: &HostedActiveXClient,
    config: &ActiveXRdpConfig,
) -> Result<(), AppError> {
    match client {
        HostedActiveXClient::Modern(client) => configure_modern_activex_client(client, config),
        HostedActiveXClient::Classic(dispatch) => {
            configure_classic_activex_client(dispatch, config)
        }
    }
}

#[cfg(windows)]
fn configure_modern_activex_client(
    client: &windows::Win32::System::RemoteDesktop::IRemoteDesktopClient,
    config: &ActiveXRdpConfig,
) -> Result<(), AppError> {
    use windows::core::BSTR;

    if config
        .password
        .as_deref()
        .is_some_and(|password| !password.is_empty())
    {
        return Err(AppError::new(
            "rdp_activex_password_unsupported",
            "该 RDP ActiveX 控件暂不支持保存密码直连。",
            "RemoteDesktopClient password injection is not implemented; trying classic MSTSC ActiveX",
            true,
        ));
    }

    let settings = unsafe { client.Settings() }.map_err(|error| {
        AppError::new(
            "rdp_activex_settings_failed",
            "RDP ActiveX 设置对象获取失败。",
            error.to_string(),
            true,
        )
    })?;
    let rdp_content = BSTR::from(config.rdp_file_content.as_str());
    unsafe { settings.ApplySettings(&rdp_content) }.map_err(|error| {
        AppError::new(
            "rdp_activex_apply_settings_failed",
            "RDP ActiveX 应用设置失败。",
            error.to_string(),
            true,
        )
    })?;
    Ok(())
}

#[cfg(windows)]
fn configure_classic_activex_client(
    dispatch: &windows::Win32::System::Com::IDispatch,
    config: &ActiveXRdpConfig,
) -> Result<(), AppError> {
    put_activex_property_id(dispatch, "Server", 1, config.host.as_str().into())?;
    put_activex_property_id(dispatch, "UserName", 3, config.username.as_str().into())?;
    if let Some(domain) = config.domain.as_deref().filter(|value| !value.is_empty()) {
        put_activex_property_id(dispatch, "Domain", 2, domain.into())?;
    }
    put_activex_property_id(dispatch, "DesktopWidth", 12, safe_i32(config.width).into())?;
    put_activex_property_id(
        dispatch,
        "DesktopHeight",
        13,
        safe_i32(config.height).into(),
    )?;
    configure_classic_activex_scale(dispatch, config.desktop_scale_factor);
    let experience = rdp_experience_settings(&config.performance);
    put_activex_property_id_optional(
        dispatch,
        "ColorDepth",
        100,
        i32::from(experience.session_bpp).into(),
    );

    let password = config.password.as_deref().filter(|value| !value.is_empty());
    if password.is_some() {
        configure_classic_activex_password_prompting(dispatch);
    }
    if let Some(advanced) = get_activex_dispatch_id(
        dispatch,
        &[
            ("AdvancedSettings9", 701),
            ("AdvancedSettings8", 600),
            ("AdvancedSettings7", 507),
            ("AdvancedSettings6", 502),
            ("AdvancedSettings5", 400),
            ("AdvancedSettings4", 300),
            ("AdvancedSettings3", 200),
            ("AdvancedSettings2", 101),
            ("AdvancedSettings", 98),
        ],
    ) {
        put_activex_property_id(&advanced, "RDPPort", 108, i32::from(config.port).into())?;
        put_activex_property_id_optional(&advanced, "SmartSizing", 184, true.into());
        put_activex_property_id_optional(&advanced, "EnableAutoReconnect", 206, true.into());
        put_activex_property_id_optional(&advanced, "GrabFocusOnConnect", 189, true.into());
        put_activex_property_id_optional(&advanced, "PublicMode", 217, false.into());
        put_activex_property_by_name_optional(
            &advanced,
            "PerformanceFlags",
            experience.performance_flags().into(),
        );
        put_activex_property_id_optional(
            &advanced,
            "RedirectClipboard",
            213,
            config.clipboard.into(),
        );
        put_activex_property_id_optional(&advanced, "RedirectDrives", 191, config.drives.into());
        put_activex_property_id_optional(
            &advanced,
            "RedirectPrinters",
            192,
            config.printers.into(),
        );
        put_activex_property_id_optional(
            &advanced,
            "RedirectSmartCards",
            194,
            config.smart_cards.into(),
        );
        put_activex_property_id_optional(
            &advanced,
            "AudioRedirectionMode",
            215,
            audio_mode_i32(&config.audio).into(),
        );
        put_activex_property_id_optional(
            &advanced,
            "EnableCredSspSupport",
            17,
            (!matches!(config.nla, RdpNetworkLevelAuthentication::Disabled)).into(),
        );
        put_activex_property_id_optional(
            &advanced,
            "AuthenticationLevel",
            212,
            certificate_authentication_level(&config.certificate_policy).into(),
        );
        if password.is_some() {
            configure_classic_activex_password_prompting(&advanced);
        }
    }

    if let Some(gateway_host) = config
        .gateway_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if let Some(transport) = get_activex_dispatch_id(
            dispatch,
            &[
                ("TransportSettings4", 800),
                ("TransportSettings3", 601),
                ("TransportSettings2", 506),
                ("TransportSettings", 500),
            ],
        ) {
            put_activex_property_id_optional(
                &transport,
                "GatewayHostname",
                210,
                gateway_host.into(),
            );
            if let Some(mode) = config.gateway_mode.as_ref() {
                put_activex_property_id_optional(
                    &transport,
                    "GatewayUsageMethod",
                    211,
                    gateway_usage_method(mode).into(),
                );
            }
            put_activex_property_id_optional(&transport, "GatewayCredsSource", 213, 4i32.into());
            put_activex_property_id_optional(
                &transport,
                "GatewayProfileUsageMethod",
                212,
                1i32.into(),
            );
        }
    }

    if password.is_some() {
        configure_classic_activex_password_prompting(dispatch);
        configure_classic_activex_password_prompting_interfaces(dispatch, config);
    }
    if let Some(password) = password {
        set_classic_activex_password(dispatch, password)?;
        configure_classic_activex_password_prompting(dispatch);
        configure_classic_activex_password_prompting_interfaces(dispatch, config);
    }

    Ok(())
}

#[cfg(windows)]
fn configure_classic_activex_scale(
    dispatch: &windows::Win32::System::Com::IDispatch,
    desktop_scale_factor: u32,
) {
    let desktop_scale_factor = normalize_desktop_scale_factor(desktop_scale_factor);
    let _ = invoke_activex_method_by_name(
        dispatch,
        "SetExtendedProperty",
        vec![desktop_scale_factor.into(), "DesktopScaleFactor".into()],
    );
    let _ = invoke_activex_method_by_name(
        dispatch,
        "SetExtendedProperty",
        vec![100u32.into(), "DeviceScaleFactor".into()],
    );
}

#[cfg(windows)]
fn sync_activex_session_display(
    hwnd: windows::Win32::Foundation::HWND,
    session: &mut ActiveXHostSession,
    force: bool,
) {
    if !session.dynamic_resize {
        return;
    }
    let Some((width, height)) = rdp_content_size_for_window(hwnd) else {
        return;
    };
    if width <= 0 || height <= 0 {
        return;
    }
    let width = width as u32;
    let height = height as u32;
    let scale_factor = desktop_scale_factor_for_window(hwnd);
    let changed = force
        || width.abs_diff(session.last_width) > 1
        || height.abs_diff(session.last_height) > 1
        || scale_factor != session.last_scale_factor;
    if !changed {
        return;
    }

    let result = match &session.client {
        HostedActiveXClient::Modern(client) => {
            unsafe { client.UpdateSessionDisplaySettings(width, height) }.map_err(|error| {
                AppError::new(
                    "rdp_activex_display_update_failed",
                    "RDP ActiveX 显示设置同步失败。",
                    error.to_string(),
                    true,
                )
            })
        }
        HostedActiveXClient::Classic(dispatch) => {
            configure_classic_activex_scale(dispatch, scale_factor);
            put_activex_property_id_optional(dispatch, "DesktopWidth", 12, safe_i32(width).into());
            put_activex_property_id_optional(
                dispatch,
                "DesktopHeight",
                13,
                safe_i32(height).into(),
            );
            invoke_activex_method_by_name(
                dispatch,
                "UpdateSessionDisplaySettings",
                vec![
                    100u32.into(),
                    scale_factor.into(),
                    0i32.into(),
                    height.into(),
                    width.into(),
                    height.into(),
                    width.into(),
                ],
            )
        }
    };

    if result.is_ok() {
        session.last_width = width;
        session.last_height = height;
        session.last_scale_factor = scale_factor;
    }
}

#[cfg(windows)]
fn rdp_content_size_for_window(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    rdp_content_rect_for_window(hwnd).map(|(_, _, width, height)| (width, height))
}

#[cfg(windows)]
fn rdp_content_rect_for_window(
    hwnd: windows::Win32::Foundation::HWND,
) -> Option<(i32, i32, i32, i32)> {
    let (client_width, client_height) = client_size_for_window(hwnd)?;
    let chrome_height = rdp_chrome_height_for_window(hwnd).min(client_height.max(0));
    Some((
        0,
        chrome_height,
        client_width.max(1),
        (client_height - chrome_height).max(1),
    ))
}

#[cfg(windows)]
fn client_size_for_window(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    let mut rect = RECT::default();
    unsafe { GetClientRect(hwnd, &mut rect) }.ok().map(|_| {
        (
            (rect.right - rect.left).max(0),
            (rect.bottom - rect.top).max(0),
        )
    })
}

#[cfg(windows)]
fn window_dpi_for_window(hwnd: windows::Win32::Foundation::HWND) -> u32 {
    use windows::Win32::UI::HiDpi::GetDpiForWindow;

    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        96
    } else {
        dpi
    }
}

#[cfg(windows)]
fn scale_dip_value(value: i32, dpi: u32) -> i32 {
    let dpi = dpi.max(1).min(i32::MAX as u32) as i32;
    ((value * dpi) + 48) / 96
}

#[cfg(windows)]
fn rdp_titlebar_height_for_window(hwnd: windows::Win32::Foundation::HWND) -> i32 {
    rdp_chrome_height_for_window(hwnd)
}

#[cfg(windows)]
fn rdp_tab_height_for_window(hwnd: windows::Win32::Foundation::HWND) -> i32 {
    scale_dip_value(MX_RDP_TAB_HEIGHT_DIP, window_dpi_for_window(hwnd))
}

#[cfg(windows)]
fn rdp_chrome_height_for_window(hwnd: windows::Win32::Foundation::HWND) -> i32 {
    scale_dip_value(MX_RDP_CHROME_HEIGHT_DIP, window_dpi_for_window(hwnd))
}

#[cfg(windows)]
fn rdp_outer_height_for_content_height(
    content_height: i32,
    hwnd: windows::Win32::Foundation::HWND,
) -> i32 {
    content_height.max(1) + rdp_chrome_height_for_window(hwnd)
}

#[cfg(windows)]
fn rdp_outer_height_for_content_height_dpi(content_height: i32, dpi: u32) -> i32 {
    content_height.max(1) + scale_dip_value(MX_RDP_CHROME_HEIGHT_DIP, dpi)
}

#[cfg(windows)]
fn rdp_resize_border_for_window(hwnd: windows::Win32::Foundation::HWND) -> i32 {
    use windows::Win32::UI::HiDpi::GetSystemMetricsForDpi;
    use windows::Win32::UI::WindowsAndMessaging::{SM_CXFRAME, SM_CXPADDEDBORDER};

    let dpi = window_dpi_for_window(hwnd);
    let frame = unsafe { GetSystemMetricsForDpi(SM_CXFRAME, dpi) };
    let padded = unsafe { GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi) };
    (frame + padded).max(4)
}

#[cfg(windows)]
fn desktop_scale_factor_for_window(hwnd: windows::Win32::Foundation::HWND) -> u32 {
    let dpi = window_dpi_for_window(hwnd);
    if dpi == 0 {
        return 100;
    }
    normalize_desktop_scale_factor(((dpi as f64 / 96.0) * 100.0).round() as u32)
}

#[cfg(windows)]
fn invalidate_activex_host_window(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Graphics::Gdi::InvalidateRect;

    unsafe {
        let _ = InvalidateRect(Some(hwnd), None, false);
    }
}

#[cfg(windows)]
fn configure_native_host_frame(hwnd: windows::Win32::Foundation::HWND) {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let corner = DWMWCP_ROUND;
    let border = rgb_color(203, 209, 218);
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&corner as *const windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE)
                .cast::<c_void>(),
            size_of::<windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&border as *const windows::Win32::Foundation::COLORREF).cast::<c_void>(),
            size_of::<windows::Win32::Foundation::COLORREF>() as u32,
        );
    }
}

#[cfg(windows)]
fn update_native_host_title(
    hwnd: windows::Win32::Foundation::HWND,
    state: &ActiveXHostWindowState,
) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::SetWindowTextW;

    let title = state
        .sessions
        .get(state.active_index)
        .map(|session| format!("MXterm RDP - {}", session.title))
        .unwrap_or_else(|| "MXterm RDP".to_string());
    let wide = to_wide_null(&title);
    unsafe {
        let _ = SetWindowTextW(hwnd, PCWSTR(wide.as_ptr()));
    }
}

#[cfg(windows)]
fn lparam_to_point(lparam: windows::Win32::Foundation::LPARAM) -> (i32, i32) {
    let value = lparam.0 as isize;
    let x = (value & 0xffff) as i16 as i32;
    let y = ((value >> 16) & 0xffff) as i16 as i32;
    (x, y)
}

#[cfg(windows)]
fn screen_lparam_to_client_point(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::ScreenToClient;

    let (x, y) = lparam_to_point(lparam);
    let mut point = POINT { x, y };
    unsafe {
        if ScreenToClient(hwnd, &mut point).as_bool() {
            Some((point.x, point.y))
        } else {
            None
        }
    }
}

#[cfg(windows)]
fn client_lparam_to_point(lparam: windows::Win32::Foundation::LPARAM) -> (i32, i32) {
    lparam_to_point(lparam)
}

#[cfg(windows)]
fn point_in_rect(point: (i32, i32), rect: &windows::Win32::Foundation::RECT) -> bool {
    let (x, y) = point;
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

#[cfg(windows)]
fn rect_from_points(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> windows::Win32::Foundation::RECT {
    windows::Win32::Foundation::RECT {
        left,
        top,
        right,
        bottom,
    }
}

#[cfg(windows)]
fn native_host_button_rects(
    hwnd: windows::Win32::Foundation::HWND,
    client_width: i32,
) -> (
    windows::Win32::Foundation::RECT,
    windows::Win32::Foundation::RECT,
    windows::Win32::Foundation::RECT,
) {
    let dpi = window_dpi_for_window(hwnd);
    let button_width = scale_dip_value(46, dpi).max(36);
    let button_height = rdp_titlebar_height_for_window(hwnd).max(1);
    let close_right = client_width.max(0);
    let max_right = (close_right - button_width).max(0);
    let min_right = (max_right - button_width).max(0);
    let min_left = (min_right - button_width).max(0);
    let top = 0;
    let bottom = button_height;
    (
        rect_from_points(min_left, top, min_right, bottom),
        rect_from_points(min_right, top, max_right, bottom),
        rect_from_points(max_right, top, close_right, bottom),
    )
}

#[cfg(windows)]
fn native_host_tab_rects(
    hwnd: windows::Win32::Foundation::HWND,
    client_width: i32,
    state: &ActiveXHostWindowState,
) -> Vec<(usize, windows::Win32::Foundation::RECT)> {
    let dpi = window_dpi_for_window(hwnd);
    let top = ((rdp_chrome_height_for_window(hwnd) - rdp_tab_height_for_window(hwnd)) / 2).max(0);
    let height = rdp_tab_height_for_window(hwnd).max(1);
    let left_padding = scale_dip_value(14, dpi).max(10);
    let button_zone = scale_dip_value(150, dpi).max(132);
    let right_padding = button_zone + scale_dip_value(8, dpi).max(6);
    let gap = scale_dip_value(4, dpi).max(3);
    let available = (client_width - left_padding - right_padding).max(0);
    if available <= 0 || state.sessions.is_empty() {
        return Vec::new();
    }

    let count = state.sessions.len() as i32;
    let mut width = ((available - gap * (count - 1)).max(1) / count).max(1);
    width = width.clamp(
        scale_dip_value(112, dpi).max(72),
        scale_dip_value(160, dpi).max(112),
    );

    let mut left = left_padding;
    let mut rects = Vec::with_capacity(state.sessions.len());
    for (index, _) in state.sessions.iter().enumerate() {
        let right = (left + width).min(client_width - right_padding);
        if right <= left {
            break;
        }
        rects.push((index, rect_from_points(left, top, right, top + height)));
        left = right + gap;
    }
    rects
}

#[cfg(windows)]
fn native_host_button_for_point(
    hwnd: windows::Win32::Foundation::HWND,
    client_width: i32,
    point: (i32, i32),
) -> Option<RdpHostChromeButton> {
    let (minimize, maximize, close) = native_host_button_rects(hwnd, client_width);
    if point_in_rect(point, &minimize) {
        return Some(RdpHostChromeButton::Minimize);
    }
    if point_in_rect(point, &maximize) {
        return Some(RdpHostChromeButton::Maximize);
    }
    if point_in_rect(point, &close) {
        return Some(RdpHostChromeButton::Close);
    }
    None
}

#[cfg(windows)]
fn native_host_tab_for_point(
    hwnd: windows::Win32::Foundation::HWND,
    client_width: i32,
    state: &ActiveXHostWindowState,
    point: (i32, i32),
) -> Option<usize> {
    native_host_tab_rects(hwnd, client_width, state)
        .into_iter()
        .find_map(|(index, rect)| point_in_rect(point, &rect).then_some(index))
}

#[cfg(windows)]
fn native_host_tab_close_rect(
    rect: &windows::Win32::Foundation::RECT,
    dpi: u32,
) -> windows::Win32::Foundation::RECT {
    let size = scale_dip_value(20, dpi).max(16);
    let right = rect.right - scale_dip_value(6, dpi).max(5);
    let top = rect.top + ((rect.bottom - rect.top - size) / 2).max(0);
    rect_from_points(right - size, top, right, top + size)
}

#[cfg(windows)]
fn native_host_tab_close_for_point(
    hwnd: windows::Win32::Foundation::HWND,
    client_width: i32,
    state: &ActiveXHostWindowState,
    point: (i32, i32),
) -> Option<usize> {
    let dpi = window_dpi_for_window(hwnd);
    native_host_tab_rects(hwnd, client_width, state)
        .into_iter()
        .find_map(|(index, rect)| {
            point_in_rect(point, &native_host_tab_close_rect(&rect, dpi)).then_some(index)
        })
}

#[cfg(windows)]
fn update_native_host_hover_state(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    lparam: windows::Win32::Foundation::LPARAM,
) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT,
    };

    let point = client_lparam_to_point(lparam);
    let client_width = client_size_for_window(hwnd)
        .map(|(width, _)| width)
        .unwrap_or(0);
    let hovered = native_host_button_for_point(hwnd, client_width, point);
    let hovered_tab_close = if hovered.is_none() {
        native_host_tab_close_for_point(hwnd, client_width, state, point)
    } else {
        None
    };
    let changed =
        state.chrome_hot_button != hovered || state.chrome_hot_tab_close != hovered_tab_close;
    state.chrome_hot_button = hovered;
    state.chrome_hot_tab_close = hovered_tab_close;
    unsafe {
        let mut event = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE,
            hwndTrack: hwnd,
            dwHoverTime: 0,
        };
        let _ = TrackMouseEvent(&mut event);
    }
    changed
}

#[cfg(windows)]
fn clear_native_host_hover_state(state: &mut ActiveXHostWindowState) -> bool {
    let changed = state.chrome_hot_button.is_some() || state.chrome_hot_tab_close.is_some();
    state.chrome_hot_button = None;
    state.chrome_hot_tab_close = None;
    changed
}

#[cfg(windows)]
fn clear_native_host_press_state(state: &mut ActiveXHostWindowState) -> bool {
    let changed = state.chrome_pressed_button.is_some() || state.chrome_pressed_tab_close.is_some();
    state.chrome_pressed_button = None;
    state.chrome_pressed_tab_close = None;
    changed
}

#[cfg(windows)]
fn handle_native_host_left_button_down(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    lparam: windows::Win32::Foundation::LPARAM,
) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::SetCapture;

    let point = client_lparam_to_point(lparam);
    let client_width = client_size_for_window(hwnd)
        .map(|(width, _)| width)
        .unwrap_or(0);
    if let Some(button) = native_host_button_for_point(hwnd, client_width, point) {
        state.chrome_pressed_button = Some(button);
        state.chrome_hot_button = Some(button);
        unsafe {
            let _ = SetCapture(hwnd);
        }
        invalidate_activex_host_window(hwnd);
        return true;
    }

    if let Some(index) = native_host_tab_close_for_point(hwnd, client_width, state, point) {
        state.chrome_pressed_tab_close = Some(index);
        state.chrome_hot_tab_close = Some(index);
        unsafe {
            let _ = SetCapture(hwnd);
        }
        invalidate_activex_host_window(hwnd);
        return true;
    }

    if let Some(index) = native_host_tab_for_point(hwnd, client_width, state, point) {
        activate_activex_tab(hwnd, state, index);
        return true;
    }

    false
}

#[cfg(windows)]
fn handle_native_host_left_button_up(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    lparam: windows::Win32::Foundation::LPARAM,
) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
    use windows::Win32::UI::WindowsAndMessaging::{
        PostMessageW, ShowWindow, SW_MINIMIZE, WM_CLOSE,
    };

    let point = client_lparam_to_point(lparam);
    let client_width = client_size_for_window(hwnd)
        .map(|(width, _)| width)
        .unwrap_or(0);
    let pressed = state.chrome_pressed_button;
    let pressed_tab_close = state.chrome_pressed_tab_close;
    state.chrome_pressed_button = None;
    state.chrome_pressed_tab_close = None;
    unsafe {
        let _ = ReleaseCapture();
    }

    if let Some(button) = pressed {
        let hovered = native_host_button_for_point(hwnd, client_width, point);
        if hovered == Some(button) {
            match button {
                RdpHostChromeButton::Minimize => unsafe {
                    let _ = ShowWindow(hwnd, SW_MINIMIZE);
                },
                RdpHostChromeButton::Maximize => toggle_native_host_maximize(hwnd),
                RdpHostChromeButton::Close => unsafe {
                    let _ = PostMessageW(
                        Some(hwnd),
                        WM_CLOSE,
                        windows::Win32::Foundation::WPARAM(0),
                        windows::Win32::Foundation::LPARAM(0),
                    );
                },
            }
        }
        invalidate_activex_host_window(hwnd);
        return true;
    }

    if let Some(index) = pressed_tab_close {
        let hovered = native_host_tab_close_for_point(hwnd, client_width, state, point);
        if hovered == Some(index) {
            if let Some(session_id) = state
                .sessions
                .get(index)
                .map(|session| session.session_id.clone())
            {
                close_activex_host_session(hwnd, state, &session_id, true);
            }
        }
        invalidate_activex_host_window(hwnd);
        return true;
    }

    false
}

#[cfg(windows)]
fn handle_native_host_left_double_click(
    hwnd: windows::Win32::Foundation::HWND,
    state: &mut ActiveXHostWindowState,
    lparam: windows::Win32::Foundation::LPARAM,
) -> bool {
    let point = client_lparam_to_point(lparam);
    let client_width = client_size_for_window(hwnd)
        .map(|(width, _)| width)
        .unwrap_or(0);
    if native_host_button_for_point(hwnd, client_width, point).is_some() {
        return false;
    }
    if native_host_tab_close_for_point(hwnd, client_width, state, point).is_some() {
        return false;
    }
    if native_host_tab_for_point(hwnd, client_width, state, point).is_some() {
        return false;
    }
    toggle_native_host_maximize(hwnd);
    true
}

#[cfg(windows)]
fn toggle_native_host_maximize(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::WindowsAndMessaging::{IsZoomed, ShowWindow, SW_MAXIMIZE, SW_RESTORE};

    unsafe {
        if IsZoomed(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_MAXIMIZE);
        }
    }
}

#[cfg(windows)]
fn adjust_native_host_maximized_client_rect(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_FROM_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{IsZoomed, NCCALCSIZE_PARAMS};

    if !unsafe { IsZoomed(hwnd).as_bool() } {
        return;
    }
    let params = lparam.0 as *mut NCCALCSIZE_PARAMS;
    if params.is_null() {
        return;
    }
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_FROM_FLAGS(2)) };
    if monitor.is_invalid() {
        return;
    }
    let mut monitor_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut monitor_info) }.as_bool() {
        return;
    }
    unsafe {
        (*params).rgrc[0] = monitor_info.rcWork;
    }
}

#[cfg(windows)]
fn update_native_host_minmax_info(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_FROM_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::MINMAXINFO;

    let minmax = lparam.0 as *mut MINMAXINFO;
    if minmax.is_null() {
        return;
    }

    let dpi = window_dpi_for_window(hwnd);
    unsafe {
        (*minmax).ptMinTrackSize.x = scale_dip_value(640, dpi);
        (*minmax).ptMinTrackSize.y =
            rdp_outer_height_for_content_height_dpi(480, dpi).max(scale_dip_value(480, dpi));
    }

    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_FROM_FLAGS(2)) };
    if monitor.is_invalid() {
        return;
    }

    let mut monitor_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut monitor_info) }.as_bool() {
        return;
    }

    let work = monitor_info.rcWork;
    let monitor_rect = monitor_info.rcMonitor;
    unsafe {
        (*minmax).ptMaxPosition.x = work.left - monitor_rect.left;
        (*minmax).ptMaxPosition.y = work.top - monitor_rect.top;
        (*minmax).ptMaxSize.x = work.right - work.left;
        (*minmax).ptMaxSize.y = work.bottom - work.top;
    }
}

#[cfg(windows)]
fn create_native_host_resize_grips(
    host_hwnd: windows::Win32::Foundation::HWND,
) -> Vec<NativeHostResizeGrip> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, RegisterClassW, SetLayeredWindowAttributes, SetWindowLongPtrW,
        GWLP_USERDATA, LWA_ALPHA, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_VISIBLE,
    };

    let Ok(instance) = (unsafe { GetModuleHandleW(None) }) else {
        return Vec::new();
    };
    let class_name = to_wide_null("mXtermRdpResizeGrip");
    let class = WNDCLASSW {
        lpfnWndProc: Some(rdp_resize_grip_wndproc),
        hInstance: instance.into(),
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };
    unsafe {
        let _ = RegisterClassW(&class);
    }

    let title = to_wide_null("");
    [
        NativeHostResizeGripKind::Left,
        NativeHostResizeGripKind::Right,
        NativeHostResizeGripKind::Bottom,
        NativeHostResizeGripKind::BottomLeft,
        NativeHostResizeGripKind::BottomRight,
    ]
    .into_iter()
    .filter_map(|kind| {
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_LAYERED,
                PCWSTR(class_name.as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                0,
                0,
                1,
                1,
                Some(host_hwnd),
                None,
                Some(instance.into()),
                None::<*const c_void>,
            )
        }
        .ok()?;
        unsafe {
            let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, kind.hit_test() as isize);
            let _ = SetLayeredWindowAttributes(hwnd, rgb_color(0, 0, 0), 1, LWA_ALPHA);
        }
        Some(NativeHostResizeGrip { hwnd, kind })
    })
    .collect()
}

#[cfg(windows)]
fn layout_native_host_resize_grips(
    hwnd: windows::Win32::Foundation::HWND,
    grips: &[NativeHostResizeGrip],
) {
    use windows::Win32::UI::WindowsAndMessaging::{
        IsZoomed, SetWindowPos, ShowWindow, HWND_TOP, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE,
        SWP_SHOWWINDOW, SW_HIDE,
    };

    if unsafe { IsZoomed(hwnd).as_bool() } {
        for grip in grips {
            unsafe {
                let _ = ShowWindow(grip.hwnd, SW_HIDE);
            }
        }
        return;
    }

    let Some((client_width, client_height)) = client_size_for_window(hwnd) else {
        return;
    };
    let grip_size = rdp_resize_grip_size_for_window(hwnd)
        .min(client_width)
        .min(client_height);
    let chrome_height = rdp_chrome_height_for_window(hwnd)
        .min(client_height.max(0))
        .min(client_height.saturating_sub(grip_size).max(0));
    let bottom_top = client_height.saturating_sub(grip_size);
    let side_height = bottom_top.saturating_sub(chrome_height).max(1);

    for grip in grips {
        let (x, y, width, height) = match grip.kind {
            NativeHostResizeGripKind::Left => (0, chrome_height, grip_size, side_height),
            NativeHostResizeGripKind::Right => (
                client_width.saturating_sub(grip_size),
                chrome_height,
                grip_size,
                side_height,
            ),
            NativeHostResizeGripKind::Bottom => (
                grip_size,
                bottom_top,
                client_width.saturating_sub(grip_size * 2).max(1),
                grip_size,
            ),
            NativeHostResizeGripKind::BottomLeft => (0, bottom_top, grip_size, grip_size),
            NativeHostResizeGripKind::BottomRight => (
                client_width.saturating_sub(grip_size),
                bottom_top,
                grip_size,
                grip_size,
            ),
        };
        unsafe {
            let _ = SetWindowPos(
                grip.hwnd,
                Some(HWND_TOP),
                x,
                y,
                width.max(1),
                height.max(1),
                SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_SHOWWINDOW.0),
            );
        }
    }
}

#[cfg(windows)]
fn rdp_resize_grip_size_for_window(hwnd: windows::Win32::Foundation::HWND) -> i32 {
    scale_dip_value(8, window_dpi_for_window(hwnd)).clamp(6, 12)
}

#[cfg(windows)]
impl NativeHostResizeGripKind {
    fn hit_test(self) -> u32 {
        use windows::Win32::UI::WindowsAndMessaging::{
            HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT,
        };

        match self {
            NativeHostResizeGripKind::Left => HTLEFT,
            NativeHostResizeGripKind::Right => HTRIGHT,
            NativeHostResizeGripKind::Bottom => HTBOTTOM,
            NativeHostResizeGripKind::BottomLeft => HTBOTTOMLEFT,
            NativeHostResizeGripKind::BottomRight => HTBOTTOMRIGHT,
        }
    }
}

#[cfg(windows)]
unsafe extern "system" fn rdp_resize_grip_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{BeginPaint, EndPaint, PAINTSTRUCT};
    use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, GetCursorPos, GetParent, GetWindowLongPtrW, LoadCursorW, SendMessageW,
        SetCursor, GWLP_USERDATA, IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE,
        WM_ERASEBKGND, WM_LBUTTONDOWN, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_PAINT, WM_SETCURSOR,
    };

    let hit_test = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as u32;
    match message {
        WM_NCHITTEST => return LRESULT(hit_test as isize),
        WM_SETCURSOR => {
            let cursor = match hit_test {
                windows::Win32::UI::WindowsAndMessaging::HTLEFT
                | windows::Win32::UI::WindowsAndMessaging::HTRIGHT => IDC_SIZEWE,
                windows::Win32::UI::WindowsAndMessaging::HTBOTTOM => IDC_SIZENS,
                windows::Win32::UI::WindowsAndMessaging::HTBOTTOMLEFT => IDC_SIZENESW,
                windows::Win32::UI::WindowsAndMessaging::HTBOTTOMRIGHT => IDC_SIZENWSE,
                _ => IDC_SIZEWE,
            };
            if let Ok(cursor) = LoadCursorW(None, cursor) {
                let _ = SetCursor(Some(cursor));
            }
            return LRESULT(1);
        }
        WM_LBUTTONDOWN | WM_NCLBUTTONDOWN => {
            let mut point = POINT::default();
            let screen_lparam = if GetCursorPos(&mut point).is_ok() {
                screen_point_to_lparam(point.x, point.y)
            } else {
                lparam
            };
            if let Ok(parent) = GetParent(hwnd) {
                let _ = ReleaseCapture();
                return SendMessageW(
                    parent,
                    WM_NCLBUTTONDOWN,
                    Some(WPARAM(hit_test as usize)),
                    Some(screen_lparam),
                );
            }
            return LRESULT(0);
        }
        WM_ERASEBKGND => return LRESULT(1),
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            if !hdc.is_invalid() {
                let _ = EndPaint(hwnd, &ps);
            }
            return LRESULT(0);
        }
        _ => {}
    }

    DefWindowProcW(hwnd, message, wparam, lparam)
}

#[cfg(windows)]
fn install_activex_resize_subclasses(
    control_hwnd: windows::Win32::Foundation::HWND,
    host_hwnd: windows::Win32::Foundation::HWND,
) {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    install_activex_resize_subclass(control_hwnd, host_hwnd);
    unsafe {
        let _ = EnumChildWindows(
            Some(control_hwnd),
            Some(enum_install_activex_resize_subclass),
            LPARAM(host_hwnd.0 as isize),
        );
    }
}

#[cfg(windows)]
fn install_activex_resize_subclass(
    hwnd: windows::Win32::Foundation::HWND,
    host_hwnd: windows::Win32::Foundation::HWND,
) {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(activex_resize_subclass_proc),
            MX_RDP_CONTROL_RESIZE_SUBCLASS_ID,
            host_hwnd.0 as usize,
        );
    }
}

#[cfg(windows)]
unsafe extern "system" fn enum_install_activex_resize_subclass(
    child_hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows_core::BOOL {
    let host_hwnd = windows::Win32::Foundation::HWND(lparam.0 as *mut std::ffi::c_void);
    install_activex_resize_subclass(child_hwnd, host_hwnd);
    true.into()
}

#[cfg(windows)]
unsafe fn remove_activex_resize_subclasses(control_hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    let _ = EnumChildWindows(
        Some(control_hwnd),
        Some(enum_remove_activex_resize_subclass),
        LPARAM(0),
    );
    remove_activex_resize_subclass(control_hwnd);
}

#[cfg(windows)]
unsafe fn remove_activex_resize_subclass(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::UI::Shell::RemoveWindowSubclass;

    let _ = RemoveWindowSubclass(
        hwnd,
        Some(activex_resize_subclass_proc),
        MX_RDP_CONTROL_RESIZE_SUBCLASS_ID,
    );
}

#[cfg(windows)]
unsafe extern "system" fn enum_remove_activex_resize_subclass(
    child_hwnd: windows::Win32::Foundation::HWND,
    _lparam: windows::Win32::Foundation::LPARAM,
) -> windows_core::BOOL {
    remove_activex_resize_subclass(child_hwnd);
    true.into()
}

#[cfg(windows)]
unsafe extern "system" fn activex_resize_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{HWND, POINT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, IsWindow, SendMessageW, WM_DESTROY, WM_LBUTTONDOWN, WM_NCDESTROY,
        WM_NCHITTEST, WM_NCLBUTTONDOWN,
    };

    let host_hwnd = HWND(ref_data as *mut std::ffi::c_void);
    if !host_hwnd.is_invalid() && IsWindow(Some(host_hwnd)).as_bool() {
        if message == WM_NCHITTEST {
            let result = resize_hit_test_native_host(host_hwnd, lparam);
            if result.0 != 0 {
                return result;
            }
        } else if message == WM_LBUTTONDOWN {
            let mut point = POINT::default();
            if GetCursorPos(&mut point).is_ok() {
                let lparam = screen_point_to_lparam(point.x, point.y);
                let result = resize_hit_test_native_host(host_hwnd, lparam);
                if result.0 != 0 {
                    let _ = ReleaseCapture();
                    return SendMessageW(
                        host_hwnd,
                        WM_NCLBUTTONDOWN,
                        Some(WPARAM(result.0 as usize)),
                        Some(lparam),
                    );
                }
            }
        } else if message == WM_NCLBUTTONDOWN && resize_hit_test_code(wparam.0) {
            let _ = ReleaseCapture();
            return SendMessageW(host_hwnd, WM_NCLBUTTONDOWN, Some(wparam), Some(lparam));
        }
    }

    if message == WM_NCDESTROY || message == WM_DESTROY {
        let result = DefSubclassProc(hwnd, message, wparam, lparam);
        let _ = RemoveWindowSubclass(
            hwnd,
            Some(activex_resize_subclass_proc),
            MX_RDP_CONTROL_RESIZE_SUBCLASS_ID,
        );
        return result;
    }

    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[cfg(windows)]
fn screen_point_to_lparam(x: i32, y: i32) -> windows::Win32::Foundation::LPARAM {
    let x = (x as i16 as u16) as isize;
    let y = (y as i16 as u16) as isize;
    windows::Win32::Foundation::LPARAM(x | (y << 16))
}

#[cfg(windows)]
fn resize_hit_test_code(value: usize) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT,
    };

    matches!(
        value as u32,
        HTLEFT | HTRIGHT | HTTOP | HTBOTTOM | HTTOPLEFT | HTTOPRIGHT | HTBOTTOMLEFT | HTBOTTOMRIGHT
    )
}

#[cfg(windows)]
fn resize_hit_test_native_host(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        IsZoomed, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT,
        HTTOPRIGHT,
    };

    if unsafe { IsZoomed(hwnd).as_bool() } {
        return LRESULT(0);
    }
    let Some(point) = screen_lparam_to_client_point(hwnd, lparam) else {
        return LRESULT(0);
    };
    let Some((client_width, client_height)) = client_size_for_window(hwnd) else {
        return LRESULT(0);
    };
    let border = rdp_resize_border_for_window(hwnd);
    let on_left = point.0 < border;
    let on_right = point.0 >= client_width.saturating_sub(border);
    let on_top = point.1 < border;
    let on_bottom = point.1 >= client_height.saturating_sub(border);
    if on_left && on_top {
        return LRESULT(HTTOPLEFT as isize);
    }
    if on_right && on_top {
        return LRESULT(HTTOPRIGHT as isize);
    }
    if on_left && on_bottom {
        return LRESULT(HTBOTTOMLEFT as isize);
    }
    if on_right && on_bottom {
        return LRESULT(HTBOTTOMRIGHT as isize);
    }
    if on_top {
        return LRESULT(HTTOP as isize);
    }
    if on_left {
        return LRESULT(HTLEFT as isize);
    }
    if on_right {
        return LRESULT(HTRIGHT as isize);
    }
    if on_bottom {
        return LRESULT(HTBOTTOM as isize);
    }
    LRESULT(0)
}

#[cfg(windows)]
fn hit_test_native_host(
    hwnd: windows::Win32::Foundation::HWND,
    state: &ActiveXHostWindowState,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{HTCAPTION, HTCLIENT};

    let Some(point) = screen_lparam_to_client_point(hwnd, lparam) else {
        return LRESULT(0);
    };
    let Some((client_width, _client_height)) = client_size_for_window(hwnd) else {
        return LRESULT(0);
    };

    let resize_result = resize_hit_test_native_host(hwnd, lparam);
    if resize_result.0 != 0 {
        return resize_result;
    }

    if point.1 < rdp_chrome_height_for_window(hwnd) {
        if native_host_button_for_point(hwnd, client_width, point).is_some() {
            return LRESULT(HTCLIENT as isize);
        }
        if native_host_tab_close_for_point(hwnd, client_width, state, point).is_some() {
            return LRESULT(HTCLIENT as isize);
        }
        if native_host_tab_for_point(hwnd, client_width, state, point).is_some() {
            return LRESULT(HTCLIENT as isize);
        }
        return LRESULT(HTCAPTION as isize);
    }

    LRESULT(0)
}

#[cfg(windows)]
fn rgb_color(r: u8, g: u8, b: u8) -> windows::Win32::Foundation::COLORREF {
    windows::Win32::Foundation::COLORREF((r as u32) | ((g as u32) << 8) | ((b as u32) << 16))
}

#[cfg(windows)]
fn paint_native_host_window(
    hwnd: windows::Win32::Foundation::HWND,
    state: &ActiveXHostWindowState,
) {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateFontW, CreatePen, CreateSolidBrush, DeleteObject, EndPaint, FillRect,
        GetStockObject, LineTo, MoveToEx, SelectObject, SetBkMode, CLEARTYPE_QUALITY,
        CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_GUI_FONT, DEFAULT_PITCH, FF_DONTCARE,
        FW_MEDIUM, HGDIOBJ, OUT_DEFAULT_PRECIS, PAINTSTRUCT, PS_SOLID, TRANSPARENT,
    };

    let mut ps = PAINTSTRUCT::default();
    let hdc = unsafe { BeginPaint(hwnd, &mut ps) };
    let mut client = RECT::default();
    if unsafe { windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client) }.is_err()
    {
        unsafe {
            let _ = EndPaint(hwnd, &ps);
        }
        return;
    }

    let dpi = window_dpi_for_window(hwnd);
    let chrome_height = rdp_chrome_height_for_window(hwnd).min((client.bottom - client.top).max(0));
    let width = (client.right - client.left).max(0);

    let bg = rgb_color(249, 250, 252);
    let chrome_bg = rgb_color(242, 244, 247);
    let border = rgb_color(221, 225, 232);
    let text = rgb_color(32, 36, 42);
    let muted = rgb_color(98, 107, 120);
    let hover = rgb_color(233, 236, 239);
    let close_hover = rgb_color(216, 59, 59);
    let active_tab_bg = rgb_color(233, 236, 239);

    let brush = unsafe { CreateSolidBrush(bg) };
    unsafe {
        let _ = FillRect(hdc, &client, brush);
        let _ = DeleteObject(HGDIOBJ::from(brush));
    }

    let chrome_rect = RECT {
        left: 0,
        top: 0,
        right: width,
        bottom: chrome_height,
    };
    let chrome_brush = unsafe { CreateSolidBrush(chrome_bg) };
    unsafe {
        let _ = FillRect(hdc, &chrome_rect, chrome_brush);
        let _ = DeleteObject(HGDIOBJ::from(chrome_brush));
    }

    let border_pen = unsafe { CreatePen(PS_SOLID, 1, border) };
    let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(border_pen)) };
    unsafe {
        let _ = MoveToEx(hdc, 0, chrome_height.saturating_sub(1), None);
        let _ = LineTo(hdc, width, chrome_height.saturating_sub(1));
        let _ = SelectObject(hdc, old_pen);
        let _ = DeleteObject(HGDIOBJ::from(border_pen));
    }

    let font_face = to_wide_null("Segoe UI Variable Text");
    let font = unsafe {
        CreateFontW(
            -scale_dip_value(12, dpi).max(11),
            0,
            0,
            0,
            FW_MEDIUM.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            (DEFAULT_PITCH.0 as u32) | (FF_DONTCARE.0 as u32),
            PCWSTR(font_face.as_ptr()),
        )
    };
    let selected_font = if font.is_invalid() {
        unsafe { GetStockObject(DEFAULT_GUI_FONT) }
    } else {
        HGDIOBJ::from(font)
    };
    let old_font = unsafe { SelectObject(hdc, selected_font) };
    let old_bk_mode = unsafe { SetBkMode(hdc, TRANSPARENT) };

    draw_native_host_buttons(hdc, hwnd, state, dpi, width, hover, close_hover);
    draw_native_host_tabs(hdc, hwnd, state, dpi, active_tab_bg, border, text, muted);

    unsafe {
        if old_bk_mode != 0 {
            let _ = SetBkMode(
                hdc,
                windows::Win32::Graphics::Gdi::BACKGROUND_MODE(old_bk_mode as u32),
            );
        }
        let _ = SelectObject(hdc, old_font);
        if !font.is_invalid() {
            let _ = DeleteObject(HGDIOBJ::from(font));
        }
        let _ = EndPaint(hwnd, &ps);
    }
}

#[cfg(windows)]
fn draw_native_host_buttons(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    hwnd: windows::Win32::Foundation::HWND,
    state: &ActiveXHostWindowState,
    dpi: u32,
    client_width: i32,
    hover: windows::Win32::Foundation::COLORREF,
    close_hover: windows::Win32::Foundation::COLORREF,
) {
    let (minimize, maximize, close) = native_host_button_rects(hwnd, client_width);
    draw_native_host_button(
        hdc,
        RdpHostChromeButton::Minimize,
        minimize,
        state.chrome_hot_button == Some(RdpHostChromeButton::Minimize),
        state.chrome_pressed_button == Some(RdpHostChromeButton::Minimize),
        hover,
        false,
        dpi,
    );
    draw_native_host_button(
        hdc,
        RdpHostChromeButton::Maximize,
        maximize,
        state.chrome_hot_button == Some(RdpHostChromeButton::Maximize),
        state.chrome_pressed_button == Some(RdpHostChromeButton::Maximize),
        hover,
        unsafe { windows::Win32::UI::WindowsAndMessaging::IsZoomed(hwnd).as_bool() },
        dpi,
    );
    draw_native_host_button(
        hdc,
        RdpHostChromeButton::Close,
        close,
        state.chrome_hot_button == Some(RdpHostChromeButton::Close),
        state.chrome_pressed_button == Some(RdpHostChromeButton::Close),
        close_hover,
        false,
        dpi,
    );
}

#[cfg(windows)]
fn draw_native_host_button(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    button: RdpHostChromeButton,
    rect: windows::Win32::Foundation::RECT,
    hot: bool,
    pressed: bool,
    fill_color: windows::Win32::Foundation::COLORREF,
    restore: bool,
    dpi: u32,
) {
    use windows::Win32::Graphics::Gdi::{
        CreatePen, CreateSolidBrush, DeleteObject, RoundRect, SelectObject, HGDIOBJ, PS_SOLID,
    };

    if rect.right <= rect.left || rect.bottom <= rect.top {
        return;
    }

    if hot || pressed {
        let brush = unsafe { CreateSolidBrush(fill_color) };
        let pen = unsafe { CreatePen(PS_SOLID, 1, fill_color) };
        let old_brush = unsafe { SelectObject(hdc, HGDIOBJ::from(brush)) };
        let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(pen)) };
        unsafe {
            let _ = RoundRect(
                hdc,
                rect.left + 2,
                rect.top + 2,
                rect.right - 2,
                rect.bottom - 2,
                scale_dip_value(6, dpi),
                scale_dip_value(6, dpi),
            );
            let _ = SelectObject(hdc, old_pen);
            let _ = SelectObject(hdc, old_brush);
            let _ = DeleteObject(HGDIOBJ::from(brush));
            let _ = DeleteObject(HGDIOBJ::from(pen));
        }
    }

    let icon_color = if hot || pressed {
        if restore {
            rgb_color(33, 38, 46)
        } else if fill_color == rgb_color(216, 59, 59) {
            rgb_color(255, 255, 255)
        } else {
            rgb_color(33, 38, 46)
        }
    } else {
        rgb_color(33, 38, 46)
    };
    draw_native_host_button_glyph(hdc, rect, icon_color, button, restore);
}

#[cfg(windows)]
fn draw_native_host_button_glyph(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    rect: windows::Win32::Foundation::RECT,
    color: windows::Win32::Foundation::COLORREF,
    button: RdpHostChromeButton,
    restore: bool,
) {
    use windows::Win32::Graphics::Gdi::{
        CreatePen, DeleteObject, LineTo, MoveToEx, SelectObject, HGDIOBJ, PS_SOLID,
    };

    let pen = unsafe { CreatePen(PS_SOLID, 1, color) };
    let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(pen)) };
    let center_x = (rect.left + rect.right) / 2;
    let center_y = (rect.top + rect.bottom) / 2;
    let dpi = 96u32.saturating_mul((rect.bottom - rect.top).max(1) as u32)
        / (MX_RDP_CHROME_HEIGHT_DIP as u32);
    let half = (scale_dip_value(9, dpi).max(8) / 2).max(4);
    let restore_offset = scale_dip_value(3, dpi).max(2);

    unsafe {
        match button {
            RdpHostChromeButton::Minimize => {
                let _ = MoveToEx(hdc, center_x - half, center_y + half / 2, None);
                let _ = LineTo(hdc, center_x + half, center_y + half / 2);
            }
            RdpHostChromeButton::Maximize if restore => {
                let left = center_x - half;
                let top = center_y - half + 1;
                let right = center_x + half;
                let bottom = center_y + half;
                let offset = restore_offset;
                let _ = MoveToEx(hdc, left + offset, top - offset, None);
                let _ = LineTo(hdc, right + offset, top - offset);
                let _ = LineTo(hdc, right + offset, bottom - offset);
                let _ = LineTo(hdc, left + offset, bottom - offset);
                let _ = LineTo(hdc, left + offset, top - offset);
                let _ = MoveToEx(hdc, left, top, None);
                let _ = LineTo(hdc, right, top);
                let _ = LineTo(hdc, right, bottom);
                let _ = LineTo(hdc, left, bottom);
                let _ = LineTo(hdc, left, top);
            }
            RdpHostChromeButton::Maximize => {
                let left = center_x - half;
                let top = center_y - half;
                let right = center_x + half;
                let bottom = center_y + half;
                let _ = MoveToEx(hdc, left, top, None);
                let _ = LineTo(hdc, right, top);
                let _ = LineTo(hdc, right, bottom);
                let _ = LineTo(hdc, left, bottom);
                let _ = LineTo(hdc, left, top);
            }
            RdpHostChromeButton::Close => {
                let left = center_x - half;
                let top = center_y - half;
                let right = center_x + half;
                let bottom = center_y + half;
                let _ = MoveToEx(hdc, left, top, None);
                let _ = LineTo(hdc, right, bottom);
                let _ = MoveToEx(hdc, right, top, None);
                let _ = LineTo(hdc, left, bottom);
            }
        }
        let _ = SelectObject(hdc, old_pen);
        let _ = DeleteObject(HGDIOBJ::from(pen));
    }
}

#[cfg(windows)]
fn draw_native_host_tabs(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    hwnd: windows::Win32::Foundation::HWND,
    state: &ActiveXHostWindowState,
    dpi: u32,
    active_tab_bg: windows::Win32::Foundation::COLORREF,
    _border: windows::Win32::Foundation::COLORREF,
    text: windows::Win32::Foundation::COLORREF,
    muted: windows::Win32::Foundation::COLORREF,
) {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        CreatePen, CreateSolidBrush, DeleteObject, DrawTextW, RoundRect, SelectObject,
        SetTextColor, DT_END_ELLIPSIS, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, HGDIOBJ, PS_SOLID,
    };

    let Some((client_width, _)) = client_size_for_window(hwnd) else {
        return;
    };
    let rects = native_host_tab_rects(hwnd, client_width, state);
    for (index, rect) in rects {
        let active = index == state.active_index;
        if active {
            let brush = unsafe { CreateSolidBrush(active_tab_bg) };
            let pen = unsafe { CreatePen(PS_SOLID, 1, active_tab_bg) };
            let old_brush = unsafe { SelectObject(hdc, HGDIOBJ::from(brush)) };
            let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(pen)) };
            unsafe {
                let _ = RoundRect(
                    hdc,
                    rect.left,
                    rect.top,
                    rect.right - 1,
                    rect.bottom - 1,
                    scale_dip_value(7, dpi),
                    scale_dip_value(7, dpi),
                );
                let _ = SelectObject(hdc, old_pen);
                let _ = SelectObject(hdc, old_brush);
                let _ = DeleteObject(HGDIOBJ::from(brush));
                let _ = DeleteObject(HGDIOBJ::from(pen));
            }
        }

        let title = state
            .sessions
            .get(index)
            .map(|session| session.title.clone())
            .unwrap_or_else(|| "已关闭".to_string());
        let mut wide = to_wide_null(&title);
        let mut text_rect = RECT {
            left: rect.left + scale_dip_value(10, dpi),
            top: rect.top,
            right: (rect.right - scale_dip_value(30, dpi)).max(rect.left + 1),
            bottom: rect.bottom,
        };
        let old_text = unsafe { SetTextColor(hdc, if active { text } else { muted }) };
        unsafe {
            let _ = DrawTextW(
                hdc,
                &mut wide,
                &mut text_rect,
                DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX,
            );
            let _ = SetTextColor(hdc, old_text);
        }
        draw_native_host_tab_close(hdc, index, rect, state, dpi, muted);
    }
}

#[cfg(windows)]
fn draw_native_host_tab_close(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    index: usize,
    tab_rect: windows::Win32::Foundation::RECT,
    state: &ActiveXHostWindowState,
    dpi: u32,
    color: windows::Win32::Foundation::COLORREF,
) {
    use windows::Win32::Graphics::Gdi::{
        CreatePen, CreateSolidBrush, DeleteObject, LineTo, MoveToEx, RoundRect, SelectObject,
        HGDIOBJ, PS_SOLID,
    };

    let rect = native_host_tab_close_rect(&tab_rect, dpi);
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return;
    }

    let hot = state.chrome_hot_tab_close == Some(index);
    let pressed = state.chrome_pressed_tab_close == Some(index);
    if hot || pressed {
        let fill = if pressed {
            rgb_color(218, 222, 228)
        } else {
            rgb_color(232, 235, 240)
        };
        let brush = unsafe { CreateSolidBrush(fill) };
        let pen = unsafe { CreatePen(PS_SOLID, 1, fill) };
        let old_brush = unsafe { SelectObject(hdc, HGDIOBJ::from(brush)) };
        let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(pen)) };
        unsafe {
            let _ = RoundRect(
                hdc,
                rect.left,
                rect.top,
                rect.right,
                rect.bottom,
                scale_dip_value(6, dpi),
                scale_dip_value(6, dpi),
            );
            let _ = SelectObject(hdc, old_pen);
            let _ = SelectObject(hdc, old_brush);
            let _ = DeleteObject(HGDIOBJ::from(brush));
            let _ = DeleteObject(HGDIOBJ::from(pen));
        }
    }

    let glyph_color = if hot || pressed {
        rgb_color(60, 66, 74)
    } else {
        color
    };
    let pen = unsafe { CreatePen(PS_SOLID, 1, glyph_color) };
    let old_pen = unsafe { SelectObject(hdc, HGDIOBJ::from(pen)) };
    let inset = scale_dip_value(4, dpi).max(4);
    unsafe {
        let _ = MoveToEx(hdc, rect.left + inset, rect.top + inset, None);
        let _ = LineTo(hdc, rect.right - inset, rect.bottom - inset);
        let _ = MoveToEx(hdc, rect.right - inset, rect.top + inset, None);
        let _ = LineTo(hdc, rect.left + inset, rect.bottom - inset);
        let _ = SelectObject(hdc, old_pen);
        let _ = DeleteObject(HGDIOBJ::from(pen));
    }
}

#[cfg(windows)]
fn normalize_desktop_scale_factor(value: u32) -> u32 {
    value.clamp(100, 500)
}

#[cfg(windows)]
fn configure_classic_activex_password_prompting(dispatch: &windows::Win32::System::Com::IDispatch) {
    put_activex_property_id_optional(dispatch, "PromptForCredentials", 15, false.into());
    put_activex_property_id_optional(dispatch, "PromptForCredsOnClient", 30, false.into());
    put_activex_property_id_optional(dispatch, "AllowPromptingForCredentials", 41, false.into());
    put_activex_property_id_optional(dispatch, "AllowCredentialSaving", 29, false.into());
    put_activex_property_id_optional(dispatch, "WarnAboutSendingCredentials", 23, false.into());
}

#[cfg(windows)]
fn configure_classic_activex_password_prompting_interfaces(
    dispatch: &windows::Win32::System::Com::IDispatch,
    config: &ActiveXRdpConfig,
) {
    use windows::core::Interface;

    if let Ok(non_scriptable3) = dispatch.cast::<IMsRdpClientNonScriptable3>() {
        unsafe {
            let _ = non_scriptable3.set_prompt_for_credentials(false);
            let _ = non_scriptable3.set_warn_about_sending_credentials(false);
            let _ = non_scriptable3.set_enable_credssp_support(!matches!(
                config.nla,
                RdpNetworkLevelAuthentication::Disabled
            ));
        }
    }
    if let Ok(non_scriptable4) = dispatch.cast::<IMsRdpClientNonScriptable4>() {
        unsafe {
            let _ = non_scriptable4.set_allow_credential_saving(false);
            let _ = non_scriptable4.set_prompt_for_creds_on_client(false);
        }
    }
    if let Ok(non_scriptable5) = dispatch.cast::<IMsRdpClientNonScriptable5>() {
        unsafe {
            let _ = non_scriptable5.set_allow_prompting_for_credentials(false);
            let _ = non_scriptable5.set_use_multimon(config.use_multimon);
        }
    }
}

#[cfg(windows)]
fn set_classic_activex_password(
    dispatch: &windows::Win32::System::Com::IDispatch,
    password: &str,
) -> Result<(), AppError> {
    use windows::core::{Interface, BSTR};

    let non_scriptable = dispatch.cast::<IMsTscNonScriptable>().map_err(|error| {
        AppError::new(
            "rdp_activex_password_failed",
            "RDP ActiveX 密码注入失败。",
            format!("IMsTscNonScriptable query failed: {error}"),
            true,
        )
    })?;
    let password = BSTR::from(password);
    unsafe { non_scriptable.set_clear_text_password(&password) }.map_err(|error| {
        AppError::new(
            "rdp_activex_password_failed",
            "RDP ActiveX 密码注入失败。",
            error.to_string(),
            true,
        )
    })
}

#[cfg(windows)]
fn connect_activex_client(client: &HostedActiveXClient) -> Result<(), AppError> {
    match client {
        HostedActiveXClient::Modern(client) => unsafe { client.Connect() }.map_err(|error| {
            AppError::new(
                "rdp_activex_connect_failed",
                "RDP ActiveX 连接失败。",
                error.to_string(),
                true,
            )
        }),
        HostedActiveXClient::Classic(dispatch) => invoke_activex_method_id(dispatch, "Connect", 30),
    }
}

#[cfg(windows)]
fn disconnect_activex_client(client: &HostedActiveXClient) -> Result<(), AppError> {
    match client {
        HostedActiveXClient::Modern(client) => unsafe { client.Disconnect() }.map_err(|error| {
            AppError::new(
                "rdp_activex_disconnect_failed",
                "RDP ActiveX 断开失败。",
                error.to_string(),
                true,
            )
        }),
        HostedActiveXClient::Classic(dispatch) => {
            invoke_activex_method_id(dispatch, "Disconnect", 31)
        }
    }
}

#[cfg(windows)]
fn get_activex_dispatch_id(
    dispatch: &windows::Win32::System::Com::IDispatch,
    names: &[(&str, i32)],
) -> Option<windows::Win32::System::Com::IDispatch> {
    names.iter().find_map(|(name, dispid)| {
        get_activex_property_id(dispatch, name, *dispid)
            .ok()
            .and_then(|variant| windows::Win32::System::Com::IDispatch::try_from(&variant).ok())
    })
}

#[cfg(windows)]
fn put_activex_property_id_optional(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    dispid: i32,
    value: windows::Win32::System::Variant::VARIANT,
) {
    let _ = put_activex_property_id(dispatch, name, dispid, value);
}

#[cfg(windows)]
fn put_activex_property_by_name_optional(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    value: windows::Win32::System::Variant::VARIANT,
) {
    let _ = put_activex_property_by_name(dispatch, name, value);
}

#[cfg(windows)]
fn put_activex_property_by_name(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    value: windows::Win32::System::Variant::VARIANT,
) -> Result<(), AppError> {
    use windows::core::PCWSTR;

    let wide = to_wide_null(name);
    let name_ptr = PCWSTR(wide.as_ptr());
    let mut dispid = 0i32;
    unsafe {
        dispatch
            .GetIDsOfNames(
                &windows::core::GUID::zeroed(),
                &name_ptr,
                1,
                0x0409,
                &mut dispid,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_property_failed",
                    "RDP ActiveX 属性定位失败。",
                    format!("{name}: {error}"),
                    true,
                )
            })?;
    }
    put_activex_property_id(dispatch, name, dispid, value)
}

#[cfg(windows)]
fn put_activex_property_id(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    dispid: i32,
    mut value: windows::Win32::System::Variant::VARIANT,
) -> Result<(), AppError> {
    use windows::Win32::System::Com::{DISPATCH_PROPERTYPUT, DISPPARAMS};
    use windows::Win32::System::Ole::DISPID_PROPERTYPUT;

    let mut named_arg = DISPID_PROPERTYPUT;
    let params = DISPPARAMS {
        rgvarg: &mut value,
        rgdispidNamedArgs: &mut named_arg,
        cArgs: 1,
        cNamedArgs: 1,
    };
    unsafe {
        dispatch
            .Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0x0409,
                DISPATCH_PROPERTYPUT,
                &params,
                None,
                None,
                None,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_property_failed",
                    "RDP ActiveX 属性写入失败。",
                    format!("{name}({dispid}): {error}"),
                    true,
                )
            })
    }
}

#[cfg(windows)]
fn get_activex_property_id(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    dispid: i32,
) -> Result<windows::Win32::System::Variant::VARIANT, AppError> {
    use windows::Win32::System::Com::{DISPATCH_PROPERTYGET, DISPPARAMS};

    let params = DISPPARAMS::default();
    let mut result = windows::Win32::System::Variant::VARIANT::default();
    unsafe {
        dispatch
            .Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0x0409,
                DISPATCH_PROPERTYGET,
                &params,
                Some(&mut result),
                None,
                None,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_property_failed",
                    "RDP ActiveX 属性读取失败。",
                    format!("{name}({dispid}): {error}"),
                    true,
                )
            })?;
    }
    Ok(result)
}

#[cfg(windows)]
fn invoke_activex_method_id(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    dispid: i32,
) -> Result<(), AppError> {
    use windows::Win32::System::Com::{DISPATCH_METHOD, DISPPARAMS};

    let params = DISPPARAMS::default();
    unsafe {
        dispatch
            .Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0x0409,
                DISPATCH_METHOD,
                &params,
                None,
                None,
                None,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_method_failed",
                    "RDP ActiveX 方法调用失败。",
                    format!("{name}({dispid}): {error}"),
                    true,
                )
            })
    }
}

#[cfg(windows)]
fn invoke_activex_method_by_name(
    dispatch: &windows::Win32::System::Com::IDispatch,
    name: &str,
    mut args: Vec<windows::Win32::System::Variant::VARIANT>,
) -> Result<(), AppError> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{DISPATCH_METHOD, DISPPARAMS};

    let wide_name = to_wide_null(name);
    let name_ptr = PCWSTR(wide_name.as_ptr());
    let mut dispid = 0;
    unsafe {
        dispatch
            .GetIDsOfNames(
                &windows::core::GUID::zeroed(),
                &name_ptr,
                1,
                0x0409,
                &mut dispid,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_method_failed",
                    "RDP ActiveX 方法查找失败。",
                    format!("{name}: {error}"),
                    true,
                )
            })?;
        let params = DISPPARAMS {
            rgvarg: args.as_mut_ptr(),
            rgdispidNamedArgs: std::ptr::null_mut(),
            cArgs: args.len().min(u32::MAX as usize) as u32,
            cNamedArgs: 0,
        };
        dispatch
            .Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0x0409,
                DISPATCH_METHOD,
                &params,
                None,
                None,
                None,
            )
            .map_err(|error| {
                AppError::new(
                    "rdp_activex_method_failed",
                    "RDP ActiveX 方法调用失败。",
                    format!("{name}({dispid}): {error}"),
                    true,
                )
            })
    }
}

fn audio_mode_i32(mode: &RdpAudioMode) -> i32 {
    match mode {
        RdpAudioMode::Local => 0,
        RdpAudioMode::Remote => 1,
        RdpAudioMode::Disabled => 2,
    }
}

#[cfg(windows)]
fn certificate_authentication_level(policy: &RdpCertificatePolicy) -> i32 {
    match policy {
        RdpCertificatePolicy::Trust => 0,
        RdpCertificatePolicy::Strict => 1,
        RdpCertificatePolicy::Prompt => 2,
    }
}

#[cfg(windows)]
fn gateway_usage_method(mode: &RdpGatewayMode) -> i32 {
    match mode {
        RdpGatewayMode::Disabled => 0,
        RdpGatewayMode::Explicit => 1,
        RdpGatewayMode::Auto => 2,
    }
}

#[cfg(windows)]
fn safe_i32(value: u32) -> i32 {
    value.min(i32::MAX as u32) as i32
}

#[cfg(windows)]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn activex_error(code: &str, message: &str, error: impl std::fmt::Debug) -> AppError {
    AppError::new(code, message, format!("{error:?}"), true)
}

#[cfg(windows)]
fn with_activex_control_context(control_name: &str, stage: &str, error: AppError) -> AppError {
    AppError::new(
        &error.code,
        &format!("{}（控件：{}）", error.message, control_name),
        format!("{stage} {control_name}: {}", error.raw_message),
        error.recoverable,
    )
}

#[cfg(test)]
mod tests {
    use super::serialize_rdp_file;
    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionCredentialMode, ConnectionJumpConfig,
        ConnectionProfile, ConnectionProtocol, ConnectionProxyConfig, RdpCertificatePolicy,
        RdpConnectionConfig, RdpPerformanceConfig, RdpPerformancePreset, RdpSecurityConfig,
    };

    fn rdp_profile() -> ConnectionProfile {
        ConnectionProfile {
            id: "rdp-1".to_string(),
            name: "RDP 1".to_string(),
            protocol: ConnectionProtocol::Rdp,
            group: None,
            host: "192.0.2.40".to_string(),
            port: 3389,
            username: r"MicrosoftAccount\user@example.com".to_string(),
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
            created_at: "2026-06-24T00:00:00+08:00".to_string(),
            updated_at: "2026-06-24T00:00:00+08:00".to_string(),
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        }
    }

    fn config_with_certificate_policy(policy: RdpCertificatePolicy) -> RdpConnectionConfig {
        RdpConnectionConfig {
            security: RdpSecurityConfig {
                certificate_policy: policy,
                ..RdpSecurityConfig::default()
            },
            ..RdpConnectionConfig::default()
        }
    }

    #[test]
    fn rdp_prompt_certificate_policy_allows_mstsc_warning_continue() {
        let content = serialize_rdp_file(
            &rdp_profile(),
            &config_with_certificate_policy(RdpCertificatePolicy::Prompt),
        )
        .unwrap();

        assert!(content.contains("authentication level:i:2\r\n"));
    }

    #[test]
    fn rdp_certificate_policy_maps_trust_and_strict() {
        let trust = serialize_rdp_file(
            &rdp_profile(),
            &config_with_certificate_policy(RdpCertificatePolicy::Trust),
        )
        .unwrap();
        let strict = serialize_rdp_file(
            &rdp_profile(),
            &config_with_certificate_policy(RdpCertificatePolicy::Strict),
        )
        .unwrap();

        assert!(trust.contains("authentication level:i:0\r\n"));
        assert!(strict.contains("authentication level:i:1\r\n"));
    }

    #[test]
    fn rdp_default_experience_enables_desktop_composition() {
        let content = serialize_rdp_file(&rdp_profile(), &RdpConnectionConfig::default()).unwrap();

        assert!(content.contains("session bpp:i:32\r\n"));
        assert!(content.contains("connection type:i:7\r\n"));
        assert!(content.contains("allow font smoothing:i:1\r\n"));
        assert!(content.contains("allow desktop composition:i:1\r\n"));
        assert!(content.contains("disable themes:i:0\r\n"));
        assert!(content.contains("disable full window drag:i:0\r\n"));
        assert!(content.contains("disable menu anims:i:0\r\n"));
    }

    #[test]
    fn rdp_low_bandwidth_experience_disables_desktop_composition() {
        let content = serialize_rdp_file(
            &rdp_profile(),
            &RdpConnectionConfig {
                performance: RdpPerformanceConfig {
                    preset: RdpPerformancePreset::LowBandwidth,
                    ..RdpPerformanceConfig::default()
                },
                ..RdpConnectionConfig::default()
            },
        )
        .unwrap();

        assert!(content.contains("session bpp:i:16\r\n"));
        assert!(content.contains("allow desktop composition:i:0\r\n"));
        assert!(content.contains("disable themes:i:1\r\n"));
        assert!(content.contains("disable cursor setting:i:1\r\n"));
    }
}
