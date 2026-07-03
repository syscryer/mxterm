# 统一终端和远程文件标签布局实现计划

## 步骤

1. 设置类型与持久化
   - 在 `settingsTypes.ts` 增加 `RemoteFileOpenMode`、默认值和 normalize。
   - 在 `SettingsView.tsx` 基础设置区使用 `AppSelect` 增加“远程文件打开方式”。

2. WorkspaceShell 布局状态
   - 增加按 connectionId 记录的 split/unified 状态。
   - 增加统一 tab active 状态和清理 effect。
   - 调整 `activateRemoteFileTab`、`activateTerminalTab`、`openRemoteFile`，让 unified 模式下 active 类型正确切换。

3. 拖拽切换
   - 给远程文件 tab 和终端 tab 添加 WorkspaceShell 内部鼠标拖拽 payload。
   - 分屏模式下拖到对方 tab 栏时切到统一 tab，不排序。
   - 统一 tab 模式下拖到内容区临时落点时恢复上下分屏。
   - 给统一 tab 的终端/文件 tab 右键菜单增加“恢复上下分屏”。

4. 统一 tab 渲染
   - split 模式保留现有编辑器/终端分屏。
   - unified 模式渲染同一个顶部 tab 栏和下方统一内容区。
   - 终端 stack 和编辑器 stack 都保持挂载，仅按 active 状态隐藏。

5. 样式
   - 在 `app.css` 扩展统一 tab/workbench 所需类，复用现有 token、subtab、remote editor、terminal stack 样式。
   - tab 拖拽保持普通鼠标箭头，不使用 grab/grabbing 手型。
   - 同时检查显式 dark 和 system dark 的 surface/border 状态。

6. 验证
   - `node scripts/check-startup-module-boundary-source.mjs`
   - `node scripts/check-remote-file-editor-source.mjs`
   - `npm run check`
   - 如 `npm run check` 不覆盖构建，再运行 `npm run build`

## 风险文件

- `src/features/layout/WorkspaceShell.tsx`
- `src/features/settings/settingsTypes.ts`
- `src/features/settings/SettingsView.tsx`
- `src/styles/app.css`

## 审查重点

- 切换到文件 tab 不卸载终端。
- 统一 tab 不影响右侧文件面板和 Command Sender。
- 设置 normalize 能兼容历史设置。
- 不把 Monaco 或 xterm 静态拉入首屏入口。
