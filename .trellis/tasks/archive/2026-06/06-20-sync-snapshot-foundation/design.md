# Sync Snapshot Foundation Design

## Scope

本任务实现传输无关的同步快照层。它只处理本地数据导出、artifact 校验、secret 加密、导入、备份和回滚。WebDAV v1 之后只负责把这些 artifact 上传/下载。

## Module Boundary

新增模块：

```text
src-tauri/src/sync_snapshot.rs
```

建议内部结构：

```rust
pub struct SyncSnapshotService;
pub struct SyncSnapshotBundle;
pub struct SyncManifest;
pub struct SyncDataDocument;
pub struct SyncSecretsPlaintext;
pub struct SyncImportOptions;
pub struct SyncImportResult;
```

`sync_snapshot.rs` 可以调用 `StorageRepository` 和 `SecretStore`，但不应直接散落 Tauri command 逻辑。若需要 SQLite 批量 export/import API，优先补到 repository 层，而不是在 WebDAV 层拼 SQL。

## Artifact Layout

本地/远端 artifact 集合：

```text
manifest.json
data.json
secrets.enc
```

`manifest.json` 是导入入口；`data.json` 和 `secrets.enc` 必须按 manifest 中的 hash/size 校验。

## Types

### SyncManifest

字段：

- `format: "mxterm-sync"`
- `protocol_version: 1`
- `snapshot_id: String`
- `device_id: String`
- `device_name: String`
- `created_at: String`
- `db_schema_version: u32`
- `artifacts: BTreeMap<String, ArtifactMeta>`
- `encryption: SyncEncryptionInfo`

### ArtifactMeta

字段：

- `sha256: String`
- `size: u64`

### SyncDataDocument

字段：

- `version: 1`
- `connections`
- `credentials`
- `known_hosts`
- `tunnels`
- `connection_groups`
- `settings`（首版白名单，可先为空对象）

连接/凭据导出规则：

- 保留 `secret_slot_id`。
- 删除本机 `secret_ref`。
- 不包含 `inline_password`、`password`、`private_key_passphrase` 等明文字段。

### SyncSecretsPlaintext

字段：

- `version: 1`
- `secrets: Vec<SyncSecretEntry>`

`SyncSecretEntry`：

- `slot_id`
- `kind`
- `value`
- `updated_at`

## Encryption

远端 `secrets.enc` 使用当前依赖可直接支持的方案：Argon2id + AES-256-GCM。

- salt: 16 bytes random。
- nonce: 12 bytes random。
- key: Argon2id(sync password, salt)。
- AAD: `format|protocol_version|snapshot_id|data_hash`。
- ciphertext: encrypted JSON bytes of `SyncSecretsPlaintext`。

错误同步主密码返回 `sync_snapshot_secret_decrypt_failed`，不能暴露内部 secret。

## Export Flow

1. 打开已解锁的 `StorageRepository`。
2. 读取 SQLite 同步范围数据。
3. 转换为 `SyncDataDocument`，剔除本机 `secret_ref` 和明文字段。
4. 按 `secret_slot_id` 从本机 vault 读取 secret。
5. 生成 `SyncSecretsPlaintext` 并用同步主密码加密为远端 `secrets.enc`。
6. 对 `data.json` 和 `secrets.enc` 计算 SHA256 和 size。
7. 生成 `manifest.json`。
8. 返回 `SyncSnapshotBundle`。

若用户选择不导出 secrets，可生成无 secret artifact，但 WebDAV v1 首版建议上传含 secret 时要求同步主密码。

## Import Flow

1. 解析 manifest。
2. 校验 format/protocol/db schema。
3. 校验 `data.json` 和可选 `secrets.enc` 的 size/hash。
4. 如果提供同步主密码，解密 `secrets.enc`。
5. 如果未提供同步主密码，跳过 secrets 并记录 `secrets_skipped=true`。
6. 创建本机备份：
   - `mxterm.db.sync-backup.<timestamp>`
   - `secrets.enc.sync-backup.<timestamp>`
7. SQLite transaction 替换同步范围内表。
8. 有 secrets 时，按 `secret_slot_id` 写入本机 vault，生成本机 `secret_ref`。
9. 提交成功后返回导入统计。
10. 任何失败必须不留下半导入状态；必要时从备份恢复。

## Backup Strategy

备份目录建议：

```text
app_data/backups/sync/<timestamp>/mxterm.db
app_data/backups/sync/<timestamp>/secrets.enc
```

导入前先备份，成功后保留备份。后续可加保留最近 N 份清理策略，首版不强制。

## Repository Needs

如果现有 `StorageRepository` 缺少批量导出/导入 API，本任务补充：

- `export_sync_data() -> SyncDataDocument`
- `replace_sync_data(document, now) -> Result<ImportStats, AppError>`
- `secret_refs_for_sync_slots() -> Vec<(slot_id, secret_ref, kind)>`

这些 API 应该保持业务边界，不让 WebDAV 模块直接掌握 schema 细节。

## Error Codes

建议新增：

- `sync_snapshot_incompatible`
- `sync_snapshot_hash_mismatch`
- `sync_snapshot_size_mismatch`
- `sync_snapshot_too_large`
- `sync_snapshot_secret_password_missing`
- `sync_snapshot_secret_decrypt_failed`
- `sync_snapshot_backup_failed`
- `sync_snapshot_import_failed`

## Security Rules

- 日志、错误、测试 fixture 名称不得包含真实密码。
- `data.json` 测试必须扫描禁词：`secret_ref`、`inline_password`、`password":"`、真实测试 secret。
- 远端 `secrets.enc` 测试必须扫描明文 secret 不存在。
- `secrets.local.key` 永不同步。

## Compatibility

- 当前本机 vault 自动解锁逻辑保持不变。
- prompt credential 不导出 secret。
- 私钥路径可进入 `data.json`，但私钥文件本身不进入 snapshot。
- known_hosts 可以同步，导入后仍由现有 host key 校验流程处理 changed key。