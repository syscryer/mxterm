# Implementation Plan

1. 增加纯 TypeScript 终端写队列和缓冲文本工具，并添加高频输入、顺序、单在途写入、clear/dispose 回归测试。
2. 接入 `TerminalPanel`：替换字符串 + rAF 直写，批量投影 recent output，重连和卸载时清理队列。
3. 接入 Docker 日志：chunk 批量提交、终态 flush、关闭/清空/重连 discard，移除 smooth follow 动画。
4. 将终端语义高亮刷新改为有界节流。
5. 在 Rust 共享 session 层增加输出批处理器，接入 SSH reader 和 streaming exec，并补顺序/批次边界测试。
6. 更新前后端 Tauri 合同中的高吞吐约束和测试要求。
7. 运行：
   - `node --test scripts/terminal-output-flow.test.mjs`
   - `npm run check`
   - `node scripts/check-docker-tool-refresh-source.mjs`
   - `cargo test --manifest-path src-tauri/Cargo.toml terminal_output_batcher`
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `node scripts/check-startup-module-boundary-source.mjs`

## Risk Files

- `src/features/terminal/TerminalPanel.tsx`
- `src/features/tools/DockerToolPanel.tsx`
- `src-tauri/src/terminal/manager.rs`
- `src-tauri/src/terminal/session.rs`

Rollback must preserve current event payloads and terminal session lifecycle.

## Validation Results

- `node --test scripts/terminal-output-flow.test.mjs`: 5 passed.
- `npm run check`: passed.
- `npm run build`: passed; existing large-chunk warning remains.
- `node scripts/check-docker-tool-refresh-source.mjs`: passed.
- `node scripts/check-startup-module-boundary-source.mjs`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml terminal_output_batcher`: 2 passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed with the existing `default_profile_id` dead-code warning.
- Real SSH and Docker sustained-output smoke was not run because it requires an active user connection/container; deterministic frontend and Rust pressure tests cover the batching contracts.
