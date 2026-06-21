# Sync Snapshot Foundation Implementation Plan

## Steps

1. 读取现有存储代码：
   - `src-tauri/src/storage_repository.rs`
   - `src-tauri/src/storage_sqlite.rs`
   - `src-tauri/src/storage_vault.rs`
   - `src-tauri/src/storage_migration.rs`
2. 先写测试骨架：manifest/hash/encryption/export/import。
3. 新增 `src-tauri/src/sync_snapshot.rs` 并在 `lib.rs` 注册模块。
4. 实现协议类型和常量：`FORMAT`, `PROTOCOL_VERSION`, artifact 名称。
5. 实现 utility：SHA256、device name normalize、snapshot id 计算、artifact 校验。
6. 实现远端 secrets 加密/解密：Argon2id + AES-256-GCM + AAD。
7. 补 repository export API：导出连接、凭据、known_hosts、隧道、分组。
8. 实现 `build_snapshot_bundle(...)`：生成 `data.json`、`secrets.enc`、`manifest.json`。
9. 补 repository import API：transaction 替换同步范围内数据。
10. 实现 `import_snapshot_bundle(...)`：校验、备份、导入 data、可选导入 secrets。
11. 实现失败恢复：导入失败不提交 transaction；必要时从备份恢复 DB/vault。
12. 更新 `.trellis/spec/backend/tauri-command-contracts.md` 或新增同步场景 spec，记录 snapshot contract。
13. 暂存新增代码和 Trellis 文档，提交前检查没有真实 secret。

## Validation Commands

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo test --manifest-path src-tauri\Cargo.toml sync_snapshot --lib
cargo test --manifest-path src-tauri\Cargo.toml storage_repository --lib
cargo check --manifest-path src-tauri\Cargo.toml
git diff --cached --check
```

## Test Checklist

- [ ] Manifest accepts current format/version/schema。
- [ ] Manifest rejects wrong format/version/schema。
- [ ] Artifact hash mismatch rejects import。
- [ ] Artifact size mismatch rejects import。
- [ ] Export data excludes local `secret_ref`。
- [ ] Export data excludes plaintext password/passphrase。
- [ ] Encrypted remote secrets do not contain plaintext secret。
- [ ] Wrong sync password cannot decrypt remote secrets。
- [ ] Import without password imports data and skips secrets。
- [ ] Import with password restores vault secrets by `secret_slot_id`。
- [ ] Import creates local backup before replacing data。
- [ ] Import failure does not leave half-imported DB rows。

## Risk Points

- `StorageRepository` 目前主要是单条 CRUD，批量 replace 需要谨慎保持 transaction 边界。
- 本机 `secrets.enc` 与远端 `secrets.enc` 名称相同，测试和代码命名要明确 local/remote。
- 不能为了方便直接复制本机 vault 文件到远端。
- 不要在 frontend 或 command 层处理 secret 明文；snapshot 加密留在 Rust 后端。

## Review Gate

开始实现前确认：本子任务只做本地 snapshot foundation，不做 WebDAV transport/UI。实现完成后再创建 `webdav-sync-v1` 子任务。