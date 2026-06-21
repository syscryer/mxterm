# WebDAV Sync v1 Design

## Scope

本子任务实现 WebDAV v1 transport、同步 service、Tauri commands 和设置页 UI。它复用 `src-tauri/src/sync_snapshot.rs`，不重新定义业务表导出/导入逻辑。

## Architecture

```text
Settings UI
  -> typed tauri command wrappers
    -> webdav_sync.rs
      -> webdav.rs transport primitives
      -> sync_snapshot.rs artifact export/import
      -> StorageRepository / SecretStore settings + WebDAV password
```

模块边界：

- `sync_snapshot.rs`：唯一负责 snapshot artifact 构建、校验、加解密、导入和备份。
- `webdav.rs`：只负责 HTTP/WebDAV 协议原语，不知道 mXterm 业务数据。
- `webdav_sync.rs`：组合设置、锁、snapshot 和 WebDAV transport，提供 Tauri command 级服务。
- `commands.rs`：薄命令包装，不拼 SQL、不处理明文 secret。
- 前端：设置页渲染和确认交互，不持久化 WebDAV 密码明文。

## Backend Types

### WebDavSettings

```rust
pub struct WebDavSettings {
    pub enabled: bool,
    pub base_url: String,
    pub username: Option<String>,
    pub password_saved: bool,
    pub remote_root: String,
    pub profile: String,
    pub last_sync_at: Option<String>,
    pub last_snapshot_id: Option<String>,
    pub last_remote_device_name: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}
```

`password_saved` 只告诉 UI 是否已有密码，不能回传密码。

### WebDavSettingsInput

```rust
pub struct WebDavSettingsInput {
    pub enabled: bool,
    pub base_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub password_touched: bool,
    pub remote_root: String,
    pub profile: String,
}
```

规则：

- `password_touched=false` 且 `password=None/blank`：保留已有 vault password。
- `password_touched=true` 且 blank：删除已有 WebDAV password。
- 测试连接或同步时，如果需要认证但没有密码，返回 `webdav_password_missing`。

### Remote Info / Result

```rust
pub struct WebDavRemoteInfo {
    pub exists: bool,
    pub compatible: bool,
    pub snapshot_id: Option<String>,
    pub device_name: Option<String>,
    pub created_at: Option<String>,
    pub protocol_version: Option<u16>,
    pub data_size: Option<u64>,
    pub secrets_size: Option<u64>,
}

pub struct WebDavSyncResult {
    pub snapshot_id: String,
    pub device_name: String,
    pub created_at: String,
    pub uploaded: bool,
    pub downloaded: bool,
    pub secrets_skipped: bool,
}
```

## WebDAV Transport

`webdav.rs` 提供：

- `WebDavClient::propfind(path, depth)`
- `WebDavClient::mkcol(path)`
- `WebDavClient::put(path, bytes, content_type)`
- `WebDavClient::get(path, max_bytes)`
- `WebDavClient::head(path)`（可选，若服务端兼容性差可不用）

实现规则：

- URL path segment 必须逐段编码，避免空格、中文和斜杠破坏路径。
- Basic Auth 只在 username 非空时设置；密码只从 vault 解出后进入请求 header，不进入日志。
- redaction 必须隐藏用户名、密码和 query value。
- `MKCOL` 返回 201/200 视为创建成功；405/409 时用 `PROPFIND` 验证目录已存在。
- `GET` 必须限制最大响应体，manifest/data/secrets 均按合理上限读取。

可参考 cc-switch 的流程经验，但不复用代码。

## Settings Storage

首版设置建议保存在 SQLite `app_settings` 的一个 JSON value 中：

```text
key = webdav.sync.default
```

WebDAV 密码保存到本机 vault：

```text
webdav:<profile>:password
```

如果后续需要多个 profile，可以扩展 key 和 secret slot，不影响现有 `default`。

同步主密码首版不保存。上传/下载需要 secrets 时由 UI 当次输入，后续可再设计“记住同步密码”的加密存储。

## Remote Layout

```text
<base_url>/<remote_root>/v1/<profile>/manifest.json
<base_url>/<remote_root>/v1/<profile>/data.json
<base_url>/<remote_root>/v1/<profile>/secrets.enc
```

默认：

- `remote_root = mxterm-sync`
- `profile = default`

## Upload Flow

1. 读取 WebDAV 设置和 vault 中的 WebDAV 密码。
2. 获取同步主密码，如果上传 secrets 且密码为空则返回错误。
3. 调用 `SyncSnapshotService::export_bundle`。
4. 逐级 `MKCOL` 确保 `<remote_root>/v1/<profile>` 存在。
5. `PUT data.json`。
6. 如存在 `secrets.enc`，`PUT secrets.enc`。
7. 最后 `PUT manifest.json`。
8. 更新 `last_sync_at`、`last_snapshot_id`、`last_remote_device_name`，清空 `last_error`。

## Download Flow

1. 读取 WebDAV 设置和 vault 中的 WebDAV 密码。
2. `GET manifest.json`，解析并校验基础兼容性。
3. 若远端不存在 manifest，返回 `webdav_remote_empty`。
4. 按 manifest 下载 `data.json` 和可选 `secrets.enc`，限制大小。
5. 调用 `SyncSnapshotService::import_bundle`。
6. 根据结果更新同步状态，包含 `secrets_skipped`。

下载覆盖本机前，前端必须展示确认弹窗；后端仍依赖 snapshot import 的备份保证失败不半导入。

## Sync Lock

`WebDavSyncManager` 内部维护 `tokio::sync::Mutex` 或 `try_lock` 风格的同步锁。

- 上传、下载、测试连接可并发吗：测试连接可以独立；上传/下载必须互斥。
- 上传/下载拿不到锁时返回 `webdav_sync_locked`。
- 锁不能跨 UI idle 持有，只包裹单次 command 执行。

## Tauri Commands

```rust
webdav_settings_get(app) -> Result<WebDavSettings, AppError>
webdav_settings_save(app, request: WebDavSettingsInput) -> Result<WebDavSettings, AppError>
webdav_test_connection(app, request: Option<WebDavSettingsInput>) -> Result<WebDavTestResult, AppError>
webdav_fetch_remote_info(app) -> Result<WebDavRemoteInfo, AppError>
webdav_upload_snapshot(app, manager, request: WebDavUploadRequest) -> Result<WebDavSyncResult, AppError>
webdav_download_snapshot(app, manager, request: WebDavDownloadRequest) -> Result<WebDavSyncResult, AppError>
```

`webdav_test_connection` 支持传入未保存的表单，用于“保存前测试”。

## Frontend UI

设置页新增“同步”分区：

- 启用开关。
- 服务地址、用户名、密码、远端目录、profile。
- 同步主密码输入：上传/下载 secrets 时使用，不持久化。
- 按钮：测试连接、保存、读取远端、上传本机、下载远端。
- 远端信息摘要：来源设备、快照时间、协议版本、是否含 secrets。
- 本机状态摘要：上次同步时间、最后错误。
- 上传确认：覆盖远端 latest。
- 下载确认：覆盖本机同步范围数据，会创建备份。

视觉约束：

- 使用 SettingsView 既有布局和全局 token。
- 使用共享按钮、输入、开关、确认框和 AppSelect。
- 不使用原生 `<select>`。
- 不把说明文字做成大块营销文案；设置页保持工具型密度。

## Error Codes

- `webdav_settings_invalid`
- `webdav_password_missing`
- `webdav_connection_failed`
- `webdav_http_status`
- `webdav_remote_empty`
- `webdav_sync_locked`
- `webdav_response_too_large`
- `webdav_settings_save_failed`

Snapshot 错误继续透传现有 `sync_snapshot_*` code。

## Tests

Backend：

- URL segment encoding。
- URL redaction 隐藏用户名、密码和 query value。
- MKCOL 405/409 后 PROPFIND 验证目录存在。
- GET 超过 max bytes 返回 `webdav_response_too_large`。
- settings save 保留未触碰密码。
- settings save 删除触碰后清空的密码。
- sync mutex 返回 `webdav_sync_locked`。
- upload operation 顺序确保 `manifest.json` 最后 PUT。
- download incompatible manifest 不调用 import。

Frontend：

- 设置表单保存 payload 中带 `password_touched`。
- 未触碰密码时保存不会把空密码当作清空。
- 上传/下载确认弹窗存在。
- 远端信息状态渲染兼容/为空/错误。

## Risks and Tradeoffs

- 首版全量覆盖简单可靠，但会覆盖本机未上传改动；必须通过确认弹窗表达清楚。
- WebDAV 服务端兼容性差异大，v1 只保证常见 Basic Auth + 标准方法路径。
- 同步主密码不保存会增加操作成本，但安全边界更清晰。
- 私钥路径同步后跨设备可能无效，v1 只同步路径文本，不同步私钥文件内容。
