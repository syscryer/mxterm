use std::future::Future;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretKind, SecretReference, VAULT_SERVICE};
use crate::sync_snapshot::{
    validate_manifest_summary, SyncExportOptions, SyncImportOptions, SyncManifest,
    SyncSnapshotBundle, SyncSnapshotService, DATA_ARTIFACT, SECRETS_ARTIFACT,
};
use crate::webdav::{
    ensure_collection, normalize_path_segments, WebDavClient, WebDavStatus, WebDavTransport,
    DEFAULT_DATA_MAX_BYTES, DEFAULT_MANIFEST_MAX_BYTES, DEFAULT_SECRETS_MAX_BYTES,
};

const WEBDAV_SETTINGS_KEY: &str = "webdav.sync.default";
const DEFAULT_REMOTE_ROOT: &str = "mxterm-sync";
const DEFAULT_PROFILE: &str = "default";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct WebDavSettings {
    pub enabled: bool,
    pub base_url: String,
    pub username: Option<String>,
    pub password_saved: bool,
    pub remote_root: String,
    pub profile: String,
    pub last_sync_at: Option<String>,
    pub last_snapshot_id: Option<String>,
    pub last_remote_device_name: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct WebDavSettingsInput {
    pub enabled: bool,
    pub base_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub password_touched: bool,
    pub remote_root: String,
    pub profile: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct WebDavUploadRequest {
    #[serde(default)]
    pub sync_password: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct WebDavDownloadRequest {
    #[serde(default)]
    pub sync_password: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WebDavRemoteInfo {
    pub exists: bool,
    pub compatible: bool,
    pub snapshot_id: Option<String>,
    pub device_name: Option<String>,
    pub created_at: Option<String>,
    pub protocol_version: Option<u16>,
    pub data_size: Option<u64>,
    pub secrets_size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WebDavTestResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct PreparedWebDavUpload {
    pub manifest_json: Vec<u8>,
    pub data_json: Vec<u8>,
    pub remote_secrets_enc: Option<Vec<u8>>,
    pub result: WebDavSyncResult,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WebDavSyncResult {
    pub snapshot_id: String,
    pub device_name: String,
    pub created_at: String,
    pub uploaded: bool,
    pub downloaded: bool,
    pub secrets_skipped: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredWebDavSettings {
    enabled: bool,
    base_url: String,
    username: Option<String>,
    remote_root: String,
    profile: String,
    last_sync_at: Option<String>,
    last_snapshot_id: Option<String>,
    last_remote_device_name: Option<String>,
    last_error: Option<String>,
    updated_at: String,
}

#[derive(Default)]
pub struct WebDavSyncManager {
    sync_lock: Mutex<()>,
}

pub struct WebDavSyncService;

impl WebDavSyncManager {
    pub async fn with_sync_lock<F, T>(&self, future: F) -> Result<T, AppError>
    where
        F: Future<Output = Result<T, AppError>>,
    {
        let _guard = self
            .sync_lock
            .try_lock()
            .map_err(|_| webdav_sync_locked())?;
        future.await
    }

    pub async fn upload_prepared_snapshot<T: WebDavTransport>(
        &self,
        transport: &T,
        settings: &WebDavSettings,
        prepared: PreparedWebDavUpload,
    ) -> Result<WebDavSyncResult, AppError> {
        self.with_sync_lock(upload_prepared_snapshot_with_transport(
            transport, settings, prepared,
        ))
        .await
    }

    pub async fn download_bundle<T: WebDavTransport>(
        &self,
        transport: &T,
        settings: &WebDavSettings,
    ) -> Result<SyncSnapshotBundle, AppError> {
        self.with_sync_lock(download_bundle_with_transport(transport, settings))
            .await
    }
}

impl WebDavSyncService {
    pub fn default_settings(now: &str) -> WebDavSettings {
        WebDavSettings {
            enabled: false,
            base_url: String::new(),
            username: None,
            password_saved: false,
            remote_root: DEFAULT_REMOTE_ROOT.to_string(),
            profile: DEFAULT_PROFILE.to_string(),
            last_sync_at: None,
            last_snapshot_id: None,
            last_remote_device_name: None,
            last_error: None,
            updated_at: now.to_string(),
        }
    }

    pub fn load_settings(
        repository: &StorageRepository,
        now: &str,
    ) -> Result<WebDavSettings, AppError> {
        let Some(stored) =
            repository.app_setting_get::<StoredWebDavSettings>(WEBDAV_SETTINGS_KEY)?
        else {
            return Ok(Self::default_settings(now));
        };
        settings_from_stored(repository, stored)
    }

    pub fn settings_from_input(
        repository: &StorageRepository,
        input: WebDavSettingsInput,
        now: &str,
    ) -> Result<(WebDavSettings, Option<Option<String>>), AppError> {
        let existing = Self::load_settings(repository, now).ok();
        let password_override = if input.password_touched {
            Some(trim_optional_owned(input.password.clone()))
        } else {
            None
        };
        let stored = normalize_settings_input(input, existing.as_ref(), now)?;
        if stored.enabled || !stored.base_url.is_empty() {
            let _ = WebDavClient::new(&stored.base_url, stored.username.clone(), None)?;
        }
        let mut settings = settings_from_stored(repository, stored)?;
        if password_override.as_ref().is_some_and(Option::is_some) {
            settings.password_saved = true;
        }
        Ok((settings, password_override))
    }

    pub fn save_settings(
        repository: &StorageRepository,
        input: WebDavSettingsInput,
        now: &str,
    ) -> Result<WebDavSettings, AppError> {
        let existing = Self::load_settings(repository, now).ok();
        let password_touched = input.password_touched;
        let password = input.password.clone();
        let stored = normalize_settings_input(input, existing.as_ref(), now)?;
        let password_reference = webdav_password_reference(&stored.profile);
        if stored.enabled || !stored.base_url.is_empty() {
            let _ = WebDavClient::new(&stored.base_url, stored.username.clone(), None)?;
        }

        if password_touched {
            if let Some(password) = trim_optional_owned(password) {
                repository.secret_set(&password_reference, &password)?;
            } else {
                repository.secret_delete(&password_reference)?;
            }
        }

        repository.app_setting_set(WEBDAV_SETTINGS_KEY, &stored, now)?;
        settings_from_stored(repository, stored)
    }

    pub fn record_sync_success(
        repository: &StorageRepository,
        settings: &WebDavSettings,
        result: &WebDavSyncResult,
        now: &str,
    ) -> Result<WebDavSettings, AppError> {
        let stored = StoredWebDavSettings {
            enabled: settings.enabled,
            base_url: settings.base_url.clone(),
            username: settings.username.clone(),
            remote_root: settings.remote_root.clone(),
            profile: settings.profile.clone(),
            last_sync_at: Some(now.to_string()),
            last_snapshot_id: Some(result.snapshot_id.clone()),
            last_remote_device_name: Some(result.device_name.clone()),
            last_error: None,
            updated_at: now.to_string(),
        };
        repository.app_setting_set(WEBDAV_SETTINGS_KEY, &stored, now)?;
        settings_from_stored(repository, stored)
    }
}

pub fn webdav_password_reference(profile: &str) -> SecretReference {
    let profile = profile
        .trim()
        .is_empty()
        .then_some(DEFAULT_PROFILE)
        .unwrap_or(profile.trim());
    let account = format!("webdav:{profile}:password");
    SecretReference {
        service: VAULT_SERVICE,
        slot_id: account.clone(),
        account,
        kind: SecretKind::Password,
    }
}

pub fn client_for_settings(
    repository: &StorageRepository,
    settings: &WebDavSettings,
    password_override: Option<Option<String>>,
) -> Result<WebDavClient, AppError> {
    ensure_enabled(settings)?;
    let password = password_for_settings(repository, settings, password_override)?;
    WebDavClient::new(&settings.base_url, settings.username.clone(), password)
}

pub fn password_for_settings(
    repository: &StorageRepository,
    settings: &WebDavSettings,
    password_override: Option<Option<String>>,
) -> Result<Option<String>, AppError> {
    if let Some(password) = password_override {
        return match password {
            Some(password) => Ok(Some(password)),
            None if settings.username.is_some() => Err(webdav_password_missing()),
            None => Ok(None),
        };
    }
    if settings.username.is_none() {
        return Ok(None);
    }
    let reference = webdav_password_reference(&settings.profile);
    repository
        .secret_get(&reference)
        .map(Some)
        .map_err(|error| {
            if error.code == "secret_missing" {
                webdav_password_missing()
            } else {
                error
            }
        })
}
pub fn prepare_upload_snapshot(
    repository: &StorageRepository,
    request: WebDavUploadRequest,
    now: &str,
) -> Result<PreparedWebDavUpload, AppError> {
    let sync_password = trim_optional_owned(request.sync_password);
    if sync_password.is_none() && repository.sync_secret_count()? > 0 {
        return Err(AppError::new(
            "webdav_sync_password_missing",
            "同步包含已保存 SSH 密码或口令，请输入同步主密码。",
            "sync password is required when exporting secrets",
            true,
        ));
    }
    let bundle = SyncSnapshotService::export_bundle(
        repository,
        SyncExportOptions {
            device_id: request
                .device_id
                .and_then(|value| trim_optional_owned(Some(value)))
                .unwrap_or_else(|| "local-device".to_string()),
            device_name: request
                .device_name
                .and_then(|value| trim_optional_owned(Some(value)))
                .unwrap_or_else(default_device_name),
            created_at: now.to_string(),
            sync_password,
        },
    )?;
    Ok(PreparedWebDavUpload {
        result: WebDavSyncResult {
            snapshot_id: bundle.manifest.snapshot_id,
            device_name: bundle.manifest.device_name,
            created_at: bundle.manifest.created_at,
            uploaded: true,
            downloaded: false,
            secrets_skipped: false,
        },
        manifest_json: bundle.manifest_json,
        data_json: bundle.data_json,
        remote_secrets_enc: bundle.remote_secrets_enc,
    })
}

pub async fn upload_prepared_snapshot_with_transport<T: WebDavTransport>(
    transport: &T,
    settings: &WebDavSettings,
    prepared: PreparedWebDavUpload,
) -> Result<WebDavSyncResult, AppError> {
    ensure_enabled(settings)?;
    let remote_dir = remote_dir_segments(settings);
    ensure_collection(transport, &remote_dir).await?;
    put_artifact(
        transport,
        settings,
        DATA_ARTIFACT,
        prepared.data_json,
        "application/json",
    )
    .await?;
    if let Some(secrets) = prepared.remote_secrets_enc {
        put_artifact(
            transport,
            settings,
            SECRETS_ARTIFACT,
            secrets,
            "application/octet-stream",
        )
        .await?;
    }
    put_artifact(
        transport,
        settings,
        "manifest.json",
        prepared.manifest_json,
        "application/json",
    )
    .await?;
    Ok(prepared.result)
}

#[cfg(test)]
pub async fn upload_snapshot_with_transport<T: WebDavTransport>(
    repository: &StorageRepository,
    transport: &T,
    settings: &WebDavSettings,
    request: WebDavUploadRequest,
    now: &str,
) -> Result<WebDavSyncResult, AppError> {
    let prepared = prepare_upload_snapshot(repository, request, now)?;
    upload_prepared_snapshot_with_transport(transport, settings, prepared).await
}

pub async fn download_bundle_with_transport<T: WebDavTransport>(
    transport: &T,
    settings: &WebDavSettings,
) -> Result<SyncSnapshotBundle, AppError> {
    ensure_enabled(settings)?;
    let manifest_segments = artifact_segments(settings, "manifest.json");
    let manifest_json = transport
        .get(&manifest_segments, DEFAULT_MANIFEST_MAX_BYTES)
        .await?
        .ok_or_else(webdav_remote_empty)?;
    let manifest: SyncManifest = serde_json::from_slice(&manifest_json)
        .map_err(|error| sync_snapshot_incompatible(error))?;
    validate_manifest_summary(&manifest)?;

    let data_size = manifest
        .artifacts
        .get(DATA_ARTIFACT)
        .map(|meta| meta.size as usize)
        .unwrap_or(DEFAULT_DATA_MAX_BYTES)
        .min(DEFAULT_DATA_MAX_BYTES);
    let data_json = transport
        .get(&artifact_segments(settings, DATA_ARTIFACT), data_size)
        .await?
        .ok_or_else(webdav_remote_empty)?;
    let remote_secrets_enc = if let Some(meta) = manifest.artifacts.get(SECRETS_ARTIFACT) {
        let max = (meta.size as usize).min(DEFAULT_SECRETS_MAX_BYTES);
        Some(
            transport
                .get(&artifact_segments(settings, SECRETS_ARTIFACT), max)
                .await?
                .ok_or_else(webdav_remote_empty)?,
        )
    } else {
        None
    };

    Ok(SyncSnapshotBundle {
        manifest,
        manifest_json,
        data_json,
        remote_secrets_enc,
    })
}

pub fn import_downloaded_bundle(
    repository: &mut StorageRepository,
    bundle: &SyncSnapshotBundle,
    request: WebDavDownloadRequest,
) -> Result<WebDavSyncResult, AppError> {
    let result = SyncSnapshotService::import_bundle(
        repository,
        bundle,
        SyncImportOptions {
            sync_password: trim_optional_owned(request.sync_password),
        },
    )?;
    Ok(WebDavSyncResult {
        snapshot_id: bundle.manifest.snapshot_id.clone(),
        device_name: bundle.manifest.device_name.clone(),
        created_at: bundle.manifest.created_at.clone(),
        uploaded: false,
        downloaded: true,
        secrets_skipped: result.secrets_skipped,
    })
}

#[cfg(test)]
pub async fn download_snapshot_with_transport<T: WebDavTransport>(
    repository: &mut StorageRepository,
    transport: &T,
    settings: &WebDavSettings,
    request: WebDavDownloadRequest,
) -> Result<WebDavSyncResult, AppError> {
    let bundle = download_bundle_with_transport(transport, settings).await?;
    import_downloaded_bundle(repository, &bundle, request)
}

pub async fn fetch_remote_info_with_transport<T: WebDavTransport>(
    transport: &T,
    settings: &WebDavSettings,
) -> Result<WebDavRemoteInfo, AppError> {
    ensure_enabled(settings)?;
    let manifest_json = match transport
        .get(
            &artifact_segments(settings, "manifest.json"),
            DEFAULT_MANIFEST_MAX_BYTES,
        )
        .await?
    {
        Some(bytes) => bytes,
        None => {
            return Ok(WebDavRemoteInfo {
                exists: false,
                compatible: false,
                snapshot_id: None,
                device_name: None,
                created_at: None,
                protocol_version: None,
                data_size: None,
                secrets_size: None,
            })
        }
    };
    let manifest: SyncManifest = serde_json::from_slice(&manifest_json)
        .map_err(|error| sync_snapshot_incompatible(error))?;
    let compatible = validate_manifest_summary(&manifest).is_ok();
    Ok(WebDavRemoteInfo {
        exists: true,
        compatible,
        snapshot_id: Some(manifest.snapshot_id),
        device_name: Some(manifest.device_name),
        created_at: Some(manifest.created_at),
        protocol_version: Some(manifest.protocol_version),
        data_size: manifest.artifacts.get(DATA_ARTIFACT).map(|meta| meta.size),
        secrets_size: manifest
            .artifacts
            .get(SECRETS_ARTIFACT)
            .map(|meta| meta.size),
    })
}

fn settings_from_stored(
    repository: &StorageRepository,
    stored: StoredWebDavSettings,
) -> Result<WebDavSettings, AppError> {
    Ok(WebDavSettings {
        enabled: stored.enabled,
        base_url: stored.base_url,
        username: stored.username,
        password_saved: repository.secret_exists(&webdav_password_reference(&stored.profile))?,
        remote_root: stored.remote_root,
        profile: stored.profile,
        last_sync_at: stored.last_sync_at,
        last_snapshot_id: stored.last_snapshot_id,
        last_remote_device_name: stored.last_remote_device_name,
        last_error: stored.last_error,
        updated_at: stored.updated_at,
    })
}

fn normalize_settings_input(
    input: WebDavSettingsInput,
    existing: Option<&WebDavSettings>,
    now: &str,
) -> Result<StoredWebDavSettings, AppError> {
    let base_url = input.base_url.trim().to_string();
    if input.enabled && base_url.is_empty() {
        return Err(AppError::new(
            "webdav_settings_invalid",
            "请填写 WebDAV 服务地址。",
            "base_url is empty",
            true,
        ));
    }
    let remote_root = normalize_path_segments(&[input.remote_root.as_str()]).join("/");
    let profile = input.profile.trim();
    if profile.contains('/')
        || profile.contains('\\')
        || profile.contains('?')
        || profile.contains('#')
    {
        return Err(AppError::new(
            "webdav_settings_invalid",
            "WebDAV profile 不能包含路径分隔符。",
            "profile contains path separator",
            true,
        ));
    }
    Ok(StoredWebDavSettings {
        enabled: input.enabled,
        base_url,
        username: trim_optional_owned(input.username),
        remote_root: if remote_root.is_empty() {
            DEFAULT_REMOTE_ROOT.to_string()
        } else {
            remote_root
        },
        profile: if profile.is_empty() {
            DEFAULT_PROFILE.to_string()
        } else {
            profile.to_string()
        },
        last_sync_at: existing.and_then(|item| item.last_sync_at.clone()),
        last_snapshot_id: existing.and_then(|item| item.last_snapshot_id.clone()),
        last_remote_device_name: existing.and_then(|item| item.last_remote_device_name.clone()),
        last_error: existing.and_then(|item| item.last_error.clone()),
        updated_at: now.to_string(),
    })
}

async fn put_artifact<T: WebDavTransport>(
    transport: &T,
    settings: &WebDavSettings,
    name: &str,
    bytes: Vec<u8>,
    content_type: &str,
) -> Result<WebDavStatus, AppError> {
    let segments = artifact_segments(settings, name);
    let status = transport.put(&segments, bytes, content_type).await?;
    if matches!(status.code, 200 | 201 | 204) {
        Ok(status)
    } else {
        Err(AppError::new(
            "webdav_http_status",
            "WebDAV 上传失败。",
            format!("PUT {} returned {}", segments.join("/"), status.code),
            true,
        ))
    }
}

pub(crate) fn remote_dir_segments(settings: &WebDavSettings) -> Vec<String> {
    let mut segments = normalize_path_segments(&[settings.remote_root.as_str()]);
    segments.push("v1".to_string());
    segments.push(settings.profile.trim().to_string());
    segments
}

fn artifact_segments(settings: &WebDavSettings, name: &str) -> Vec<String> {
    let mut segments = remote_dir_segments(settings);
    segments.push(name.to_string());
    segments
}

fn ensure_enabled(settings: &WebDavSettings) -> Result<(), AppError> {
    if !settings.enabled {
        return Err(AppError::new(
            "webdav_settings_invalid",
            "请先启用 WebDAV 同步。",
            "webdav sync disabled",
            true,
        ));
    }
    if settings.base_url.trim().is_empty() {
        return Err(AppError::new(
            "webdav_settings_invalid",
            "请填写 WebDAV 服务地址。",
            "base_url is empty",
            true,
        ));
    }
    Ok(())
}

fn trim_optional<T: AsRef<str>>(value: Option<T>) -> Option<String> {
    value
        .map(|item| item.as_ref().trim().to_string())
        .filter(|item| !item.is_empty())
}

fn trim_optional_owned(value: Option<String>) -> Option<String> {
    trim_optional(value)
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .and_then(|value| trim_optional_owned(Some(value)))
        .unwrap_or_else(|| "mXterm".to_string())
}

fn webdav_password_missing() -> AppError {
    AppError::new(
        "webdav_password_missing",
        "请填写或保存 WebDAV 登录密码。",
        "webdav password is missing",
        true,
    )
}
fn webdav_sync_locked() -> AppError {
    AppError::new(
        "webdav_sync_locked",
        "已有同步任务正在执行。",
        "webdav sync lock is busy",
        true,
    )
}

fn webdav_remote_empty() -> AppError {
    AppError::new(
        "webdav_remote_empty",
        "远端还没有同步快照。",
        "manifest.json not found",
        true,
    )
}

fn sync_snapshot_incompatible(raw: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_incompatible",
        "同步快照格式不兼容。",
        raw,
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex as StdMutex};

    use super::{
        download_snapshot_with_transport, upload_snapshot_with_transport,
        webdav_password_reference, WebDavDownloadRequest, WebDavSettings, WebDavSettingsInput,
        WebDavSyncManager, WebDavSyncService, WebDavUploadRequest,
    };
    use crate::app_error::AppError;
    use crate::storage_repository::StorageRepository;
    use crate::storage_vault::{InMemorySecretStore, SecretStore};
    use crate::webdav::{WebDavStatus, WebDavTransport};

    #[test]
    fn settings_save_preserves_untouched_password() {
        let (repo, secrets) = temp_repository("webdav-preserve-password");
        WebDavSyncService::save_settings(
            &repo,
            settings_input(Some("dav-secret"), true),
            "2026-06-21T10:00:00+08:00",
        )
        .unwrap();

        let saved = WebDavSyncService::save_settings(
            &repo,
            settings_input(None, false),
            "2026-06-21T10:01:00+08:00",
        )
        .unwrap();

        assert!(saved.password_saved);
        assert_eq!(
            secrets
                .get_secret(&webdav_password_reference("default"))
                .unwrap(),
            "dav-secret"
        );
    }

    #[test]
    fn settings_save_deletes_touched_blank_password() {
        let (repo, secrets) = temp_repository("webdav-delete-password");
        WebDavSyncService::save_settings(
            &repo,
            settings_input(Some("dav-secret"), true),
            "2026-06-21T10:00:00+08:00",
        )
        .unwrap();

        let saved = WebDavSyncService::save_settings(
            &repo,
            settings_input(Some("   "), true),
            "2026-06-21T10:01:00+08:00",
        )
        .unwrap();

        assert!(!saved.password_saved);
        assert_eq!(
            secrets
                .get_secret(&webdav_password_reference("default"))
                .unwrap_err()
                .code,
            "secret_missing"
        );
    }

    #[test]
    fn sync_lock_rejects_concurrent_operation() {
        let manager = WebDavSyncManager::default();
        let _guard = manager.sync_lock.try_lock().unwrap();

        let error =
            tauri::async_runtime::block_on(manager.with_sync_lock(async { Ok(()) })).unwrap_err();

        assert_eq!(error.code, "webdav_sync_locked");
    }

    #[test]
    fn upload_puts_manifest_last() {
        let (repo, _secrets) = temp_repository("webdav-upload-order");
        let transport = RecordingTransport::default();

        tauri::async_runtime::block_on(upload_snapshot_with_transport(
            &repo,
            &transport,
            &settings(),
            WebDavUploadRequest {
                sync_password: None,
                device_id: Some("device-a".to_string()),
                device_name: Some("Desk A".to_string()),
            },
            "2026-06-21T10:00:00+08:00",
        ))
        .unwrap();

        let put_operations = transport.put_operations();
        assert_eq!(
            put_operations,
            vec![
                "PUT mxterm-sync/v1/default/data.json",
                "PUT mxterm-sync/v1/default/manifest.json",
            ]
        );
    }

    #[test]
    fn incompatible_manifest_rejects_before_import_or_data_download() {
        let (mut repo, _secrets) = temp_repository("webdav-download-incompatible");
        let manifest = serde_json::json!({
            "format": "other-sync",
            "protocol_version": 1,
            "snapshot_id": "snapshot-a",
            "device_id": "device-a",
            "device_name": "Desk A",
            "created_at": "2026-06-21T10:00:00+08:00",
            "db_schema_version": 1,
            "artifacts": {
                "data.json": { "sha256": "00", "size": 2 }
            },
            "encryption": {
                "secrets_cipher": "aes-256-gcm",
                "secrets_kdf": "argon2id"
            }
        });
        let transport = RecordingTransport::with_manifest(serde_json::to_vec(&manifest).unwrap());

        let error = tauri::async_runtime::block_on(download_snapshot_with_transport(
            &mut repo,
            &transport,
            &settings(),
            WebDavDownloadRequest {
                sync_password: None,
            },
        ))
        .unwrap_err();

        assert_eq!(error.code, "sync_snapshot_incompatible");
        assert_eq!(
            transport.operations(),
            vec!["GET mxterm-sync/v1/default/manifest.json"]
        );
    }

    #[derive(Default)]
    struct RecordingTransport {
        manifest: Option<Vec<u8>>,
        operations: StdMutex<Vec<String>>,
    }

    impl RecordingTransport {
        fn with_manifest(manifest: Vec<u8>) -> Self {
            Self {
                manifest: Some(manifest),
                operations: StdMutex::new(Vec::new()),
            }
        }

        fn operations(&self) -> Vec<String> {
            self.operations.lock().unwrap().clone()
        }

        fn put_operations(&self) -> Vec<String> {
            self.operations()
                .into_iter()
                .filter(|operation| operation.starts_with("PUT "))
                .collect()
        }

        fn push(&self, operation: String) {
            self.operations.lock().unwrap().push(operation);
        }
    }

    impl WebDavTransport for RecordingTransport {
        async fn propfind(
            &self,
            path_segments: &[String],
            depth: u8,
        ) -> Result<WebDavStatus, AppError> {
            self.push(format!(
                "PROPFIND {} depth={depth}",
                path_segments.join("/")
            ));
            Ok(WebDavStatus::new(207))
        }

        async fn mkcol(&self, path_segments: &[String]) -> Result<WebDavStatus, AppError> {
            self.push(format!("MKCOL {}", path_segments.join("/")));
            Ok(WebDavStatus::new(201))
        }

        async fn put(
            &self,
            path_segments: &[String],
            _bytes: Vec<u8>,
            _content_type: &str,
        ) -> Result<WebDavStatus, AppError> {
            self.push(format!("PUT {}", path_segments.join("/")));
            Ok(WebDavStatus::new(201))
        }

        async fn get(
            &self,
            path_segments: &[String],
            _max_bytes: usize,
        ) -> Result<Option<Vec<u8>>, AppError> {
            self.push(format!("GET {}", path_segments.join("/")));
            if path_segments
                .last()
                .is_some_and(|segment| segment == "manifest.json")
            {
                return Ok(self.manifest.clone());
            }
            Ok(Some(br#"{}"#.to_vec()))
        }
    }

    fn settings_input(password: Option<&str>, password_touched: bool) -> WebDavSettingsInput {
        WebDavSettingsInput {
            enabled: true,
            base_url: "https://dav.example.com/root".to_string(),
            username: Some("alice".to_string()),
            password: password.map(ToOwned::to_owned),
            password_touched,
            remote_root: "mxterm-sync".to_string(),
            profile: "default".to_string(),
        }
    }

    fn settings() -> WebDavSettings {
        WebDavSettings {
            enabled: true,
            base_url: "https://dav.example.com/root".to_string(),
            username: Some("alice".to_string()),
            password_saved: true,
            remote_root: "mxterm-sync".to_string(),
            profile: "default".to_string(),
            last_sync_at: None,
            last_snapshot_id: None,
            last_remote_device_name: None,
            last_error: None,
            updated_at: "2026-06-21T10:00:00+08:00".to_string(),
        }
    }

    fn temp_repository(name: &str) -> (StorageRepository, Arc<InMemorySecretStore>) {
        let root =
            std::env::temp_dir().join(format!("mxterm-webdav-{name}-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("mxterm.db");
        let secrets = Arc::new(InMemorySecretStore::default());
        let repo = StorageRepository::open(db_path, secrets.clone()).unwrap();
        (repo, secrets)
    }
}
