use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

use crate::app_error::AppError;

pub const SQLITE_SCHEMA_VERSION: i64 = 1;

const SCHEMA_SQL: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    kind TEXT NOT NULL,
    secret_ref TEXT,
    secret_slot_id TEXT,
    private_key_path TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'ssh',
    group_id TEXT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    credential_mode TEXT NOT NULL,
    credential_id TEXT,
    inline_auth_kind TEXT,
    inline_secret_ref TEXT,
    inline_secret_slot_id TEXT,
    inline_private_key_path TEXT,
    prompt_auth_kind TEXT,
    proxy_json TEXT NOT NULL,
    jump_json TEXT NOT NULL,
    advanced_json TEXT NOT NULL,
    rdp_json TEXT,
    notes TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    last_connected_at TEXT,
    remote_os_id TEXT,
    remote_os_name TEXT,
    remote_os_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(group_id) REFERENCES connection_groups(id) ON DELETE SET NULL,
    FOREIGN KEY(credential_id) REFERENCES credentials(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connections_group_id ON connections(group_id);
CREATE INDEX IF NOT EXISTS idx_connections_credential_id ON connections(credential_id);
CREATE INDEX IF NOT EXISTS idx_connections_host_port ON connections(host, port);

CREATE TABLE IF NOT EXISTS known_hosts (
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    key_algorithm TEXT NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    public_key TEXT NOT NULL,
    first_trusted_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY(host, port, key_algorithm)
);

CREATE TABLE IF NOT EXISTS tunnels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    local_host TEXT NOT NULL,
    local_port INTEGER NOT NULL,
    remote_host TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    auto_start INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tunnels_connection_id ON tunnels(connection_id);

CREATE TABLE IF NOT EXISTS command_snippets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    command TEXT NOT NULL,
    description TEXT,
    group_name TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_snippets_usage
    ON command_snippets(favorite DESC, last_used_at DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS command_history (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 0,
    append_enter INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_history_last_used_at
    ON command_history(last_used_at DESC);

CREATE TABLE IF NOT EXISTS command_history_scopes (
    history_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    source TEXT NOT NULL,
    target_count INTEGER NOT NULL DEFAULT 0,
    append_enter INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(history_id, scope_kind, scope_id),
    FOREIGN KEY(history_id) REFERENCES command_history(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_command_history_scopes_scope
    ON command_history_scopes(scope_kind, scope_id, last_used_at DESC);
"#;

pub struct SqliteStore {
    connection: Connection,
}

impl SqliteStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "sqlite_store_open_failed",
                    "SQLite 存储目录创建失败。",
                    error,
                    true,
                )
            })?;
        }

        let connection = Connection::open(&path).map_err(|error| {
            AppError::new(
                "sqlite_store_open_failed",
                "SQLite 存储打开失败。",
                error,
                true,
            )
        })?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(sqlite_query_error)?;

        Ok(Self { connection })
    }

    pub fn initialize(&self) -> Result<(), AppError> {
        self.connection.execute_batch(SCHEMA_SQL).map_err(|error| {
            AppError::new(
                "sqlite_store_init_failed",
                "SQLite 存储初始化失败。",
                error,
                true,
            )
        })?;
        self.ensure_command_snippet_group_column()?;
        self.ensure_command_history_scope_columns()?;
        self.ensure_connection_protocol_columns()?;
        self.connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![SQLITE_SCHEMA_VERSION],
            )
            .map_err(|error| AppError::new("sqlite_store_init_failed", "SQLite 版本记录失败。", error, true))?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, AppError> {
        let version = self
            .connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .optional()
            .map_err(sqlite_query_error)?
            .flatten()
            .unwrap_or(0);
        Ok(version)
    }

    fn ensure_connection_protocol_columns(&self) -> Result<(), AppError> {
        self.add_column_if_missing(
            "connections",
            "protocol",
            "ALTER TABLE connections
             ADD COLUMN protocol TEXT NOT NULL DEFAULT 'ssh'",
        )?;
        self.add_column_if_missing(
            "connections",
            "rdp_json",
            "ALTER TABLE connections
             ADD COLUMN rdp_json TEXT",
        )?;
        self.connection
            .execute(
                "UPDATE connections SET protocol = 'ssh'
                 WHERE protocol IS NULL OR TRIM(protocol) = ''",
                [],
            )
            .map_err(sqlite_query_error)?;
        Ok(())
    }

    fn ensure_command_snippet_group_column(&self) -> Result<(), AppError> {
        if !self.column_exists("command_snippets", "group_name")? {
            self.connection
                .execute(
                    "ALTER TABLE command_snippets
                     ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
                    [],
                )
                .map_err(sqlite_query_error)?;
        }

        self.connection
            .execute(
                "UPDATE command_snippets SET group_name = '' WHERE TRIM(group_name) = '未分组'",
                [],
            )
            .map_err(sqlite_query_error)?;

        self.connection
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_command_snippets_group
                    ON command_snippets(group_name, favorite DESC, last_used_at DESC, updated_at DESC)",
                [],
            )
            .map_err(sqlite_query_error)?;
        Ok(())
    }

    fn ensure_command_history_scope_columns(&self) -> Result<(), AppError> {
        let source_added = self.add_column_if_missing(
            "command_history_scopes",
            "source",
            "ALTER TABLE command_history_scopes
             ADD COLUMN source TEXT NOT NULL DEFAULT 'command_sender'",
        )?;
        let target_count_added = self.add_column_if_missing(
            "command_history_scopes",
            "target_count",
            "ALTER TABLE command_history_scopes
             ADD COLUMN target_count INTEGER NOT NULL DEFAULT 0",
        )?;
        let append_enter_added = self.add_column_if_missing(
            "command_history_scopes",
            "append_enter",
            "ALTER TABLE command_history_scopes
             ADD COLUMN append_enter INTEGER NOT NULL DEFAULT 1",
        )?;

        if source_added {
            self.connection
                .execute(
                    "UPDATE command_history_scopes
                     SET source = COALESCE(
                        (SELECT command_history.source
                         FROM command_history
                         WHERE command_history.id = command_history_scopes.history_id),
                        source
                     )",
                    [],
                )
                .map_err(sqlite_query_error)?;
        }

        if target_count_added {
            self.connection
                .execute(
                    "UPDATE command_history_scopes
                     SET target_count = COALESCE(
                        (SELECT command_history.target_count
                         FROM command_history
                         WHERE command_history.id = command_history_scopes.history_id),
                        target_count
                     )",
                    [],
                )
                .map_err(sqlite_query_error)?;
        }

        if append_enter_added {
            self.connection
                .execute(
                    "UPDATE command_history_scopes
                     SET append_enter = COALESCE(
                        (SELECT command_history.append_enter
                         FROM command_history
                         WHERE command_history.id = command_history_scopes.history_id),
                        append_enter
                     )",
                    [],
                )
                .map_err(sqlite_query_error)?;
        }

        self.connection
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_command_history_scopes_scope
                    ON command_history_scopes(scope_kind, scope_id, last_used_at DESC)",
                [],
            )
            .map_err(sqlite_query_error)?;
        Ok(())
    }

    fn add_column_if_missing(
        &self,
        table_name: &str,
        column_name: &str,
        alter_sql: &str,
    ) -> Result<bool, AppError> {
        if self.column_exists(table_name, column_name)? {
            return Ok(false);
        }

        self.connection
            .execute(alter_sql, [])
            .map_err(sqlite_query_error)?;
        Ok(true)
    }

    fn column_exists(&self, table_name: &str, column_name: &str) -> Result<bool, AppError> {
        let mut statement = self
            .connection
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .map_err(sqlite_query_error)?;
        let rows = statement
            .query_map(params![table_name], |row| row.get::<_, String>(0))
            .map_err(sqlite_query_error)?;

        for row in rows {
            if row.map_err(sqlite_query_error)? == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[cfg(test)]
    fn table_exists(&self, table_name: &str) -> Result<bool, AppError> {
        let exists = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
                params![table_name],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sqlite_query_error)?;
        Ok(exists == 1)
    }

    #[cfg(test)]
    fn table_columns(&self, table_name: &str) -> Result<Vec<String>, AppError> {
        let mut statement = self
            .connection
            .prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")
            .map_err(sqlite_query_error)?;
        let rows = statement
            .query_map(params![table_name], |row| row.get::<_, String>(0))
            .map_err(sqlite_query_error)?;

        let mut columns = Vec::new();
        for row in rows {
            columns.push(row.map_err(sqlite_query_error)?);
        }
        Ok(columns)
    }

    #[cfg(test)]
    fn index_exists(&self, index_name: &str) -> Result<bool, AppError> {
        let exists = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?1)",
                params![index_name],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sqlite_query_error)?;
        Ok(exists == 1)
    }
}

pub fn sqlite_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "sqlite_store_path_failed",
            "SQLite 存储路径获取失败。",
            error,
            true,
        )
    })?;
    Ok(app_data_dir.join("mxterm.db"))
}

pub fn normalize_known_host_host(host: &str) -> String {
    host.trim().to_lowercase()
}

fn sqlite_query_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        "sqlite_store_query_failed",
        "SQLite 存储查询失败。",
        error,
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{normalize_known_host_host, SqliteStore, SQLITE_SCHEMA_VERSION};

    const CORE_TABLES: [&str; 11] = [
        "schema_migrations",
        "app_meta",
        "app_settings",
        "connection_groups",
        "connections",
        "credentials",
        "known_hosts",
        "tunnels",
        "command_snippets",
        "command_history",
        "command_history_scopes",
    ];

    #[test]
    fn initialize_records_schema_version() {
        let store = open_temp_store("schema-version");

        store.initialize().unwrap();

        assert_eq!(store.schema_version().unwrap(), SQLITE_SCHEMA_VERSION);
    }

    #[test]
    fn initialize_is_idempotent() {
        let store = open_temp_store("idempotent");

        store.initialize().unwrap();
        store.initialize().unwrap();

        assert_eq!(store.schema_version().unwrap(), SQLITE_SCHEMA_VERSION);
    }

    #[test]
    fn initialize_creates_core_tables() {
        let store = open_temp_store("core-tables");

        store.initialize().unwrap();

        for table in CORE_TABLES {
            assert!(store.table_exists(table).unwrap(), "{table} should exist");
        }
    }

    #[test]
    fn normalize_known_host_host_trims_and_lowercases() {
        assert_eq!(normalize_known_host_host("  Example.COM  "), "example.com");
    }

    #[test]
    fn schema_does_not_define_plaintext_secret_columns() {
        let store = open_temp_store("no-plaintext-secrets");

        store.initialize().unwrap();

        for table in ["connections", "credentials"] {
            let columns = store.table_columns(table).unwrap();
            for column in columns {
                let normalized = column.to_lowercase();
                assert!(
                    !normalized.contains("password") && !normalized.contains("passphrase"),
                    "{table}.{column} must not store plaintext secrets"
                );
            }
        }
    }

    #[test]
    fn initialize_migrates_legacy_command_snippets_without_group_name() {
        let store = open_temp_store("legacy-command-snippets-group");
        store
            .connection
            .execute_batch(
                r#"
                CREATE TABLE command_snippets (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    command TEXT NOT NULL,
                    description TEXT,
                    tags_json TEXT NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    use_count INTEGER NOT NULL DEFAULT 0,
                    last_used_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                "#,
            )
            .unwrap();

        store.initialize().unwrap();

        let columns = store.table_columns("command_snippets").unwrap();
        assert!(columns.iter().any(|column| column == "group_name"));
        assert!(store.index_exists("idx_command_snippets_group").unwrap());
    }

    #[test]
    fn initialize_migrates_legacy_command_history_scopes_without_metadata_columns() {
        let store = open_temp_store("legacy-command-history-scopes");
        store
            .connection
            .execute_batch(
                r#"
                CREATE TABLE command_history (
                    id TEXT PRIMARY KEY,
                    command TEXT NOT NULL UNIQUE,
                    source TEXT NOT NULL,
                    target_count INTEGER NOT NULL DEFAULT 0,
                    append_enter INTEGER NOT NULL DEFAULT 1,
                    use_count INTEGER NOT NULL DEFAULT 1,
                    last_used_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE command_history_scopes (
                    history_id TEXT NOT NULL,
                    scope_kind TEXT NOT NULL,
                    scope_id TEXT NOT NULL,
                    use_count INTEGER NOT NULL DEFAULT 1,
                    last_used_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(history_id, scope_kind, scope_id)
                );

                INSERT INTO command_history (
                    id, command, source, target_count, append_enter,
                    use_count, last_used_at, created_at
                ) VALUES (
                    'history-1', 'pwd', 'terminal_input', 3, 0,
                    5, '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'
                );

                INSERT INTO command_history_scopes (
                    history_id, scope_kind, scope_id, use_count, last_used_at, created_at
                ) VALUES (
                    'history-1', 'ssh_connection', 'connection-1',
                    2, '2026-06-22T00:00:00Z', '2026-06-22T00:00:00Z'
                );
                "#,
            )
            .unwrap();

        store.initialize().unwrap();

        let columns = store.table_columns("command_history_scopes").unwrap();
        assert!(columns.iter().any(|column| column == "source"));
        assert!(columns.iter().any(|column| column == "target_count"));
        assert!(columns.iter().any(|column| column == "append_enter"));
        assert!(store
            .index_exists("idx_command_history_scopes_scope")
            .unwrap());

        let migrated = store
            .connection
            .query_row(
                "SELECT source, target_count, append_enter
                 FROM command_history_scopes
                 WHERE history_id = 'history-1'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(migrated, ("terminal_input".to_string(), 3, 0));
    }

    fn open_temp_store(name: &str) -> SqliteStore {
        let path = temp_store_path(name);
        let root = path.parent().unwrap().to_path_buf();
        let _ = fs::remove_dir_all(&root);
        SqliteStore::open(path).unwrap()
    }

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("mxterm-sqlite-{name}-{}", uuid::Uuid::new_v4()))
            .join("mxterm.db")
    }
}
