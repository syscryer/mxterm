# Storage Security Sync Foundation Implementation Plan

## Constraints

- 本阶段只做 SQLite Foundation Phase 1。
- 不切换生产读写路径。
- 不实现 keyring/WebDAV。
- 遵守 TDD：生产代码前先写失败测试。
- Windows 环境，文件 UTF-8 无 BOM。

## Steps

1. 读取后端规范和现有 storage/json store 实现。
2. 添加 SQLite 依赖：`rusqlite`，启用 bundled feature。
3. 新增 `src-tauri/src/storage_sqlite.rs`，先写测试：
   - 初始化创建 schema version。
   - 重复初始化幂等。
   - 核心表存在。
   - known_hosts host 规范化。
   - schema 不含明文 secret 字段。
4. 运行测试，确认失败原因是模块/功能缺失。
5. 实现最小 SQLiteStore 和 schema 初始化。
6. 在 `lib.rs` 注册模块，但不接入 commands。
7. 运行验证：
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
8. 如本任务形成新约定，更新 `.trellis/spec/backend/tauri-command-contracts.md` 或新建 backend storage spec。
9. `git diff --check`。
10. `git add` 新增/修改文件，等待人工审核。

## Rollback

- 如果 SQLite 依赖或 Windows 编译出现不可接受问题，回滚 `Cargo.toml` 和 `storage_sqlite.rs`，现有 JSON 路径不受影响。
- 因本阶段不切生产读写，不需要数据迁移回滚。

## Validation Notes

`cargo test --manifest-path src-tauri/Cargo.toml --lib` 可能仍触发既有 local profile 测试失败；本任务最低要求过滤测试和 `cargo check` 通过，并记录任何既有无关失败。