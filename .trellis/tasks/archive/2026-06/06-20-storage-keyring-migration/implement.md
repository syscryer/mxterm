# Storage Vault Migration Implementation Plan

## Constraints

- 遵守 TDD：新增生产代码前先写失败测试。
- 不实现 WebDAV 传输。
- 不把明文 password/passphrase 写入 SQLite。
- 不在 vault 失败时静默回退到明文存储。
- Windows 环境，文件 UTF-8 无 BOM。

## Steps

1. 读取 Phase 2 PRD/design、后端 spec、现有 JSON store、`ssh_config.rs` 解析路径。
2. 引入 vault 加密依赖：`argon2`、`aes-gcm`、`base64`、`getrandom`。
3. 先写 `storage_vault` 测试：
   - secret account 生成稳定。
   - fake store set/get/delete。
   - vault 文件不包含明文 secret。
   - 错误主密码无法解锁。
4. 实现 `storage_vault.rs`：trait、reference、fake test store、real vault adapter、Tauri `VaultState`、默认本机 key 解锁和主密码 rekey。
5. 先写 `storage_repository` / `storage_migration` 测试：
   - 空环境初始化 SQLite。
   - legacy JSON inline password 迁移到 vault + SQLite refs。
   - saved credential password/private key passphrase 迁移。
   - known_hosts lowercase。
   - tunnels round-trip。
   - secret store 写入失败不标记迁移成功。
   - SQLite 写入失败不标记迁移成功。
6. 实现 SQLite repository 最小 API，覆盖 connection/credential/known_host/tunnel list/upsert/delete/get/trust。
7. 实现 migrator：读取 JSON、写 vault、SQLite transaction、app_meta 标记、`.migrated.bak` 保留。
8. 修改 `ssh_config.rs` 走 repository + vault secret resolution，保持 prompt runtime credential 行为。
9. 修改 `commands.rs` 中 connection/credential/known_host/tunnel 生产命令走 repository facade。
10. 新增 `secret_vault_status` / `secret_vault_unlock` / `secret_vault_unlock_local` / 主密码启停命令和设置页开关。
11. 确认 remote_files、remote_monitor、terminal、tunnel start 都通过同一 `resolve_saved_connection`，不各自解析 secret。
12. 更新 `.trellis/spec/backend/tauri-command-contracts.md`，补 Phase 2 的 repository/vault/migration contract。
13. 验证：
    - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
    - `cargo test --manifest-path src-tauri/Cargo.toml storage_vault --lib`
    - `cargo test --manifest-path src-tauri/Cargo.toml storage_migration --lib`
    - `cargo test --manifest-path src-tauri/Cargo.toml storage_repository --lib`
    - `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`
    - `cargo test --manifest-path src-tauri/Cargo.toml ssh_config --lib`
    - `npm run check`
    - `cargo check --manifest-path src-tauri/Cargo.toml`
    - `git diff --check`
14. 暂存改动，提交前检查 staged diff 中没有真实 secret。

## Rollback

- 迁移成功前旧 JSON 不改名、不删除，任何失败都可继续使用旧数据或重试。
- 如果 Phase 2 实现中途发现生产切换风险过高，保留 `StorageRepository` 和 `StorageMigrator` 测试，不接命令层，回到用户处重新确认是否拆成 Phase 2A/2B。
- 如加密库在 Windows 编译或运行不可接受，回滚依赖和 real adapter，保留 trait/fake tests 重新选型。

## Review Gate

范围已确认：完整 Phase 2 一次做完生产切换。用户已确认不使用系统 密钥环，改为 mXterm 自管 encrypted vault。