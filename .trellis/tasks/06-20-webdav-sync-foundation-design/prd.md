# WebDAV sync foundation design

## Goal

设计 mXterm WebDAV 同步的下一阶段地基，明确同步范围、文件协议、安全边界、设置入口和首版能力。目标是基于现有 SQLite + `secrets.enc` 存储模型，形成可实现、可验收、可后续扩展的 WebDAV v1 方案；本任务先做设计和实施计划，不直接写生产同步代码。

## Confirmed Facts

- 结构化生产数据已经切到 app data 下的 `mxterm.db`，连接、凭据、known_hosts、隧道通过 `StorageRepository` 读写。
- SSH 密码和私钥口令已经进入 mXterm 自管 encrypted vault：`secrets.enc`；SQLite 只保存 `secret_ref` / `secret_slot_id`。
- 默认不开启主密码保护时，应用使用本机 `secrets.local.key` 自动解锁 vault；用户可在设置里主动启用主密码保护。
- 既有长期计划把 WebDAV 拆成 Sync Snapshot Foundation 和 WebDAV v1 两段：先定义 `manifest.json` / `data.json` / `secrets.enc` 快照协议，再接 WebDAV transport 和设置 UI。
- 之前计划中“系统 keyring”已经被产品决策替换为 mXterm 自管加密 vault；后续 WebDAV 设计必须按当前 `secrets.enc` 现实修订。
- 当前前端设置仍通过 `localStorage` 的 `mxterm.settings.v1` 保存，`app_settings` 表存在但尚未承接设置读写。

## Requirements

- 首版必须默认关闭同步，用户在设置中显式配置并手动触发。
- WebDAV 可同步连接、凭据元数据、known_hosts、隧道和必要设置；不能同步终端输出、传输实时任务、本地下载缓存或编辑临时文件。
- WebDAV 可以同步 SSH 密码和私钥口令，但云端只能保存同步主密码加密后的密文，不能出现明文 secret。
- 同步主密码不复用 vault 主密码，不复用 WebDAV 密码，不明文保存。
- WebDAV 密码自身也不能进入明文日志、事件或 SQLite 明文字段。
- 下载远端快照前必须创建本机备份或提供可恢复路径。
- 首版不做自动同步、多端实时冲突合并或历史快照管理，除非后续明确扩大范围。
- 设计必须覆盖 Windows 桌面使用场景，并保持后续跨平台可扩展。

## Acceptance Criteria

- [x] `prd.md` 明确 WebDAV v1 的同步范围、非目标、首版用户流程和验收标准。
- [x] `design.md` 明确快照文件协议、加密模型、WebDAV transport 边界、设置存储策略、导入导出流程和冲突策略。
- [x] `implement.md` 给出分阶段实施清单、验证命令和风险回滚点。
- [x] 设计与当前 SQLite + `secrets.enc` 代码现实一致，不再引用系统 keyring 作为当前方案。
- [x] 设计中明确哪些内容进入 `mxterm.db`、哪些进入 `secrets.enc`、哪些进入远端 `manifest/data/secrets` 文件。

## Scope Decision

- 采用两段式：先交付 Sync Snapshot Foundation，再交付 WebDAV v1 transport/UI。
- Snapshot Foundation 负责 manifest.json / data.json / secrets.enc 的导出、校验、导入、备份、加密和回滚。
- WebDAV v1 只负责连接测试、远端目录创建、远端信息读取、手动上传和手动下载，不理解业务表细节。
- 首版不做自动同步；cc-switch 的自动同步、S3、多版本历史只作为后续参考。

## Notes

- 参考历史计划：`docs/plans/2026-06-20-storage-security-sync-foundation.md`。
- 参考已完成地基：`.trellis/tasks/archive/2026-06/06-20-storage-keyring-migration/design.md`。
- 可能需要参考 `D:\cursor_project\cc-switch` 的 WebDAV 实现，但不能直接复用代码；最多借鉴流程和交互。