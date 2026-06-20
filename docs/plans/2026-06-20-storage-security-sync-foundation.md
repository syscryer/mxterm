# mXterm Storage, Secret, and WebDAV Sync Foundation Design

## 1. 背景

mXterm 当前已具备连接管理、凭据库、known_hosts、SFTP、远程监控、隧道、本地终端等能力。现有持久化主要使用 app data 下的 JSON 文件：`connections.json`、`credentials.json`、`known_hosts.json`、`tunnels.json`。这套实现适合早期快速迭代，但随着 WebDAV 云同步、传输历史、远程编辑会话、连接标签、命令片段等能力加入，JSON 会逐渐暴露几个问题：

- 结构化查询、迁移和索引能力弱。
- 多类数据各自读写文件，后续同步协议难以统一。
- 敏感凭据如果直接进入同步包，会形成明显安全风险。
- 需求文档长期目标要求 SQLite 保存非敏感配置、系统钥匙串保存敏感凭据。

因此下一阶段需要先打存储、安全和同步地基，再继续扩展 WebDAV 和更复杂的功能。

## 2. 目标

- 使用 SQLite 作为结构化本地数据的主存储。
- 使用系统 keyring 保存 SSH 密码、私钥口令和 WebDAV 同步密码等本机敏感数据。
- WebDAV 允许同步 SSH 密码和私钥口令，但云端只保存加密密文。
- 同步主密码与应用锁屏密码分离，不复用、不互相迁移。
- 提供从现有 JSON 数据到 SQLite/keyring 的自动迁移路径。
- 设计稳定的同步快照协议，让 WebDAV 只是传输层，后续可以复用到 S3 或其它云端。

## 3. 非目标

- 不在一期实现自动同步、实时冲突合并或多端协同编辑。
- 不同步终端输出历史、传输实时任务、本地下载缓存、远程编辑临时文件。
- 不把应用锁屏密码作为同步加密密码。
- 不把 WebDAV 密码、SSH 密码、私钥口令明文写入 SQLite 或同步包。
- 不在一期做复杂 UI 重构；只提供必要设置入口和迁移提示。

## 4. 总体架构

```text
React UI
  |
Tauri Commands
  |
Repository Layer
  |-- SQLiteStore: connections / credentials / known_hosts / tunnels / settings / snippets / future tables
  |-- SecretStore: OS keyring
  |-- SyncSnapshotStore: export/import versioned snapshot
  |
WebDAV Transport
```

核心边界：

- Repository 层对业务暴露连接、凭据、known_hosts、隧道等领域方法。
- SQLite 层只保存非明文结构化数据和本机 secret 引用。
- SecretStore 负责 keyring 读写、删除、迁移和错误归一。
- SyncSnapshotStore 负责把 SQLite + keyring 数据转换为可同步快照。
- WebDAV 只负责上传、下载、列远端信息和连接测试，不理解业务表细节。

## 5. SQLite 设计

### 5.1 技术选择

推荐 `rusqlite` + bundled SQLite。

原因：

- 当前 Rust 后端不是高并发数据库服务，Tauri command 场景以本地短事务为主。
- `rusqlite` 简单、可控、迁移成本低。
- `bundled` 降低 Windows 用户环境差异。
- 后续如需连接池或异步队列，可以在 repository 层内封装，不把选择泄漏到业务命令。

SQLite 文件建议位于：

```text
app_data/mxterm.db
```

### 5.2 基础表

```sql
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)
app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)
```

`schema_migrations` 管理 schema 版本。`app_meta` 保存设备 ID、迁移状态、最近同步信息等轻量元数据。`app_settings` 保存外观、终端字体、下载根目录、WebDAV 设置等本地配置；当前 localStorage 设置迁移可以单独分步做，但新后端设置不得继续散落到业务文件。所有时间字段统一使用 ISO8601 字符串。

### 5.3 连接表

```sql
connections(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  credential_mode TEXT NOT NULL,
  credential_id TEXT,
  inline_auth_kind TEXT,
  inline_secret_ref TEXT,
  inline_secret_slot_id TEXT,
  proxy_json TEXT NOT NULL,
  jump_json TEXT NOT NULL,
  advanced_json TEXT NOT NULL,
  notes TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  last_connected_at TEXT,
  remote_os_id TEXT,
  remote_os_name TEXT,
  remote_os_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

说明：

- `proxy_json`、`jump_json`、`advanced_json` 暂用 JSON 字符串，避免一期拆太细。
- `group_id` 指向 `connection_groups`；从旧 JSON 迁移时可按原 `group` 字符串自动生成分组。
- `inline_secret_ref` 指向本机 keyring，`inline_secret_slot_id` 是跨设备稳定同步槽位；二者都不保存明文密码或私钥口令。
- `credential_mode=prompt` 不保存 secret 引用。

### 5.4 凭据表

```sql
credentials(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  secret_slot_id TEXT NOT NULL,
  private_key_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

`secret_ref` 指向本机 keyring 中的 password 或 private key passphrase，`secret_slot_id` 用于 WebDAV 加密快照跨设备匹配。私钥文件本身仍使用本机路径，不进入 keyring，也不默认进入 WebDAV。

### 5.5 known_hosts 表

```sql
known_hosts(
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  key_algorithm TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  public_key TEXT NOT NULL,
  trusted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(host, port)
)
```

Host key 属于安全信任记录，但不是密码。可以进入 SQLite 和同步包。迁移和写入时 `host` 统一 lowercase，避免同一主机大小写不同导致重复信任记录。同步后如果远端发生 changed key，仍由现有 host-key 校验阻断。

### 5.6 隧道表

```sql
tunnels(
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
  updated_at TEXT NOT NULL
)
```

运行时状态仍保存在 `TunnelManager` 内存，不进入 SQLite。

### 5.7 分组与设置表

```sql
connection_groups(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

分组一期只做扁平分组，不做多级树。旧 JSON 的 `group`/`group_name` 迁移为 `connection_groups.name`，连接表保存 `group_id`。

### 5.8 预留表

一期可以建表但不接 UI，或等功能实现时再迁移：

```sql
connection_tags(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
connection_tag_relations(connection_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(connection_id, tag_id))
command_snippets(id TEXT PRIMARY KEY, title TEXT NOT NULL, command TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
transfer_history(id TEXT PRIMARY KEY, direction TEXT NOT NULL, local_path TEXT, remote_path TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
editor_sessions(id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, remote_path TEXT NOT NULL, local_cache_path TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
```

## 6. Keyring 设计

### 6.1 SecretStore 接口

```rust
trait SecretStore {
    fn set_secret(&self, reference: &SecretReference, value: &str) -> Result<(), AppError>;
    fn get_secret(&self, reference: &SecretReference) -> Result<String, AppError>;
    fn delete_secret(&self, reference: &SecretReference) -> Result<(), AppError>;
}
```

`SecretReference` 至少包含：

- `service`: 固定为 `mxterm`。
- `account`: 稳定 key。
- `kind`: `ssh_password` / `private_key_passphrase` / `webdav_password` / `sync_master_verifier`。

### 6.2 key 规则

```text
mxterm.connection.<connection_id>.inline_password
mxterm.connection.<connection_id>.inline_private_key_passphrase
mxterm.credential.<credential_id>.password
mxterm.credential.<credential_id>.private_key_passphrase
mxterm.webdav.<profile_id>.password
mxterm.sync.<profile_id>.master_verifier
```

SQLite 只保存上述引用，不保存明文。

### 6.3 错误策略

- keyring 写入失败：保存连接或凭据失败，不静默降级到 SQLite 明文。
- keyring 读取失败：连接流程返回可恢复错误，提示重新输入或重新保存。
- keyring 删除失败：删除连接/凭据时提示用户，避免误以为 secret 已清理。
- 迁移时 keyring 写入失败：停止迁移，保留 JSON 原文件和 `.bak`，不删除旧数据。

## 7. JSON 到 SQLite/keyring 迁移

迁移在 app 启动或首次访问 repository 时执行，必须幂等。

步骤：

1. 检查 `mxterm.db` 是否存在且 `schema_migrations` 已到目标版本。
2. 如果未迁移，创建 SQLite 文件和 schema。
3. 读取现有 `connections.json`、`credentials.json`、`known_hosts.json`、`tunnels.json`。
4. 在同一个迁移流程里对明文密码和私钥口令写入 keyring，生成本机 `secret_ref` 和跨设备 `secret_slot_id`。
5. 在 SQLite 单事务中写入非敏感字段和 secret 引用。
6. 迁移成功后，把 JSON 文件保留为 `.migrated.bak`，不立即删除。
7. 写入 `app_meta(storage_migrated_from_json=true)`。

失败回滚：

- SQLite 事务失败：回滚当前事务。迁移必须使用单事务提交，不能留下半迁移数据。
- keyring 写入失败：中止迁移，不标记成功。
- 迁移中止后下次启动可重试。
- 已写入 keyring 但 SQLite 未提交的 secret，可以按迁移批次记录临时清理列表，尽量删除；删除失败记录 warning。

## 8. WebDAV 同步协议

### 8.1 文件布局

远端根目录：

```text
<remote_root>/mxterm-sync/v1/
  manifest.json
  data.json
  secrets.enc
```

一期只保留最新快照。后续可以扩展：

```text
snapshots/<snapshot_id>/manifest.json
snapshots/<snapshot_id>/data.json
snapshots/<snapshot_id>/secrets.enc
latest.json
```

### 8.2 manifest.json

```json
{
  "app": "mxterm",
  "protocol_version": 1,
  "snapshot_id": "uuid",
  "device_id": "uuid",
  "device_name": "Windows-PC",
  "created_at": "2026-06-20T12:00:00+08:00",
  "db_schema_version": 1,
  "data_hash": "sha256",
  "secrets_hash": "sha256",
  "encryption": {
    "enabled": true,
    "kdf": "argon2id",
    "cipher": "xchacha20poly1305",
    "salt": "base64",
    "ops_limit": "interactive",
    "mem_limit": "64MiB"
  }
}
```

### 8.3 data.json

`data.json` 保存非敏感结构化数据：

```json
{
  "connections": [],
  "credentials": [],
  "known_hosts": [],
  "tunnels": [],
  "settings": {},
  "tags": [],
  "snippets": []
}
```

`connections` 和 `credentials` 中只包含跨设备稳定的 `secret_slot_id`，不包含明文 secret，也不直接同步本机 keyring account。导入新设备时由 `secret_slot_id` 重新生成本机 `secret_ref`。

### 8.4 secrets.enc

`secrets.enc` 是用同步主密码加密的 JSON 明文载荷，解密后结构如下：

```json
{
  "version": 1,
  "secrets": [
    {
      "slot_id": "credential:<credential_id>:password",
      "kind": "ssh_password",
      "value": "plain secret after decrypt",
      "updated_at": "2026-06-20T12:00:00+08:00"
    }
  ]
}
```

加密要求：

- 使用同步主密码通过 Argon2id 派生密钥。
- 使用 XChaCha20-Poly1305 加密。
- AAD 绑定 `app`、`protocol_version`、`snapshot_id`、`data_hash`，避免密文被跨快照替换。
- 不保存同步主密码明文。
- 本机可以保存一个 verifier，用于判断用户输入的同步主密码是否正确；verifier 也必须是不可逆校验，不是明文。

## 9. WebDAV v1 能力边界

一期命令：

- `webdav_test_connection`
- `webdav_save_settings`
- `webdav_fetch_remote_info`
- `webdav_upload_snapshot`
- `webdav_download_snapshot`

一期 UI：

- WebDAV 地址、用户名、密码、远端目录。
- 同步主密码设置/确认。
- 手动上传、手动下载、测试连接、查看远端快照信息。
- 下载时可选择是否输入同步主密码；不输入则只导入非敏感配置。

一期不做：

- 自动同步。
- 双向字段级合并。
- 多历史快照选择。
- 跨设备实时冲突提示。

## 10. 冲突策略

一期采用简单、可解释策略：

- 手动上传：本机快照覆盖远端 latest。
- 手动下载：远端快照导入本机，导入前创建本机 SQLite 备份。
- 如果远端 `device_id` 与本机不同，UI 明确提示来源设备和快照时间。
- 如果本机自上次同步后有修改，下载前提示会覆盖本机配置。
- 不做字段级 merge，避免早期隐藏冲突。

后续 v2 再考虑按表和 `updated_at` 合并。

## 11. 安全策略

- WebDAV 密码存 keyring。
- 同步主密码不等于应用锁屏密码。
- 同步主密码不上传、不明文保存。
- WebDAV 可以同步 SSH 密码和私钥口令，但必须只出现在 `secrets.enc` 密文中。
- 下载快照时，如果无法解密 secrets，仍允许导入非敏感配置，但连接会显示凭据缺失或需要重新保存。
- 日志、错误、事件中不得输出 SSH 密码、私钥口令、WebDAV 密码、同步主密码或解密后的 secret。

## 12. 实施分期

### Phase 1：SQLite Foundation

- 引入 SQLite 依赖和 DB 初始化。
- 建 schema migration。
- 抽 Repository 边界和测试夹具。
- 实现 JSON 读取到领域模型、领域模型写入 SQLite 的迁移代码，但不在没有 keyring 的情况下切换生产读写。
- Phase 1 的交付物可以通过测试验证 schema、repository 和非敏感表读写；不能把明文密码写入 SQLite，也不能留下空 `secret_ref` 导致连接断裂。

### Phase 2：Secret Foundation + Atomic Migration

- 引入 keyring。
- 将 SQLite 数据迁移与 keyring secret 写入作为一次原子迁移流程交付。
- SQLite 只保存本机 `secret_ref` 和跨设备 `secret_slot_id`。
- 迁移成功后再把生产读写从 JSON 切换到 SQLite，并保留 JSON `.migrated.bak`。
- 更新连接、凭据、prompt、测试连接、隧道启动的 secret 解析。
- 删除/更新连接时同步维护 keyring。

### Phase 3：Sync Snapshot Foundation

- 定义 `manifest.json`、`data.json`、`secrets.enc`。
- 实现 snapshot export/import。
- 实现同步主密码加密/解密。
- import 前创建 SQLite 本地备份。

### Phase 4：WebDAV v1

- 实现 WebDAV transport。
- 接入设置 UI。
- 支持测试连接、手动上传、手动下载、远端信息。
- 不做自动同步。

## 13. 验收标准

- 新安装用户直接使用 SQLite，不生成旧 JSON 主存储。
- 老用户首次启动可自动从 JSON 原子迁移到 SQLite + keyring。
- 迁移失败不会破坏旧 JSON 数据。
- SQLite 中不出现 SSH 密码或私钥口令明文，也不存在已切换生产但 secret 只能为空的中间态。
- keyring 读取失败时给出可恢复错误，不静默降级。
- WebDAV 上传包中不出现明文 SSH 密码、私钥口令、WebDAV 密码或同步主密码。
- 新设备可下载 WebDAV 快照，并在输入同步主密码后按 secret_slot_id 恢复加密凭据到本机 keyring。
- 不输入同步主密码时，仍可导入连接、known_hosts、隧道等非敏感配置。
- 手动上传/下载有同步锁，不能并发执行两个同步任务。
- `cargo test` 覆盖迁移、secret store、snapshot 加密、WebDAV 设置校验。

## 14. 风险与取舍

- SQLite + keyring + WebDAV 同时设计，但实施必须分期；不能一口气改完所有功能。
- keyring 在不同平台表现不完全一致，Windows 需要重点验证凭据保留、删除、应用升级后的读取。
- 同步主密码忘记后无法恢复 encrypted secrets，这是安全设计的一部分，需要 UI 明确说明。
- WebDAV 只做 latest 覆盖会简单可靠，但不适合多端频繁同时修改；自动同步前必须升级冲突策略。
- 私钥文件路径跨设备不一定有效。同步凭据可以恢复 passphrase，但私钥文件本身是否同步需要单独设计，默认不做。

## 15. 推荐下一步

先把当前 JSON 原子写入修复和隧道改动提交为回退点。JSON 原子写入是过渡锚点，用来保护迁移前用户数据；SQLite + keyring 切换完成后它不再是长期主存储方案。随后创建 Trellis 任务 `storage-security-sync-foundation`，按 Phase 1 到 Phase 4 拆成可独立验收的子任务。第一批只启动 Phase 1：SQLite Foundation，但 Phase 1 不能切换生产读写；生产切换必须等 Phase 2 的 keyring 原子迁移一起完成。
