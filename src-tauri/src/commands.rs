use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::app_error::AppError;
use crate::connections::{ConnectionProfile, ConnectionProfileInput, ConnectionStore};
use crate::remote_files::{
    RemoteFileEntry, RemoteFileManager, RemoteFileMetadata, RemoteFileReadResult,
    RemoteFileWriteResult,
};
use crate::terminal::manager::TerminalManager;

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
pub struct RemoteFileReadRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileWriteRequest {
    pub connection_id: String,
    pub path: String,
    pub content: String,
    pub expected_mtime: u64,
    pub expected_size: u64,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFilePathRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileRenameRequest {
    pub connection_id: String,
    pub path: String,
    pub new_path: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileDeleteRequest {
    pub connection_id: String,
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileUploadFileRequest {
    pub connection_id: String,
    pub path: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct RemoteFileDownloadResult {
    pub path: String,
    pub name: String,
    pub content: Vec<u8>,
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
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileListRequest,
) -> Result<Vec<RemoteFileEntry>, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = request
        .path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(".");
    manager.list_directory(profile, path).await
}

#[tauri::command]
pub async fn remote_file_read(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileReadRequest,
) -> Result<RemoteFileReadResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.read_file(profile, path).await
}

#[tauri::command]
pub async fn remote_file_write(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileWriteRequest,
) -> Result<RemoteFileWriteResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager
        .write_file(
            profile,
            path,
            &request.content,
            request.expected_mtime,
            request.expected_size,
            request.overwrite,
        )
        .await
}

#[tauri::command]
pub async fn remote_file_create_file(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFileMetadata, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.create_file(profile, path).await
}

#[tauri::command]
pub async fn remote_file_create_directory(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<(), AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.create_directory(profile, path).await
}

#[tauri::command]
pub async fn remote_file_rename(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileRenameRequest,
) -> Result<(), AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let new_path = require_remote_path(&request.new_path)?;
    manager.rename_entry(profile, path, new_path).await
}

#[tauri::command]
pub async fn remote_file_delete(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileDeleteRequest,
) -> Result<(), AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.delete_entry(profile, path, request.recursive).await
}

#[tauri::command]
pub async fn remote_file_upload_file(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadFileRequest,
) -> Result<RemoteFileMetadata, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.upload_file(profile, path, &request.content).await
}

#[tauri::command]
pub async fn remote_file_download(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFileDownloadResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let content = manager.download_file(profile, path).await?;
    Ok(RemoteFileDownloadResult {
        name: path
            .rsplit('/')
            .find(|segment| !segment.is_empty())
            .unwrap_or(path)
            .to_string(),
        path: path.to_string(),
        content,
    })
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

fn load_remote_connection_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ConnectionProfile, AppError> {
    let connection_id = connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "remote_file_connection_missing",
            "请选择活动连接。",
            "connection_id is empty",
            false,
        ));
    }

    load_connection_profile(app, connection_id)
}

fn require_remote_path(path: &str) -> Result<&str, AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::new(
            "remote_file_path_missing",
            "请选择远程路径。",
            "path is empty",
            true,
        ));
    }

    Ok(path)
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
