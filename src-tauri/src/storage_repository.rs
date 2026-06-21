use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use crate::app_error::AppError;
use crate::connections::{
    validate_profile_input, ConnectionAuthKind, ConnectionCredentialMode, ConnectionProfile,
    ConnectionProfileInput, ConnectionRemoteSystemInfo,
};
use crate::credentials::{validate_credential_input, CredentialProfile, CredentialProfileInput};
use crate::known_hosts::{HostKeyInfo, KnownHostCheck, KnownHostEntry};
use crate::ssh_config::{ResolvedSshConfig, RuntimeCredentialInput};
use crate::storage_migration::StorageMigrator;
use crate::storage_sqlite::{normalize_known_host_host, SqliteStore};
use crate::storage_vault::{
    SecretKind, SecretReference, SecretStore, VaultState, VAULT_FILE_NAME, VAULT_SERVICE,
};
use crate::sync_snapshot::{
    SyncConnectionGroup, SyncConnectionRecord, SyncCredentialRecord, SyncDataDocument,
    SyncSecretEntry, SyncSecretsPlaintext, SYNC_PROTOCOL_VERSION,
};
use crate::tunnels::{validate_tunnel_rule_input, TunnelRule, TunnelRuleInput};

pub struct StorageRepository {
    connection: Connection,
    secret_store: Arc<dyn SecretStore>,
    db_path: PathBuf,
}

pub struct SyncRepositoryImportStats {
    pub connections: usize,
    pub credentials: usize,
    pub known_hosts: usize,
    pub tunnels: usize,
}

struct ExistingConnectionMeta {
    created_at: String,
    is_favorite: bool,
    last_connected_at: Option<String>,
    remote_os_id: Option<String>,
    remote_os_name: Option<String>,
    remote_os_version: Option<String>,
}

impl StorageRepository {
    pub fn open(
        db_path: impl AsRef<Path>,
        secret_store: Arc<dyn SecretStore>,
    ) -> Result<Self, AppError> {
        let db_path = db_path.as_ref().to_path_buf();
        let store = SqliteStore::open(&db_path)?;
        store.initialize()?;
        drop(store);
        let connection = Connection::open(&db_path).map_err(sqlite_repository_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(sqlite_repository_error)?;
        Ok(Self {
            connection,
            secret_store,
            db_path,
        })
    }

    pub fn open_app(app: &AppHandle) -> Result<Self, AppError> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| {
            AppError::new(
                "sqlite_store_path_failed",
                "SQLite 存储路径获取失败。",
                error,
                true,
            )
        })?;
        Self::open_root(app_data_dir, app.state::<VaultState>().secret_store()?)
    }

    pub fn open_root(
        root: impl AsRef<Path>,
        secret_store: Arc<dyn SecretStore>,
    ) -> Result<Self, AppError> {
        let root = root.as_ref().to_path_buf();
        StorageMigrator::new(root.clone(), Arc::clone(&secret_store)).migrate()?;
        Self::open(root.join("mxterm.db"), secret_store)
    }
    pub fn root_dir(&self) -> PathBuf {
        self.db_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn sync_backup_root(&self) -> PathBuf {
        self.root_dir().join("backups").join("sync").join("latest")
    }

    pub fn create_sync_backup(&self) -> Result<(), AppError> {
        let backup_root = self.sync_backup_root();
        fs::create_dir_all(&backup_root).map_err(sync_snapshot_backup_failed)?;
        if self.db_path.exists() {
            fs::copy(&self.db_path, backup_root.join("mxterm.db"))
                .map_err(sync_snapshot_backup_failed)?;
        }
        let local_vault = self.root_dir().join(VAULT_FILE_NAME);
        if local_vault.exists() {
            fs::copy(local_vault, backup_root.join(VAULT_FILE_NAME))
                .map_err(sync_snapshot_backup_failed)?;
        }
        Ok(())
    }

    pub fn app_setting_get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, AppError> {
        let value_json = self
            .connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sqlite_repository_error)?;
        value_json
            .map(|value| serde_json::from_str(&value).map_err(sqlite_serialize_error))
            .transpose()
    }

    pub fn app_setting_set<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        now: &str,
    ) -> Result<(), AppError> {
        let value_json = serde_json::to_string(value).map_err(sqlite_serialize_error)?;
        self.connection
            .execute(
                "INSERT INTO app_settings(key, value_json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at",
                params![key, value_json, now],
            )
            .map_err(sqlite_repository_error)?;
        Ok(())
    }

    pub fn secret_set(&self, reference: &SecretReference, secret: &str) -> Result<(), AppError> {
        self.secret_store.set_secret(reference, secret)
    }

    pub fn secret_get(&self, reference: &SecretReference) -> Result<String, AppError> {
        self.secret_store.get_secret(reference)
    }

    pub fn secret_delete(&self, reference: &SecretReference) -> Result<(), AppError> {
        self.secret_store.delete_secret(reference)
    }

    pub fn secret_exists(&self, reference: &SecretReference) -> Result<bool, AppError> {
        match self.secret_store.get_secret(reference) {
            Ok(_) => Ok(true),
            Err(error) if error.code == "secret_missing" => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn sync_secret_count(&self) -> Result<usize, AppError> {
        let count = self
            .connection
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM connections WHERE inline_secret_ref IS NOT NULL AND inline_secret_slot_id IS NOT NULL) +
                    (SELECT COUNT(*) FROM credentials WHERE secret_ref IS NOT NULL AND secret_slot_id IS NOT NULL)",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sqlite_repository_error)?;
        Ok(count.max(0) as usize)
    }
    pub fn export_sync_data(&self) -> Result<SyncDataDocument, AppError> {
        Ok(SyncDataDocument {
            version: SYNC_PROTOCOL_VERSION,
            connection_groups: self.export_sync_groups()?,
            credentials: self.export_sync_credentials()?,
            connections: self.export_sync_connections()?,
            known_hosts: self.export_sync_known_hosts()?,
            tunnels: self.tunnel_list()?,
            settings: self.export_sync_settings()?,
        })
    }

    pub fn export_sync_secrets(&self) -> Result<Vec<SyncSecretEntry>, AppError> {
        let mut rows = Vec::new();
        {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT inline_secret_ref, inline_secret_slot_id, inline_auth_kind, updated_at
                       FROM connections
                      WHERE inline_secret_ref IS NOT NULL AND inline_secret_slot_id IS NOT NULL",
                )
                .map_err(sqlite_repository_error)?;
            let items = statement
                .query_map([], |row| {
                    let account: String = row.get(0)?;
                    let slot_id: String = row.get(1)?;
                    let auth_kind: Option<String> = row.get(2)?;
                    let updated_at: String = row.get(3)?;
                    Ok((account, slot_id, auth_kind, updated_at, true))
                })
                .map_err(sqlite_repository_error)?;
            for item in items {
                rows.push(item.map_err(sqlite_repository_error)?);
            }
        }
        {
            let mut statement = self
                .connection
                .prepare(
                    "SELECT secret_ref, secret_slot_id, kind, updated_at
                       FROM credentials
                      WHERE secret_ref IS NOT NULL AND secret_slot_id IS NOT NULL",
                )
                .map_err(sqlite_repository_error)?;
            let items = statement
                .query_map([], |row| {
                    let account: String = row.get(0)?;
                    let slot_id: String = row.get(1)?;
                    let kind: String = row.get(2)?;
                    let updated_at: String = row.get(3)?;
                    Ok((account, slot_id, Some(kind), updated_at, false))
                })
                .map_err(sqlite_repository_error)?;
            for item in items {
                rows.push(item.map_err(sqlite_repository_error)?);
            }
        }

        rows.into_iter()
            .map(|(account, slot_id, kind, updated_at, inline)| {
                let secret_kind = sync_secret_kind_from_db(kind.as_deref(), inline)?;
                let reference = SecretReference {
                    service: VAULT_SERVICE,
                    account,
                    slot_id: slot_id.clone(),
                    kind: secret_kind,
                };
                Ok(SyncSecretEntry {
                    slot_id,
                    kind: sync_secret_kind_label(secret_kind).to_string(),
                    value: self.secret_store.get_secret(&reference)?,
                    updated_at,
                })
            })
            .collect()
    }

    pub fn import_sync_secrets(&self, plaintext: &SyncSecretsPlaintext) -> Result<(), AppError> {
        for secret in &plaintext.secrets {
            let reference = SecretReference {
                service: VAULT_SERVICE,
                account: secret.slot_id.clone(),
                slot_id: secret.slot_id.clone(),
                kind: sync_secret_kind_from_label(&secret.kind)?,
            };
            self.secret_store.set_secret(&reference, &secret.value)?;
        }
        Ok(())
    }

    pub fn replace_sync_data(
        &mut self,
        data: &SyncDataDocument,
        restore_secret_refs: bool,
    ) -> Result<SyncRepositoryImportStats, AppError> {
        let result = self.replace_sync_data_inner(data, restore_secret_refs);
        if let Err(error) = result {
            let _ = self.connection.execute_batch("ROLLBACK;");
            return Err(AppError::new(
                "sync_snapshot_import_failed",
                "同步快照导入失败，本地数据未替换。",
                error.raw_message,
                true,
            ));
        }
        result
    }

    fn replace_sync_data_inner(
        &mut self,
        data: &SyncDataDocument,
        restore_secret_refs: bool,
    ) -> Result<SyncRepositoryImportStats, AppError> {
        self.connection
            .execute_batch("BEGIN IMMEDIATE;")
            .map_err(sqlite_repository_error)?;
        self.connection
            .execute_batch(
                "DELETE FROM tunnels;
                 DELETE FROM connections;
                 DELETE FROM credentials;
                 DELETE FROM connection_groups;
                 DELETE FROM known_hosts;
                 DELETE FROM app_settings;",
            )
            .map_err(sqlite_repository_error)?;

        for group in &data.connection_groups {
            self.connection
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
                .map_err(sqlite_repository_error)?;
        }

        for credential in &data.credentials {
            let secret_ref = if restore_secret_refs {
                credential.secret_slot_id.clone()
            } else {
                None
            };
            self.connection
                .execute(
                    "INSERT INTO credentials(
                        id, name, username, kind, secret_ref, secret_slot_id,
                        private_key_path, notes, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        credential.id,
                        credential.name,
                        credential.username,
                        enum_value(&credential.kind)?,
                        secret_ref,
                        credential.secret_slot_id,
                        credential.private_key_path,
                        credential.notes,
                        credential.created_at,
                        credential.updated_at,
                    ],
                )
                .map_err(sqlite_repository_error)?;
        }

        for connection in &data.connections {
            let inline_secret_ref = if restore_secret_refs {
                connection.inline_secret_slot_id.clone()
            } else {
                None
            };
            let proxy_json =
                serde_json::to_string(&connection.proxy).map_err(sqlite_serialize_error)?;
            let jump_json =
                serde_json::to_string(&connection.jump).map_err(sqlite_serialize_error)?;
            let advanced_json =
                serde_json::to_string(&connection.advanced).map_err(sqlite_serialize_error)?;
            self.connection
                .execute(
                    "INSERT INTO connections(
                        id, name, group_id, host, port, username, credential_mode, credential_id,
                        inline_auth_kind, inline_secret_ref, inline_secret_slot_id,
                        inline_private_key_path, prompt_auth_kind, proxy_json, jump_json,
                        advanced_json, notes, is_favorite, last_connected_at, remote_os_id,
                        remote_os_name, remote_os_version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
                    )",
                    params![
                        connection.id,
                        connection.name,
                        connection.group_id,
                        connection.host,
                        connection.port,
                        connection.username,
                        enum_value(&connection.credential_mode)?,
                        connection.credential_id,
                        optional_enum_value(&connection.inline_auth_kind)?,
                        inline_secret_ref,
                        connection.inline_secret_slot_id,
                        connection.inline_private_key_path,
                        optional_enum_value(&connection.prompt_auth_kind)?,
                        proxy_json,
                        jump_json,
                        advanced_json,
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
                .map_err(sqlite_repository_error)?;
        }

        for entry in &data.known_hosts {
            self.connection
                .execute(
                    "INSERT INTO known_hosts(
                        host, port, key_algorithm, fingerprint_sha256, public_key,
                        first_trusted_at, last_seen_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        normalize_known_host_host(&entry.host),
                        entry.port,
                        entry.key_algorithm,
                        entry.fingerprint_sha256,
                        entry.public_key,
                        entry.trusted_at,
                        entry.updated_at,
                    ],
                )
                .map_err(sqlite_repository_error)?;
        }

        for tunnel in &data.tunnels {
            self.connection
                .execute(
                    "INSERT INTO tunnels(
                        id, name, kind, connection_id, local_host, local_port,
                        remote_host, remote_port, auto_start, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        tunnel.id,
                        tunnel.name,
                        enum_value(&tunnel.kind)?,
                        tunnel.connection_id,
                        tunnel.local_host,
                        tunnel.local_port,
                        tunnel.remote_host,
                        tunnel.remote_port,
                        if tunnel.auto_start { 1 } else { 0 },
                        tunnel.created_at,
                        tunnel.updated_at,
                    ],
                )
                .map_err(sqlite_repository_error)?;
        }

        for (key, value) in &data.settings {
            self.connection
                .execute(
                    "INSERT INTO app_settings(key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, value.to_string(), current_timestamp()],
                )
                .map_err(sqlite_repository_error)?;
        }

        self.connection
            .execute_batch("COMMIT;")
            .map_err(sqlite_repository_error)?;
        Ok(SyncRepositoryImportStats {
            connections: data.connections.len(),
            credentials: data.credentials.len(),
            known_hosts: data.known_hosts.len(),
            tunnels: data.tunnels.len(),
        })
    }

    fn export_sync_groups(&self) -> Result<Vec<SyncConnectionGroup>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, sort_order, created_at, updated_at
                   FROM connection_groups ORDER BY sort_order ASC, created_at ASC, name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(SyncConnectionGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sort_order: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    fn export_sync_credentials(&self) -> Result<Vec<SyncCredentialRecord>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, username, kind, secret_slot_id, private_key_path, notes,
                        created_at, updated_at
                   FROM credentials ORDER BY created_at ASC, name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], |row| {
                let kind: String = row.get(3)?;
                Ok(SyncCredentialRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    username: row.get(2)?,
                    kind: serde_json::from_value(serde_json::Value::String(kind))
                        .map_err(from_serde_row_error)?,
                    secret_slot_id: row.get(4)?,
                    private_key_path: row.get(5)?,
                    notes: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    fn export_sync_connections(&self) -> Result<Vec<SyncConnectionRecord>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, group_id, host, port, username, credential_mode, credential_id,
                        inline_auth_kind, inline_secret_slot_id, inline_private_key_path,
                        prompt_auth_kind, proxy_json, jump_json, advanced_json, notes,
                        is_favorite, last_connected_at, remote_os_id, remote_os_name,
                        remote_os_version, created_at, updated_at
                   FROM connections ORDER BY created_at ASC, name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], |row| {
                let credential_mode: String = row.get(6)?;
                let inline_auth_kind: Option<String> = row.get(8)?;
                let prompt_auth_kind: Option<String> = row.get(11)?;
                let proxy_json: String = row.get(12)?;
                let jump_json: String = row.get(13)?;
                let advanced_json: String = row.get(14)?;
                let mut proxy: crate::connections::ConnectionProxyConfig =
                    serde_json::from_str(&proxy_json).map_err(from_serde_row_error)?;
                proxy.password = None;
                Ok(SyncConnectionRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    group_id: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    username: row.get(5)?,
                    credential_mode: serde_json::from_value(serde_json::Value::String(
                        credential_mode,
                    ))
                    .map_err(from_serde_row_error)?,
                    credential_id: row.get(7)?,
                    inline_auth_kind: optional_enum_from_string(inline_auth_kind)?,
                    inline_secret_slot_id: row.get(9)?,
                    inline_private_key_path: row.get(10)?,
                    prompt_auth_kind: optional_enum_from_string(prompt_auth_kind)?,
                    proxy,
                    jump: serde_json::from_str(&jump_json).map_err(from_serde_row_error)?,
                    advanced: serde_json::from_str(&advanced_json).map_err(from_serde_row_error)?,
                    notes: row.get(15)?,
                    is_favorite: row.get::<_, i64>(16)? != 0,
                    last_connected_at: row.get(17)?,
                    remote_os_id: row.get(18)?,
                    remote_os_name: row.get(19)?,
                    remote_os_version: row.get(20)?,
                    created_at: row.get(21)?,
                    updated_at: row.get(22)?,
                })
            })
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    fn export_sync_known_hosts(&self) -> Result<Vec<KnownHostEntry>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT host, port, key_algorithm, fingerprint_sha256, public_key,
                        first_trusted_at, last_seen_at
                   FROM known_hosts ORDER BY host ASC, port ASC, key_algorithm ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], |row| {
                let host: String = row.get(0)?;
                let port: u16 = row.get(1)?;
                let key_algorithm: String = row.get(2)?;
                Ok(KnownHostEntry {
                    id: format!("{host}:{port}:{key_algorithm}"),
                    host,
                    port,
                    key_algorithm,
                    fingerprint_sha256: row.get(3)?,
                    public_key: row.get(4)?,
                    trusted_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    fn export_sync_settings(&self) -> Result<BTreeMap<String, serde_json::Value>, AppError> {
        let mut statement = self
            .connection
            .prepare("SELECT key, value_json FROM app_settings ORDER BY key ASC")
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], |row| {
                let key: String = row.get(0)?;
                let value_json: String = row.get(1)?;
                let value = serde_json::from_str(&value_json).map_err(from_serde_row_error)?;
                Ok((key, value))
            })
            .map_err(sqlite_repository_error)?;
        let mut settings = BTreeMap::new();
        for row in rows {
            let (key, value) = row.map_err(sqlite_repository_error)?;
            settings.insert(key, value);
        }
        Ok(settings)
    }
    pub fn connection_upsert(
        &self,
        input: ConnectionProfileInput,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let validated = validate_profile_input(&input)?;
        let id = validated
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let existing = self.existing_connection_meta(&id)?;
        let created_at = existing
            .as_ref()
            .map(|item| item.created_at.clone())
            .unwrap_or_else(|| now.to_string());
        let is_favorite = input
            .is_favorite
            .unwrap_or_else(|| existing.as_ref().is_some_and(|item| item.is_favorite));
        let last_connected_at = trim_optional(input.last_connected_at.as_ref()).or_else(|| {
            existing
                .as_ref()
                .and_then(|item| item.last_connected_at.clone())
        });
        let remote_os_id = trim_optional(input.remote_os_id.as_ref())
            .or_else(|| existing.as_ref().and_then(|item| item.remote_os_id.clone()));
        let remote_os_name = trim_optional(input.remote_os_name.as_ref()).or_else(|| {
            existing
                .as_ref()
                .and_then(|item| item.remote_os_name.clone())
        });
        let remote_os_version = trim_optional(input.remote_os_version.as_ref()).or_else(|| {
            existing
                .as_ref()
                .and_then(|item| item.remote_os_version.clone())
        });
        let group_id = match validated.group.as_deref() {
            Some(group) => Some(self.ensure_group(group, now)?),
            None => None,
        };

        let (inline_secret_ref, inline_secret_slot_id) = match (
            validated.inline_auth_kind.as_ref(),
            validated.inline_password.as_ref(),
            validated.inline_private_key_passphrase.as_ref(),
        ) {
            (Some(crate::connections::ConnectionAuthKind::Password), Some(password), _) => {
                let reference = SecretReference::connection(&id, SecretKind::InlinePassword);
                self.secret_store.set_secret(&reference, password)?;
                (Some(reference.account), Some(reference.slot_id))
            }
            (Some(crate::connections::ConnectionAuthKind::PrivateKey), _, Some(passphrase)) => {
                let reference =
                    SecretReference::connection(&id, SecretKind::InlinePrivateKeyPassphrase);
                self.secret_store.set_secret(&reference, passphrase)?;
                (Some(reference.account), Some(reference.slot_id))
            }
            _ => (None, None),
        };

        let proxy_json = serde_json::to_string(&validated.proxy).map_err(sqlite_serialize_error)?;
        let jump_json = serde_json::to_string(&validated.jump).map_err(sqlite_serialize_error)?;
        let advanced_json =
            serde_json::to_string(&validated.advanced).map_err(sqlite_serialize_error)?;

        self.connection
            .execute(
                "INSERT INTO connections(
                    id, name, group_id, host, port, username, credential_mode, credential_id,
                    inline_auth_kind, inline_secret_ref, inline_secret_slot_id,
                    inline_private_key_path, prompt_auth_kind, proxy_json, jump_json,
                    advanced_json, notes, is_favorite, last_connected_at, remote_os_id,
                    remote_os_name, remote_os_version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                    ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
                )
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
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
                    notes = excluded.notes,
                    is_favorite = excluded.is_favorite,
                    last_connected_at = excluded.last_connected_at,
                    remote_os_id = excluded.remote_os_id,
                    remote_os_name = excluded.remote_os_name,
                    remote_os_version = excluded.remote_os_version,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    validated.name,
                    group_id,
                    validated.host,
                    validated.port,
                    validated.username,
                    serde_json::to_value(&validated.credential_mode)
                        .map_err(sqlite_serialize_error)?
                        .as_str()
                        .unwrap_or("inline"),
                    validated.credential_id,
                    optional_enum_value(&validated.inline_auth_kind)?,
                    inline_secret_ref,
                    inline_secret_slot_id,
                    validated.inline_private_key_path,
                    optional_enum_value(&validated.prompt_auth_kind)?,
                    proxy_json,
                    jump_json,
                    advanced_json,
                    validated.notes,
                    if is_favorite { 1 } else { 0 },
                    last_connected_at,
                    remote_os_id,
                    remote_os_name,
                    remote_os_version,
                    created_at,
                    now,
                ],
            )
            .map_err(sqlite_repository_error)?;

        self.connection_get(&id)?.ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            )
        })
    }

    pub fn connection_list(&self) -> Result<Vec<ConnectionProfile>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT c.id, c.name, g.name, c.host, c.port, c.username,
                        c.credential_mode, c.credential_id, c.inline_auth_kind,
                        c.inline_private_key_path, c.prompt_auth_kind, c.proxy_json,
                        c.jump_json, c.advanced_json, c.notes, c.is_favorite,
                        c.last_connected_at, c.remote_os_id, c.remote_os_name,
                        c.remote_os_version, c.created_at, c.updated_at
                   FROM connections c
                   LEFT JOIN connection_groups g ON g.id = c.group_id
                  ORDER BY c.created_at ASC, c.name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], row_to_connection_profile)
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    pub fn connection_delete(&self, id: &str) -> Result<(), AppError> {
        let (_profile, inline_secret_ref) = self.stored_connection(id)?;
        let changed = self
            .connection
            .execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            ));
        }
        if let Some(reference) = inline_secret_ref {
            self.secret_store.delete_secret(&reference)?;
        }
        Ok(())
    }

    pub fn connection_set_favorite(
        &self,
        id: &str,
        is_favorite: bool,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE connections SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
                params![if is_favorite { 1 } else { 0 }, now, id],
            )
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            ));
        }
        self.connection_get(id)?.ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            )
        })
    }

    pub fn connection_mark_connected(
        &self,
        id: &str,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE connections SET last_connected_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            ));
        }
        self.connection_get(id)?.ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            )
        })
    }

    pub fn connection_update_remote_system(
        &self,
        id: &str,
        system: ConnectionRemoteSystemInfo,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE connections
                    SET remote_os_id = ?1, remote_os_name = ?2, remote_os_version = ?3,
                        updated_at = ?4
                  WHERE id = ?5",
                params![system.os_id, system.os_name, system.os_version, now, id],
            )
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            ));
        }
        self.connection_get(id)?.ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            )
        })
    }
    pub fn connection_get(&self, id: &str) -> Result<Option<ConnectionProfile>, AppError> {
        self.connection
            .query_row(
                "SELECT c.id, c.name, g.name, c.host, c.port, c.username,
                        c.credential_mode, c.credential_id, c.inline_auth_kind,
                        c.inline_private_key_path, c.prompt_auth_kind, c.proxy_json,
                        c.jump_json, c.advanced_json, c.notes, c.is_favorite,
                        c.last_connected_at, c.remote_os_id, c.remote_os_name,
                        c.remote_os_version, c.created_at, c.updated_at
                   FROM connections c
                   LEFT JOIN connection_groups g ON g.id = c.group_id
                  WHERE c.id = ?1",
                params![id],
                row_to_connection_profile,
            )
            .optional()
            .map_err(sqlite_repository_error)
    }

    pub fn credential_upsert(
        &self,
        input: CredentialProfileInput,
        now: &str,
    ) -> Result<CredentialProfile, AppError> {
        let validated = validate_credential_input(&input)?;
        let id = validated
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = self
            .connection
            .query_row(
                "SELECT created_at FROM credentials WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sqlite_repository_error)?
            .unwrap_or_else(|| now.to_string());

        let (secret_ref, secret_slot_id) = match validated.kind {
            ConnectionAuthKind::Password => {
                let reference = SecretReference::credential(&id, SecretKind::Password);
                let password = validated.password.as_deref().ok_or_else(|| {
                    AppError::new(
                        "credential_password_missing",
                        "请填写账号密码。",
                        "credential password is empty",
                        true,
                    )
                })?;
                self.secret_store.set_secret(&reference, password)?;
                (Some(reference.account), Some(reference.slot_id))
            }
            ConnectionAuthKind::PrivateKey => match validated.private_key_passphrase.as_deref() {
                Some(passphrase) => {
                    let reference =
                        SecretReference::credential(&id, SecretKind::PrivateKeyPassphrase);
                    self.secret_store.set_secret(&reference, passphrase)?;
                    (Some(reference.account), Some(reference.slot_id))
                }
                None => (None, None),
            },
        };
        let kind = enum_value(&validated.kind)?;

        self.connection
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
                    id,
                    validated.name,
                    validated.username,
                    kind,
                    secret_ref,
                    secret_slot_id,
                    validated.private_key_path,
                    validated.notes,
                    created_at,
                    now,
                ],
            )
            .map_err(sqlite_repository_error)?;

        self.credential_get(&id)?.ok_or_else(|| {
            AppError::new(
                "credential_missing",
                "凭据不存在。",
                format!("credential_id={id}"),
                false,
            )
        })
    }

    pub fn credential_get(&self, id: &str) -> Result<Option<CredentialProfile>, AppError> {
        self.connection
            .query_row(
                "SELECT id, name, username, kind, private_key_path, notes, created_at, updated_at
                   FROM credentials WHERE id = ?1",
                params![id],
                row_to_credential_profile,
            )
            .optional()
            .map_err(sqlite_repository_error)
    }

    pub fn credential_list(&self) -> Result<Vec<CredentialProfile>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, username, kind, private_key_path, notes, created_at, updated_at
                   FROM credentials ORDER BY created_at ASC, name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], row_to_credential_profile)
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    pub fn credential_delete(&self, id: &str) -> Result<(), AppError> {
        let references = self
            .connection
            .prepare("SELECT name FROM connections WHERE credential_id = ?1")
            .and_then(|mut statement| {
                let rows = statement.query_map(params![id], |row| row.get::<_, String>(0))?;
                rows.collect::<Result<Vec<_>, _>>()
            })
            .map_err(sqlite_repository_error)?;
        if !references.is_empty() {
            return Err(AppError::new(
                "credential_in_use",
                "该凭据正在被连接使用，请先修改连接。",
                references.join(", "),
                true,
            ));
        }

        let (_credential, secret_ref) = self.stored_credential(id)?;
        let changed = self
            .connection
            .execute("DELETE FROM credentials WHERE id = ?1", params![id])
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "credential_missing",
                "凭据不存在。",
                format!("credential_id={id}"),
                false,
            ));
        }
        if let Some(reference) = secret_ref {
            self.secret_store.delete_secret(&reference)?;
        }
        Ok(())
    }
    pub fn resolve_saved_connection(
        &self,
        connection_id: &str,
        prompt: Option<RuntimeCredentialInput>,
    ) -> Result<ResolvedSshConfig, AppError> {
        let (mut profile, inline_secret_ref) = self.stored_connection(connection_id)?;
        match profile.credential_mode {
            ConnectionCredentialMode::Inline => match profile.inline_auth_kind {
                Some(ConnectionAuthKind::Password) => {
                    let reference = inline_secret_ref.ok_or_else(|| {
                        AppError::new(
                            "secret_missing",
                            "系统凭据不存在。",
                            format!("connection_id={}", profile.id),
                            true,
                        )
                    })?;
                    profile.inline_password = Some(self.secret_store.get_secret(&reference)?);
                }
                Some(ConnectionAuthKind::PrivateKey) => {
                    profile.inline_private_key_passphrase = inline_secret_ref
                        .as_ref()
                        .map(|reference| self.secret_store.get_secret(reference))
                        .transpose()?;
                }
                None => {}
            },
            _ => {}
        }
        self.resolve_profile(profile, prompt)
    }
    pub fn resolve_transient_connection(
        &self,
        input: ConnectionProfileInput,
    ) -> Result<ResolvedSshConfig, AppError> {
        let validated = validate_profile_input(&input)?;
        let profile = ConnectionProfile {
            id: "__transient_connection_test__".to_string(),
            name: validated.name,
            group: validated.group,
            host: validated.host,
            port: validated.port,
            username: validated.username,
            credential_mode: validated.credential_mode,
            credential_id: validated.credential_id,
            inline_auth_kind: validated.inline_auth_kind,
            inline_password: validated.inline_password,
            inline_private_key_path: validated.inline_private_key_path,
            inline_private_key_passphrase: validated.inline_private_key_passphrase,
            prompt_auth_kind: validated.prompt_auth_kind,
            proxy: validated.proxy,
            jump: validated.jump,
            advanced: validated.advanced,
            notes: validated.notes,
            is_favorite: false,
            last_connected_at: None,
            remote_os_id: None,
            remote_os_name: None,
            remote_os_version: None,
            created_at: String::new(),
            updated_at: String::new(),
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        };
        self.resolve_profile(profile, None)
    }

    fn resolve_profile(
        &self,
        profile: ConnectionProfile,
        prompt: Option<RuntimeCredentialInput>,
    ) -> Result<ResolvedSshConfig, AppError> {
        let (auth_kind, password, private_key_path, private_key_passphrase) =
            match profile.credential_mode {
                ConnectionCredentialMode::Saved => {
                    let credential_id = profile.credential_id.as_deref().ok_or_else(|| {
                        AppError::new(
                            "connection_credential_missing",
                            "连接缺少保存的凭据。",
                            format!("connection_id={}", profile.id),
                            true,
                        )
                    })?;
                    let (credential, secret_ref) = self.stored_credential(credential_id)?;
                    match credential.kind {
                        ConnectionAuthKind::Password => {
                            let secret_ref = secret_ref.ok_or_else(|| {
                                AppError::new(
                                    "secret_missing",
                                    "系统凭据不存在。",
                                    format!("credential_id={credential_id}"),
                                    true,
                                )
                            })?;
                            (
                                ConnectionAuthKind::Password,
                                Some(self.secret_store.get_secret(&secret_ref)?),
                                None,
                                None,
                            )
                        }
                        ConnectionAuthKind::PrivateKey => {
                            let passphrase = secret_ref
                                .as_ref()
                                .map(|reference| self.secret_store.get_secret(reference))
                                .transpose()?;
                            (
                                ConnectionAuthKind::PrivateKey,
                                None,
                                credential.private_key_path,
                                passphrase,
                            )
                        }
                    }
                }
                ConnectionCredentialMode::Inline => {
                    let auth_kind = profile.inline_auth_kind.clone().ok_or_else(|| {
                        AppError::new(
                            "terminal_auth_missing",
                            "连接缺少认证方式。",
                            format!("connection_id={}", profile.id),
                            true,
                        )
                    })?;
                    (
                        auth_kind,
                        profile.inline_password,
                        profile.inline_private_key_path,
                        profile.inline_private_key_passphrase,
                    )
                }
                ConnectionCredentialMode::Prompt => {
                    let prompt = prompt.ok_or_else(|| {
                        AppError::new(
                            "credential_prompt_required",
                            "请输入本次连接凭据。",
                            format!("connection_id={}", profile.id),
                            true,
                        )
                    })?;
                    let auth_kind = prompt
                        .auth_kind
                        .or(profile.prompt_auth_kind.clone())
                        .unwrap_or(ConnectionAuthKind::Password);
                    (
                        auth_kind,
                        prompt.password,
                        prompt.private_key_path,
                        prompt.private_key_passphrase,
                    )
                }
            };

        validate_auth_material(&auth_kind, password.as_ref(), private_key_path.as_ref())?;
        let (password, private_key_path, private_key_passphrase) = match auth_kind {
            ConnectionAuthKind::Password => (password, None, None),
            ConnectionAuthKind::PrivateKey => (None, private_key_path, private_key_passphrase),
        };
        Ok(ResolvedSshConfig {
            connection_id: profile.id,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            auth_kind,
            password,
            private_key_path,
            private_key_passphrase,
            proxy: profile.proxy,
            jump: profile.jump,
            advanced: profile.advanced,
        })
    }

    fn stored_connection(
        &self,
        id: &str,
    ) -> Result<(ConnectionProfile, Option<SecretReference>), AppError> {
        self.connection
            .query_row(
                "SELECT c.id, c.name, g.name, c.host, c.port, c.username,
                        c.credential_mode, c.credential_id, c.inline_auth_kind,
                        c.inline_private_key_path, c.prompt_auth_kind, c.proxy_json,
                        c.jump_json, c.advanced_json, c.notes, c.is_favorite,
                        c.last_connected_at, c.remote_os_id, c.remote_os_name,
                        c.remote_os_version, c.created_at, c.updated_at,
                        c.inline_secret_ref, c.inline_secret_slot_id
                   FROM connections c
                   LEFT JOIN connection_groups g ON g.id = c.group_id
                  WHERE c.id = ?1",
                params![id],
                |row| {
                    let profile = row_to_connection_profile(row)?;
                    let account: Option<String> = row.get(22)?;
                    let slot_id: Option<String> = row.get(23)?;
                    let reference = account.map(|account| SecretReference {
                        service: VAULT_SERVICE,
                        slot_id: slot_id.unwrap_or_else(|| account.clone()),
                        account,
                        kind: profile
                            .inline_auth_kind
                            .as_ref()
                            .map(|kind| match kind {
                                ConnectionAuthKind::Password => SecretKind::InlinePassword,
                                ConnectionAuthKind::PrivateKey => {
                                    SecretKind::InlinePrivateKeyPassphrase
                                }
                            })
                            .unwrap_or(SecretKind::InlinePassword),
                    });
                    Ok((profile, reference))
                },
            )
            .optional()
            .map_err(sqlite_repository_error)?
            .ok_or_else(|| {
                AppError::new(
                    "connection_missing",
                    "连接不存在。",
                    format!("connection_id={id}"),
                    false,
                )
            })
    }

    fn stored_credential(
        &self,
        id: &str,
    ) -> Result<(CredentialProfile, Option<SecretReference>), AppError> {
        self.connection
            .query_row(
                "SELECT id, name, username, kind, private_key_path, notes, created_at,
                        updated_at, secret_ref, secret_slot_id
                   FROM credentials WHERE id = ?1",
                params![id],
                |row| {
                    let credential = row_to_credential_profile(row)?;
                    let account: Option<String> = row.get(8)?;
                    let slot_id: Option<String> = row.get(9)?;
                    let reference = account.map(|account| SecretReference {
                        service: VAULT_SERVICE,
                        slot_id: slot_id.unwrap_or_else(|| account.clone()),
                        account,
                        kind: match credential.kind {
                            ConnectionAuthKind::Password => SecretKind::Password,
                            ConnectionAuthKind::PrivateKey => SecretKind::PrivateKeyPassphrase,
                        },
                    });
                    Ok((credential, reference))
                },
            )
            .optional()
            .map_err(sqlite_repository_error)?
            .ok_or_else(|| {
                AppError::new(
                    "credential_missing",
                    "连接引用的凭据不存在。",
                    format!("credential_id={id}"),
                    true,
                )
            })
    }

    pub fn known_host_trust(
        &self,
        info: HostKeyInfo,
        now: &str,
    ) -> Result<KnownHostEntry, AppError> {
        let host = normalize_known_host_host(&info.host);
        let existing = self
            .connection
            .query_row(
                "SELECT first_trusted_at FROM known_hosts
                  WHERE host = ?1 AND port = ?2 AND key_algorithm = ?3",
                params![host, info.port, info.key_algorithm],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sqlite_repository_error)?;
        let first_trusted_at = existing.unwrap_or_else(|| now.to_string());
        self.connection
            .execute(
                "INSERT INTO known_hosts(
                    host, port, key_algorithm, fingerprint_sha256, public_key,
                    first_trusted_at, last_seen_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(host, port, key_algorithm) DO UPDATE SET
                    fingerprint_sha256 = excluded.fingerprint_sha256,
                    public_key = excluded.public_key,
                    last_seen_at = excluded.last_seen_at",
                params![
                    host,
                    info.port,
                    info.key_algorithm,
                    info.fingerprint_sha256,
                    info.public_key,
                    first_trusted_at,
                    now,
                ],
            )
            .map_err(sqlite_repository_error)?;
        Ok(KnownHostEntry {
            id: format!("{}:{}:{}", host, info.port, info.key_algorithm),
            host,
            port: info.port,
            key_algorithm: info.key_algorithm,
            fingerprint_sha256: info.fingerprint_sha256,
            public_key: info.public_key,
            trusted_at: first_trusted_at,
            updated_at: now.to_string(),
        })
    }

    pub fn known_host_check(
        &self,
        host: &str,
        port: u16,
        info: HostKeyInfo,
    ) -> Result<KnownHostCheck, AppError> {
        let host = normalize_known_host_host(host);
        let current = self
            .connection
            .query_row(
                "SELECT host, port, key_algorithm, fingerprint_sha256, public_key,
                        first_trusted_at, last_seen_at
                   FROM known_hosts
                  WHERE host = ?1 AND port = ?2 AND key_algorithm = ?3",
                params![host, port, info.key_algorithm],
                |row| {
                    Ok(KnownHostEntry {
                        id: format!(
                            "{}:{}:{}",
                            row.get::<_, String>(0)?,
                            row.get::<_, u16>(1)?,
                            row.get::<_, String>(2)?
                        ),
                        host: row.get(0)?,
                        port: row.get(1)?,
                        key_algorithm: row.get(2)?,
                        fingerprint_sha256: row.get(3)?,
                        public_key: row.get(4)?,
                        trusted_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(sqlite_repository_error)?;
        Ok(match current {
            Some(entry) if entry.fingerprint_sha256 == info.fingerprint_sha256 => {
                KnownHostCheck::Trusted { entry }
            }
            Some(entry) => KnownHostCheck::Changed {
                current: entry,
                host_key: info,
            },
            None => KnownHostCheck::Unknown { host_key: info },
        })
    }

    pub fn tunnel_list(&self) -> Result<Vec<TunnelRule>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, kind, connection_id, local_host, local_port,
                        remote_host, remote_port, auto_start, created_at, updated_at
                   FROM tunnels ORDER BY created_at ASC, name ASC",
            )
            .map_err(sqlite_repository_error)?;
        let rows = statement
            .query_map([], row_to_tunnel_rule)
            .map_err(sqlite_repository_error)?;
        collect_rows(rows)
    }

    pub fn tunnel_get(&self, id: &str) -> Result<Option<TunnelRule>, AppError> {
        self.connection
            .query_row(
                "SELECT id, name, kind, connection_id, local_host, local_port,
                        remote_host, remote_port, auto_start, created_at, updated_at
                   FROM tunnels WHERE id = ?1",
                params![id],
                row_to_tunnel_rule,
            )
            .optional()
            .map_err(sqlite_repository_error)
    }

    pub fn tunnel_upsert(&self, input: TunnelRuleInput, now: &str) -> Result<TunnelRule, AppError> {
        let validated = validate_tunnel_rule_input(input)?;
        let id = validated
            .id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = self
            .connection
            .query_row(
                "SELECT created_at FROM tunnels WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sqlite_repository_error)?
            .unwrap_or_else(|| now.to_string());
        let name = validated.name.unwrap_or_else(|| {
            format!(
                "{}:{} -> {}:{}",
                validated.local_host,
                validated.local_port,
                validated.remote_host,
                validated.remote_port
            )
        });
        self.connection
            .execute(
                "INSERT INTO tunnels(
                    id, name, kind, connection_id, local_host, local_port,
                    remote_host, remote_port, auto_start, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    kind = excluded.kind,
                    connection_id = excluded.connection_id,
                    local_host = excluded.local_host,
                    local_port = excluded.local_port,
                    remote_host = excluded.remote_host,
                    remote_port = excluded.remote_port,
                    auto_start = excluded.auto_start,
                    updated_at = excluded.updated_at",
                params![
                    id,
                    name,
                    enum_value(&validated.kind)?,
                    validated.connection_id,
                    validated.local_host,
                    validated.local_port,
                    validated.remote_host,
                    validated.remote_port,
                    if validated.auto_start { 1 } else { 0 },
                    created_at,
                    now,
                ],
            )
            .map_err(sqlite_repository_error)?;
        self.tunnel_get(&id)?.ok_or_else(|| {
            AppError::new(
                "tunnel_rule_missing",
                "隧道规则不存在。",
                format!("rule_id={id}"),
                false,
            )
        })
    }

    pub fn tunnel_delete(&self, id: &str) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute("DELETE FROM tunnels WHERE id = ?1", params![id])
            .map_err(sqlite_repository_error)?;
        if changed == 0 {
            return Err(AppError::new(
                "tunnel_rule_missing",
                "隧道规则不存在。",
                format!("rule_id={id}"),
                false,
            ));
        }
        Ok(())
    }
    fn existing_connection_meta(
        &self,
        id: &str,
    ) -> Result<Option<ExistingConnectionMeta>, AppError> {
        self.connection
            .query_row(
                "SELECT created_at, is_favorite, last_connected_at, remote_os_id,
                        remote_os_name, remote_os_version
                   FROM connections WHERE id = ?1",
                params![id],
                |row| {
                    Ok(ExistingConnectionMeta {
                        created_at: row.get(0)?,
                        is_favorite: row.get::<_, i64>(1)? != 0,
                        last_connected_at: row.get(2)?,
                        remote_os_id: row.get(3)?,
                        remote_os_name: row.get(4)?,
                        remote_os_version: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(sqlite_repository_error)
    }

    fn ensure_group(&self, name: &str, now: &str) -> Result<String, AppError> {
        if let Some(id) = self
            .connection
            .query_row(
                "SELECT id FROM connection_groups WHERE name = ?1",
                params![name],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(sqlite_repository_error)?
        {
            return Ok(id);
        }

        let id = uuid::Uuid::new_v4().to_string();
        self.connection
            .execute(
                "INSERT INTO connection_groups(id, name, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, 0, ?3, ?3)",
                params![id, name, now],
            )
            .map_err(sqlite_repository_error)?;
        Ok(id)
    }
}

fn row_to_connection_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionProfile> {
    let credential_mode: String = row.get(6)?;
    let inline_auth_kind: Option<String> = row.get(8)?;
    let prompt_auth_kind: Option<String> = row.get(10)?;
    let proxy_json: String = row.get(11)?;
    let jump_json: String = row.get(12)?;
    let advanced_json: String = row.get(13)?;
    Ok(ConnectionProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        group: row.get(2)?,
        host: row.get(3)?,
        port: row.get(4)?,
        username: row.get(5)?,
        credential_mode: serde_json::from_value(serde_json::Value::String(credential_mode))
            .map_err(from_serde_row_error)?,
        credential_id: row.get(7)?,
        inline_auth_kind: optional_enum_from_string(inline_auth_kind)?,
        inline_password: None,
        inline_private_key_path: row.get(9)?,
        inline_private_key_passphrase: None,
        prompt_auth_kind: optional_enum_from_string(prompt_auth_kind)?,
        proxy: serde_json::from_str(&proxy_json).map_err(from_serde_row_error)?,
        jump: serde_json::from_str(&jump_json).map_err(from_serde_row_error)?,
        advanced: serde_json::from_str(&advanced_json).map_err(from_serde_row_error)?,
        notes: row.get(14)?,
        is_favorite: row.get::<_, i64>(15)? != 0,
        last_connected_at: row.get(16)?,
        remote_os_id: row.get(17)?,
        remote_os_name: row.get(18)?,
        remote_os_version: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        auth_kind: None,
        password: None,
        private_key_path: None,
        private_key_passphrase: None,
    })
}

fn row_to_tunnel_rule(row: &rusqlite::Row<'_>) -> rusqlite::Result<TunnelRule> {
    let kind: String = row.get(2)?;
    Ok(TunnelRule {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: serde_json::from_value(serde_json::Value::String(kind))
            .map_err(from_serde_row_error)?,
        connection_id: row.get(3)?,
        local_host: row.get(4)?,
        local_port: row.get(5)?,
        remote_host: row.get(6)?,
        remote_port: row.get(7)?,
        auto_start: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn collect_rows<I, T>(rows: I) -> Result<Vec<T>, AppError>
where
    I: IntoIterator<Item = rusqlite::Result<T>>,
{
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(sqlite_repository_error)?);
    }
    Ok(items)
}
fn row_to_credential_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialProfile> {
    let kind: String = row.get(3)?;
    Ok(CredentialProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        username: Some(row.get(2)?),
        kind: serde_json::from_value(serde_json::Value::String(kind))
            .map_err(from_serde_row_error)?,
        password: None,
        private_key_path: row.get(4)?,
        private_key_passphrase: None,
        notes: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn enum_value<T: serde::Serialize>(value: &T) -> Result<String, AppError> {
    let value = serde_json::to_value(value).map_err(sqlite_serialize_error)?;
    value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
        AppError::new(
            "sqlite_store_serialize_failed",
            "SQLite 存储序列化失败。",
            "enum did not serialize to string",
            true,
        )
    })
}

fn validate_auth_material(
    auth_kind: &ConnectionAuthKind,
    password: Option<&String>,
    private_key_path: Option<&String>,
) -> Result<(), AppError> {
    match auth_kind {
        ConnectionAuthKind::Password if password.is_none_or(|value| value.trim().is_empty()) => {
            Err(AppError::new(
                "terminal_auth_missing",
                "请填写密码或选择私钥。",
                "password is empty",
                true,
            ))
        }
        ConnectionAuthKind::PrivateKey
            if private_key_path.is_none_or(|value| value.trim().is_empty()) =>
        {
            Err(AppError::new(
                "terminal_auth_missing",
                "请填写密码或选择私钥。",
                "private_key_path is empty",
                true,
            ))
        }
        _ => Ok(()),
    }
}
fn optional_enum_value<T: serde::Serialize>(value: &Option<T>) -> Result<Option<String>, AppError> {
    value
        .as_ref()
        .map(|item| {
            serde_json::to_value(item)
                .map_err(sqlite_serialize_error)
                .and_then(|value| {
                    value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                        AppError::new(
                            "sqlite_store_serialize_failed",
                            "SQLite 存储序列化失败。",
                            "enum did not serialize to string",
                            true,
                        )
                    })
                })
        })
        .transpose()
}

fn optional_enum_from_string<T>(value: Option<String>) -> rusqlite::Result<Option<T>>
where
    T: serde::de::DeserializeOwned,
{
    value
        .map(|item| {
            serde_json::from_value(serde_json::Value::String(item)).map_err(from_serde_row_error)
        })
        .transpose()
}

fn from_serde_row_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn sqlite_repository_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        "sqlite_store_query_failed",
        "SQLite 存储查询失败。",
        error,
        true,
    )
}

fn sqlite_serialize_error(error: serde_json::Error) -> AppError {
    AppError::new(
        "sqlite_store_serialize_failed",
        "SQLite 存储序列化失败。",
        error,
        true,
    )
}

fn trim_optional(value: Option<&String>) -> Option<String> {
    value
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn sync_secret_kind_from_db(kind: Option<&str>, inline: bool) -> Result<SecretKind, AppError> {
    match (inline, kind) {
        (true, Some("password")) => Ok(SecretKind::InlinePassword),
        (true, Some("private_key")) => Ok(SecretKind::InlinePrivateKeyPassphrase),
        (false, Some("password")) => Ok(SecretKind::Password),
        (false, Some("private_key")) => Ok(SecretKind::PrivateKeyPassphrase),
        _ => Err(AppError::new(
            "sync_snapshot_incompatible",
            "同步快照凭据类型不兼容。",
            format!("kind={:?}, inline={inline}", kind),
            true,
        )),
    }
}

fn sync_secret_kind_from_label(kind: &str) -> Result<SecretKind, AppError> {
    match kind {
        "password" => Ok(SecretKind::Password),
        "private_key_passphrase" => Ok(SecretKind::PrivateKeyPassphrase),
        "inline_password" => Ok(SecretKind::InlinePassword),
        "inline_private_key_passphrase" => Ok(SecretKind::InlinePrivateKeyPassphrase),
        _ => Err(AppError::new(
            "sync_snapshot_incompatible",
            "同步快照凭据类型不兼容。",
            format!("kind={kind}"),
            true,
        )),
    }
}

fn sync_secret_kind_label(kind: SecretKind) -> &'static str {
    match kind {
        SecretKind::Password => "password",
        SecretKind::PrivateKeyPassphrase => "private_key_passphrase",
        SecretKind::InlinePassword => "inline_password",
        SecretKind::InlinePrivateKeyPassphrase => "inline_private_key_passphrase",
    }
}

fn sync_snapshot_backup_failed(error: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_backup_failed",
        "同步导入备份创建失败。",
        error,
        true,
    )
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rusqlite::Connection;

    use super::StorageRepository;
    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionCredentialMode,
        ConnectionJumpConfig, ConnectionProfileInput, ConnectionProxyConfig,
    };
    use crate::storage_vault::{InMemorySecretStore, SecretStore};

    #[test]
    fn connection_upsert_stores_inline_password_in_secret_store_only() {
        let (repo, db_path, secrets) = temp_repository("inline-password");

        let saved = repo
            .connection_upsert(password_connection_input(), "2026-06-20T00:00:00+08:00")
            .unwrap();

        assert_eq!(saved.inline_password, None);
        let conn = Connection::open(db_path).unwrap();
        let (secret_ref, secret_slot_id): (String, String) = conn
            .query_row(
                "SELECT inline_secret_ref, inline_secret_slot_id FROM connections WHERE id = ?1",
                [&saved.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            secret_ref,
            format!("connection:{}:inline_password", saved.id)
        );
        assert_eq!(secret_slot_id, secret_ref);
        let reference = crate::storage_vault::SecretReference::connection(
            &saved.id,
            crate::storage_vault::SecretKind::InlinePassword,
        );
        assert_eq!(secrets.get_secret(&reference).unwrap(), "secret");
    }

    #[test]
    fn resolve_saved_connection_reads_saved_credential_secret_from_store() {
        let (repo, _db_path, _secrets) = temp_repository("saved-credential");
        let credential = repo
            .credential_upsert(password_credential_input(), "2026-06-20T00:00:00+08:00")
            .unwrap();
        let connection = repo
            .connection_upsert(
                ConnectionProfileInput {
                    credential_mode: ConnectionCredentialMode::Saved,
                    credential_id: Some(credential.id.clone()),
                    inline_password: None,
                    ..password_connection_input()
                },
                "2026-06-20T00:01:00+08:00",
            )
            .unwrap();

        let resolved = repo.resolve_saved_connection(&connection.id, None).unwrap();

        assert_eq!(resolved.password, Some("secret".to_string()));
        assert_eq!(resolved.private_key_path, None);
    }
    fn password_connection_input() -> ConnectionProfileInput {
        ConnectionProfileInput {
            id: Some("conn-001".to_string()),
            name: Some("生产".to_string()),
            group: Some("默认".to_string()),
            host: " example.com ".to_string(),
            port: 22,
            username: " root ".to_string(),
            credential_mode: ConnectionCredentialMode::Inline,
            credential_id: None,
            inline_auth_kind: Some(ConnectionAuthKind::Password),
            inline_password: Some(" secret ".to_string()),
            inline_private_key_path: None,
            inline_private_key_passphrase: None,
            prompt_auth_kind: None,
            proxy: ConnectionProxyConfig::default(),
            jump: ConnectionJumpConfig::default(),
            advanced: ConnectionAdvancedConfig::default(),
            notes: None,
            is_favorite: None,
            last_connected_at: None,
            remote_os_id: None,
            remote_os_name: None,
            remote_os_version: None,
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        }
    }

    fn password_credential_input() -> crate::credentials::CredentialProfileInput {
        crate::credentials::CredentialProfileInput {
            id: Some("cred-001".to_string()),
            name: Some("生产账号".to_string()),
            username: Some("deploy".to_string()),
            kind: ConnectionAuthKind::Password,
            password: Some(" secret ".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            notes: None,
        }
    }
    fn temp_repository(
        name: &str,
    ) -> (
        StorageRepository,
        std::path::PathBuf,
        Arc<InMemorySecretStore>,
    ) {
        let root =
            std::env::temp_dir().join(format!("mxterm-repo-{name}-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("mxterm.db");
        let secrets = Arc::new(InMemorySecretStore::default());
        let repo = StorageRepository::open(db_path.clone(), secrets.clone()).unwrap();
        (repo, db_path, secrets)
    }
}
