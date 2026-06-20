# Storage Security Sync Foundation

## Goal

建立 mXterm 的 SQLite 存储地基，为后续 keyring 原子迁移和 WebDAV 加密同步做准备。本阶段只做 Phase 1：SQLite Foundation，不切换生产读写，不把明文密码写入 SQLite，不让现有连接、终端、SFTP、监控或隧道行为发生变化。

## Background

已确认长期方向：SQLite 保存结构化非敏感数据，系统 keyring 保存 SSH 密码和私钥口令，WebDAV 通过独立同步主密码加密 `secrets.enc`。完整设计见 `docs/plans/2026-06-20-storage-security-sync-foundation.md`。

当前项目仍使用 JSON 文件作为主存储：`connections.json`、`credentials.json`、`known_hosts.json`、`tunnels.json`。JSON 原子写入已经作为过渡锚点落地。本任务不能提前废弃 JSON 主路径。

## Requirements

- 新增 SQLite 地基模块，负责 DB 路径、连接打开、schema 初始化、迁移版本记录。
- 使用 `rusqlite` + bundled SQLite，优先保证 Windows 本地可运行。
- Schema 至少覆盖 Phase 1 需要的表：`schema_migrations`、`app_meta`、`app_settings`、`connection_groups`、`connections`、`credentials`、`known_hosts`、`tunnels`。
- 所有时间字段按后续实现约定使用 ISO8601 字符串；本阶段 schema 和测试必须体现该约定。
- `known_hosts.host` 在迁移/写入辅助逻辑中应规范为 lowercase，避免大小写重复。
- 连接分组一期是扁平分组；旧 JSON 的 `group` / `group_name` 后续迁移为 `connection_groups.name` 和 `connections.group_id`。
- 提供测试夹具或 helper，能在临时目录创建 SQLite DB 并初始化 schema。
- 可以实现 JSON 到领域模型、领域模型到 SQLite 的迁移准备代码，但不得切换现有 Tauri command 的生产读写。
- 不实现 keyring，不迁移真实明文密码，不生成真实 WebDAV 同步包。
- 不引入 UI 变更。

## Acceptance Criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib` 通过。
- [ ] SQLite 初始化测试能验证核心表存在、schema version 已记录、重复初始化幂等。
- [ ] Repository/迁移准备测试能验证 known_hosts host lowercase。
- [ ] 当前 JSON stores 和现有 Tauri commands 仍保持主读写路径，没有改成 SQLite 生产路径。
- [ ] SQLite 表中只有 secret 引用字段和 `secret_slot_id`，没有明文 password/passphrase 字段。
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过或只保留与本任务无关的既有 warning。
- [ ] 新增代码文件已 `git add` 暂存，未提交。

## Out Of Scope

- keyring 接入和真实 secret 迁移。
- WebDAV transport、snapshot export/import、`secrets.enc` 加密。
- 自动同步、冲突合并、多历史快照。
- 前端设置页和 UI 入口。
- 将 `ConnectionStore` / `CredentialStore` / `KnownHostStore` / `TunnelStore` 的生产读写切换到 SQLite。