use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::app_error::AppError;
use crate::connections::{ConnectionProfile, ConnectionProfileInput, ConnectionStore};
use crate::remote_files::{build_remote_list_command, parse_remote_list_output, RemoteFileEntry};
use crate::terminal::manager::TerminalManager;
use crate::terminal::session::TerminalSession;

#[derive(Debug, Deserialize)]
pub struct TerminalConnectRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileListRequest {
    pub connection_id: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionLatencyProbeRequest {
    pub connection_id: String,
}

#[derive(Debug, Serialize)]
pub struct ConnectionLatencyProbeResult {
    pub latency_ms: Option<u64>,
    pub reachable: bool,
}

#[tauri::command]
pub async fn terminal_connect(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    mut request: TerminalConnectRequest,
) -> Result<String, AppError> {
    if let Some(connection_id) = request
        .connection_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let profile = load_connection_profile(&app, connection_id)?;
        request.host = profile.host;
        request.port = profile.port;
        request.username = profile.username;
        request.password = profile.password;
        request.private_key_path = profile.private_key_path;
        request.private_key_passphrase = profile.private_key_passphrase;
    }

    manager.connect(app, request).await
}

#[tauri::command]
pub async fn terminal_write(
    manager: State<'_, TerminalManager>,
    request: TerminalWriteRequest,
) -> Result<(), AppError> {
    manager.write(request).await
}

#[tauri::command]
pub async fn terminal_resize(
    manager: State<'_, TerminalManager>,
    request: TerminalResizeRequest,
) -> Result<(), AppError> {
    manager.resize(request).await
}

#[tauri::command]
pub async fn terminal_close(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), AppError> {
    manager.close(session_id).await
}

#[tauri::command]
pub async fn remote_file_list(
    app: AppHandle,
    request: RemoteFileListRequest,
) -> Result<Vec<RemoteFileEntry>, AppError> {
    let connection_id = request.connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "remote_file_connection_missing",
            "请选择活动连接。",
            "connection_id is empty",
            false,
        ));
    }

    let profile = load_connection_profile(&app, connection_id)?;
    let path = request
        .path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(".");
    let output = TerminalSession::exec(
        TerminalConnectRequest {
            request_id: None,
            connection_id: Some(profile.id),
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password: profile.password,
            private_key_path: profile.private_key_path,
            private_key_passphrase: profile.private_key_passphrase,
            cols: 80,
            rows: 24,
        },
        &build_remote_list_command(path),
    )
    .await?;

    if output.exit_status != Some(0) {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::new(
            "remote_file_list_failed",
            "远程目录读取失败。",
            detail.trim(),
            true,
        ));
    }

    Ok(parse_remote_list_output(&output.stdout))
}

#[tauri::command]
pub async fn connection_list(app: AppHandle) -> Result<Vec<ConnectionProfile>, AppError> {
    let store = ConnectionStore::load(connection_store_path(&app)?)?;
    Ok(store.list())
}

#[tauri::command]
pub async fn connection_upsert(
    app: AppHandle,
    request: ConnectionProfileInput,
) -> Result<ConnectionProfile, AppError> {
    let mut store = ConnectionStore::load(connection_store_path(&app)?)?;
    store.upsert(request, &now_timestamp()?)
}

#[tauri::command]
pub async fn connection_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    let mut store = ConnectionStore::load(connection_store_path(&app)?)?;
    store.delete(id.trim())
}

#[tauri::command]
pub async fn connection_probe_latency(
    app: AppHandle,
    request: ConnectionLatencyProbeRequest,
) -> Result<ConnectionLatencyProbeResult, AppError> {
    let connection_id = request.connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "connection_probe_connection_missing",
            "请选择要探测的连接。",
            "connection_id is empty",
            false,
        ));
    }

    let profile = load_connection_profile(&app, connection_id)?;
    let host = profile.host;
    let port = profile.port;
    tauri::async_runtime::spawn_blocking(move || probe_tcp_latency(&host, port))
        .await
        .map_err(|error| {
            AppError::new(
                "connection_probe_join_failed",
                "延迟探测失败。",
                error,
                true,
            )
        })
}

fn load_connection_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ConnectionProfile, AppError> {
    let store = ConnectionStore::load(connection_store_path(app)?)?;
    store.get(connection_id).ok_or_else(|| {
        AppError::new(
            "connection_missing",
            "连接不存在。",
            format!("connection_id={connection_id}"),
            false,
        )
    })
}

fn connection_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "connection_store_path_failed",
            "连接仓库路径获取失败。",
            error,
            true,
        )
    })?;
    Ok(app_data_dir.join("connections.json"))
}

fn now_timestamp() -> Result<String, AppError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            AppError::new("connection_clock_invalid", "系统时间异常。", error, false)
        })?;
    Ok(duration.as_secs().to_string())
}

fn probe_tcp_latency(host: &str, port: u16) -> ConnectionLatencyProbeResult {
    let timeout = Duration::from_secs(2);
    let started = Instant::now();
    let addresses = match (host, port).to_socket_addrs() {
        Ok(addresses) => addresses.take(4).collect::<Vec<_>>(),
        Err(_) => return unreachable_latency(),
    };

    for address in addresses {
        if TcpStream::connect_timeout(&address, timeout).is_ok() {
            let latency_ms = started
                .elapsed()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64;
            return ConnectionLatencyProbeResult {
                latency_ms: Some(latency_ms),
                reachable: true,
            };
        }
    }

    unreachable_latency()
}

fn unreachable_latency() -> ConnectionLatencyProbeResult {
    ConnectionLatencyProbeResult {
        latency_ms: None,
        reachable: false,
    }
}
