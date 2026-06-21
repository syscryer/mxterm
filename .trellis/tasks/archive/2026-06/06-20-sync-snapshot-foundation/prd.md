# Sync Snapshot Foundation

## Goal

实现 mXterm WebDAV 同步前的本地快照地基：从 SQLite + 本机 encrypted vault 导出 `manifest.json`、`data.json`、远端用同步主密码加密的 `secrets.enc`，并能在本机导入同样的快照。该阶段不接 WebDAV 网络、不做设置 UI，只用 Rust API 和测试验证协议、安全边界和恢复路径。

## Background

父任务 `06-20-webdav-sync-foundation-design` 已确认两段式：先做 Sync Snapshot Foundation，再做 WebDAV v1。当前生产数据已在 `mxterm.db`，SSH secret 已在本机 `secrets.enc`，SQLite 只保存 `secret_ref` 和 `secret_slot_id`。WebDAV 首版需要先有稳定、可测试、传输无关的 snapshot 协议。

## Requirements

- 新增本地 snapshot 协议，不依赖 WebDAV transport。
- 导出 `data.json` 时只能包含非敏感结构化数据和跨设备 `secret_slot_id`，不能包含本机 `secret_ref` 或明文 secret。
- 远端 `secrets.enc` 必须用同步主密码重新加密，不能直接上传本机 vault 文件。
- 同步主密码不保存明文，不复用 vault 主密码，不复用 WebDAV 密码。
- 导入前必须创建本机 `mxterm.db` 和本机 `secrets.enc` 备份，失败时可恢复。
- 支持“不输入同步主密码”的导入路径：只导入非敏感数据，跳过 secrets，并在结果里明确 `secrets_skipped=true`。
- 支持“输入同步主密码”的导入路径：按 `secret_slot_id` 重建本机 vault entries。
- 不实现 WebDAV 设置、连接测试、上传、下载、UI、自动同步或冲突合并。
- 不同步 `secrets.local.key`、终端输出、传输实时任务、本地缓存、远程编辑临时文件。

## Acceptance Criteria

- [ ] 新增 `src-tauri/src/sync_snapshot.rs` 或等价模块，职责清晰，不在 WebDAV 层绕过 repository。
- [ ] 定义 `SyncManifest` / `SyncDataDocument` / `SyncSecretsPlaintext` / artifact meta 等协议类型。
- [ ] 单测证明 `data.json` 不包含 `secret_ref`、password/passphrase 明文或本机 vault account。
- [ ] 单测证明远端 `secrets.enc` 密文不包含明文 secret，错误同步主密码无法解密。
- [ ] 单测覆盖 manifest format/version/schema/hash/size 校验。
- [ ] 单测覆盖无同步主密码导入：非敏感数据导入，secrets 跳过且结果明确。
- [ ] 单测覆盖有同步主密码导入：本机 vault 可按 `secret_slot_id` 恢复 secret。
- [ ] 单测覆盖导入前创建备份，导入失败不留下半导入状态。
- [ ] `cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- [ ] `cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib` 通过。
- [ ] `cargo check --manifest-path src-tauri\Cargo.toml` 通过或只保留既有无关 warning。

## Out Of Scope

- WebDAV HTTP transport。
- WebDAV 设置 UI。
- 自动同步。
- 多端字段级 merge。
- 历史快照管理。
- S3 或其它云端。
- 私钥文件内容同步。

## Notes

- 远端 `secrets.enc` 与本机 `secrets.enc` 名字相同但加密语义不同：远端用同步主密码，本机用本机 key 或 vault 主密码。
- 首版 snapshot import 可以采用同步范围全量替换，不做 merge。
- 当前前端设置仍在 localStorage；本任务只设计/预留 settings 白名单，不强制迁移所有设置。