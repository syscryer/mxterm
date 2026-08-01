use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::connection_transfer_recovery::{
    ConnectionTransferRecovery, CONNECTION_TRANSFER_COMMIT_KEY,
};
use crate::secure_bundle::{decrypt_json, encrypt_json, EncryptedJsonEnvelope};
use crate::storage::{write_json_document, JsonStoreErrorLabels};
use crate::storage_repository::StorageRepository;
use crate::storage_vault::{SecretKind, SecretReference, VAULT_SERVICE};
use crate::sync_snapshot::{
    sha256_hex, SyncConnectionGroup, SyncConnectionRecord, SyncCredentialRecord, SyncSecretEntry,
};

pub const CONNECTION_TRANSFER_FORMAT: &str = "mxterm-connections";
pub const CONNECTION_TRANSFER_VERSION: u16 = 1;
const CONNECTION_TRANSFER_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const CONNECTION_TRANSFER_MAX_PASSWORD_BYTES: usize = 1024;
const CONNECTION_TRANSFER_MAX_CONNECTIONS: usize = 10_000;
const CONNECTION_TRANSFER_MAX_CREDENTIALS: usize = 5_000;
const CONNECTION_TRANSFER_MAX_GROUPS: usize = 5_000;
const CONNECTION_TRANSFER_MAX_SECRETS: usize = 20_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConnectionTransferData {
    pub version: u16,
    pub connection_groups: Vec<SyncConnectionGroup>,
    pub credentials: Vec<SyncCredentialRecord>,
    pub connections: Vec<SyncConnectionRecord>,
}

impl Default for ConnectionTransferData {
    fn default() -> Self {
        Self {
            version: CONNECTION_TRANSFER_VERSION,
            connection_groups: Vec::new(),
            credentials: Vec::new(),
            connections: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferSecrets {
    pub version: u16,
    pub secrets: Vec<SyncSecretEntry>,
}

impl Default for ConnectionTransferSecrets {
    fn default() -> Self {
        Self {
            version: CONNECTION_TRANSFER_VERSION,
            secrets: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ConnectionTransferBundle {
    pub format: String,
    pub version: u16,
    pub created_at: String,
    pub data: ConnectionTransferData,
    pub data_sha256: String,
    pub secrets: EncryptedJsonEnvelope,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferItemStats {
    pub total: usize,
    pub new: usize,
    pub conflicts: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferPreview {
    pub connections: ConnectionTransferItemStats,
    pub credentials: ConnectionTransferItemStats,
    pub groups: ConnectionTransferItemStats,
    pub private_key_warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferPreviewResult {
    pub fingerprint: String,
    pub summary: ConnectionTransferPreview,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferExportResult {
    pub file_name: String,
    pub connections: usize,
    pub credentials: usize,
    pub groups: usize,
    pub secrets: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionTransferConflictStrategy {
    Skip,
    Overwrite,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferMutationStats {
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ConnectionTransferImportResult {
    pub connections: ConnectionTransferMutationStats,
    pub credentials: ConnectionTransferMutationStats,
    pub groups: ConnectionTransferMutationStats,
    pub secrets: usize,
}

pub fn export_to_file(
    repository: &StorageRepository,
    path: &Path,
    password: &str,
    created_at: &str,
) -> Result<ConnectionTransferExportResult, AppError> {
    validate_transfer_path(path)?;
    let bundle = export_repository_bundle(repository, password, created_at)?;
    let result = ConnectionTransferExportResult {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("connections.mxterm-connections.json")
            .to_string(),
        connections: bundle.data.connections.len(),
        credentials: bundle.data.credentials.len(),
        groups: bundle.data.connection_groups.len(),
        secrets: repository.sync_secret_count()?,
    };
    write_json_document(path, &bundle, connection_transfer_file_labels())?;
    Ok(result)
}

pub fn preview_file(
    repository: &StorageRepository,
    path: &Path,
    password: &str,
) -> Result<ConnectionTransferPreviewResult, AppError> {
    let (bundle, fingerprint) = read_bundle_file(path)?;
    let summary = preview_bundle(repository, &bundle, password)?;
    Ok(ConnectionTransferPreviewResult {
        fingerprint,
        summary,
    })
}

pub fn import_from_file(
    repository: &mut StorageRepository,
    path: &Path,
    password: &str,
    expected_fingerprint: &str,
    strategy: ConnectionTransferConflictStrategy,
) -> Result<ConnectionTransferImportResult, AppError> {
    let (bundle, fingerprint) = read_bundle_file(path)?;
    if expected_fingerprint.len() != 64 || fingerprint != expected_fingerprint {
        return Err(AppError::new(
            "connection_transfer_file_changed",
            "连接迁移文件在预检后发生了变化，请重新预检。",
            "connection transfer fingerprint mismatch",
            true,
        ));
    }
    apply_bundle(repository, &bundle, password, strategy)
}

fn read_bundle_file(path: &Path) -> Result<(ConnectionTransferBundle, String), AppError> {
    validate_transfer_path(path)?;
    let metadata = fs::metadata(path).map_err(connection_transfer_file_read_failed)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(connection_transfer_file_read_failed(
            "connection transfer path is not a non-empty file",
        ));
    }
    if metadata.len() > CONNECTION_TRANSFER_MAX_FILE_BYTES {
        return Err(connection_transfer_file_too_large(metadata.len()));
    }
    let bytes = fs::read(path).map_err(connection_transfer_file_read_failed)?;
    if bytes.len() as u64 > CONNECTION_TRANSFER_MAX_FILE_BYTES {
        return Err(connection_transfer_file_too_large(bytes.len() as u64));
    }
    let fingerprint = sha256_hex(&bytes);
    let bundle = serde_json::from_slice(&bytes).map_err(|error| {
        AppError::new(
            "connection_transfer_file_parse_failed",
            "连接迁移文件无法解析。",
            error,
            true,
        )
    })?;
    Ok((bundle, fingerprint))
}

fn validate_transfer_path(path: &Path) -> Result<(), AppError> {
    if path.as_os_str().is_empty() || path.to_string_lossy().trim().is_empty() {
        return Err(AppError::new(
            "connection_transfer_path_required",
            "请选择连接迁移文件。",
            "connection transfer path is empty",
            true,
        ));
    }
    Ok(())
}

fn connection_transfer_file_labels() -> JsonStoreErrorLabels {
    JsonStoreErrorLabels {
        create_dir_code: "connection_transfer_create_dir_failed",
        create_dir_message: "连接迁移文件目录创建失败。",
        parse_code: "connection_transfer_file_parse_failed",
        parse_message: "连接迁移文件无法解析。",
        read_code: "connection_transfer_file_read_failed",
        read_message: "连接迁移文件读取失败。",
        serialize_code: "connection_transfer_serialize_failed",
        serialize_message: "连接迁移文件处理失败。",
        write_code: "connection_transfer_file_write_failed",
        write_message: "连接迁移文件写入失败。",
    }
}

fn connection_transfer_file_read_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_file_read_failed",
        "连接迁移文件读取失败。",
        raw,
        true,
    )
}

fn connection_transfer_file_too_large(size: u64) -> AppError {
    AppError::new(
        "connection_transfer_file_too_large",
        "连接迁移文件过大。",
        format!("connection transfer file has {size} bytes"),
        true,
    )
}

fn apply_bundle(
    repository: &mut StorageRepository,
    bundle: &ConnectionTransferBundle,
    password: &str,
    strategy: ConnectionTransferConflictStrategy,
) -> Result<ConnectionTransferImportResult, AppError> {
    let secrets = decrypt_bundle(bundle, password)?;
    validate_transfer_data(&bundle.data)?;
    validate_transfer_secrets(&bundle.data, &secrets)?;
    apply_transfer_data(repository, &bundle.data, &secrets, strategy)
}

fn apply_transfer_data(
    repository: &mut StorageRepository,
    data: &ConnectionTransferData,
    secrets: &ConnectionTransferSecrets,
    strategy: ConnectionTransferConflictStrategy,
) -> Result<ConnectionTransferImportResult, AppError> {
    repository.create_sync_backup()?;
    let recovery = ConnectionTransferRecovery::begin(&repository.root_dir())?;
    let existing_connection_ids = query_string_set(repository, "SELECT id FROM connections")?;
    let existing_credential_ids = query_string_set(repository, "SELECT id FROM credentials")?;
    let local_groups = query_string_pairs(repository, "SELECT id, name FROM connection_groups")?;
    let local_group_by_id: BTreeMap<_, _> = local_groups.iter().cloned().collect();
    let local_group_by_name: BTreeMap<_, _> = local_groups
        .iter()
        .map(|(id, name)| (name.clone(), id.clone()))
        .collect();
    let mut result = ConnectionTransferImportResult::default();
    let mut group_id_map = BTreeMap::new();
    let mut active_secret_slots = BTreeSet::new();

    repository
        .sqlite_connection()
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(connection_transfer_import_failed)?;

    let database_result = (|| -> Result<(), AppError> {
        for group in &data.connection_groups {
            let existing_by_id = local_group_by_id.get(&group.id);
            let existing_by_name = local_group_by_name.get(&group.name);
            if let (Some(current_name), Some(current_id)) = (existing_by_id, existing_by_name) {
                if current_name != &group.name && current_id != &group.id {
                    return Err(connection_transfer_invalid_data(format!(
                        "group {} conflicts by both id and name",
                        group.id
                    )));
                }
            }

            let target_id = existing_by_name
                .cloned()
                .unwrap_or_else(|| group.id.clone());
            group_id_map.insert(group.id.clone(), target_id.clone());
            let conflict = existing_by_id.is_some() || existing_by_name.is_some();
            if conflict && strategy == ConnectionTransferConflictStrategy::Skip {
                result.groups.skipped += 1;
                continue;
            }
            if conflict {
                repository
                    .sqlite_connection()
                    .execute(
                        "UPDATE connection_groups
                            SET name = ?1, sort_order = ?2, updated_at = ?3
                          WHERE id = ?4",
                        params![group.name, group.sort_order, group.updated_at, target_id],
                    )
                    .map_err(connection_transfer_import_failed)?;
                result.groups.updated += 1;
            } else {
                repository
                    .sqlite_connection()
                    .execute(
                        "INSERT INTO connection_groups(id, name, sort_order, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![
                            group.id,
                            group.name,
                            group.sort_order,
                            group.created_at,
                            group.updated_at,
                        ],
                    )
                    .map_err(connection_transfer_import_failed)?;
                result.groups.created += 1;
            }
        }

        for credential in &data.credentials {
            let conflict = existing_credential_ids.contains(&credential.id);
            if conflict && strategy == ConnectionTransferConflictStrategy::Skip {
                result.credentials.skipped += 1;
                continue;
            }
            if let Some(slot_id) = credential.secret_slot_id.as_ref() {
                active_secret_slots.insert(slot_id.clone());
            }
            let secret_ref = credential.secret_slot_id.as_ref();
            repository
                .sqlite_connection()
                .execute(
                    "INSERT INTO credentials(
                        id, name, username, kind, secret_ref, secret_slot_id,
                        private_key_path, notes, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                     ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        username = excluded.username,
                        kind = excluded.kind,
                        secret_ref = excluded.secret_ref,
                        secret_slot_id = excluded.secret_slot_id,
                        private_key_path = excluded.private_key_path,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at",
                    params![
                        credential.id,
                        credential.name,
                        credential.username,
                        enum_json(&credential.kind)?,
                        secret_ref,
                        credential.secret_slot_id,
                        credential.private_key_path,
                        credential.notes,
                        credential.created_at,
                        credential.updated_at,
                    ],
                )
                .map_err(connection_transfer_import_failed)?;
            if conflict {
                result.credentials.updated += 1;
            } else {
                result.credentials.created += 1;
            }
        }

        for connection in &data.connections {
            let conflict = existing_connection_ids.contains(&connection.id);
            if conflict && strategy == ConnectionTransferConflictStrategy::Skip {
                result.connections.skipped += 1;
                continue;
            }
            if let Some(slot_id) = connection.inline_secret_slot_id.as_ref() {
                active_secret_slots.insert(slot_id.clone());
            }
            let group_id = connection
                .group_id
                .as_ref()
                .and_then(|id| group_id_map.get(id))
                .cloned();
            let inline_secret_ref = connection.inline_secret_slot_id.as_ref();
            repository
                .sqlite_connection()
                .execute(
                    "INSERT INTO connections(
                        id, name, protocol, group_id, host, port, username, credential_mode, credential_id,
                        inline_auth_kind, inline_secret_ref, inline_secret_slot_id,
                        inline_private_key_path, prompt_auth_kind, proxy_json, jump_json,
                        advanced_json, rdp_json, vnc_json, telnet_json, serial_json, notes, is_favorite,
                        last_connected_at, remote_os_id, remote_os_name, remote_os_version, created_at, updated_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24,
                        ?25, ?26, ?27, ?28, ?29
                     )
                     ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        protocol = excluded.protocol,
                        group_id = excluded.group_id,
                        host = excluded.host,
                        port = excluded.port,
                        username = excluded.username,
                        credential_mode = excluded.credential_mode,
                        credential_id = excluded.credential_id,
                        inline_auth_kind = excluded.inline_auth_kind,
                        inline_secret_ref = excluded.inline_secret_ref,
                        inline_secret_slot_id = excluded.inline_secret_slot_id,
                        inline_private_key_path = excluded.inline_private_key_path,
                        prompt_auth_kind = excluded.prompt_auth_kind,
                        proxy_json = excluded.proxy_json,
                        jump_json = excluded.jump_json,
                        advanced_json = excluded.advanced_json,
                        rdp_json = excluded.rdp_json,
                        vnc_json = excluded.vnc_json,
                        telnet_json = excluded.telnet_json,
                        serial_json = excluded.serial_json,
                        notes = excluded.notes,
                        is_favorite = excluded.is_favorite,
                        last_connected_at = excluded.last_connected_at,
                        remote_os_id = excluded.remote_os_id,
                        remote_os_name = excluded.remote_os_name,
                        remote_os_version = excluded.remote_os_version,
                        updated_at = excluded.updated_at",
                    params![
                        connection.id,
                        connection.name,
                        enum_json(&connection.protocol)?,
                        group_id,
                        connection.host,
                        connection.port,
                        connection.username,
                        enum_json(&connection.credential_mode)?,
                        connection.credential_id,
                        optional_enum_json(connection.inline_auth_kind.as_ref())?,
                        inline_secret_ref,
                        connection.inline_secret_slot_id,
                        connection.inline_private_key_path,
                        optional_enum_json(connection.prompt_auth_kind.as_ref())?,
                        serde_json::to_string(&connection.proxy)
                            .map_err(connection_transfer_import_failed)?,
                        serde_json::to_string(&connection.jump)
                            .map_err(connection_transfer_import_failed)?,
                        serde_json::to_string(&connection.advanced)
                            .map_err(connection_transfer_import_failed)?,
                        optional_json(&connection.rdp)?,
                        optional_json(&connection.vnc)?,
                        optional_json(&connection.telnet)?,
                        optional_json(&connection.serial)?,
                        connection.notes,
                        if connection.is_favorite { 1 } else { 0 },
                        connection.last_connected_at,
                        connection.remote_os_id,
                        connection.remote_os_name,
                        connection.remote_os_version,
                        connection.created_at,
                        connection.updated_at,
                    ],
                )
                .map_err(connection_transfer_import_failed)?;
            if conflict {
                result.connections.updated += 1;
            } else {
                result.connections.created += 1;
            }
        }
        repository
            .sqlite_connection()
            .execute(
                "INSERT INTO app_settings(key, value_json, updated_at)
                 VALUES (?1, ?2, 'connection-transfer')
                 ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at",
                params![
                    CONNECTION_TRANSFER_COMMIT_KEY,
                    serde_json::to_string(recovery.transaction_id())
                        .map_err(connection_transfer_import_failed)?,
                ],
            )
            .map_err(connection_transfer_import_failed)?;
        Ok(())
    })();

    if let Err(error) = database_result {
        let _ = repository.sqlite_connection().execute_batch("ROLLBACK;");
        recovery.abort()?;
        return Err(error);
    }

    let mut secret_backups = Vec::new();
    for secret in secrets
        .secrets
        .iter()
        .filter(|item| active_secret_slots.contains(&item.slot_id))
    {
        let reference = secret_reference(secret)?;
        let previous = match repository.secret_get(&reference) {
            Ok(value) => Some(value),
            Err(error) if error.code == "secret_missing" => None,
            Err(error) => {
                let _ = repository.sqlite_connection().execute_batch("ROLLBACK;");
                restore_secret_backups(repository, &secret_backups)?;
                recovery.abort()?;
                return Err(connection_transfer_import_failed(error.raw_message));
            }
        };
        secret_backups.push((reference.clone(), previous));
        if let Err(error) = repository.secret_set(&reference, &secret.value) {
            let _ = repository.sqlite_connection().execute_batch("ROLLBACK;");
            restore_secret_backups(repository, &secret_backups)?;
            recovery.abort()?;
            return Err(connection_transfer_import_failed(error.raw_message));
        }
        result.secrets += 1;
    }

    if let Err(error) = repository.sqlite_connection().execute_batch("COMMIT;") {
        let _ = repository.sqlite_connection().execute_batch("ROLLBACK;");
        restore_secret_backups(repository, &secret_backups)?;
        recovery.abort()?;
        return Err(connection_transfer_import_failed(error));
    }
    recovery.commit()?;
    Ok(result)
}

fn restore_secret_backups(
    repository: &StorageRepository,
    backups: &[(SecretReference, Option<String>)],
) -> Result<(), AppError> {
    for (reference, previous) in backups.iter().rev() {
        match previous {
            Some(value) => repository.secret_set(reference, value)?,
            None => repository.secret_delete(reference)?,
        }
    }
    Ok(())
}

fn secret_reference(secret: &SyncSecretEntry) -> Result<SecretReference, AppError> {
    let kind = match secret.kind.as_str() {
        "password" => SecretKind::Password,
        "private_key_passphrase" => SecretKind::PrivateKeyPassphrase,
        "inline_password" => SecretKind::InlinePassword,
        "inline_private_key_passphrase" => SecretKind::InlinePrivateKeyPassphrase,
        _ => {
            return Err(connection_transfer_invalid_data(
                "unsupported connection transfer secret kind",
            ))
        }
    };
    Ok(SecretReference {
        service: VAULT_SERVICE,
        account: secret.slot_id.clone(),
        slot_id: secret.slot_id.clone(),
        kind,
    })
}

fn enum_json<T: Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_value(value)
        .map_err(connection_transfer_import_failed)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| connection_transfer_import_failed("enum did not serialize as a string"))
}

fn optional_enum_json<T: Serialize>(value: Option<&T>) -> Result<Option<String>, AppError> {
    value.map(enum_json).transpose()
}

fn optional_json<T: Serialize>(value: &Option<T>) -> Result<Option<String>, AppError> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(connection_transfer_import_failed)
}

fn export_repository_bundle(
    repository: &StorageRepository,
    password: &str,
    created_at: &str,
) -> Result<ConnectionTransferBundle, AppError> {
    let sync_data = repository.export_sync_data()?;
    let data = ConnectionTransferData {
        version: CONNECTION_TRANSFER_VERSION,
        connection_groups: sync_data.connection_groups,
        credentials: sync_data.credentials,
        connections: sync_data.connections,
    };
    let secrets = ConnectionTransferSecrets {
        version: CONNECTION_TRANSFER_VERSION,
        secrets: repository.export_sync_secrets()?,
    };
    validate_transfer_data(&data)?;
    validate_transfer_secrets(&data, &secrets)?;
    build_bundle(data, &secrets, password, created_at)
}

fn preview_bundle(
    repository: &StorageRepository,
    bundle: &ConnectionTransferBundle,
    password: &str,
) -> Result<ConnectionTransferPreview, AppError> {
    let secrets = decrypt_bundle(bundle, password)?;
    validate_transfer_data(&bundle.data)?;
    validate_transfer_secrets(&bundle.data, &secrets)?;

    let local_connection_ids = query_string_set(repository, "SELECT id FROM connections")?;
    let local_credential_ids = query_string_set(repository, "SELECT id FROM credentials")?;
    let local_group_ids = query_string_set(repository, "SELECT id FROM connection_groups")?;
    let local_group_names = query_string_set(repository, "SELECT name FROM connection_groups")?;

    let connection_conflicts = bundle
        .data
        .connections
        .iter()
        .filter(|item| local_connection_ids.contains(&item.id))
        .count();
    let credential_conflicts = bundle
        .data
        .credentials
        .iter()
        .filter(|item| local_credential_ids.contains(&item.id))
        .count();
    let group_conflicts = bundle
        .data
        .connection_groups
        .iter()
        .filter(|item| local_group_ids.contains(&item.id) || local_group_names.contains(&item.name))
        .count();

    Ok(ConnectionTransferPreview {
        connections: item_stats(bundle.data.connections.len(), connection_conflicts),
        credentials: item_stats(bundle.data.credentials.len(), credential_conflicts),
        groups: item_stats(bundle.data.connection_groups.len(), group_conflicts),
        private_key_warnings: private_key_warnings(&bundle.data),
    })
}

fn validate_transfer_data(data: &ConnectionTransferData) -> Result<(), AppError> {
    if data.connection_groups.len() > CONNECTION_TRANSFER_MAX_GROUPS
        || data.credentials.len() > CONNECTION_TRANSFER_MAX_CREDENTIALS
        || data.connections.len() > CONNECTION_TRANSFER_MAX_CONNECTIONS
    {
        return Err(connection_transfer_invalid_data(
            "connection transfer record limit exceeded",
        ));
    }

    let mut group_ids = BTreeSet::new();
    let mut group_names = BTreeSet::new();
    for group in &data.connection_groups {
        if group.id.trim().is_empty()
            || group.name.trim().is_empty()
            || !group_ids.insert(group.id.as_str())
            || !group_names.insert(group.name.as_str())
        {
            return Err(connection_transfer_invalid_data(
                "duplicate or empty connection group",
            ));
        }
    }

    let mut credential_ids = BTreeSet::new();
    for credential in &data.credentials {
        if credential.id.trim().is_empty() || !credential_ids.insert(credential.id.as_str()) {
            return Err(connection_transfer_invalid_data(
                "duplicate or empty credential id",
            ));
        }
    }

    let mut connection_ids = BTreeSet::new();
    for connection in &data.connections {
        if connection.id.trim().is_empty() || !connection_ids.insert(connection.id.as_str()) {
            return Err(connection_transfer_invalid_data(
                "duplicate or empty connection id",
            ));
        }
        if connection
            .group_id
            .as_deref()
            .is_some_and(|id| !group_ids.contains(id))
        {
            return Err(connection_transfer_invalid_data(format!(
                "connection {} references missing group",
                connection.id
            )));
        }
        if connection
            .credential_id
            .as_deref()
            .is_some_and(|id| !credential_ids.contains(id))
        {
            return Err(connection_transfer_invalid_data(format!(
                "connection {} references missing credential",
                connection.id
            )));
        }
    }
    for connection in &data.connections {
        if connection
            .jump
            .jump_connection_id
            .as_deref()
            .is_some_and(|id| !connection_ids.contains(id))
        {
            return Err(connection_transfer_invalid_data(format!(
                "connection {} references missing jump connection",
                connection.id
            )));
        }
    }
    Ok(())
}

fn validate_transfer_secrets(
    data: &ConnectionTransferData,
    secrets: &ConnectionTransferSecrets,
) -> Result<(), AppError> {
    if secrets.secrets.len() > CONNECTION_TRANSFER_MAX_SECRETS {
        return Err(connection_transfer_invalid_data(
            "connection transfer secret limit exceeded",
        ));
    }
    let mut expected = BTreeMap::new();
    for credential in &data.credentials {
        if let Some(slot_id) = credential.secret_slot_id.as_ref() {
            let kind = match credential.kind {
                crate::connections::ConnectionAuthKind::Password => "password",
                crate::connections::ConnectionAuthKind::PrivateKey => "private_key_passphrase",
            };
            expected.insert(slot_id.as_str(), kind);
        }
    }
    for connection in &data.connections {
        if let Some(slot_id) = connection.inline_secret_slot_id.as_ref() {
            let kind = match connection.inline_auth_kind {
                Some(crate::connections::ConnectionAuthKind::Password) => "inline_password",
                Some(crate::connections::ConnectionAuthKind::PrivateKey) => {
                    "inline_private_key_passphrase"
                }
                None => {
                    return Err(connection_transfer_invalid_data(format!(
                        "connection {} has a secret slot without auth kind",
                        connection.id
                    )))
                }
            };
            expected.insert(slot_id.as_str(), kind);
        }
    }

    let mut seen = BTreeSet::new();
    for secret in &secrets.secrets {
        if !seen.insert(secret.slot_id.as_str())
            || expected.get(secret.slot_id.as_str()).copied() != Some(secret.kind.as_str())
        {
            return Err(connection_transfer_invalid_data(
                "secret slot is duplicated, unsupported, or mismatched",
            ));
        }
    }
    if seen.len() != expected.len() {
        return Err(connection_transfer_invalid_data(
            "one or more referenced secrets are missing",
        ));
    }
    Ok(())
}

fn query_string_set(
    repository: &StorageRepository,
    sql: &str,
) -> Result<BTreeSet<String>, AppError> {
    let mut statement = repository
        .sqlite_connection()
        .prepare(sql)
        .map_err(connection_transfer_query_failed)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(connection_transfer_query_failed)?;
    rows.collect::<Result<BTreeSet<_>, _>>()
        .map_err(connection_transfer_query_failed)
}

fn query_string_pairs(
    repository: &StorageRepository,
    sql: &str,
) -> Result<Vec<(String, String)>, AppError> {
    let mut statement = repository
        .sqlite_connection()
        .prepare(sql)
        .map_err(connection_transfer_query_failed)?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(connection_transfer_query_failed)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(connection_transfer_query_failed)
}

fn item_stats(total: usize, conflicts: usize) -> ConnectionTransferItemStats {
    ConnectionTransferItemStats {
        total,
        new: total.saturating_sub(conflicts),
        conflicts,
    }
}

fn private_key_warnings(data: &ConnectionTransferData) -> Vec<String> {
    let mut paths = BTreeSet::new();
    for path in data
        .credentials
        .iter()
        .filter_map(|item| item.private_key_path.as_deref())
        .chain(
            data.connections
                .iter()
                .filter_map(|item| item.inline_private_key_path.as_deref()),
        )
    {
        if !path.trim().is_empty() && !Path::new(path).is_file() {
            paths.insert(path.to_string());
        }
    }
    paths.into_iter().collect()
}

fn build_bundle(
    mut data: ConnectionTransferData,
    secrets: &ConnectionTransferSecrets,
    password: &str,
    created_at: &str,
) -> Result<ConnectionTransferBundle, AppError> {
    validate_password(password)?;
    data.version = CONNECTION_TRANSFER_VERSION;
    let data_bytes = serde_json::to_vec(&data).map_err(connection_transfer_serialize_failed)?;
    let data_sha256 = sha256_hex(&data_bytes);
    let encrypted = encrypt_json(&connection_transfer_aad(&data_sha256), password, secrets)
        .map_err(connection_transfer_serialize_failed)?;

    Ok(ConnectionTransferBundle {
        format: CONNECTION_TRANSFER_FORMAT.to_string(),
        version: CONNECTION_TRANSFER_VERSION,
        created_at: created_at.to_string(),
        data,
        data_sha256,
        secrets: encrypted,
    })
}

fn decrypt_bundle(
    bundle: &ConnectionTransferBundle,
    password: &str,
) -> Result<ConnectionTransferSecrets, AppError> {
    validate_password(password)?;
    if bundle.format != CONNECTION_TRANSFER_FORMAT || bundle.version != CONNECTION_TRANSFER_VERSION
    {
        return Err(connection_transfer_incompatible(
            "unsupported format or version",
        ));
    }
    let data_bytes =
        serde_json::to_vec(&bundle.data).map_err(connection_transfer_serialize_failed)?;
    let actual_hash = sha256_hex(&data_bytes);
    if actual_hash != bundle.data_sha256 {
        return Err(connection_transfer_data_modified("data hash mismatch"));
    }
    if bundle.data.version != CONNECTION_TRANSFER_VERSION {
        return Err(connection_transfer_incompatible("unsupported data version"));
    }
    let secrets: ConnectionTransferSecrets = decrypt_json(
        &connection_transfer_aad(&actual_hash),
        password,
        &bundle.secrets,
    )
    .map_err(connection_transfer_decrypt_failed)?;
    if secrets.version != CONNECTION_TRANSFER_VERSION {
        return Err(connection_transfer_incompatible(
            "unsupported secrets version",
        ));
    }
    Ok(secrets)
}

fn connection_transfer_aad(data_sha256: &str) -> Vec<u8> {
    format!("{CONNECTION_TRANSFER_FORMAT}\0v{CONNECTION_TRANSFER_VERSION}\0{data_sha256}")
        .into_bytes()
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::new(
            "connection_transfer_password_required",
            "请输入导出密码。",
            "connection transfer password is empty",
            true,
        ));
    }
    if password.len() > CONNECTION_TRANSFER_MAX_PASSWORD_BYTES {
        return Err(AppError::new(
            "connection_transfer_password_too_long",
            "导出密码过长。",
            "connection transfer password exceeds byte limit",
            true,
        ));
    }
    Ok(())
}

fn connection_transfer_incompatible(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_incompatible",
        "连接迁移文件格式不兼容。",
        raw,
        true,
    )
}

fn connection_transfer_data_modified(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_data_modified",
        "连接迁移文件的数据已被修改。",
        raw,
        true,
    )
}

fn connection_transfer_decrypt_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_decrypt_failed",
        "密码不正确或加密凭据已损坏。",
        raw,
        true,
    )
}

fn connection_transfer_serialize_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_serialize_failed",
        "连接迁移文件处理失败。",
        raw,
        true,
    )
}

fn connection_transfer_invalid_data(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_invalid_data",
        "连接迁移文件包含无效或不完整的数据。",
        raw,
        true,
    )
}

fn connection_transfer_query_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_preview_failed",
        "连接迁移预检失败。",
        raw,
        true,
    )
}

fn connection_transfer_import_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_import_failed",
        "连接导入失败，本地数据未更改。",
        raw,
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionCredentialMode,
        ConnectionJumpConfig, ConnectionProfileInput, ConnectionProtocol, ConnectionProxyConfig,
    };
    use crate::credentials::CredentialProfileInput;
    use crate::storage_repository::StorageRepository;
    use crate::storage_vault::{InMemorySecretStore, SecretStoreFailure};
    use crate::sync_snapshot::SyncConnectionGroup;

    use super::{
        apply_bundle, build_bundle, decrypt_bundle, export_repository_bundle, export_to_file,
        import_from_file, preview_bundle, preview_file, validate_transfer_data,
        ConnectionTransferConflictStrategy, ConnectionTransferData, ConnectionTransferSecrets,
    };

    #[test]
    fn bundle_round_trips_with_correct_password() {
        let data = ConnectionTransferData::default();
        let secrets = ConnectionTransferSecrets::default();
        let bundle = build_bundle(
            data.clone(),
            &secrets,
            "export-password",
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();

        let restored = decrypt_bundle(&bundle, "export-password").unwrap();

        assert_eq!(bundle.format, "mxterm-connections");
        assert_eq!(bundle.version, 1);
        assert_eq!(bundle.data, data);
        assert_eq!(restored, secrets);
        assert_eq!(restored.version, 1);
    }

    #[test]
    fn bundle_rejects_wrong_password() {
        let bundle = build_bundle(
            ConnectionTransferData::default(),
            &ConnectionTransferSecrets::default(),
            "export-password",
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();

        let error = decrypt_bundle(&bundle, "wrong-password").unwrap_err();

        assert_eq!(error.code, "connection_transfer_decrypt_failed");
    }

    #[test]
    fn bundle_rejects_modified_plaintext_data() {
        let mut bundle = build_bundle(
            ConnectionTransferData::default(),
            &ConnectionTransferSecrets::default(),
            "export-password",
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();
        bundle.data.version = 2;

        let error = decrypt_bundle(&bundle, "export-password").unwrap_err();

        assert_eq!(error.code, "connection_transfer_data_modified");
    }

    #[test]
    fn repository_export_encrypts_secrets_and_preview_reports_new_records() {
        let source = temp_repository("export-source");
        seed_secret_profiles(&source);
        let bundle =
            export_repository_bundle(&source, "export-password", "2026-08-01T00:00:00+08:00")
                .unwrap();
        let serialized = serde_json::to_string(&bundle).unwrap();
        let target = temp_repository("export-target");

        let preview = preview_bundle(&target, &bundle, "export-password").unwrap();

        assert!(!serialized.contains("credential-secret"));
        assert!(!serialized.contains("inline-secret"));
        assert_eq!(preview.connections.total, 1);
        assert_eq!(preview.connections.new, 1);
        assert_eq!(preview.credentials.total, 1);
        assert_eq!(preview.credentials.new, 1);
        assert_eq!(preview.groups.total, 1);
        assert_eq!(preview.groups.new, 1);
    }

    #[test]
    fn validation_rejects_duplicate_groups_and_dangling_references() {
        let source = temp_repository("validation-source");
        seed_secret_profiles(&source);
        let bundle =
            export_repository_bundle(&source, "export-password", "2026-08-01T00:00:00+08:00")
                .unwrap();
        let mut duplicate = bundle.data.clone();
        duplicate.connection_groups.push(SyncConnectionGroup {
            id: "other-group".to_string(),
            name: duplicate.connection_groups[0].name.clone(),
            sort_order: 1,
            created_at: "2026-08-01T00:00:00+08:00".to_string(),
            updated_at: "2026-08-01T00:00:00+08:00".to_string(),
        });

        let duplicate_error = validate_transfer_data(&duplicate).unwrap_err();
        assert_eq!(duplicate_error.code, "connection_transfer_invalid_data");

        let mut dangling = bundle.data.clone();
        dangling.connections[0].group_id = Some("missing-group".to_string());
        let dangling_error = validate_transfer_data(&dangling).unwrap_err();
        assert_eq!(dangling_error.code, "connection_transfer_invalid_data");
    }

    #[test]
    fn import_inserts_records_and_restores_saved_secrets() {
        let source = temp_repository("import-source");
        seed_profiles(
            &source,
            "Source connection",
            "Source credential",
            "source-credential-secret",
            "source-inline-secret",
        );
        let bundle =
            export_repository_bundle(&source, "export-password", "2026-08-01T00:00:00+08:00")
                .unwrap();
        let mut target = temp_repository("import-target");

        let result = apply_bundle(
            &mut target,
            &bundle,
            "export-password",
            ConnectionTransferConflictStrategy::Skip,
        )
        .unwrap();

        assert_eq!(result.connections.created, 1);
        assert_eq!(result.credentials.created, 1);
        assert_eq!(result.groups.created, 1);
        let resolved = target
            .resolve_saved_connection("conn-inline", None)
            .unwrap();
        assert_eq!(resolved.password.as_deref(), Some("source-inline-secret"));
        let credential = target.credential_reveal_secret("cred-password").unwrap();
        assert_eq!(
            credential.password.as_deref(),
            Some("source-credential-secret")
        );
    }

    #[test]
    fn import_skip_keeps_local_conflicts_and_overwrite_replaces_them() {
        let source = temp_repository("conflict-source");
        seed_profiles(
            &source,
            "Source connection",
            "Source credential",
            "source-credential-secret",
            "source-inline-secret",
        );
        let bundle =
            export_repository_bundle(&source, "export-password", "2026-08-01T00:00:00+08:00")
                .unwrap();
        let mut target = temp_repository("conflict-target");
        seed_profiles(
            &target,
            "Local connection",
            "Local credential",
            "local-credential-secret",
            "local-inline-secret",
        );

        let skipped = apply_bundle(
            &mut target,
            &bundle,
            "export-password",
            ConnectionTransferConflictStrategy::Skip,
        )
        .unwrap();
        assert_eq!(skipped.connections.skipped, 1);
        assert_eq!(
            target.connection_get("conn-inline").unwrap().unwrap().name,
            "Local connection"
        );
        assert_eq!(
            target
                .resolve_saved_connection("conn-inline", None)
                .unwrap()
                .password
                .as_deref(),
            Some("local-inline-secret")
        );

        let overwritten = apply_bundle(
            &mut target,
            &bundle,
            "export-password",
            ConnectionTransferConflictStrategy::Overwrite,
        )
        .unwrap();
        assert_eq!(overwritten.connections.updated, 1);
        assert_eq!(
            target.connection_get("conn-inline").unwrap().unwrap().name,
            "Source connection"
        );
        assert_eq!(
            target
                .resolve_saved_connection("conn-inline", None)
                .unwrap()
                .password
                .as_deref(),
            Some("source-inline-secret")
        );
    }

    #[test]
    fn import_rolls_back_database_and_prior_secrets_after_late_secret_failure() {
        let source = temp_repository("rollback-source");
        seed_profiles(
            &source,
            "Source connection",
            "Source credential",
            "source-credential-secret",
            "source-inline-secret",
        );
        let bundle =
            export_repository_bundle(&source, "export-password", "2026-08-01T00:00:00+08:00")
                .unwrap();
        let root = std::env::temp_dir().join(format!(
            "mxterm-connection-transfer-rollback-target-{}",
            uuid::Uuid::new_v4()
        ));
        let failing_secrets = Arc::new(InMemorySecretStore::failing_after(
            SecretStoreFailure::Write,
            1,
        ));
        let mut target = StorageRepository::open(root.join("mxterm.db"), failing_secrets).unwrap();

        let error = apply_bundle(
            &mut target,
            &bundle,
            "export-password",
            ConnectionTransferConflictStrategy::Skip,
        )
        .unwrap_err();

        assert_eq!(error.code, "connection_transfer_import_failed");
        assert!(target.connection_list().unwrap().is_empty());
        assert!(target.credential_list().unwrap().is_empty());
        assert_eq!(
            target
                .sqlite_connection()
                .query_row("SELECT COUNT(*) FROM connection_groups", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn file_export_and_preview_round_trip_with_stable_fingerprint() {
        let source = temp_repository("file-export-source");
        seed_secret_profiles(&source);
        let root = std::env::temp_dir().join(format!(
            "mxterm-connection-transfer-file-export-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("connections.mxterm-connections.json");

        let exported = export_to_file(
            &source,
            &path,
            "export-password",
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();
        let target = temp_repository("file-export-target");
        let preview = preview_file(&target, &path, "export-password").unwrap();

        assert_eq!(exported.connections, 1);
        assert_eq!(exported.credentials, 1);
        assert_eq!(exported.groups, 1);
        assert_eq!(preview.summary.connections.new, 1);
        assert_eq!(preview.fingerprint.len(), 64);
        assert!(path.exists());
    }

    #[test]
    fn import_rejects_file_replaced_after_preview() {
        let source = temp_repository("fingerprint-source");
        seed_secret_profiles(&source);
        let root = std::env::temp_dir().join(format!(
            "mxterm-connection-transfer-fingerprint-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("connections.mxterm-connections.json");
        export_to_file(
            &source,
            &path,
            "export-password",
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();
        let mut target = temp_repository("fingerprint-target");
        let preview = preview_file(&target, &path, "export-password").unwrap();
        let mut document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        document["created_at"] = serde_json::Value::String("2026-08-01T00:00:01+08:00".to_string());
        fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();

        let error = import_from_file(
            &mut target,
            &path,
            "export-password",
            &preview.fingerprint,
            ConnectionTransferConflictStrategy::Skip,
        )
        .unwrap_err();

        assert_eq!(error.code, "connection_transfer_file_changed");
        assert!(target.connection_list().unwrap().is_empty());
    }

    fn seed_secret_profiles(repo: &StorageRepository) {
        seed_profiles(
            repo,
            "Production connection",
            "Production credential",
            "credential-secret",
            "inline-secret",
        );
    }

    fn seed_profiles(
        repo: &StorageRepository,
        connection_name: &str,
        credential_name: &str,
        credential_secret: &str,
        inline_secret: &str,
    ) {
        repo.credential_upsert(
            CredentialProfileInput {
                id: Some("cred-password".to_string()),
                name: Some(credential_name.to_string()),
                username: Some("deploy".to_string()),
                kind: ConnectionAuthKind::Password,
                password: Some(credential_secret.to_string()),
                password_touched: true,
                private_key_path: None,
                private_key_passphrase: None,
                private_key_passphrase_touched: false,
                notes: None,
            },
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();
        repo.connection_upsert(
            ConnectionProfileInput {
                id: Some("conn-inline".to_string()),
                protocol: ConnectionProtocol::Ssh,
                name: Some(connection_name.to_string()),
                group: Some("Production".to_string()),
                host: "example.com".to_string(),
                port: 22,
                username: "root".to_string(),
                credential_mode: ConnectionCredentialMode::Inline,
                credential_id: None,
                inline_auth_kind: Some(ConnectionAuthKind::Password),
                inline_password: Some(inline_secret.to_string()),
                inline_password_touched: true,
                inline_private_key_path: None,
                inline_private_key_passphrase: None,
                inline_private_key_passphrase_touched: false,
                prompt_auth_kind: None,
                proxy: ConnectionProxyConfig::default(),
                jump: ConnectionJumpConfig::default(),
                advanced: ConnectionAdvancedConfig::default(),
                rdp: None,
                vnc: None,
                telnet: None,
                serial: None,
                notes: Some("transfer me".to_string()),
                is_favorite: Some(true),
                last_connected_at: None,
                remote_os_id: None,
                remote_os_name: None,
                remote_os_version: None,
                auth_kind: None,
                password: None,
                private_key_path: None,
                private_key_passphrase: None,
            },
            "2026-08-01T00:00:00+08:00",
        )
        .unwrap();
    }

    fn temp_repository(name: &str) -> StorageRepository {
        let root = std::env::temp_dir().join(format!(
            "mxterm-connection-transfer-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        let secrets = Arc::new(InMemorySecretStore::default());
        StorageRepository::open(root.join("mxterm.db"), secrets).unwrap()
    }
}
