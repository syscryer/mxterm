# Implementation Plan

1. 阅读 `RemoteFilePanel.tsx`、`WorkspaceShell.tsx`、`app.css` 当前传输面板结构。
2. 从 `RemoteFileTool` 移除 `transfers` 作为默认一级 tab，并让文件 tab 渲染 `transferPanel`。
3. 调整 `WorkspaceShell` 中 `RemoteFilePanel` 传参，保留 `transferPanel` 回调和数据不变。
4. 重写 `RemoteFileTransferPanel` 的 JSX 为 dock + 抽屉结构，保留所有已有操作按钮。
5. 更新 `app.css` 传输相关样式，使用全局 token，并保证窄栏不重叠。
6. 运行 `git diff --check` 和前端类型检查。
7. 检查 diff，确认未改动 Tauri 传输命令与后端逻辑。
