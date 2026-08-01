use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::storage::{write_json_document, JsonStoreErrorLabels};
use crate::storage_vault::VAULT_FILE_NAME;

pub(crate) const CONNECTION_TRANSFER_COMMIT_KEY: &str = "connection_transfer_last_commit";
const JOURNAL_FILE_NAME: &str = ".connection-transfer-pending.json";
const VAULT_BACKUP_FILE_NAME: &str = ".connection-transfer-secrets.enc.bak";

#[derive(Debug, Deserialize, Serialize)]
struct RecoveryJournal {
    version: u16,
    transaction_id: String,
    vault_existed: bool,
}

pub(crate) struct ConnectionTransferRecovery {
    root: PathBuf,
    transaction_id: String,
}

impl ConnectionTransferRecovery {
    pub(crate) fn begin(root: &Path) -> Result<Self, AppError> {
        if root.join(JOURNAL_FILE_NAME).exists() {
            return Err(connection_transfer_recovery_failed(
                "pending connection transfer recovery requires vault unlock",
            ));
        }
        fs::create_dir_all(root).map_err(connection_transfer_recovery_failed)?;
        let vault_path = root.join(VAULT_FILE_NAME);
        let backup_path = root.join(VAULT_BACKUP_FILE_NAME);
        let vault_existed = vault_path.exists();
        if vault_existed {
            fs::copy(&vault_path, &backup_path).map_err(connection_transfer_recovery_failed)?;
        }
        let transaction_id = uuid::Uuid::new_v4().to_string();
        let journal = RecoveryJournal {
            version: 1,
            transaction_id: transaction_id.clone(),
            vault_existed,
        };
        if let Err(error) =
            write_json_document(&root.join(JOURNAL_FILE_NAME), &journal, recovery_labels())
        {
            let _ = fs::remove_file(backup_path);
            return Err(error);
        }
        Ok(Self {
            root: root.to_path_buf(),
            transaction_id,
        })
    }

    pub(crate) fn transaction_id(&self) -> &str {
        &self.transaction_id
    }

    pub(crate) fn commit(self) -> Result<(), AppError> {
        cleanup_recovery_files(&self.root)
    }

    pub(crate) fn abort(self) -> Result<(), AppError> {
        restore_vault_backup(&self.root)?;
        cleanup_recovery_files(&self.root)
    }
}

pub(crate) fn recover_pending_connection_transfer(root: &Path) -> Result<(), AppError> {
    let journal_path = root.join(JOURNAL_FILE_NAME);
    if !journal_path.exists() {
        return Ok(());
    }
    let bytes = fs::read(&journal_path).map_err(connection_transfer_recovery_failed)?;
    let journal: RecoveryJournal =
        serde_json::from_slice(&bytes).map_err(connection_transfer_recovery_failed)?;
    if journal.version != 1 {
        return Err(connection_transfer_recovery_failed(
            "unsupported connection transfer recovery journal",
        ));
    }
    let committed = read_committed_transaction(root)?
        .as_deref()
        .is_some_and(|value| value == journal.transaction_id);
    if !committed {
        restore_vault_backup_with_state(root, journal.vault_existed)?;
    }
    cleanup_recovery_files(root)
}

fn read_committed_transaction(root: &Path) -> Result<Option<String>, AppError> {
    let database_path = root.join("mxterm.db");
    if !database_path.exists() {
        return Ok(None);
    }
    let connection =
        Connection::open(database_path).map_err(connection_transfer_recovery_failed)?;
    let raw = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            [CONNECTION_TRANSFER_COMMIT_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(connection_transfer_recovery_failed)?;
    raw.map(|value| serde_json::from_str(&value).map_err(connection_transfer_recovery_failed))
        .transpose()
}

fn restore_vault_backup(root: &Path) -> Result<(), AppError> {
    let journal_bytes =
        fs::read(root.join(JOURNAL_FILE_NAME)).map_err(connection_transfer_recovery_failed)?;
    let journal: RecoveryJournal =
        serde_json::from_slice(&journal_bytes).map_err(connection_transfer_recovery_failed)?;
    restore_vault_backup_with_state(root, journal.vault_existed)
}

fn restore_vault_backup_with_state(root: &Path, vault_existed: bool) -> Result<(), AppError> {
    let vault_path = root.join(VAULT_FILE_NAME);
    let backup_path = root.join(VAULT_BACKUP_FILE_NAME);
    if vault_existed {
        if !backup_path.exists() {
            return Err(connection_transfer_recovery_failed(
                "connection transfer vault backup is missing",
            ));
        }
        fs::copy(backup_path, vault_path).map_err(connection_transfer_recovery_failed)?;
    } else if vault_path.exists() {
        fs::remove_file(vault_path).map_err(connection_transfer_recovery_failed)?;
    }
    Ok(())
}

fn cleanup_recovery_files(root: &Path) -> Result<(), AppError> {
    for path in [
        root.join(JOURNAL_FILE_NAME),
        root.join(VAULT_BACKUP_FILE_NAME),
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(connection_transfer_recovery_failed)?;
        }
    }
    Ok(())
}

fn recovery_labels() -> JsonStoreErrorLabels {
    JsonStoreErrorLabels {
        create_dir_code: "connection_transfer_recovery_failed",
        create_dir_message: "连接迁移恢复信息创建失败。",
        parse_code: "connection_transfer_recovery_failed",
        parse_message: "连接迁移恢复信息损坏。",
        read_code: "connection_transfer_recovery_failed",
        read_message: "连接迁移恢复信息读取失败。",
        serialize_code: "connection_transfer_recovery_failed",
        serialize_message: "连接迁移恢复信息创建失败。",
        write_code: "connection_transfer_recovery_failed",
        write_message: "连接迁移恢复信息写入失败。",
    }
}

fn connection_transfer_recovery_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "connection_transfer_recovery_failed",
        "连接仓库恢复失败，为避免数据不一致已停止继续操作。",
        raw,
        false,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::Connection;

    use super::{
        recover_pending_connection_transfer, ConnectionTransferRecovery,
        CONNECTION_TRANSFER_COMMIT_KEY,
    };
    use crate::storage_vault::VAULT_FILE_NAME;

    #[test]
    fn pending_uncommitted_transfer_restores_vault_backup() {
        let root = temp_root("restore");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(VAULT_FILE_NAME), b"before").unwrap();
        initialize_database(&root);
        let recovery = ConnectionTransferRecovery::begin(&root).unwrap();
        fs::write(root.join(VAULT_FILE_NAME), b"after").unwrap();
        drop(recovery);

        recover_pending_connection_transfer(&root).unwrap();

        assert_eq!(fs::read(root.join(VAULT_FILE_NAME)).unwrap(), b"before");
    }

    #[test]
    fn pending_committed_transfer_keeps_new_vault() {
        let root = temp_root("commit");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(VAULT_FILE_NAME), b"before").unwrap();
        let connection = initialize_database(&root);
        let recovery = ConnectionTransferRecovery::begin(&root).unwrap();
        fs::write(root.join(VAULT_FILE_NAME), b"after").unwrap();
        connection
            .execute(
                "INSERT INTO app_settings(key, value_json, updated_at) VALUES (?1, ?2, 'test')",
                rusqlite::params![
                    CONNECTION_TRANSFER_COMMIT_KEY,
                    serde_json::to_string(recovery.transaction_id()).unwrap()
                ],
            )
            .unwrap();
        drop(recovery);

        recover_pending_connection_transfer(&root).unwrap();

        assert_eq!(fs::read(root.join(VAULT_FILE_NAME)).unwrap(), b"after");
    }

    fn initialize_database(root: &std::path::Path) -> Connection {
        let connection = Connection::open(root.join("mxterm.db")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE app_settings(
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "mxterm-connection-transfer-recovery-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }
}
