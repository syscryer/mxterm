# WebDAV Sync Foundation Design

## Scope

本设计覆盖 WebDAV 同步的两段式落地方案：

1. **Sync Snapshot Foundation**：实现本地快照导出/导入协议，不依赖 WebDAV 网络。负责 `manifest.json`、`data.json`、`secrets.enc` 的构建、校验、加密、解密、导入、备份和回滚。
2. **WebDAV v1**：在 Snapshot Foundation 之上实现 WebDAV 传输和设置 UI。负责连接测试、远端目录创建、远端信息读取、手动上传、手动下载。

本任务是设计任务，不直接实现生产代码。下一步实现时建议先启动 Snapshot Foundation 子任务，再启动 WebDAV v1 子任务。

## Product Boundary

首版同步是“手动备份/恢复式同步”，不是自动多端协同：

- 上传：本机当前快照覆盖远端 latest。
- 下载：远端 latest 覆盖本机同步范围内数据，导入前必须创建本机备份。
- 冲突：不做字段级 merge；通过设备名、快照时间和覆盖提示让用户确认。
- 自动同步：不做。
- 历史快照：不做，只保留 latest；本机备份保留最近若干份供恢复。

这个边界比 cc-switch 简化。cc-switch 里的自动同步、S3、多版本兼容、技能 zip、数据库 SQL 全量恢复都不进入 mXterm v1。

## Data Ownership

本地数据源：

- `mxterm.db`：连接、凭据元数据、known_hosts、隧道、未来 snippets/tags/settings。
- `secrets.enc`：SSH 密码、私钥口令等本机 encrypted vault。
- `secrets.local.key`：仅本机自动解锁 key，绝不同步。
- `localStorage mxterm.settings.v1`：当前前端设置来源；WebDAV 设计应先定义设置表承接策略，避免长期同步浏览器 localStorage。

远端同步 artifact：

```text
<remote_root>/mxterm-sync/v1/<profile>/
  manifest.json
  data.json
  secrets.enc
```

`profile` 默认 `default`，用于同一个 WebDAV 账号下隔离不同配置集。

## Snapshot Protocol

### manifest.json

`manifest.json` 只保存元数据和 artifact 校验，不保存业务数据或 secret。

```json
{
  "format": "mxterm-sync",
  "protocol_version": 1,
  "snapshot_id": "uuid-or-hash",
  "device_id": "uuid",
  "device_name": "Windows-PC",
  "created_at": "2026-06-20T22:00:00+08:00",
  "db_schema_version": 1,
  "artifacts": {
    "data.json": { "sha256": "...", "size": 1234 },
    "secrets.enc": { "sha256": "...", "size": 567 }
  },
  "encryption": {
    "enabled": true,
    "kdf": "argon2id",
    "cipher": "aes-256-gcm",
    "salt": "base64",
    "nonce": "base64"
  }
}
```

Rules:

- `format` / `protocol_version` / `db_schema_version` 必须校验。
- `device_id` 存本机 SQLite `app_meta`，首次生成后稳定。
- `device_name` 用于 UI 提示，来自 `COMPUTERNAME` / `HOSTNAME` / fallback。
- `artifacts` 必须校验 size 和 SHA256，避免远端损坏或错文件导入。
- `snapshot_id` 推荐由 artifact hash 组合生成，便于判断同一快照。

### data.json

`data.json` 保存非敏感结构化数据：

```json
{
  "version": 1,
  "connections": [],
  "credentials": [],
  "known_hosts": [],
  "tunnels": [],
  "settings": {},
  "connection_groups": [],
  "connection_tags": [],
  "command_snippets": []
}
```

Rules:

- `connections` / `credentials` 只包含 `secret_slot_id`，不能包含 `secret_ref` 或明文 secret。
- `secret_ref` 是本机 vault account，不跨设备同步；导入时用 `secret_slot_id` 重新生成本机 `secret_ref`。
- 私钥文件内容不进入 `data.json`；私钥路径可同步，但导入后可能无效，UI 后续应提示重新选择。
- `settings` 首版只同步安全的 UI/终端/文件传输设置；本机路径类设置默认不同步或需白名单。

### secrets.enc

远端 `secrets.enc` 不是本机 `secrets.enc` 的原样上传，而是用“同步主密码”重新加密的同步密文。

解密后的 plaintext：

```json
{
  "version": 1,
  "secrets": [
    {
      "slot_id": "credential:<id>:password",
      "kind": "password",
      "value": "plain after decrypt",
      "updated_at": "2026-06-20T22:00:00+08:00"
    }
  ]
}
```

Rules:

- 同步主密码不复用 vault 主密码，不复用 WebDAV 密码。
- 同步主密码不保存明文。
- 云端 `secrets.enc` 必须使用 Argon2id + AES-256-GCM（复用当前依赖），后续可再升级 XChaCha20-Poly1305。
- 加密 AAD 绑定 `format`、`protocol_version`、`snapshot_id`、`data_hash`，防止 data/secrets 被交叉替换。
- 用户不输入同步主密码时，下载仍可导入 `data.json`，但 secret 不导入，相关连接会需要重新保存凭据。

## Backend Modules

建议新增模块：

```text
src-tauri/src/sync_snapshot.rs
src-tauri/src/webdav.rs
src-tauri/src/webdav_sync.rs
```

### sync_snapshot.rs

职责：

- 从 `StorageRepository` 导出 `SyncSnapshot`。
- 从当前 `VaultState` / `SecretStore` 读取 secret，通过 `secret_slot_id` 生成同步 secrets plaintext。
- 加密/解密远端 `secrets.enc`。
- 校验 manifest、hash、schema 版本、artifact size。
- 导入前备份 `mxterm.db` 和本机 `secrets.enc`。
- 导入 `data.json` 到 SQLite，导入 secrets 到本机 vault。

### webdav.rs

职责：

- WebDAV HTTP transport primitives：`PROPFIND`、`MKCOL`、`PUT`、`GET`、`HEAD`。
- URL 解析和 path segment 编码。
- Basic Auth。
- 隐藏 URL 中用户名、密码和 query value。
- 处理坚果云/Nextcloud/Synology 常见状态码。

可借鉴 cc-switch：

- `MKCOL 405` 或 `409` 后用 `PROPFIND` 验证目录是否已存在。
- `GET` 限制最大响应体，防止远端异常大文件。
- 错误里只显示 redacted URL。

### webdav_sync.rs

职责：

- 组合 `sync_snapshot` 和 `webdav`。
- 维护单例 sync mutex，禁止两个同步任务并发。
- 保存/读取 WebDAV 设置。
- 上传前 fetch remote info 供 UI 确认。
- 下载前 fetch remote info 并校验兼容性。
- 同步成功后记录 `last_sync_at`、`last_snapshot_id`、`last_remote_etag`。
- 同步失败后记录 `last_error`，但不覆盖 WebDAV 密码。

## Tauri Commands

首版命令建议：

```rust
webdav_test_connection(request: WebDavSettingsInput) -> Result<WebDavTestResult, AppError>
webdav_settings_get() -> Result<Option<WebDavSettings>, AppError>
webdav_settings_save(request: WebDavSettingsInput) -> Result<WebDavSettings, AppError>
webdav_fetch_remote_info() -> Result<WebDavRemoteInfo, AppError>
webdav_upload_snapshot(request: WebDavUploadRequest) -> Result<WebDavSyncResult, AppError>
webdav_download_snapshot(request: WebDavDownloadRequest) -> Result<WebDavSyncResult, AppError>
```

Snapshot-only commands for Phase 1 implementation:

```rust
sync_snapshot_export(request: SyncSnapshotExportRequest) -> Result<SyncSnapshotPreview, AppError>
sync_snapshot_import(request: SyncSnapshotImportRequest) -> Result<SyncSnapshotImportResult, AppError>
```

如果不打算暴露文件导入导出 UI，snapshot-only commands 可以只作为 Rust 内部 API + 单元测试，不注册 Tauri。

## Settings Storage

WebDAV 设置建议进入 SQLite `app_settings`，不要再扩展 localStorage：

```json
{
  "enabled": false,
  "base_url": "https://dav.example.com/dav",
  "username": "alice",
  "password_ref": "webdav:default:password",
  "remote_root": "mxterm-sync",
  "profile": "default",
  "last_sync_at": null,
  "last_snapshot_id": null,
  "last_error": null
}
```

Rules:

- WebDAV 密码写入本机 vault，不进入 `app_settings` 明文。
- 前端保存设置时如果密码框为空且未触碰，应保留已有密码。cc-switch 在这点踩过坑。
- `enabled=false` 是默认值。
- 后续如果设置整体迁移到 SQLite，WebDAV 设置先走 repository 命令，避免散落在 localStorage。

## Import Flow

1. 读取并校验 manifest。
2. 下载/读取 `data.json` 和可选 `secrets.enc`。
3. 校验 size/hash/schema/version。
4. 如果用户提供同步主密码，解密 `secrets.enc`；否则标记 secrets skipped。
5. 创建本地备份：`mxterm.db.sync-backup.<timestamp>` 和 `secrets.enc.sync-backup.<timestamp>`。
6. 在 SQLite transaction 中替换同步范围内表。
7. 将同步 secrets 写入本机 vault。
8. 如 vault 写入失败，回滚 SQLite transaction；如果 transaction 已提交后失败，应从备份恢复并返回错误。
9. 更新同步状态。

首版导入策略建议“同步范围全量替换”，不做 merge。

## Export Flow

1. 从 SQLite 读取同步范围数据。
2. 从 vault 读取 `secret_slot_id` 对应 secret。
3. 构建 `data.json`，剔除本机 `secret_ref` 和明文字段。
4. 用同步主密码构建远端 `secrets.enc`。
5. 生成 manifest 和 artifact hash。
6. WebDAV v1 上传时先 `MKCOL` 目录，再 PUT `data.json`、`secrets.enc`，最后 PUT `manifest.json`。

`manifest.json` 最后上传，避免远端先看到一个指向未完成 artifact 的 latest。

## Frontend UX

入口：设置页新增“同步”或“云同步”分区，放在安全/基础设置附近，不放右侧工作区。

首版 UI：

- 开关：启用 WebDAV 同步，默认关。
- 表单：服务预设、自定义 URL、用户名、密码、远端目录、配置名。
- 同步主密码：设置/确认；上传含 secret 时必填。
- 操作：测试连接、保存、读取远端信息、上传、下载。
- 状态：上次同步时间、来源设备、快照时间、远端是否为空、最后错误。
- 确认弹窗：上传覆盖远端；下载覆盖本机且会创建备份。

视觉要求：使用现有 SettingsView 风格、共享输入/按钮/确认框、全局 `--mx-*` token。下拉不能用原生 select。

## Error Strategy

新增错误码建议：

- `webdav_settings_invalid`
- `webdav_password_missing`
- `webdav_connection_failed`
- `webdav_http_status`
- `webdav_remote_empty`
- `webdav_sync_locked`
- `sync_snapshot_incompatible`
- `sync_snapshot_hash_mismatch`
- `sync_snapshot_too_large`
- `sync_snapshot_secret_decrypt_failed`
- `sync_snapshot_backup_failed`
- `sync_snapshot_import_failed`

所有错误不得包含 WebDAV 密码、同步主密码、SSH secret、完整带认证 URL。

## Tests

Snapshot Foundation tests:

- manifest serialization and compatibility validation。
- artifact hash/size validation。
- export data excludes `secret_ref` and plaintext secret。
- export secrets encrypts values and ciphertext does not contain plaintext。
- wrong sync password rejects decrypt。
- import without sync password imports data but skips secrets。
- import with sync password recreates local vault entries by `secret_slot_id`。
- import creates local backup before replacing data。

WebDAV v1 tests:

- URL segment encoding。
- Basic auth only when username exists。
- redacted URL hides credentials/query values。
- MKCOL 405/409 verifies directory via PROPFIND。
- sync mutex serializes upload/download。
- save settings preserves existing password when password field is untouched。
- upload puts manifest last。

## Risks

- 当前设置仍在 localStorage，若同步设置时直接复制 localStorage 会带来不可控字段。首版应白名单同步设置。
- 私钥路径跨设备可能无效。同步 passphrase 不等于同步私钥文件。
- `secrets.enc` 本地 vault 和远端 `secrets.enc` 名字相同但加密口令不同，需要在代码和文档里明确区分。
- 下载覆盖策略简单可靠，但多设备频繁修改时会丢本机未上传变更；首版必须通过确认弹窗表达清楚。