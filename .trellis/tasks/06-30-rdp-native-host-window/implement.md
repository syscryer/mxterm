# RDP 独立子窗体实施计划

1. 任务上下文整理
   - 补齐 `prd.md`、`design.md`、`implement.md`。
   - 激活 `06-30-rdp-native-host-window` 任务。

2. Rust 宿主窗口收尾
   - 检查 `RdpSessionManager` 的宿主复用逻辑，确认完全按单例宿主复用。
   - 收尾 `run_activex_host(...)`，确保宿主作为独立顶层窗口创建，并恢复持久化窗口状态。
   - 检查 `WM_NCDESTROY`、宿主唤起、tab 激活和窗口恢复逻辑是否完整。

3. 前端 typed wrapper 接线
   - 在 `connectionTypes.ts` 增加 `RdpSessionRevealResult`。
   - 在 `commands.ts` 增加 `rdpRevealSession(...)`。
   - 在 `WorkspaceShell` 的已有会话打开路径接入宿主唤起。

4. 校验
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `npm run check`
   - `git diff --check`

5. 结果整理
   - 汇总本轮代码改动、验证结果和仍需用户本机烟测的点。
