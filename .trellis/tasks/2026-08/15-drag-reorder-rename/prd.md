# 活动标签支持拖拽重排与双击重命名

## Goal

让 SSH 与本地终端的 subtab 支持在同一连接内拖拽重排顺序，并支持双击就地重命名，让用户可以快速整理会话顺序并为标签赋予语义化名称，减少在大量终端会话间切换的成本。

## Confirmed Facts

- 现有 drag infrastructure 已实现 90%：`workbenchTabMouseDrag` state (`WorkspaceShell.tsx:1029-1030`)、6px 阈值与 `mouseMove`/`mouseUp` 监听 (`:1830-1887`)、`handleWorkbenchTabMouseDown` (`:5158-5180)` 与 `applyWorkbenchTabMouseDrop` (`:5340-5395`)。
- 现有 drop zone 字面量只有 4 个，全部位于 `<nav>` 容器级 (`terminal`/`file`/`split-file`/`split-terminal`)。
- `terminalTabs` state 为 `useState<TerminalTab[]>` (`:897-898`)，`terminalTabsRef` 在 `replaceConnectingTabWithTerminal` 等处同步维护。
- `TerminalTab` 接口包含 `title: string` 字段 (`:469`)。
- `replaceConnectingTabWithTerminal` 在 `:4427` 强制覆盖 `title: terminalTabTitle(tab.index)`，会导致用户重命名被清零。
- `useShortcutManager` 在 `:1711-1714` 注册全局键盘，rename `<input>` 必须 `stopPropagation` 避免被吞键。
- `tabContextMenuActions.ts` 的 `prepend?: TabContextMenuAction[]` 是当前唯一的菜单覆盖接口，不新增布尔字段。

## Requirements

- 在同一 SSH 连接内，subtab 拖拽到另一 subtab 的左半边或右半边后，会把源 tab 重新插入到目标 tab 之前或之后；连接外拖拽视为 no-op。
- 在同一本地终端 pool 内，subtab 拖拽行为同上；跨连接 / 跨池拖拽视为 no-op。
- 双击 SSH subtab 标签进入就地重命名，提交（Enter 或失焦）保存，空字符串或超过 50 字拒绝；Esc 取消。
- 双击本地终端 subtab 行为同上。
- `replaceConnectingTabWithTerminal` 必须保留用户在之前会话里重命名过的标题。
- 拖拽 / 重命名不会触碰 RDP / VNC / RemoteFile / 终端分屏组 subtab。
- 远程文件 subtab 不参与重命名（重命名仅 SSH + local）。
- 不新增 npm 依赖；不动 `App.tsx` / `main.tsx` / `package.json` / `vite.config.ts` / `tsconfig.json`。

## Acceptance Criteria

- [ ] `node scripts/check-q3-tab-drag-rename.mjs` 输出 `Q3 tab drag-reorder + rename check passed.`。
- [ ] SSH subtab 在同一连接内可拖拽重排，跨连接拖拽 no-op。
- [ ] 本地终端 subtab 可拖拽重排，跨连接拖拽 no-op。
- [ ] 双击 SSH subtab 进入就地重命名，Enter 提交、Esc 取消、失焦提交。
- [ ] 双击本地终端 subtab 进入就地重命名，行为同上。
- [ ] 已重命名的 SSH subtab 在连接握手完成后仍保留自定义标题。
- [ ] 终端分屏组 subtab 不响应双击重命名，拖拽也不会被作为目标。
- [ ] RDP / VNC / 远程文件 subtab 不响应双击重命名。
- [ ] `pnpm exec tsc --noEmit` 无错误。

## Out of Scope

- RDP / VNC / RemoteFile / 终端分屏组 subtab 的重命名与拖拽。
- 跨连接 subtab 拖拽移动。
- 重命名历史的持久化（重命名只在内存中维持）。
- 自定义拖拽预览样式 / 视觉特效。
- 键盘快捷键触发重命名（例如 F2）。