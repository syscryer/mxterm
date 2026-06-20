# Fix empty connections after storage migration

## Goal

修复 SQLite + encrypted vault 迁移后连接列表为空的问题。用户现有 `connections.json` 中的连接必须在迁移后继续出现在连接列表中，且修复不能把明文密码重新写入 SQLite 或生产 JSON。

## Requirements

- 先定位根因：区分是旧 JSON 没读到、SQLite 写入为空、迁移标记提前写入、前端读取被 vault lock 阻断，还是 repository 查询/映射错误。
- 保留旧 JSON 和 `.migrated.bak` 作为恢复来源，不删除、不覆盖用户数据。
- 若已迁移状态下 SQLite 为空但 legacy JSON/backup 有连接，应提供可重复的修复路径，让 repository 能恢复结构化连接数据。
- 若 SQLite 不为空但本地 vault key 丢失或被重建，应能基于 `.migrated.bak` 恢复加密 vault，并避免前端自动解锁无限重试。
- SQLite 仍只能保存 secret 引用，不能保存明文 password/private_key_passphrase。
- 修复必须有回归测试覆盖，不靠 UI 去重或隐藏空状态兜底。
- 不处理 WebDAV 同步，不改变 vault 加密模型，不重构连接 UI。

## Acceptance Criteria

- [x] 本机 AppData 中 legacy JSON/backup 和 SQLite 的连接数量差异被确认并记录根因。
- [x] 连接列表从 repository 读取时能恢复或显示迁移前的连接。
- [x] 回归测试覆盖“vault 本地 key 被重建后，从 migrated backup 恢复 encrypted vault”的恢复场景。
- [x] `cargo test --manifest-path src-tauri\Cargo.toml storage_vault --lib` 通过。
- [x] `cargo test --manifest-path src-tauri\Cargo.toml storage_migration --lib` 或更精确相关测试通过。
- [x] `cargo test --manifest-path src-tauri\Cargo.toml storage_repository --lib` 如 repository 行为变更则通过。
- [x] `npm run check` 如前端类型变更则通过。

## Notes

- 用户反馈：目前连接是空的。
- 本机 SQLite 已确认不为空：connections=10、credentials=1、known_hosts=8，`app_meta.storage_migrated_from_json=true`。
- 实际根因是 `secrets.enc` 早于 `secrets.local.key`，本地 key 被重建后 `secret_vault_unlock_local` 无法解旧 vault；前端失败后还会重复自动解锁，导致 storage hooks 持续 disabled，连接区看起来为空。
- 修复走 vault 恢复和自动解锁节流，不做 UI 层兜底，不把明文 secret 写回 SQLite/生产 JSON。
