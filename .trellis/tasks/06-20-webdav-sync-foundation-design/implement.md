# WebDAV Sync Foundation Implementation Plan

## Phase Split

本设计后续实现拆成两个独立 Trellis 子任务，不建议一次性把所有代码写完。

1. `sync-snapshot-foundation`
   - 只做本地快照协议、加密、导入导出、备份和测试。
   - 不接 WebDAV 网络，不做设置 UI。
2. `webdav-sync-v1`
   - 复用 Snapshot Foundation artifact。
   - 接 WebDAV transport、设置保存、测试连接、远端信息、手动上传/下载 UI。

## Phase 1: Sync Snapshot Foundation

### Backend Steps

1. 读取当前 `StorageRepository`、`storage_sqlite.rs`、`storage_vault.rs`，确认可导出的表和 secret slot 规则。
2. 新增 `src-tauri/src/sync_snapshot.rs`。
3. 定义协议类型：
   - `SyncManifest`
   - `SyncArtifactMeta`
   - `SyncDataDocument`
   - `SyncSecretsPlaintext`
   - `SyncSnapshotBundle`
4. 实现 manifest 构建和校验：format、protocol version、db schema version、artifact size/hash。
5. 实现 device id / device name：
   - `device_id` 存 SQLite `app_meta`，没有则生成。
   - `device_name` 从 Windows `COMPUTERNAME` 或跨平台 `HOSTNAME` 获取，做长度和控制字符清理。
6. 实现 export：
   - 从 SQLite 读取 connections、credentials、known_hosts、tunnels、groups。
   - 剔除本机 `secret_ref` 和所有明文字段。
   - 从 vault 按 `secret_slot_id` 读取 secret，生成远端 secrets plaintext。
   - 用同步主密码加密远端 `secrets.enc`。
   - 生成 `manifest.json` 和 hash。
7. 实现 import：
   - 校验 manifest 和 artifact。
   - 可选解密远端 `secrets.enc`。
   - 创建 `mxterm.db` 和本机 `secrets.enc` 备份。
   - SQLite transaction 替换同步范围内数据。
   - 按 `secret_slot_id` 重建本机 vault entries。
   - 失败时回滚或从备份恢复。
8. 不注册 Tauri command，除非需要临时调试；首版以 Rust 单测验证为主。

### Tests

- `cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml storage_repository --lib`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml`

### Required Test Cases

- manifest hash is stable and rejects wrong format/version/schema。
- artifact size/hash mismatch is rejected。
- export `data.json` does not contain `secret_ref` or plaintext password/passphrase。
- export encrypted `secrets.enc` does not contain plaintext secret。
- wrong sync password rejects decrypt。
- import without sync password imports non-secret data and reports `secrets_skipped=true`。
- import with sync password restores vault secrets by `secret_slot_id`。
- import creates backups before replacing local data。

## Phase 2: WebDAV Sync v1

### Backend Steps

1. 新增 `src-tauri/src/webdav.rs`：WebDAV transport primitives。
2. 新增 `src-tauri/src/webdav_sync.rs`：组合 transport 和 snapshot。
3. 在 `commands.rs` / `lib.rs` 注册命令：
   - `webdav_test_connection`
   - `webdav_settings_get`
   - `webdav_settings_save`
   - `webdav_fetch_remote_info`
   - `webdav_upload_snapshot`
   - `webdav_download_snapshot`
4. WebDAV 设置进入 SQLite `app_settings`，WebDAV 密码进入本机 vault。
5. 保存设置时实现 `password_touched` 语义：密码框未触碰且为空时保留旧密码。
6. 实现 sync mutex，禁止并发上传/下载。
7. 上传顺序：确保目录 -> PUT `data.json` -> PUT `secrets.enc` -> PUT `manifest.json`。
8. 下载顺序：GET manifest -> 校验 -> GET artifacts -> 调用 snapshot import。
9. 错误全部走 `AppError`，redact URL 和 secret。

### Frontend Steps

1. 扩展 `settingsTypes.ts` 或新增 `features/sync` 类型：WebDAV settings/status/result。
2. 在 `src/shared/tauri/commands.ts` 新增 typed wrappers。
3. SettingsView 增加“同步/云同步”分区。
4. UI 控件使用共享组件和全局 token：
   - 不能用原生 select。
   - 确认弹窗用共享 ConfirmDialog。
   - 密码输入支持“保留已有密码”语义。
5. 实现交互：测试连接、保存、读取远端信息、上传、下载。
6. 上传/下载前显示确认弹窗：来源设备、快照时间、目标路径、覆盖含义。
7. 显示状态：远端空/兼容/不兼容、上次同步、最后错误。

### Tests

- `cargo test --manifest-path src-tauri\Cargo.toml webdav --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml webdav_sync --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `npm run check`

### Required Test Cases

- WebDAV URL path segment encoding avoids double slash and handles spaces。
- redacted URL hides username/password/query values。
- MKCOL 405/409 verifies directory exists with PROPFIND。
- GET rejects oversized response before reading too much。
- sync mutex serializes upload/download。
- settings save preserves existing WebDAV password when untouched。
- upload puts manifest last。
- download rejects incompatible manifest before import。

## UI Prototype Step

如果要先看样式，按项目规则在 `prototype/light-neutral/mxterm-empty-session.html` 上加一个“设置 / 云同步”伪页面或弹层：

- 表单布局接近现有 SettingsView。
- 模拟远端信息、上传确认、下载确认、同步主密码输入。
- 用户确认后再迁移到 React/Radix。

## Rollback

- Snapshot import 前必须创建 DB/vault 备份；导入失败恢复备份。
- WebDAV 设置保存失败不得改变现有配置。
- WebDAV 上传失败不修改本地数据，只更新错误状态。
- WebDAV 下载失败不得提交半导入状态。
- 如果 Snapshot Foundation 发现现有 repository 不适合导出，先补 repository export/import API，不在 WebDAV 层绕过 SQL 边界。

## Review Gate

开始实现前需要确认：

- 是否接受两阶段拆分。
- 首版是否只做手动同步。
- 首版同步设置白名单是否包含外观/终端/文件传输，是否排除本机路径类设置。
- 是否允许 Snapshot Foundation 先不提供 UI，只用单测验证。