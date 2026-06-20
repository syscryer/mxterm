use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};

use crate::app_error::AppError;
use crate::connections::{ConnectionAuthKind, ConnectionStore};
use crate::credentials::CredentialStore;
use crate::known_hosts::KnownHostStore;
use crate::storage_sqlite::{normalize_known_host_host, SqliteStore};
use crate::storage_vault::{SecretKind, SecretReference, SecretStore, VAULT_SERVICE};
use crate::tunnels::TunnelStore;

pub struct StorageMigrator {
    root: PathBuf,
    secret_store: Arc<dyn SecretStore>,
}

impl StorageMigrator {
    pub fn new(root: PathBuf, secret_store: Arc<dyn SecretStore>) -> Self {
        Self { root, secret_store }
    }

    pub fn migrate(&self) -> Result<(), AppError> {
        let db_path = self.root.join("mxterm.db");
        let store = SqliteStore::open(&db_path)?;
        store.initialize()?;
        drop(store);

        let mut connection = Connection::open(&db_path).map_err(sqlite_migration_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(sqlite_migration_error)?;
        if migration_marker(&connection)? {
            self.repair_migrated_vault_secrets(&connection)?;
            return Ok(());
        }

        let connections = ConnectionStore::load(self.root.join("connections.json"))?.list();
        let credentials = CredentialStore::load(self.root.join("credentials.json"))?.list();
        let known_hosts = KnownHostStore::load(self.root.join("known_hosts.json"))?.list();
        let tunnels = TunnelStore::load(self.root.join("tunnels.json"))?.list();

        let mut written_secrets = Vec::new();
        let mut connection_secret_refs: HashMap<String, (Option<String>, Option<String>)> =
            HashMap::new();
        for profile in &connections {
            let secret = match profile.inline_auth_kind {
                Some(ConnectionAuthKind::Password) => {
                    profile.inline_password.as_deref().map(|secret| {
                        (
                            SecretReference::connection(&profile.id, SecretKind::InlinePassword),
                            secret,
                        )
                    })
                }
                Some(ConnectionAuthKind::PrivateKey) => profile
                    .inline_private_key_passphrase
                    .as_deref()
                    .map(|secret| {
                        (
                            SecretReference::connection(
                                &profile.id,
                                SecretKind::InlinePrivateKeyPassphrase,
                            ),
                            secret,
                        )
                    }),
                None => None,
            };
            if let Some((reference, secret)) = secret {
                self.secret_store.set_secret(&reference, secret)?;
                connection_secret_refs.insert(
                    profile.id.clone(),
                    (
                        Some(reference.account.clone()),
                        Some(reference.slot_id.clone()),
                    ),
                );
                written_secrets.push(reference);
            } else {
                connection_secret_refs.insert(profile.id.clone(), (None, None));
            }
        }

        let mut credential_secret_refs: HashMap<String, (Option<String>, Option<String>)> =
            HashMap::new();
        for credential in &credentials {
            let secret = match credential.kind {
                ConnectionAuthKind::Password => credential.password.as_deref().map(|secret| {
                    (
                        SecretReference::credential(&credential.id, SecretKind::Password),
                        secret,
                    )
                }),
                ConnectionAuthKind::PrivateKey => {
                    credential.private_key_passphrase.as_deref().map(|secret| {
                        (
                            SecretReference::credential(
                                &credential.id,
                                SecretKind::PrivateKeyPassphrase,
                            ),
                            secret,
                        )
                    })
                }
            };
            if let Some((reference, secret)) = secret {
                self.secret_store.set_secret(&reference, secret)?;
                credential_secret_refs.insert(
                    credential.id.clone(),
                    (
                        Some(reference.account.clone()),
                        Some(reference.slot_id.clone()),
                    ),
                );
                written_secrets.push(reference);
            } else {
                credential_secret_refs.insert(credential.id.clone(), (None, None));
            }
        }

        let transaction_result = (|| -> Result<(), AppError> {
            let tx = connection.transaction().map_err(sqlite_migration_error)?;
            let mut groups = HashMap::new();
            for profile in &connections {
                if let Some(group) = profile
                    .group
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                {
                    if groups.contains_key(group) {
                        continue;
                    }
                    let id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT OR IGNORE INTO connection_groups(id, name, sort_order, created_at, updated_at)
                         VALUES (?1, ?2, 0, ?3, ?4)",
                        params![id, group, profile.created_at, profile.updated_at],
                    )
                    .map_err(sqlite_migration_error)?;
                    let group_id = tx
                        .query_row(
                            "SELECT id FROM connection_groups WHERE name = ?1",
                            params![group],
                            |row| row.get::<_, String>(0),
                        )
                        .map_err(sqlite_migration_error)?;
                    groups.insert(group.to_string(), group_id);
                }
            }

            for credential in &credentials {
                let (secret_ref, secret_slot_id) = credential_secret_refs
                    .get(&credential.id)
                    .cloned()
                    .unwrap_or((None, None));
                tx.execute(
                    "INSERT OR REPLACE INTO credentials(
                        id, name, username, kind, secret_ref, secret_slot_id,
                        private_key_path, notes, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        credential.id,
                        credential.name,
                        credential.username.clone().unwrap_or_default(),
                        enum_value(&credential.kind)?,
                        secret_ref,
                        secret_slot_id,
                        credential.private_key_path,
                        credential.notes,
                        credential.created_at,
                        credential.updated_at,
                    ],
                )
                .map_err(sqlite_migration_error)?;
            }

            for profile in &connections {
                let group_id = profile
                    .group
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| groups.get(value).cloned());
                let (inline_secret_ref, inline_secret_slot_id) = connection_secret_refs
                    .get(&profile.id)
                    .cloned()
                    .unwrap_or((None, None));
                tx.execute(
                    "INSERT OR REPLACE INTO connections(
                        id, name, group_id, host, port, username, credential_mode, credential_id,
                        inline_auth_kind, inline_secret_ref, inline_secret_slot_id,
                        inline_private_key_path, prompt_auth_kind, proxy_json, jump_json,
                        advanced_json, notes, is_favorite, last_connected_at, remote_os_id,
                        remote_os_name, remote_os_version, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                              ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)",
                    params![
                        profile.id,
                        profile.name,
                        group_id,
                        profile.host,
                        profile.port,
                        profile.username,
                        enum_value(&profile.credential_mode)?,
                        profile.credential_id,
                        optional_enum_value(&profile.inline_auth_kind)?,
                        inline_secret_ref,
                        inline_secret_slot_id,
                        profile.inline_private_key_path,
                        optional_enum_value(&profile.prompt_auth_kind)?,
                        serde_json::to_string(&profile.proxy).map_err(sqlite_serialize_error)?,
                        serde_json::to_string(&profile.jump).map_err(sqlite_serialize_error)?,
                        serde_json::to_string(&profile.advanced).map_err(sqlite_serialize_error)?,
                        profile.notes,
                        if profile.is_favorite { 1 } else { 0 },
                        profile.last_connected_at,
                        profile.remote_os_id,
                        profile.remote_os_name,
                        profile.remote_os_version,
                        profile.created_at,
                        profile.updated_at,
                    ],
                )
                .map_err(sqlite_migration_error)?;
            }

            for entry in &known_hosts {
                tx.execute(
                    "INSERT OR REPLACE INTO known_hosts(
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
                .map_err(sqlite_migration_error)?;
            }

            for rule in &tunnels {
                tx.execute(
                    "INSERT OR REPLACE INTO tunnels(
                        id, name, kind, connection_id, local_host, local_port,
                        remote_host, remote_port, auto_start, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        rule.id,
                        rule.name,
                        enum_value(&rule.kind)?,
                        rule.connection_id,
                        rule.local_host,
                        rule.local_port,
                        rule.remote_host,
                        rule.remote_port,
                        if rule.auto_start { 1 } else { 0 },
                        rule.created_at,
                        rule.updated_at,
                    ],
                )
                .map_err(sqlite_migration_error)?;
            }

            tx.execute(
                "INSERT OR REPLACE INTO app_meta(key, value, updated_at)
                 VALUES ('storage_migrated_from_json', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [],
            )
            .map_err(sqlite_migration_error)?;
            tx.commit().map_err(sqlite_migration_error)?;
            Ok(())
        })();

        if let Err(error) = transaction_result {
            cleanup_secrets(&*self.secret_store, &written_secrets);
            return Err(error);
        }

        self.backup_legacy_json()?;
        Ok(())
    }

    fn repair_migrated_vault_secrets(&self, connection: &Connection) -> Result<(), AppError> {
        let legacy_connections =
            ConnectionStore::load(self.legacy_repair_path("connections.json"))?
                .list()
                .into_iter()
                .map(|profile| (profile.id.clone(), profile))
                .collect::<HashMap<_, _>>();
        let legacy_credentials =
            CredentialStore::load(self.legacy_repair_path("credentials.json"))?
                .list()
                .into_iter()
                .map(|credential| (credential.id.clone(), credential))
                .collect::<HashMap<_, _>>();

        let mut statement = connection
            .prepare(
                "SELECT id, inline_auth_kind, inline_secret_ref, inline_secret_slot_id
                   FROM connections
                  WHERE inline_secret_ref IS NOT NULL",
            )
            .map_err(sqlite_migration_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(sqlite_migration_error)?;
        for row in rows {
            let (id, auth_kind, account, slot_id) = row.map_err(sqlite_migration_error)?;
            let Some(kind) = auth_kind.as_deref().and_then(inline_secret_kind_from_value) else {
                continue;
            };
            let reference = SecretReference {
                service: VAULT_SERVICE,
                slot_id: slot_id.unwrap_or_else(|| account.clone()),
                account,
                kind,
            };
            if !self.secret_needs_repair(&reference)? {
                continue;
            }
            let secret = legacy_connections.get(&id).and_then(|profile| match kind {
                SecretKind::InlinePassword => profile.inline_password.as_deref(),
                SecretKind::InlinePrivateKeyPassphrase => {
                    profile.inline_private_key_passphrase.as_deref()
                }
                _ => None,
            });
            if let Some(secret) = secret {
                self.secret_store.set_secret(&reference, secret)?;
            }
        }

        let mut statement = connection
            .prepare(
                "SELECT id, kind, secret_ref, secret_slot_id
                   FROM credentials
                  WHERE secret_ref IS NOT NULL",
            )
            .map_err(sqlite_migration_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(sqlite_migration_error)?;
        for row in rows {
            let (id, kind_value, account, slot_id) = row.map_err(sqlite_migration_error)?;
            let Some(kind) = credential_secret_kind_from_value(&kind_value) else {
                continue;
            };
            let reference = SecretReference {
                service: VAULT_SERVICE,
                slot_id: slot_id.unwrap_or_else(|| account.clone()),
                account,
                kind,
            };
            if !self.secret_needs_repair(&reference)? {
                continue;
            }
            let secret = legacy_credentials
                .get(&id)
                .and_then(|credential| match kind {
                    SecretKind::Password => credential.password.as_deref(),
                    SecretKind::PrivateKeyPassphrase => {
                        credential.private_key_passphrase.as_deref()
                    }
                    _ => None,
                });
            if let Some(secret) = secret {
                self.secret_store.set_secret(&reference, secret)?;
            }
        }

        Ok(())
    }

    fn secret_needs_repair(&self, reference: &SecretReference) -> Result<bool, AppError> {
        match self.secret_store.get_secret(reference) {
            Ok(_) => Ok(false),
            Err(error) if error.code == "secret_missing" => Ok(true),
            Err(error) => Err(error),
        }
    }

    fn legacy_repair_path(&self, file_name: &str) -> PathBuf {
        let source = self.root.join(file_name);
        let backup = migrated_backup_path(&source);
        if backup.exists() {
            backup
        } else {
            source
        }
    }

    fn backup_legacy_json(&self) -> Result<(), AppError> {
        for file_name in [
            "connections.json",
            "credentials.json",
            "known_hosts.json",
            "tunnels.json",
        ] {
            let source = self.root.join(file_name);
            if source.exists() {
                let backup = migrated_backup_path(&source);
                fs::copy(&source, &backup).map_err(|error| {
                    AppError::new(
                        "storage_migration_backup_failed",
                        "旧存储备份失败。",
                        error,
                        true,
                    )
                })?;
            }
        }
        Ok(())
    }
}

fn migration_marker(connection: &Connection) -> Result<bool, AppError> {
    let value = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'storage_migrated_from_json'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sqlite_migration_error)?;
    Ok(value.as_deref() == Some("true"))
}

fn inline_secret_kind_from_value(value: &str) -> Option<SecretKind> {
    match value {
        "password" => Some(SecretKind::InlinePassword),
        "private_key" => Some(SecretKind::InlinePrivateKeyPassphrase),
        _ => None,
    }
}

fn credential_secret_kind_from_value(value: &str) -> Option<SecretKind> {
    match value {
        "password" => Some(SecretKind::Password),
        "private_key" => Some(SecretKind::PrivateKeyPassphrase),
        _ => None,
    }
}

fn migrated_backup_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".migrated.bak");
    PathBuf::from(backup)
}

fn cleanup_secrets(secret_store: &dyn SecretStore, references: &[SecretReference]) {
    for reference in references {
        let _ = secret_store.delete_secret(reference);
    }
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

fn optional_enum_value<T: serde::Serialize>(value: &Option<T>) -> Result<Option<String>, AppError> {
    value.as_ref().map(enum_value).transpose()
}

fn sqlite_migration_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        "storage_migration_sqlite_failed",
        "SQLite 迁移写入失败。",
        error,
        true,
    )
}

fn sqlite_serialize_error(error: serde_json::Error) -> AppError {
    AppError::new(
        "storage_migration_sqlite_failed",
        "SQLite 迁移序列化失败。",
        error,
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use rusqlite::Connection;

    use super::StorageMigrator;
    use crate::storage_vault::{
        InMemorySecretStore, SecretKind, SecretReference, SecretStore, SecretStoreFailure,
    };

    #[test]
    fn migrates_json_stores_to_sqlite_and_vault() {
        let (root, secrets) = temp_root("full");
        write_legacy_json(&root);

        StorageMigrator::new(root.clone(), secrets.clone())
            .migrate()
            .unwrap();

        let conn = Connection::open(root.join("mxterm.db")).unwrap();
        let migrated: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'storage_migrated_from_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migrated, "true");
        let inline_ref: String = conn
            .query_row(
                "SELECT inline_secret_ref FROM connections WHERE id = 'conn-json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inline_ref, "connection:conn-json:inline_password");
        assert_eq!(
            secrets
                .get_secret(&SecretReference::connection(
                    "conn-json",
                    SecretKind::InlinePassword
                ))
                .unwrap(),
            "inline-secret"
        );
        let credential_ref: String = conn
            .query_row(
                "SELECT secret_ref FROM credentials WHERE id = 'cred-json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(credential_ref, "credential:cred-json:password");
        let known_host: String = conn
            .query_row("SELECT host FROM known_hosts WHERE port = 22", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(known_host, "example.com");
        let tunnel_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tunnels WHERE id = 'tun-json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tunnel_count, 1);
        assert!(root.join("connections.json.migrated.bak").exists());
    }

    #[test]
    fn secret_store_failure_does_not_mark_migration_success() {
        let (root, _secrets) = temp_root("secret-store-failure");
        write_legacy_json(&root);
        let failing = Arc::new(InMemorySecretStore::failing(SecretStoreFailure::Write));

        let error = StorageMigrator::new(root.clone(), failing)
            .migrate()
            .unwrap_err();

        assert_eq!(error.code, "secret_store_write_failed");
        let conn = Connection::open(root.join("mxterm.db")).unwrap();
        let marker_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_meta WHERE key = 'storage_migrated_from_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count, 0);
        assert!(root.join("connections.json").exists());
        assert!(!root.join("connections.json.migrated.bak").exists());
    }

    #[test]
    fn migrated_store_repairs_missing_vault_secrets_from_backup() {
        let (root, initial_secrets) = temp_root("repair-missing-vault");
        write_legacy_json(&root);
        StorageMigrator::new(root.clone(), initial_secrets)
            .migrate()
            .unwrap();

        let repaired_secrets = Arc::new(InMemorySecretStore::default());
        StorageMigrator::new(root.clone(), repaired_secrets.clone())
            .migrate()
            .unwrap();

        assert_eq!(
            repaired_secrets
                .get_secret(&SecretReference::connection(
                    "conn-json",
                    SecretKind::InlinePassword
                ))
                .unwrap(),
            "inline-secret"
        );
        assert_eq!(
            repaired_secrets
                .get_secret(&SecretReference::credential(
                    "cred-json",
                    SecretKind::Password
                ))
                .unwrap(),
            "credential-secret"
        );
    }

    fn temp_root(name: &str) -> (std::path::PathBuf, Arc<InMemorySecretStore>) {
        let root =
            std::env::temp_dir().join(format!("mxterm-migration-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        (root, Arc::new(InMemorySecretStore::default()))
    }

    fn write_legacy_json(root: &std::path::Path) {
        fs::write(
            root.join("connections.json"),
            r#"{
  "version": 2,
  "profiles": [{
    "id": "conn-json",
    "name": "json connection",
    "group": "Ops",
    "host": "example.com",
    "port": 22,
    "username": "root",
    "credential_mode": "inline",
    "inline_auth_kind": "password",
    "inline_password": "inline-secret",
    "proxy": {"kind": "none"},
    "jump": {"kind": "none"},
    "advanced": {"connect_timeout_ms": 30000, "auth_timeout_ms": 45000, "keepalive_interval_ms": 20000, "terminal_encoding": "utf-8"},
    "notes": null,
    "is_favorite": true,
    "last_connected_at": null,
    "remote_os_id": null,
    "remote_os_name": null,
    "remote_os_version": null,
    "created_at": "2026-06-20T00:00:00+08:00",
    "updated_at": "2026-06-20T00:00:00+08:00"
  }]
}"#,
        ).unwrap();
        fs::write(
            root.join("credentials.json"),
            r#"{
  "version": 1,
  "profiles": [{
    "id": "cred-json",
    "name": "json credential",
    "username": "deploy",
    "kind": "password",
    "password": "credential-secret",
    "private_key_path": null,
    "private_key_passphrase": null,
    "notes": null,
    "created_at": "2026-06-20T00:00:00+08:00",
    "updated_at": "2026-06-20T00:00:00+08:00"
  }]
}"#,
        )
        .unwrap();
        fs::write(
            root.join("known_hosts.json"),
            r#"{
  "version": 1,
  "entries": [{
    "id": "host-json",
    "host": " Example.COM ",
    "port": 22,
    "key_algorithm": "ssh-ed25519",
    "fingerprint_sha256": "SHA256:test",
    "public_key": "ssh-ed25519 AAAA",
    "trusted_at": "2026-06-20T00:00:00+08:00",
    "updated_at": "2026-06-20T00:00:00+08:00"
  }]
}"#,
        )
        .unwrap();
        fs::write(
            root.join("tunnels.json"),
            r#"{
  "version": 1,
  "rules": [{
    "id": "tun-json",
    "name": "json tunnel",
    "kind": "local",
    "connection_id": "conn-json",
    "local_host": "127.0.0.1",
    "local_port": 15432,
    "remote_host": "127.0.0.1",
    "remote_port": 5432,
    "auto_start": true,
    "created_at": "2026-06-20T00:00:00+08:00",
    "updated_at": "2026-06-20T00:00:00+08:00"
  }]
}"#,
        )
        .unwrap();
    }
}
