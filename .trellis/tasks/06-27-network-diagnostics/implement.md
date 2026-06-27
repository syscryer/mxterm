# 网络诊断工具实施计划

## Checklist

1. 后端 TDD
   - 为 `build_diagnostic_command` 写单元测试：Ping、TCP fallback、DNS fallback、Trace fallback、HTTP URL 规范化、端口非法。
   - 先运行 targeted test，确认测试因缺少实现失败。

2. 后端实现
   - 新增 `src-tauri/src/network_tools.rs`。
   - 增加 request/result 类型和 `NetworkDiagnosticSessionManager`。
   - 实现命令构造、输入校验、远端执行和结果映射。
   - 在 `commands.rs`、`lib.rs` 注册命令和 state。

3. 前端类型和 wrapper
   - 在 `src/features/tools/dockerTypes.ts` 或工具类型文件增加网络诊断类型。
   - 在 `src/shared/tauri/commands.ts` 增加 `networkDiagnosticRun`。

4. 前端 UI
   - 替换 `toolboxView === "network"` 的占位状态。
   - 增加诊断表单、运行状态、结果摘要、原始输出、复制按钮。
   - 浏览器预览提供 deterministic sample。

5. 样式
   - 在 `src/styles/app.css` 增加紧凑工具面板样式。
   - 使用 `--mx-*` token 和现有工具箱按钮风格。

6. 规范同步
   - 更新前后端 Tauri command contract，记录网络诊断命令。

7. 验证
   - `cargo test --manifest-path src-tauri/Cargo.toml network_tools --lib`
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `npm run check`
   - `git diff --check`

## Notes

- 不提交 `.code-review-findings.md`、`tauri-dev.err.log`、`tauri-dev.out.log`。
- 不自动提交推送，除非用户再次明确要求。
