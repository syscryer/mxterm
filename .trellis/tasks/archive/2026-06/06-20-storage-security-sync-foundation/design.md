# Storage Security Sync Foundation Design

## Scope

本设计只覆盖 Phase 1：SQLite Foundation。完整 Storage/Security/Sync 方向见 `docs/plans/2026-06-20-storage-security-sync-foundation.md`。

Phase 1 的核心目标是把 SQLite 作为可测试的基础设施引入项目，但不改变现有业务命令的生产存储路径。这样可以先验证 schema、迁移版本、路径和 repository 边界，避免在 keyring 未就绪时出现密码断裂。

## Module Boundary

新增后端模块建议：

```text
src-tauri/src/storage_sqlite.rs
```

该模块负责：

- `sqlite_store_path(app)`：返回 `app_data/mxterm.db` 路径。
- `SqliteStore::open(path)`：打开或创建 DB。
- `SqliteStore::initialize()`：创建 schema 并记录 schema version。
- `SqliteStore::schema_version()`：读取当前 schema version。
- 测试 helper：在临时目录创建 DB 并初始化。

本阶段不在 `commands.rs` 中使用 SQLiteStore，也不替换现有 JSON store。

## Schema

Phase 1 初始化 schema：

- `schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`
- `app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`
- `app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`
- `connection_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
- `connections(...)`
- `credentials(...)`
- `known_hosts(...)`
- `tunnels(...)`

`connections` 和 `credentials` 只保存本机 `secret_ref` 与跨设备 `secret_slot_id`，不得出现明文 secret 字段。

## Migration Boundary

本阶段可以添加纯函数辅助逻辑，例如：

- `normalize_known_host_host(host: &str) -> String`
- `group_name_to_key(name: &str)`（如需要）

但不执行真实 JSON 到 SQLite 迁移。真实迁移必须等 Phase 2 keyring 可用后，一次完成 SQLite + keyring 原子迁移。

## Error Handling

SQLite 初始化和查询错误统一映射到 `AppError`，错误码建议：

- `sqlite_store_open_failed`
- `sqlite_store_init_failed`
- `sqlite_store_query_failed`
- `sqlite_store_path_failed`

错误默认 recoverable 为 true，除非系统路径无法解析等不可恢复场景已在现有项目里有明确约定。

## Tests

使用 TDD：先写失败测试，再实现。

最小测试：

- 初始化创建 schema 并记录 version。
- 重复初始化幂等。
- 核心表存在。
- `normalize_known_host_host` 会 trim 并 lowercase。
- schema 文本或表字段检查确认没有明文 password/passphrase 存储列。

## Compatibility

现有 JSON 原子写入工具仍是当前生产路径，Phase 1 不删除、不替换。若 SQLite 初始化代码存在 bug，不应影响用户打开应用和使用现有连接功能。