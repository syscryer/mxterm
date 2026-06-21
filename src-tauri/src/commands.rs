use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::connections::{
    parse_remote_system_probe, ConnectionAuthKind, ConnectionProfile, ConnectionProfileInput,
    REMOTE_SYSTEM_PROBE_COMMAND,
};
use crate::credentials::{CredentialProfile, CredentialProfileInput};
use crate::events::RemoteFileTransferProgressEvent;
use crate::known_hosts::HostKeyInfo;
use crate::remote_files::{
    RemoteFileArchiveUploadResult, RemoteFileEntry, RemoteFileEntryMetadata, RemoteFileManager,
    RemoteFileMetadata, RemoteFilePathCheckResult, RemoteFileReadResult, RemoteFileUploadResult,
    RemoteFileWriteResult, SftpProgressCallback, TransferConflictPolicy,
};
use crate::remote_monitor::{
    RemoteMonitorCollectionOptions, RemoteMonitorManager, RemoteMonitorSnapshot,
    RemoteProcessActionResult, RemoteProcessSignal,
};
use crate::ssh_config::{
    load_connection_profile, resolve_saved_connection, resolve_transient_connection,
    ResolvedSshConfig, RuntimeCredentialInput,
};
use crate::storage_repository::{
    RevealedConnectionSecret, RevealedCredentialSecret, StorageRepository,
};
use crate::storage_vault::{VaultState, VaultStatus};
use crate::terminal::local::list_profiles as list_local_profiles;
pub use crate::terminal::local_profiles::{LocalTerminalProfile, LocalTerminalProfileInput};
use crate::terminal::manager::TerminalManager;
use crate::terminal::session::ExecProgressCallback;
use crate::tunnels::{
    TunnelManager, TunnelRuleIdRequest, TunnelRuleInput, TunnelRuleWithState, TunnelStartRequest,
};
use crate::webdav::ensure_collection;
use crate::webdav_sync::{
    client_for_settings, fetch_remote_info_with_transport, import_downloaded_bundle,
    prepare_upload_snapshot, remote_dir_segments, WebDavDownloadRequest, WebDavRemoteInfo,
    WebDavSettings, WebDavSettingsInput, WebDavSyncManager, WebDavSyncResult, WebDavSyncService,
    WebDavTestResult, WebDavUploadRequest,
};

static CONNECTION_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CREDENTIAL_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static KNOWN_HOST_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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
    pub auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    pub cols: u16,
    pub rows: u16,
    #[serde(skip)]
    pub runtime_config: Option<ResolvedSshConfig>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionRuntimeCredentialRequest {
    pub connection_id: String,
    #[serde(default)]
    pub auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct KnownHostTrustRequest {
    pub host_key: HostKeyInfo,
}

#[derive(Debug, Serialize)]
pub struct ConnectionStepResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct WindowMaterial {
    pub id: i32,
    pub name: &'static str,
}

#[derive(Debug, Serialize)]
pub struct WindowsPtyInfo {
    pub backend: &'static str,
    pub build_number: Option<u32>,
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

#[derive(Debug, Default, Deserialize)]
pub struct LocalTerminalListProfilesRequest {
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub hidden_profile_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct LocalTerminalOpenRequest {
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub profile: Option<LocalTerminalProfileInput>,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub cwd: Option<String>,
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
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileUploadLocalFileRequest {
    pub connection_id: String,
    pub path: String,
    pub local_path: String,
    #[serde(default)]
    pub conflict_policy: Option<String>,
    #[serde(default)]
    pub transfer_id: Option<String>,
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
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileUploadLocalArchiveRequest {
    pub connection_id: String,
    pub target_dir: String,
    pub root_name: String,
    pub local_path: String,
    #[serde(default)]
    pub conflict_policy: Option<String>,
    #[serde(default = "default_compress_enabled")]
    pub compress: bool,
    #[serde(default)]
    pub keep_archive: bool,
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LocalUploadTempRequest {
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
pub struct LocalUploadTempAppendRequest {
    pub local_path: String,
    pub chunk: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub struct LocalUploadTempDeleteRequest {
    pub local_path: String,
}

#[derive(Debug, Serialize)]
pub struct LocalUploadTempResult {
    pub local_path: String,
}

#[derive(Debug, Deserialize)]
pub struct LocalPathMetadataRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct LocalPathMetadataResult {
    pub path: String,
    pub name: String,
    pub kind: String,
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
    #[serde(default = "default_compress_enabled")]
    pub compress: bool,
    #[serde(default)]
    pub conflict_policy: Option<String>,
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileCancelTransferRequest {
    pub transfer_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteFileDownloadTargetCheckRequest {
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

#[derive(Debug, Serialize)]
pub struct RemoteFileDownloadTargetCheckResult {
    pub exists: bool,
    pub directory: bool,
    pub local_directory: String,
    pub local_path: String,
    pub name: String,
    pub remote_path: String,
}

#[derive(Debug, Deserialize)]
pub struct RemoteMonitorSnapshotRequest {
    pub connection_id: String,
    #[serde(default)]
    pub include_processes: bool,
    #[serde(default)]
    pub process_limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteProcessSignalRequest {
    pub connection_id: String,
    pub pid: u32,
    pub signal: RemoteProcessSignal,
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

#[derive(Debug, Deserialize)]
pub struct ConnectionFavoriteRequest {
    pub connection_id: String,
    pub is_favorite: bool,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionActivityRequest {
    pub connection_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SecretVaultUnlockRequest {
    pub master_password: String,
}

#[derive(Debug, Deserialize)]
pub struct SecretVaultEnableMasterPasswordRequest {
    pub master_password: String,
}

#[tauri::command]
pub fn secret_vault_status(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, AppError> {
    vault_state.status(app_data_dir(&app)?)
}

#[tauri::command]
pub fn secret_vault_unlock(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
    request: SecretVaultUnlockRequest,
) -> Result<VaultStatus, AppError> {
    vault_state.unlock(app_data_dir(&app)?, &request.master_password)
}

#[tauri::command]
pub fn secret_vault_unlock_local(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, AppError> {
    vault_state.unlock_local(app_data_dir(&app)?)
}

#[tauri::command]
pub fn secret_vault_lock(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, AppError> {
    vault_state.lock(app_data_dir(&app)?)
}

#[tauri::command]
pub fn secret_vault_enable_master_password(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
    request: SecretVaultEnableMasterPasswordRequest,
) -> Result<VaultStatus, AppError> {
    vault_state.enable_master_password(app_data_dir(&app)?, &request.master_password)
}

#[tauri::command]
pub fn secret_vault_disable_master_password(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
) -> Result<VaultStatus, AppError> {
    vault_state.disable_master_password(app_data_dir(&app)?)
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
        let config = resolve_saved_connection(
            &app,
            connection_id,
            Some(RuntimeCredentialInput {
                auth_kind: request.auth_kind.clone(),
                password: request.password.clone(),
                private_key_path: request.private_key_path.clone(),
                private_key_passphrase: request.private_key_passphrase.clone(),
            }),
        )?;
        request.host = config.host.clone();
        request.port = config.port;
        request.username = config.username.clone();
        request.password = config.password.clone();
        request.private_key_path = config.private_key_path.clone();
        request.private_key_passphrase = config.private_key_passphrase.clone();
        request.runtime_config = Some(config);
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
pub fn local_terminal_list_profiles(
    request: LocalTerminalListProfilesRequest,
) -> Result<Vec<LocalTerminalProfile>, AppError> {
    list_local_profiles(request.hidden_profile_ids, request.platform)
}

#[tauri::command]
pub async fn local_terminal_open(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    request: LocalTerminalOpenRequest,
) -> Result<String, AppError> {
    manager.connect_local(app, request).await
}

#[tauri::command]
pub fn get_windows_pty_info() -> Option<WindowsPtyInfo> {
    windows_pty_info::current()
}

#[tauri::command]
pub fn get_supported_window_materials() -> Vec<WindowMaterial> {
    window_material::supported_window_materials()
}

#[tauri::command]
pub fn set_window_material(app: AppHandle, material: i32) -> Result<WindowMaterial, AppError> {
    window_material::set_window_material(&app, material).map_err(|error| {
        AppError::new(
            "window_material_set_failed",
            "窗口材质切换失败。",
            error,
            true,
        )
    })
}

#[tauri::command]
pub async fn remote_file_list(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileListRequest,
) -> Result<Vec<RemoteFileEntry>, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = request
        .path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(".");
    manager.list_directory(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_monitor_snapshot(
    app: AppHandle,
    manager: State<'_, RemoteMonitorManager>,
    request: RemoteMonitorSnapshotRequest,
) -> Result<RemoteMonitorSnapshot, AppError> {
    let config = resolve_remote_monitor_connection(&app, &request.connection_id)?;
    manager
        .snapshot(
            &app,
            config,
            RemoteMonitorCollectionOptions {
                include_processes: request.include_processes,
                process_limit: request.process_limit,
            },
        )
        .await
}

#[tauri::command]
pub async fn remote_monitor_process_signal(
    app: AppHandle,
    manager: State<'_, RemoteMonitorManager>,
    request: RemoteProcessSignalRequest,
) -> Result<RemoteProcessActionResult, AppError> {
    let config = resolve_remote_monitor_connection(&app, &request.connection_id)?;
    manager
        .signal_process(&app, config, request.pid, request.signal)
        .await
}

#[tauri::command]
pub async fn tunnel_list(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
) -> Result<Vec<TunnelRuleWithState>, AppError> {
    manager.list(&app).await
}

#[tauri::command]
pub async fn tunnel_upsert(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    request: TunnelRuleInput,
) -> Result<TunnelRuleWithState, AppError> {
    manager.upsert(&app, request).await
}

#[tauri::command]
pub async fn tunnel_delete(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    request: TunnelRuleIdRequest,
) -> Result<(), AppError> {
    manager.delete(&app, &request.rule_id).await
}

#[tauri::command]
pub async fn tunnel_start(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    request: TunnelStartRequest,
) -> Result<TunnelRuleWithState, AppError> {
    manager.start(&app, request).await
}

#[tauri::command]
pub async fn tunnel_stop(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
    request: TunnelRuleIdRequest,
) -> Result<TunnelRuleWithState, AppError> {
    manager.stop(&app, &request.rule_id).await
}

#[tauri::command]
pub async fn tunnel_autostart(
    app: AppHandle,
    manager: State<'_, TunnelManager>,
) -> Result<Vec<TunnelRuleWithState>, AppError> {
    manager.autostart(&app).await
}

#[tauri::command]
pub fn webdav_settings_get(app: AppHandle) -> Result<WebDavSettings, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    WebDavSyncService::load_settings(&repository, &now_timestamp()?)
}

#[tauri::command]
pub fn webdav_settings_save(
    app: AppHandle,
    request: WebDavSettingsInput,
) -> Result<WebDavSettings, AppError> {
    let repository = StorageRepository::open_app(&app)?;
    WebDavSyncService::save_settings(&repository, request, &now_timestamp()?)
}

#[tauri::command]
pub async fn webdav_test_connection(
    app: AppHandle,
    request: Option<WebDavSettingsInput>,
) -> Result<WebDavTestResult, AppError> {
    let now = now_timestamp()?;
    let (settings, client) = {
        let repository = StorageRepository::open_app(&app)?;
        let (settings, password_override) = match request {
            Some(input) => WebDavSyncService::settings_from_input(&repository, input, &now)?,
            None => (WebDavSyncService::load_settings(&repository, &now)?, None),
        };
        let client = client_for_settings(&repository, &settings, password_override)?;
        (settings, client)
    };
    ensure_collection(&client, &remote_dir_segments(&settings)).await?;
    Ok(WebDavTestResult {
        ok: true,
        message: "WebDAV 连接正常。".to_string(),
    })
}

#[tauri::command]
pub async fn webdav_fetch_remote_info(app: AppHandle) -> Result<WebDavRemoteInfo, AppError> {
    let now = now_timestamp()?;
    let (settings, client) = {
        let repository = StorageRepository::open_app(&app)?;
        let settings = WebDavSyncService::load_settings(&repository, &now)?;
        let client = client_for_settings(&repository, &settings, None)?;
        (settings, client)
    };
    fetch_remote_info_with_transport(&client, &settings).await
}

#[tauri::command]
pub async fn webdav_upload_snapshot(
    app: AppHandle,
    manager: State<'_, WebDavSyncManager>,
    request: WebDavUploadRequest,
) -> Result<WebDavSyncResult, AppError> {
    let now = now_timestamp()?;
    let (settings, client, prepared) = {
        let repository = StorageRepository::open_app(&app)?;
        let settings = WebDavSyncService::load_settings(&repository, &now)?;
        let client = client_for_settings(&repository, &settings, None)?;
        let prepared = prepare_upload_snapshot(&repository, request, &now)?;
        (settings, client, prepared)
    };
    let result = manager
        .upload_prepared_snapshot(&client, &settings, prepared)
        .await?;
    {
        let repository = StorageRepository::open_app(&app)?;
        let _ = WebDavSyncService::record_sync_success(&repository, &settings, &result, &now)?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn webdav_download_snapshot(
    app: AppHandle,
    manager: State<'_, WebDavSyncManager>,
    request: WebDavDownloadRequest,
) -> Result<WebDavSyncResult, AppError> {
    let now = now_timestamp()?;
    let (settings, client) = {
        let repository = StorageRepository::open_app(&app)?;
        let settings = WebDavSyncService::load_settings(&repository, &now)?;
        let client = client_for_settings(&repository, &settings, None)?;
        (settings, client)
    };
    let bundle = manager.download_bundle(&client, &settings).await?;
    let result = {
        let mut repository = StorageRepository::open_app(&app)?;
        let result = import_downloaded_bundle(&mut repository, &bundle, request)?;
        let _ = WebDavSyncService::record_sync_success(&repository, &settings, &result, &now)?;
        result
    };
    Ok(result)
}
#[tauri::command]
pub async fn remote_file_read(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileReadRequest,
) -> Result<RemoteFileReadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.read_file(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_file_write(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileWriteRequest,
) -> Result<RemoteFileWriteResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager
        .write_file(
            &app,
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
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.create_file(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_file_create_directory(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<(), AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.create_directory(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_file_rename(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileRenameRequest,
) -> Result<(), AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let new_path = require_remote_path(&request.new_path)?;
    manager.rename_entry(&app, profile, path, new_path).await
}

#[tauri::command]
pub async fn remote_file_delete(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileDeleteRequest,
) -> Result<(), AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager
        .delete_entry(&app, profile, path, request.recursive)
        .await
}

#[tauri::command]
pub async fn remote_file_metadata(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFileEntryMetadata, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.entry_metadata(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_file_check_path(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFilePathCheckResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    manager.check_path(&app, profile, path).await
}

#[tauri::command]
pub async fn remote_file_upload_file(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadFileRequest,
) -> Result<RemoteFileUploadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let total_bytes = request.content.len() as u64;
    let progress = remote_transfer_progress_callback(
        &app,
        request.transfer_id.as_deref(),
        "upload",
        Some(total_bytes),
    );
    manager
        .upload_file(
            &app,
            profile,
            path,
            &request.content,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
            progress,
        )
        .await
}

#[tauri::command]
pub async fn remote_file_upload_local_file(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadLocalFileRequest,
) -> Result<RemoteFileUploadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let local_path = require_existing_local_file_path(&request.local_path)?;
    let total_bytes = fs::metadata(&local_path)
        .map_err(|error| {
            AppError::new(
                "remote_file_upload_local_metadata_failed",
                "本地上传文件信息读取失败。",
                error,
                true,
            )
        })?
        .len();
    let registration = manager
        .register_transfer(request.transfer_id.as_deref())
        .await;
    let progress = remote_sftp_transfer_progress_callback(
        &app,
        request.transfer_id.as_deref(),
        "upload",
        Some(total_bytes),
    );
    let result = manager
        .upload_local_file_sftp(
            &app,
            profile,
            path,
            &local_path,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
            progress,
            registration.token.clone(),
        )
        .await;
    registration.finish().await;
    result
}

#[tauri::command]
pub async fn remote_file_upload_archive(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadArchiveRequest,
) -> Result<RemoteFileArchiveUploadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let target_dir = require_remote_path(&request.target_dir)?;
    let root_name = require_safe_name(&request.root_name, "remote_file_archive_root_missing")?;
    let total_bytes = request.archive_content.len() as u64;
    let progress = remote_transfer_progress_callback(
        &app,
        request.transfer_id.as_deref(),
        "upload",
        Some(total_bytes),
    );
    manager
        .upload_archive(
            &app,
            profile,
            target_dir,
            root_name,
            &request.archive_content,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
            request.keep_archive,
            progress,
        )
        .await
}

#[tauri::command]
pub async fn remote_file_upload_local_archive(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileUploadLocalArchiveRequest,
) -> Result<RemoteFileArchiveUploadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let target_dir = require_remote_path(&request.target_dir)?;
    let requested_root_name =
        require_safe_name(&request.root_name, "remote_file_archive_root_missing")?;
    let local_path = require_existing_local_path(&request.local_path)?;
    if local_path.is_dir() {
        let root_name = local_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                AppError::new(
                    "remote_file_archive_root_missing",
                    "请选择有效的本地文件夹。",
                    local_path.to_string_lossy(),
                    true,
                )
            })?
            .to_string();
        let root_name =
            require_safe_name(&root_name, "remote_file_archive_root_missing")?.to_string();

        // Compressed path: only when requested and both local & remote tar are
        // available. Otherwise silently fall back to SFTP file-by-file.
        let want_compress = request.compress
            && local_tar_available()
            && manager.remote_tar_available(&app, profile.clone()).await;

        if want_compress {
            let archive_path = create_local_directory_archive(&local_path, &root_name)?;
            let total_bytes = fs::metadata(&archive_path)
                .map_err(|error| {
                    AppError::new(
                        "remote_file_upload_local_metadata_failed",
                        "本地上传归档信息读取失败。",
                        error,
                        true,
                    )
                })?
                .len();
            let progress = remote_transfer_progress_callback(
                &app,
                request.transfer_id.as_deref(),
                "upload",
                Some(total_bytes),
            )
            .unwrap_or_else(noop_transfer_progress_callback);
            let result = manager
                .upload_local_archive(
                    &app,
                    profile,
                    target_dir,
                    &root_name,
                    &archive_path,
                    TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
                    request.keep_archive,
                    progress,
                )
                .await;
            let _ = fs::remove_file(&archive_path);
            return result;
        }

        let registration = manager
            .register_transfer(request.transfer_id.as_deref())
            .await;
        let progress = remote_sftp_transfer_progress_callback(
            &app,
            request.transfer_id.as_deref(),
            "upload",
            None,
        );
        let result = manager
            .upload_local_directory_sftp(
                &app,
                profile,
                target_dir,
                &root_name,
                &local_path,
                TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
                progress,
                registration.token.clone(),
            )
            .await;
        registration.finish().await;
        return result;
    }
    let upload_path = local_path;
    let root_name = requested_root_name.to_string();
    let total_bytes = fs::metadata(&upload_path)
        .map_err(|error| {
            AppError::new(
                "remote_file_upload_local_metadata_failed",
                "本地上传归档信息读取失败。",
                error,
                true,
            )
        })?
        .len();
    let progress = remote_transfer_progress_callback(
        &app,
        request.transfer_id.as_deref(),
        "upload",
        Some(total_bytes),
    )
    .unwrap_or_else(noop_transfer_progress_callback);
    let result = manager
        .upload_local_archive(
            &app,
            profile,
            target_dir,
            &root_name,
            &upload_path,
            TransferConflictPolicy::from_request(request.conflict_policy.as_deref()),
            request.keep_archive,
            progress,
        )
        .await;
    result
}

#[tauri::command]
pub async fn remote_file_prepare_upload_temp(
    request: LocalUploadTempRequest,
) -> Result<LocalUploadTempResult, AppError> {
    let dir = upload_temp_dir()?;
    fs::create_dir_all(&dir).map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_create_dir_failed",
            "本地上传临时目录创建失败。",
            error,
            true,
        )
    })?;
    let file_name = sanitize_local_path_segment(&request.file_name);
    let local_path = dir.join(format!("{}-{}", now_millis(), file_name));
    fs::File::create(&local_path).map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_create_failed",
            "本地上传临时文件创建失败。",
            error,
            true,
        )
    })?;
    Ok(LocalUploadTempResult {
        local_path: local_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn remote_file_append_upload_temp(
    request: LocalUploadTempAppendRequest,
) -> Result<(), AppError> {
    let local_path = require_upload_temp_path(&request.local_path)?;
    let mut file = OpenOptions::new()
        .append(true)
        .open(&local_path)
        .map_err(|error| {
            AppError::new(
                "remote_file_upload_temp_open_failed",
                "本地上传临时文件打开失败。",
                error,
                true,
            )
        })?;
    file.write_all(&request.chunk).map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_write_failed",
            "本地上传临时文件写入失败。",
            error,
            true,
        )
    })
}

#[tauri::command]
pub async fn remote_file_delete_upload_temp(
    request: LocalUploadTempDeleteRequest,
) -> Result<(), AppError> {
    let local_path = require_upload_temp_path(&request.local_path)?;
    match fs::remove_file(&local_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::new(
            "remote_file_upload_temp_delete_failed",
            "本地上传临时文件删除失败。",
            error,
            true,
        )),
    }
}

#[tauri::command]
pub async fn remote_file_cancel_transfer(
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileCancelTransferRequest,
) -> Result<bool, AppError> {
    Ok(manager.cancel_transfer(&request.transfer_id).await)
}

#[tauri::command]
pub async fn local_path_metadata(
    request: LocalPathMetadataRequest,
) -> Result<LocalPathMetadataResult, AppError> {
    let path = require_existing_local_path(&request.path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let kind = if path.is_dir() {
        "directory"
    } else if path.is_file() {
        "file"
    } else {
        "other"
    };

    Ok(LocalPathMetadataResult {
        path: path.to_string_lossy().to_string(),
        name,
        kind: kind.to_string(),
    })
}

#[tauri::command]
pub async fn remote_file_download(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFilePathRequest,
) -> Result<RemoteFileDownloadResult, AppError> {
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
    let path = require_remote_path(&request.path)?;
    let content = manager.download_file(&app, profile, path, None).await?;
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
pub async fn remote_file_check_download_target(
    app: AppHandle,
    request: RemoteFileDownloadTargetCheckRequest,
) -> Result<RemoteFileDownloadTargetCheckResult, AppError> {
    let _profile = load_connection_profile(&app, request.connection_id.trim())?;
    let path = require_remote_path(&request.path)?;
    let name = remote_path_name(path);
    let local_directory = resolve_download_directory_parts(
        &app,
        request.download_root.as_deref(),
        request.session_name.as_deref(),
        request.timestamp_name.as_deref(),
        request.group_by_session,
        request.timestamp_directory,
    )?;
    ensure_local_download_directory_ready(&local_directory)?;
    let target = local_directory.join(sanitize_local_path_segment(&name));

    Ok(RemoteFileDownloadTargetCheckResult {
        exists: target.exists(),
        directory: request.directory,
        local_directory: local_directory.to_string_lossy().to_string(),
        local_path: target.to_string_lossy().to_string(),
        name,
        remote_path: path.to_string(),
    })
}

#[tauri::command]
pub async fn remote_file_download_to_local(
    app: AppHandle,
    manager: State<'_, RemoteFileManager>,
    request: RemoteFileDownloadToLocalRequest,
) -> Result<RemoteFileDownloadToLocalResult, AppError> {
    let keep_archives = request.keep_archives;
    let profile = resolve_remote_connection_profile(&app, &request.connection_id)?;
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

        // Compressed path: only when requested and both local & remote tar are
        // available. Otherwise silently fall back to SFTP file-by-file.
        let want_compress = request.compress
            && local_tar_extract_available()
            && manager.remote_tar_available(&app, profile.clone()).await;

        if want_compress {
            let registration = manager
                .register_transfer(request.transfer_id.as_deref())
                .await;
            let progress = remote_transfer_progress_callback(
                &app,
                request.transfer_id.as_deref(),
                "download",
                None,
            )
            .unwrap_or_else(noop_transfer_progress_callback);
            let content = manager
                .download_archive(&app, profile, path, Some(progress))
                .await;
            registration.finish().await;
            let content = content?;

            let archive_path = if keep_archives {
                resolve_local_conflict(
                    &local_directory.join(format!("{}.tar.gz", sanitize_local_path_segment(&name))),
                    TransferConflictPolicy::Rename,
                    true,
                )?
                .1
            } else {
                std::env::temp_dir().join(format!(
                    "mxterm-download-{}-{}.tar.gz",
                    now_millis(),
                    sanitize_local_path_segment(&name)
                ))
            };
            fs::create_dir_all(&local_directory).map_err(|error| {
                AppError::new(
                    "remote_file_download_create_dir_failed",
                    "本地下载目录创建失败。",
                    error,
                    true,
                )
            })?;
            fs::write(&archive_path, &content).map_err(|error| {
                AppError::new(
                    "remote_file_download_write_failed",
                    "本地归档写入失败。",
                    error,
                    true,
                )
            })?;
            unpack_remote_directory_archive(
                &archive_path,
                &local_directory,
                &name,
                &target,
                policy,
            )?;
            if !keep_archives {
                let _ = fs::remove_file(&archive_path);
            }

            return Ok(RemoteFileDownloadToLocalResult {
                archive_path: keep_archives.then(|| archive_path.to_string_lossy().to_string()),
                directory: true,
                local_directory: local_directory.to_string_lossy().to_string(),
                local_path: target.to_string_lossy().to_string(),
                name,
                remote_path: path.to_string(),
                skipped: false,
            });
        }

        let registration = manager
            .register_transfer(request.transfer_id.as_deref())
            .await;
        let progress = remote_sftp_transfer_progress_callback(
            &app,
            request.transfer_id.as_deref(),
            "download",
            None,
        );
        let result = manager
            .download_directory_to_local_sftp(
                &app,
                profile,
                path,
                &target,
                progress,
                registration.token.clone(),
            )
            .await;
        registration.finish().await;
        result?;

        Ok(RemoteFileDownloadToLocalResult {
            archive_path: None,
            directory: true,
            local_directory: local_directory.to_string_lossy().to_string(),
            local_path: target.to_string_lossy().to_string(),
            name,
            remote_path: path.to_string(),
            skipped: false,
        })
    } else {
        let target = local_directory.join(sanitize_local_path_segment(&name));
        let (skipped, target) = if policy == TransferConflictPolicy::Overwrite && target.exists() {
            (false, target)
        } else {
            resolve_local_conflict(&target, policy, true)?
        };
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

        let registration = manager
            .register_transfer(request.transfer_id.as_deref())
            .await;
        let progress = remote_sftp_transfer_progress_callback(
            &app,
            request.transfer_id.as_deref(),
            "download",
            None,
        );
        let result = manager
            .download_file_to_local_sftp(
                &app,
                profile,
                path,
                &target,
                progress,
                registration.token.clone(),
            )
            .await;
        registration.finish().await;
        result?;

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
    StorageRepository::open_app(&app)?.connection_list()
}

#[tauri::command]
pub async fn connection_upsert(
    app: AppHandle,
    request: ConnectionProfileInput,
) -> Result<ConnectionProfile, AppError> {
    let _guard = connection_store_lock().lock().await;
    StorageRepository::open_app(&app)?.connection_upsert(request, &now_timestamp()?)
}

#[tauri::command]
pub async fn connection_set_favorite(
    app: AppHandle,
    request: ConnectionFavoriteRequest,
) -> Result<ConnectionProfile, AppError> {
    let _guard = connection_store_lock().lock().await;
    StorageRepository::open_app(&app)?.connection_set_favorite(
        request.connection_id.trim(),
        request.is_favorite,
        &now_timestamp()?,
    )
}

#[tauri::command]
pub async fn connection_mark_connected(
    app: AppHandle,
    request: ConnectionActivityRequest,
) -> Result<ConnectionProfile, AppError> {
    let _guard = connection_store_lock().lock().await;
    StorageRepository::open_app(&app)?
        .connection_mark_connected(request.connection_id.trim(), &now_timestamp()?)
}

#[tauri::command]
pub async fn connection_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    let _guard = connection_store_lock().lock().await;
    StorageRepository::open_app(&app)?.connection_delete(id.trim())
}

#[tauri::command]
pub async fn connection_reveal_inline_secret(
    app: AppHandle,
    id: String,
) -> Result<RevealedConnectionSecret, AppError> {
    StorageRepository::open_app(&app)?.connection_reveal_inline_secret(id.trim())
}

#[tauri::command]
pub async fn credential_list(app: AppHandle) -> Result<Vec<CredentialProfile>, AppError> {
    StorageRepository::open_app(&app)?.credential_list()
}

#[tauri::command]
pub async fn credential_upsert(
    app: AppHandle,
    request: CredentialProfileInput,
) -> Result<CredentialProfile, AppError> {
    let _guard = credential_store_lock().lock().await;
    StorageRepository::open_app(&app)?.credential_upsert(request, &now_timestamp()?)
}

#[tauri::command]
pub async fn credential_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    let credential_id = id.trim();
    if credential_id.is_empty() {
        return Err(AppError::new(
            "credential_missing",
            "凭据不存在。",
            "credential id is empty",
            false,
        ));
    }

    let _connection_guard = connection_store_lock().lock().await;
    let _credential_guard = credential_store_lock().lock().await;
    StorageRepository::open_app(&app)?.credential_delete(credential_id)
}

#[tauri::command]
pub async fn credential_reveal_secret(
    app: AppHandle,
    id: String,
) -> Result<RevealedCredentialSecret, AppError> {
    StorageRepository::open_app(&app)?.credential_reveal_secret(id.trim())
}

#[tauri::command]
pub async fn known_host_trust(
    app: AppHandle,
    request: KnownHostTrustRequest,
) -> Result<(), AppError> {
    let _guard = known_host_store_lock().lock().await;
    StorageRepository::open_app(&app)?.known_host_trust(request.host_key, &now_timestamp()?)?;
    Ok(())
}

#[tauri::command]
pub async fn connection_test(
    app: AppHandle,
    request: ConnectionRuntimeCredentialRequest,
) -> Result<ConnectionStepResult, AppError> {
    let config = resolve_saved_connection(
        &app,
        request.connection_id.trim(),
        Some(RuntimeCredentialInput {
            auth_kind: request.auth_kind,
            password: request.password,
            private_key_path: request.private_key_path,
            private_key_passphrase: request.private_key_passphrase,
        }),
    )?;

    crate::terminal::session::ReusableExecSession::connect_resolved(&app, &config)
        .await?
        .close()
        .await;
    Ok(ConnectionStepResult {
        ok: true,
        message: "连接测试通过。".to_string(),
    })
}

#[tauri::command]
pub async fn connection_test_profile(
    app: AppHandle,
    request: ConnectionProfileInput,
) -> Result<ConnectionStepResult, AppError> {
    let config = resolve_transient_connection(&app, request)?;

    crate::terminal::session::ReusableExecSession::connect_resolved(&app, &config)
        .await?
        .close()
        .await;
    Ok(ConnectionStepResult {
        ok: true,
        message: "连接测试通过。".to_string(),
    })
}

#[tauri::command]
pub async fn connection_probe_system(
    app: AppHandle,
    request: ConnectionRuntimeCredentialRequest,
) -> Result<ConnectionProfile, AppError> {
    let connection_id = request.connection_id.trim().to_string();
    let config = resolve_saved_connection(
        &app,
        &connection_id,
        Some(RuntimeCredentialInput {
            auth_kind: request.auth_kind,
            password: request.password,
            private_key_path: request.private_key_path,
            private_key_passphrase: request.private_key_passphrase,
        }),
    )?;

    let session =
        crate::terminal::session::ReusableExecSession::connect_resolved(&app, &config).await?;
    let output = session.exec(REMOTE_SYSTEM_PROBE_COMMAND).await;
    session.close().await;
    let output = output?;
    let system = parse_remote_system_probe(&output.stdout);
    let _guard = connection_store_lock().lock().await;
    let repo = StorageRepository::open_app(&app)?;

    if system.is_empty() {
        return repo.connection_get(&config.connection_id)?.ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={}", config.connection_id),
                false,
            )
        });
    }

    repo.connection_update_remote_system(&config.connection_id, system, &now_timestamp()?)
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

fn resolve_remote_connection_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ResolvedSshConfig, AppError> {
    let connection_id = connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "remote_file_connection_missing",
            "请选择活动连接。",
            "connection_id is empty",
            false,
        ));
    }

    resolve_saved_connection(app, connection_id, None)
}

fn resolve_remote_monitor_connection(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ResolvedSshConfig, AppError> {
    let connection_id = connection_id.trim();
    if connection_id.is_empty() {
        return Err(AppError::new(
            "remote_monitor_connection_missing",
            "请选择活动连接。",
            "connection_id is empty",
            false,
        ));
    }

    resolve_saved_connection(app, connection_id, None)
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
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
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
    resolve_download_directory_parts(
        app,
        request.download_root.as_deref(),
        request.session_name.as_deref(),
        request.timestamp_name.as_deref(),
        request.group_by_session,
        request.timestamp_directory,
    )
}

fn resolve_download_directory_parts(
    app: &AppHandle,
    download_root: Option<&str>,
    session_name: Option<&str>,
    timestamp_name: Option<&str>,
    group_by_session: bool,
    timestamp_directory: bool,
) -> Result<PathBuf, AppError> {
    let root = match download_root.map(str::trim) {
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
    if group_by_session {
        directory.push(sanitize_local_path_segment(
            session_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("mxterm-session"),
        ));
    }
    if timestamp_directory {
        directory.push(sanitize_local_path_segment(
            timestamp_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("download"),
        ));
    }

    Ok(directory)
}

fn ensure_local_download_directory_ready(directory: &Path) -> Result<(), AppError> {
    fs::create_dir_all(directory).map_err(|error| {
        AppError::new(
            "remote_file_download_create_dir_failed",
            "本地下载目录创建失败。",
            format!("path={}: {error}", directory.display()),
            true,
        )
    })?;

    let probe_path = directory.join(format!(".mxterm-write-test-{}", now_millis()));
    match fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe_path)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe_path);
            Ok(())
        }
        Err(error) => Err(AppError::new(
            "remote_file_download_directory_not_writable",
            "本地下载目录不可写。",
            format!("path={}: {error}", directory.display()),
            true,
        )),
    }
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

/// Extract a downloaded directory `tar.gz` archive into the local download
/// tree. Belongs to the optional compressed directory-download path and
/// requires a local `tar` executable; callers should probe
/// [`local_tar_available`] first and fall back to SFTP when unavailable.
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

    let mut command = Command::new("tar");
    command.args(local_tar_extract_args(archive_path, &tmp_dir));
    let output = command.output().map_err(|error| {
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
    fs::rename(&extracted, target)
        .or_else(|_| {
            copy_local_directory(&extracted, target)?;
            fs::remove_dir_all(&extracted)
        })
        .map_err(|error| {
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

fn local_tar_extract_args(archive_path: &Path, target_dir: &Path) -> Vec<OsString> {
    let mut args = Vec::new();
    #[cfg(windows)]
    args.push(OsString::from("--options=hdrcharset=UTF-8"));
    args.push(OsString::from("-xzf"));
    args.push(archive_path.as_os_str().to_os_string());
    args.push(OsString::from("-C"));
    args.push(target_dir.as_os_str().to_os_string());
    args
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

fn upload_temp_dir() -> Result<PathBuf, AppError> {
    Ok(std::env::temp_dir().join("mxterm-upload-temp"))
}

fn require_existing_local_path(local_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = local_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "remote_file_upload_local_path_missing",
            "请选择本地上传路径。",
            "local_path is empty",
            true,
        ));
    }

    PathBuf::from(trimmed).canonicalize().map_err(|error| {
        AppError::new(
            "remote_file_upload_local_path_failed",
            "本地上传路径解析失败。",
            error,
            true,
        )
    })
}

fn require_existing_local_file_path(local_path: &str) -> Result<PathBuf, AppError> {
    let path = require_existing_local_path(local_path)?;
    if !path.is_file() {
        return Err(AppError::new(
            "remote_file_upload_local_file_invalid",
            "请选择有效的本地文件。",
            path.to_string_lossy(),
            true,
        ));
    }
    Ok(path)
}

fn require_upload_temp_path(local_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = local_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "remote_file_upload_temp_path_missing",
            "本地上传临时文件路径缺失。",
            "local_path is empty",
            true,
        ));
    }

    let root = upload_temp_dir()?;
    let root = root.canonicalize().map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_root_failed",
            "本地上传临时目录解析失败。",
            error,
            true,
        )
    })?;
    let path = PathBuf::from(trimmed).canonicalize().map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_path_failed",
            "本地上传临时文件路径解析失败。",
            error,
            true,
        )
    })?;
    if !path.starts_with(&root) {
        return Err(AppError::new(
            "remote_file_upload_temp_path_invalid",
            "本地上传临时文件路径无效。",
            path.to_string_lossy(),
            true,
        ));
    }

    Ok(path)
}

/// Pack a local directory into a backend-owned temporary `tar.gz`. Belongs to
/// the optional compressed directory-upload path and requires a local `tar`
/// executable; callers should probe [`local_tar_available`] first.
fn create_local_directory_archive(directory: &Path, root_name: &str) -> Result<PathBuf, AppError> {
    let parent = directory.parent().ok_or_else(|| {
        AppError::new(
            "remote_file_upload_archive_parent_missing",
            "本地上传文件夹父目录不可用。",
            directory.to_string_lossy(),
            true,
        )
    })?;
    let archive_dir = upload_temp_dir()?;
    fs::create_dir_all(&archive_dir).map_err(|error| {
        AppError::new(
            "remote_file_upload_temp_create_dir_failed",
            "本地上传临时目录创建失败。",
            error,
            true,
        )
    })?;
    let archive_path = archive_dir.join(format!(
        "{}-{}.tar.gz",
        now_millis(),
        sanitize_local_path_segment(root_name)
    ));
    let status = Command::new("tar")
        .arg("-czf")
        .arg(&archive_path)
        .arg("-C")
        .arg(parent)
        .arg(root_name)
        .status()
        .map_err(|error| {
            AppError::new(
                "remote_file_upload_archive_start_failed",
                "本地 tar 打包启动失败。",
                error,
                true,
            )
        })?;
    if !status.success() {
        let _ = fs::remove_file(&archive_path);
        return Err(AppError::new(
            "remote_file_upload_archive_failed",
            "本地 tar.gz 打包失败。",
            status.to_string(),
            true,
        ));
    }
    Ok(archive_path)
}

/// serde default for the `compress` request flag. Defaults to `true` so the
/// legacy compressed experience is restored unless the caller opts out.
fn default_compress_enabled() -> bool {
    true
}

/// Probe whether a local `tar` executable is available. Used to decide whether
/// the compressed directory transfer path can run, or must fall back to SFTP.
fn local_tar_available() -> bool {
    Command::new("tar")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Probe whether local `tar` can extract remote archives with UTF-8 path
/// headers. Windows' bundled bsdtar needs this option for Linux-created
/// archives that contain non-ASCII path segments.
fn local_tar_extract_available() -> bool {
    if !local_tar_available() {
        return false;
    }

    #[cfg(windows)]
    {
        Command::new("tar")
            .arg("--options=hdrcharset=UTF-8")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        true
    }
}

fn noop_transfer_progress_callback() -> ExecProgressCallback {
    std::sync::Arc::new(|_| {})
}

fn noop_sftp_progress_callback() -> SftpProgressCallback {
    std::sync::Arc::new(|_, _| {})
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

fn remote_transfer_progress_callback(
    app: &AppHandle,
    transfer_id: Option<&str>,
    direction: &'static str,
    total_bytes: Option<u64>,
) -> Option<ExecProgressCallback> {
    let transfer_id = transfer_id
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let app = app.clone();
    Some(std::sync::Arc::new(move |loaded_bytes| {
        let _ = app.emit(
            crate::events::REMOTE_FILE_TRANSFER_PROGRESS,
            RemoteFileTransferProgressEvent {
                transfer_id: transfer_id.clone(),
                direction: direction.to_string(),
                loaded_bytes,
                total_bytes,
            },
        );
    }))
}

fn remote_sftp_transfer_progress_callback(
    app: &AppHandle,
    transfer_id: Option<&str>,
    direction: &'static str,
    fallback_total_bytes: Option<u64>,
) -> SftpProgressCallback {
    let transfer_id = match transfer_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => value.to_string(),
        None => return noop_sftp_progress_callback(),
    };
    let app = app.clone();
    let state = std::sync::Arc::new(std::sync::Mutex::new((Instant::now(), 0u64)));
    std::sync::Arc::new(move |loaded_bytes, total_bytes| {
        let total_bytes = total_bytes.or(fallback_total_bytes);
        let should_emit = {
            let mut state = state.lock().expect("progress throttle lock poisoned");
            let now = Instant::now();
            let elapsed = now.duration_since(state.0);
            let byte_delta = loaded_bytes.saturating_sub(state.1);
            let finished = total_bytes.is_some_and(|total| loaded_bytes >= total);
            if finished || elapsed >= Duration::from_millis(200) || byte_delta >= 1024 * 1024 {
                *state = (now, loaded_bytes);
                true
            } else {
                false
            }
        };
        if !should_emit {
            return;
        }
        let _ = app.emit(
            crate::events::REMOTE_FILE_TRANSFER_PROGRESS,
            RemoteFileTransferProgressEvent {
                transfer_id: transfer_id.clone(),
                direction: direction.to_string(),
                loaded_bytes,
                total_bytes,
            },
        );
    })
}

#[cfg(test)]
mod tests {
    use super::{ensure_local_download_directory_ready, local_tar_extract_args};
    use std::ffi::OsString;
    use std::fs;
    use std::path::Path;

    #[test]
    fn remote_files_tar_extract_args_use_utf8_header_on_windows() {
        let args = local_tar_extract_args(Path::new("archive.tar.gz"), Path::new("target"));
        let xzf_index = if cfg!(windows) { 1 } else { 0 };

        #[cfg(windows)]
        assert_eq!(args[0], OsString::from("--options=hdrcharset=UTF-8"));

        assert_eq!(args[xzf_index], OsString::from("-xzf"));
        assert_eq!(args[xzf_index + 1], OsString::from("archive.tar.gz"));
        assert_eq!(args[xzf_index + 2], OsString::from("-C"));
        assert_eq!(args[xzf_index + 3], OsString::from("target"));
    }

    #[test]
    fn local_download_directory_ready_creates_missing_directory() {
        let root = std::env::temp_dir().join(format!(
            "mxterm-download-ready-{}",
            crate::commands::now_millis()
        ));
        let nested = root.join("group").join("time");

        ensure_local_download_directory_ready(&nested).expect("directory should be prepared");

        assert!(nested.exists());

        let _ = fs::remove_dir_all(&root);
    }
}

fn connection_store_lock() -> &'static Mutex<()> {
    CONNECTION_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn credential_store_lock() -> &'static Mutex<()> {
    CREDENTIAL_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn known_host_store_lock() -> &'static Mutex<()> {
    KNOWN_HOST_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn window_material_info(id: i32) -> WindowMaterial {
    let name = match id {
        2 => "Mica",
        3 => "Acrylic",
        4 => "Mica Alt",
        _ => "Auto",
    };

    WindowMaterial { id, name }
}

#[cfg(windows)]
mod windows_pty_info {
    use super::WindowsPtyInfo;

    pub fn current() -> Option<WindowsPtyInfo> {
        Some(WindowsPtyInfo {
            backend: "conpty",
            build_number: Some(windows_version::OsVersion::current().build),
        })
    }
}

#[cfg(not(windows))]
mod windows_pty_info {
    use super::WindowsPtyInfo;

    pub fn current() -> Option<WindowsPtyInfo> {
        None
    }
}

#[cfg(windows)]
mod window_material {
    use super::{window_material_info, WindowMaterial};
    use std::{ffi::c_void, mem::size_of};
    use tauri::Manager;
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE},
        UI::WindowsAndMessaging::GetParent,
    };

    pub fn supported_window_materials() -> Vec<WindowMaterial> {
        let mut materials = vec![window_material_info(0)];
        let build = windows_version::OsVersion::current().build;

        if build >= 22523 {
            materials.push(window_material_info(2));
            materials.push(window_material_info(3));
            materials.push(window_material_info(4));
        }

        materials
    }

    pub fn set_window_material(
        app: &tauri::AppHandle,
        material: i32,
    ) -> Result<WindowMaterial, String> {
        let material = normalize_material(material)?;
        let hwnd = main_hwnd(app)?;

        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE,
                (&material as *const i32).cast::<c_void>(),
                size_of::<i32>() as u32,
            )
            .map_err(|error| format!("set DWM backdrop failed: {error}"))?;
        }

        Ok(window_material_info(material))
    }

    fn main_hwnd(app: &tauri::AppHandle) -> Result<HWND, String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let mut hwnd = window
            .hwnd()
            .map_err(|error| format!("get window handle failed: {error}"))?;

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

    fn normalize_material(material: i32) -> Result<i32, String> {
        match material {
            0 | 2 | 3 | 4 => Ok(material),
            _ => Err(format!("unsupported window material: {material}")),
        }
    }
}

#[cfg(not(windows))]
mod window_material {
    use super::{window_material_info, WindowMaterial};

    pub fn supported_window_materials() -> Vec<WindowMaterial> {
        vec![window_material_info(0)]
    }

    pub fn set_window_material(
        _app: &tauri::AppHandle,
        material: i32,
    ) -> Result<WindowMaterial, String> {
        if material == 0 {
            Ok(window_material_info(0))
        } else {
            Err(format!(
                "unsupported window material on this platform: {material}"
            ))
        }
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "sqlite_store_path_failed",
            "SQLite 存储路径获取失败。",
            error,
            true,
        )
    })
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
            let latency_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
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
