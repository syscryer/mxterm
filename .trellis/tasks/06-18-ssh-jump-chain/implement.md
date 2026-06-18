# 真实 SSH 跳板机链路实现计划

## Implementation Checklist

- [x] 读取并对齐 `terminal/session.rs`、`ssh_config.rs`、`commands.rs` 当前共享建连边界
- [x] 在 Rust 侧补跳板机运行时校验与错误码
- [x] 提取共享“通过配置建立目标机 SSH client handle”的底座函数
- [x] 实现跳板机连接到目标机的 `direct-tcpip -> into_stream() -> connect_stream(...)` 路径
- [x] 让 `TerminalSession::open(...)` 复用新底座
- [x] 让 `ReusableExecSession::connect_resolved(...)` 复用新底座
- [x] 让 `ReusableSftpSession::connect_resolved(...)` 复用新底座
- [x] 补充 / 更新 Rust 单测，覆盖 jump 运行时限制和共享路径回归
- [x] 必要时更新 `.trellis/spec/backend/tauri-command-contracts.md`
- [x] 运行验证命令并记录结果

## Validation Commands

- `cargo test --manifest-path src-tauri/Cargo.toml terminal::session --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml connections --lib`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm check`

## Validation Results

- `node scripts/check-connection-jump-source.mjs` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml terminal::session --lib` passed: 8 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml connections --lib` passed: 20 tests.
- `cargo check --manifest-path src-tauri/Cargo.toml` passed with one pre-existing warning in `src/terminal/local_profiles.rs`.
- `pnpm check` passed.

## Risky Files

- `src-tauri/src/terminal/session.rs`
- `src-tauri/src/ssh_config.rs`
- `src-tauri/src/connections/mod.rs`
- `.trellis/spec/backend/tauri-command-contracts.md`

## Rollback Notes

- 若共享建连底座抽取过深导致编译面太大，优先保留公共 helper，但不要改动前端 payload 契约
- 若 `direct-tcpip` stream 接入失败，可先回退到“保持现状 + 保留运行时校验与错误码”，不要提交半通不通的链路
