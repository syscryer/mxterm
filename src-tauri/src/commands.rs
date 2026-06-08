use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::app_error::AppError;
use crate::connections::{ConnectionProfile, ConnectionProfileInput, ConnectionStore};
use crate::remote_files::{
    RemoteFileArchiveUploadResult, RemoteFileEntry, RemoteFileEntryMetadata,
    RemoteFileManager, RemoteFileMetadata, RemoteFileReadResult, RemoteFileUploadResult,
    RemoteFileWriteResult, TransferConflictPolicy,
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
    #[serde(default)]
    pub conflict_policy: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileUploadArchiveRequest {
    pub connection_id: String,
    pub target_dir: String,
    pub root_name: String,
    pub archive_content: Vec<u8>,
    #[serde(default)]
    pub conflict_policy: Option<String>,
    #[serde(default)]
    pub keep_archive: bool,
}

#[derive(Debug, Serialize)]
pub struct RemoteFileDownloadResult {
    pub path: String,
    pub name: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileDownloadToLocalRequest {
    pub connection_id: String,
    pub path: String,
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub download_root: Option<String>,
    #[serde(default)]
    pub session_name: Option<String>,
    #[serde(default)]
    pub timestamp_name: Option<String>,
    #[serde(default)]
    pub group_by_session: bool,
    #[serde(default)]
    pub timestamp_directory: bool,
    #[serde(default)]
    pub keep_archives: bool,
    #[serde(default)]
    pub conflict_policy: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RemoteFileDownloadToLocalResult {
    pub remote_path: String,
    pub name: String,
    pub local_path: String,
    pub local_directory: String,
    pub archive_path: Option<String>,
    pub skipped: bool,
    pub directory: bool,
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
pub async fn remote_file_metadata(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFileEntryMetadata, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.entry_metadata(profile, path).await
}

#[tauri::command]
pub async fn remote_file_upload_file(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadFileRequest,
) -> Result<RemoteFileUploadResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager
        .upload_file(
            profile,
            path,
            &request.content,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
        )
        .await
}

#[tauri::command]
pub async fn remote_file_upload_archive(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadArchiveRequest,
) -> Result<RemoteFileArchiveUploadResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let target_dir = require_remote_path(&request.target_dir)?;
    let root_name = require_safe_name(&request.root_name, "remote_file_archive_root_missing")?;
    manager
        .upload_archive(
            profile,
            target_dir,
            root_name,
            &request.archive_content,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
            request.keep_archive,
        )
        .await
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
pub async fn remote_file_download_to_local(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileDownloadToLocalRequest,
) -> Result<RemoteFileDownloadToLocalResult, AppError> {
    let profile = load_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let name = remote_path_name(path);
    let policy = TransferConflictPolicy::from_request(request.conflict_policy.as_deref());
    let local_directory = resolve_download_directory(&app, &request)?;

    if request.directory {
        let target = local_directory.join(sanitize_local_path_segment(&name));
        let (skipped, target) = resolve_local_conflict(&target, policy, false)?;
        if skipped {
            return Ok(RemoteFileDownloadToLocalResult {
                archive_path: None,
                directory: true,
                local_directory: local_directory.to_string_lossy().to_string(),
                local_path: target.to_string_lossy().to_string(),
                name,
                remote_path: path.to_string(),
                skipped: true,
            });
        }

        let content = manager.download_archive(profile, path).await?;
        fs::create_dir_all(&local_directory).map_err(|error| {
            AppError::new(
                "remote_file_download_create_dir_failed",
                "本地下载目录创建失败。",
                error,
                true,
            )
        })?;

        let archive_path = if request.keep_archives {
            let archive_target =
                local_directory.join(format!("{}.tar.gz", sanitize_local_path_segment(&name)));
            resolve_local_conflict(&archive_target, TransferConflictPolicy::Rename, true)?.1
        } else {
            std::env::temp_dir().join(format!(
                "mxterm-download-{}-{}.tar.gz",
                now_millis(),
                sanitize_local_path_segment(&name)
            ))
        };
        fs::write(&archive_path, content).map_err(|error| {
            AppError::new(
                "remote_file_download_write_failed",
                "本地归档写入失败。",
                error,
                true,
            )
        })?;

        unpack_remote_directory_archive(&archive_path, &local_directory, &name, &target, policy)?;
        if !request.keep_archives {
            let _ = fs::remove_file(&archive_path);
        }

        Ok(RemoteFileDownloadToLocalResult {
            archive_path: request
                .keep_archives
                .then(|| archive_path.to_string_lossy().to_string()),
            directory: true,
            local_directory: local_directory.to_string_lossy().to_string(),
            local_path: target.to_string_lossy().to_string(),
            name,
            remote_path: path.to_string(),
            skipped: false,
        })
    } else {
        let target = local_directory.join(sanitize_local_path_segment(&name));
        let (skipped, target) = resolve_local_conflict(&target, policy, true)?;
        if skipped {
            return Ok(RemoteFileDownloadToLocalResult {
                archive_path: None,
                directory: false,
                local_directory: local_directory.to_string_lossy().to_string(),
                local_path: target.to_string_lossy().to_string(),
                name,
                remote_path: path.to_string(),
                skipped: true,
            });
        }

        let content = manager.download_file(profile, path).await?;
        fs::create_dir_all(&local_directory).map_err(|error| {
            AppError::new(
                "remote_file_download_create_dir_failed",
                "本地下载目录创建失败。",
                error,
                true,
            )
        })?;
        fs::write(&target, content).map_err(|error| {
            AppError::new(
                "remote_file_download_write_failed",
                "本地文件写入失败。",
                error,
                true,
            )
        })?;

        Ok(RemoteFileDownloadToLocalResult {
            archive_path: None,
            directory: false,
            local_directory: local_directory.to_string_lossy().to_string(),
            local_path: target.to_string_lossy().to_string(),
            name,
            remote_path: path.to_string(),
            skipped: false,
        })
    }
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

fn require_safe_name<'a>(name: &'a str, code: &str) -> Result<&'a str, AppError> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(AppError::new(
            code,
            "请输入有效名称。",
            format!("invalid name={name:?}"),
            true,
        ));
    }

    Ok(name)
}

fn resolve_download_directory(
    app: &AppHandle,
    request: &RemoteFileDownloadToLocalRequest,
) -> Result<PathBuf, AppError> {
    let root = match request.download_root.as_ref().map(|value| value.trim()) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => app.path().download_dir().map_err(|error| {
            AppError::new(
                "remote_file_download_root_failed",
                "系统下载目录获取失败。",
                error,
                true,
            )
        })?,
    };

    let mut directory = root;
    if request.group_by_session {
        directory.push(sanitize_local_path_segment(
            request
                .session_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("mxterm-session"),
        ));
    }
    if request.timestamp_directory {
        directory.push(sanitize_local_path_segment(
            request
                .timestamp_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("download"),
        ));
    }

    Ok(directory)
}

fn resolve_local_conflict(
    target: &Path,
    policy: TransferConflictPolicy,
    file_like: bool,
) -> Result<(bool, PathBuf), AppError> {
    if !target.exists() {
        return Ok((false, target.to_path_buf()));
    }

    match policy {
        TransferConflictPolicy::Skip => Ok((true, target.to_path_buf())),
        TransferConflictPolicy::Overwrite => {
            remove_local_target(target)?;
            Ok((false, target.to_path_buf()))
        }
        TransferConflictPolicy::Rename => {
            let parent = target.parent().unwrap_or_else(|| Path::new("."));
            let file_name = target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("download");
            let (stem, extension) = split_local_name(file_name, file_like);
            for index in 1..10_000 {
                let candidate_name = if extension.is_empty() {
                    format!("{stem} ({index})")
                } else {
                    format!("{stem} ({index}).{extension}")
                };
                let candidate = parent.join(candidate_name);
                if !candidate.exists() {
                    return Ok((false, candidate));
                }
            }
            Err(AppError::new(
                "remote_file_download_rename_failed",
                "本地同名文件过多，无法自动重命名。",
                target.to_string_lossy(),
                true,
            ))
        }
    }
}

fn remove_local_target(target: &Path) -> Result<(), AppError> {
    if target.is_dir() {
        fs::remove_dir_all(target)
    } else {
        fs::remove_file(target)
    }
    .map_err(|error| {
        AppError::new(
            "remote_file_download_overwrite_failed",
            "本地同名目标覆盖失败。",
            error,
            true,
        )
    })
}

fn unpack_remote_directory_archive(
    archive_path: &Path,
    local_directory: &Path,
    root_name: &str,
    target: &Path,
    policy: TransferConflictPolicy,
) -> Result<(), AppError> {
    fs::create_dir_all(local_directory).map_err(|error| {
        AppError::new(
            "remote_file_download_create_dir_failed",
            "本地下载目录创建失败。",
            error,
            true,
        )
    })?;
    if target.exists() {
        match policy {
            TransferConflictPolicy::Skip => return Ok(()),
            TransferConflictPolicy::Overwrite => remove_local_target(target)?,
            TransferConflictPolicy::Rename => {}
        }
    }

    let tmp_dir = local_directory.join(format!(".mxterm-extract-{}", now_millis()));
    fs::create_dir_all(&tmp_dir).map_err(|error| {
        AppError::new(
            "remote_file_download_extract_dir_failed",
            "本地解压临时目录创建失败。",
            error,
            true,
        )
    })?;

    let output = Command::new("tar")
        .arg("-xzf")
        .arg(archive_path)
        .arg("-C")
        .arg(&tmp_dir)
        .output()
        .map_err(|error| {
            AppError::new(
                "remote_file_download_extract_start_failed",
                "本地 tar 解压启动失败。",
                error,
                true,
            )
        })?;
    if !output.status.success() {
        let detail = if output.stderr.is_empty() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            String::from_utf8_lossy(&output.stderr).to_string()
        };
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(AppError::new(
            "remote_file_download_extract_failed",
            "本地目录解压失败。",
            detail.trim(),
            true,
        ));
    }

    let extracted = tmp_dir.join(root_name);
    if !extracted.exists() {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(AppError::new(
            "remote_file_download_extract_missing",
            "本地解压结果缺少目录根。",
            root_name,
            true,
        ));
    }
    fs::rename(&extracted, target).or_else(|_| {
        copy_local_directory(&extracted, target)?;
        fs::remove_dir_all(&extracted)
    }).map_err(|error| {
        AppError::new(
            "remote_file_download_extract_move_failed",
            "本地解压结果移动失败。",
            error,
            true,
        )
    })?;
    let _ = fs::remove_dir_all(&tmp_dir);
    Ok(())
}

fn copy_local_directory(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_local_directory(&source, &target)?;
        } else {
            fs::copy(&source, &target)?;
        }
    }
    Ok(())
}

fn split_local_name(name: &str, file_like: bool) -> (String, String) {
    if !file_like {
        return (name.to_string(), String::new());
    }

    let Some((stem, extension)) = name.rsplit_once('.') else {
        return (name.to_string(), String::new());
    };
    if stem.is_empty() {
        (name.to_string(), String::new())
    } else {
        (stem.to_string(), extension.to_string())
    }
}

fn sanitize_local_path_segment(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches(|ch| ch == ' ' || ch == '.')
        .to_string();
    if sanitized.is_empty() {
        "download".to_string()
    } else {
        sanitized
    }
}

fn remote_path_name(path: &str) -> String {
    path.rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("download")
        .to_string()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
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
