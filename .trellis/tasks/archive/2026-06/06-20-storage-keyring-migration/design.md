# Storage Vault Migration Design

## Scope

本任务交付 Phase 2：Secret Foundation + Atomic Migration。目标是让 mXterm 的生产存储从 JSON 切到 SQLite + encrypted vault，同时保留失败可恢复路径。

不做 WebDAV 传输。WebDAV 后续会复用本任务产生的 `secret_slot_id`、SQLite repository 和 `secrets.enc`。

## Architecture

```text
Tauri commands
  |
Repository facade
  |-- JsonStores: legacy migration source only
  |-- SqliteStore: production structured data after migration
  |-- SecretStore: vault-backed secret read/write/delete
  |-- StorageMigrator: JSON -> vault + SQLite atomic cutover
```

新增/修改模块：

```text
src-tauri/src/storage_vault.rs
src-tauri/src/storage_repository.rs
src-tauri/src/storage_migration.rs
```

- `storage_vault.rs`：封装 encrypted vault，提供 `SecretStore` trait、测试 fake、`VaultSecretStore`、`VaultState`，以及默认本机 key 解锁和主密码 rekey。
- `storage_repository.rs`：提供连接、凭据、known_hosts、隧道的 SQLite repository API，命令层只依赖 repository，不直接拼 SQL。
- `storage_migration.rs`：负责检测迁移状态、读取旧 JSON、写 vault、写 SQLite transaction、保留 `.migrated.bak`。

## Secret Model

`SecretKind`：

- `Password`
- `PrivateKeyPassphrase`
- `InlinePassword`
- `InlinePrivateKeyPassphrase`

`SecretReference`：

```rust
service: "mxterm"
account: String
slot_id: String
kind: SecretKind
```

Account 规则：

```text
connection:<connection_id>:inline_password
connection:<connection_id>:inline_private_key_passphrase
credential:<credential_id>:password
credential:<credential_id>:private_key_passphrase
```

`secret_ref` 和 `secret_slot_id` 使用同一语义 key。后续 WebDAV 用 `secret_slot_id` 匹配加密 secrets。

## Vault Format

`secrets.enc` 是 JSON envelope，只有 salt、nonce、ciphertext 和 KDF 参数可见：

```text
version: 1
kdf: argon2id(memory_cost_kib, time_cost, parallelism)
cipher: aes-256-gcm
salt: base64
nonce: base64
ciphertext: base64(encrypted VaultPlaintext)
```

plaintext 结构：

```text
version: 1
secrets: map secret_ref -> plaintext secret
```

约束：

- `secrets.enc` 不得包含明文 secret。
- 默认关闭主密码保护时，后端生成并保存本机 `secrets.local.key`，用它自动解锁/创建 `secrets.enc`；该模式不把 SSH secret 明文写入 SQLite/JSON。
- 用户在设置页开启主密码保护时，`VaultState` 将当前 vault plaintext 重新加密到用户主密码；关闭时重新加密回本机 key。
- 用户主密码只用于本次解锁或 rekey，不写入 SQLite、JSON、vault 或系统凭据。
- `VaultState` 在本次运行内缓存已解锁的 `VaultSecretStore`。
- 未解锁时，依赖 secret 的生产 command 返回 `vault_locked`。

## Migration Flow

1. 前端读取设置：默认主密码保护关闭时调用 `secret_vault_unlock_local` 自动打开或创建 `secrets.enc`；开启后由用户输入主密码调用 `secret_vault_unlock`。
2. 打开 SQLite 并初始化 schema。
3. 读取 `app_meta.storage_migrated_from_json`。
4. 若已迁移，检查 SQLite 中存在 secret_ref 且 vault 缺失的条目，能从 `.migrated.bak` 找到明文时补回 vault。
5. 若未迁移：读取旧 JSON stores。
6. 归一化领域数据：legacy connection auth fields 先转换为 inline mode；known_hosts host trim + lowercase；group name 生成扁平 `connection_groups`。
7. 为每个非空 secret 生成 `SecretReference` 和 `secret_slot_id`。
8. 写入 vault，并记录本批已写入 secret，供失败清理。
9. 开启 SQLite transaction，写入 connection_groups、connections、credentials、known_hosts、tunnels、app_meta。
10. transaction 提交成功后，把旧 JSON 复制为 `.migrated.bak`。
11. 后续生产命令只走 SQLite repository。

失败策略：

- vault 写入失败：中止迁移，不写 app_meta，不重命名 JSON，尽量删除本批已写入 vault secret。
- SQLite transaction 失败：回滚 transaction，不写 app_meta，不重命名 JSON，尽量删除本批已写入 vault secret。
- `.migrated.bak` 保留失败：返回可恢复错误，避免用户误判旧数据已保留。

## Repository Cutover

命令层通过 repository facade：

```rust
let repo = StorageRepository::open_app(&app)?;
repo.connection_list()?;
repo.connection_upsert(input, now)?;
repo.resolve_saved_connection(connection_id, prompt)?;
```

`StorageRepository::open_app` 从 Tauri `VaultState` 获取已解锁 secret store。这样未来 WebDAV import/export 也能复用同一 repository。

## Compatibility

- 旧 JSON 仍作为迁移源；迁移成功前不能删除。
- 旧 JSON 中 legacy `auth_kind/password/private_key_passphrase` 仍按现有 `migrate_profile` 语义转为 inline mode。
- 新安装用户没有旧 JSON：默认用本机 key 创建空 vault + SQLite，进入 SQLite repository。
- prompt mode 仍不存 secret。
- proxy password 当前仍在 proxy config JSON/SQLite 字段里，这是单独安全债；本任务优先 SSH 登录 secret。

## Error Codes

- `vault_locked`
- `vault_password_missing`
- `vault_unlock_failed`
- `vault_locked`
- `secret_store_write_failed`
- `secret_store_read_failed`
- `secret_store_delete_failed`
- `secret_missing`
- `storage_migration_failed`
- `storage_migration_sqlite_failed`
- `storage_migration_backup_failed`

## Tests

使用 TDD。迁移单测使用 fake/in-memory SecretStore，避免普通单测依赖真实用户主密码流程。

关键测试：

- Secret reference account 生成稳定。
- Fake SecretStore set/get/delete 成功和失败映射。
- VaultSecretStore 持久化后文件不包含明文 secret。
- 错误主密码打开 vault 返回 `vault_unlock_failed`。
- 本机 key 自动解锁能跨进程读取已有 secret。
- 本机 key -> 主密码 -> 本机 key rekey 后已有 secret 不丢失。
- JSON -> SQLite migration 写入 secret_ref/secret_slot_id，不写明文。
- secret store 写入失败时迁移不标记成功。
- SQLite transaction 失败时迁移不标记成功。
- `resolve_saved_connection` 从 SecretStore 取回 password/passphrase。
- prompt credentials 不落盘。
- delete credential/connection 清理 vault secret。