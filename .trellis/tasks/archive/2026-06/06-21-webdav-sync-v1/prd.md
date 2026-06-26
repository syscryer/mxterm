# WebDAV Sync v1 Transport and Settings

## Goal

在已完成的 Sync Snapshot Foundation 之上，实现 mXterm WebDAV 同步 v1：用户在设置里配置 WebDAV，手动测试连接、读取远端快照信息、上传本机快照、下载远端快照并导入。本阶段只做手动同步，不做自动同步、字段级冲突合并或历史快照管理。

## Background

`sync_snapshot` 已提供传输无关的本地快照协议：`manifest.json`、`data.json`、远端同步密码加密的 `secrets.enc`，并能校验、备份、导入。WebDAV v1 负责把这三个 artifact 安全地上传/下载，不直接理解 SQLite 表结构，也不能直接上传本机 vault 文件。

父任务 `06-20-webdav-sync-foundation-design` 已确定：WebDAV 首版是“手动备份/恢复式同步”，默认关闭，云端 secrets 只允许同步主密码加密密文。

## Requirements

- 设置页新增 WebDAV 同步配置入口，默认关闭。
- WebDAV 设置保存到 SQLite `app_settings` 或 repository 封装中；WebDAV 登录密码进入本机 vault，不明文进入 SQLite、日志、错误或前端持久化。
- 设置保存需要支持 `password_touched` 语义：密码框未触碰且为空时保留已有密码。
- 提供连接测试：校验 URL、认证、远端目录可访问/可创建。
- 提供远端信息读取：读取 `manifest.json`，展示远端是否为空、来源设备、快照时间、协议版本和兼容状态。
- 提供手动上传：调用 `SyncSnapshotService::export_bundle` 生成 artifact，确保远端目录后依次上传 `data.json`、`secrets.enc`、最后上传 `manifest.json`。
- 提供手动下载：下载并校验 manifest/data/secrets，调用 `SyncSnapshotService::import_bundle`；覆盖本机前必须有明确确认，并依赖 snapshot import 创建本机备份。
- 上传含 SSH secret 时必须要求同步主密码；同步主密码不保存明文，不复用 WebDAV 密码。
- 同一时间只允许一个 WebDAV 同步操作，避免上传/下载并发互相覆盖。
- 所有 WebDAV 错误必须 redacted，不能包含密码、同步主密码、SSH secret、带认证 URL 或 query 明文。
- UI 必须使用现有 SettingsView 风格、共享组件、全局 `--mx-*` token；业务下拉不能用原生 `<select>`。

## Acceptance Criteria

- [ ] 新增 WebDAV transport/backend 模块，支持 `PROPFIND`、`MKCOL`、`PUT`、`GET` 基础能力，并有 URL redaction 和大小限制。
- [ ] 新增 WebDAV sync service，组合 `sync_snapshot` 与 transport；WebDAV 层不直接查询业务表或读取本机 `secrets.enc`。
- [ ] 新增 Tauri commands：设置读取/保存、测试连接、读取远端信息、上传快照、下载快照。
- [ ] 设置保存时 WebDAV 密码写入 vault，未触碰密码时保留旧密码。
- [ ] 上传顺序单测证明 `manifest.json` 最后 PUT。
- [ ] 下载不兼容 manifest 时拒绝导入。
- [ ] 同步 mutex 单测证明并发上传/下载会返回 `webdav_sync_locked`。
- [ ] 前端设置页有 WebDAV 同步配置、远端信息、手动上传/下载、确认弹窗和结果反馈。
- [ ] 前端 WebDAV 设置不使用原生 select，复用共享 UI 和 token。
- [ ] `cargo test --manifest-path src-tauri\Cargo.toml webdav --lib` 通过。
- [ ] `cargo test --manifest-path src-tauri\Cargo.toml webdav_sync --lib` 通过。
- [ ] `cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib` 通过。
- [ ] `cargo check --manifest-path src-tauri\Cargo.toml` 通过或只保留既有无关 warning。
- [ ] `npm run check` 通过。

## Out Of Scope

- 自动同步。
- 多端字段级 merge。
- 历史快照列表和版本恢复 UI。
- S3、坚果云专属高级能力或其它云端协议。
- 私钥文件内容同步。
- 迁移所有前端 localStorage 设置到 SQLite。
- 后台定时任务和跨进程同步锁。

## User Flow

1. 用户打开设置 / 同步。
2. 默认同步关闭，用户填写 WebDAV URL、用户名、密码、远端目录、profile 名称和同步主密码。
3. 用户点击测试连接，后端验证目录可访问或可创建。
4. 用户保存设置。
5. 用户点击读取远端信息，看到远端为空或已有快照摘要。
6. 用户点击上传，确认覆盖远端 latest 后执行上传。
7. 用户点击下载，确认覆盖本机同步范围数据后执行下载导入。
8. 操作结束后显示成功摘要或 redacted 错误。

## Notes

- `manifest.json` 必须最后上传，避免远端 latest 指向未完整上传的 artifact。
- 下载导入的恢复能力由 `sync_snapshot` 的本机备份负责，WebDAV UI 需要把“会覆盖本机数据但会创建备份”说清楚。
- WebDAV 密码和同步主密码是两个概念：前者用于远端登录，后者用于加密云端 SSH secrets。
- 首版可以只保存一个 `default` WebDAV profile，数据结构保留 profile 字段方便后续扩展。
