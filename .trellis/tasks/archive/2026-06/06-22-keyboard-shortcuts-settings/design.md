# 快捷键设置设计

## Scope

本任务建立应用内快捷键基础设施，并把首批高频动作接入。实现重点是“统一注册、统一匹配、统一设置、冲突可见”，不是一次性覆盖所有菜单动作。

## Architecture

新增 `src/features/shortcuts/` 作为快捷键业务模块：

- `shortcutTypes.ts`：定义动作 ID、分类、作用域、快捷键结构。
- `shortcutRegistry.ts`：集中维护动作元数据和默认快捷键。
- `shortcutKeys.ts`：解析、规范化、格式化、匹配 `KeyboardEvent`。
- `shortcutValidation.ts`：冲突检测、保留键检测、编辑校验。
- `useShortcutManager.ts`：根据 settings 中的绑定监听键盘事件，并分发动作。
- `ShortcutSettingsSection.tsx`：设置页快捷键分类内容。

新增 `src/shared/ui/Keybinding.tsx` 显示 keycap。连接搜索和快捷键设置都需要展示快捷键，keycap 组件应共享，避免复制样式。

## Data Model

`settingsTypes.ts` 增加：

```ts
export type ShortcutActionId = string;

export interface ShortcutSettings {
  bindings: Record<ShortcutActionId, string | null>;
}
```

`defaultSettings.shortcuts.bindings` 由 `shortcutRegistry` 的默认快捷键生成。`normalizeSettings` 只保留注册表中存在的动作 ID，绑定值必须能被 `shortcutKeys` 解析并通过基础校验；无效值回落默认值或 `null`。

快捷键持久化使用规范字符串，例如：

- `Ctrl+Shift+F`
- `Ctrl+,`
- `F3`
- `Shift+F3`

字符串只作为存储和展示边界，运行时统一解析为结构化对象。

## Shortcut Scope

动作元数据包含作用域：

- `global`：设置、快速连接搜索等应用级动作。
- `workspace`：只在工作区视图有效。
- `terminal`：需要当前有活动 SSH 或本地终端。
- `terminal-search`：只在终端搜索打开时有效。

动作还包含 `allowInTerminal`：

- `true`：xterm 聚焦时也允许触发，例如 `Ctrl+Shift+F`。
- `false`：xterm 聚焦时不拦截，避免影响 shell。

普通表单输入、textarea、contentEditable 聚焦时默认不触发快捷键。xterm 的 helper textarea 需要特殊识别：它属于终端输入区域，应按 `allowInTerminal` 判断，而不是简单按 textarea 忽略。

## Action Dispatch

`WorkspaceShell` 保留业务动作实现，新增一个动作分发表：

```ts
const shortcutHandlers: Partial<Record<ShortcutActionId, () => void>> = {
  "connection.quickOpen": () => setConnectionSearchOpen(true),
  "terminal.search.toggle": () => toggleTerminalSearch(activeTerminalTabId),
  "commandSender.toggle": () => openCommandSender(),
};
```

`useShortcutManager` 只负责匹配和调用 handler，不直接理解终端、连接、面板业务状态。不可用动作由 handler 或 `enabled` 回调判断，避免快捷键层持有过多业务上下文。

首批动作尽量接入已有函数：

- 快速打开连接：复用 `ConnectionSearchDialog`。
- 终端搜索：复用 `toggleTerminalSearch` 和 `TerminalPanel` 的搜索接口。
- Command Sender：复用现有打开/关闭状态。
- 新建终端 tab：复用当前连接或本地终端的新增 tab 能力；没有上下文时不触发。
- 关闭当前终端 tab：复用现有关闭函数。
- 打开设置：复用 `setActiveView("settings")`。

## Settings UI

设置页新增 `SettingsSectionId = "shortcuts"`，左侧导航使用 Lucide `Keyboard` 图标。

快捷键页面结构：

- 顶部：标题、搜索框、恢复默认按钮。
- 内容：按分类分组的动作列表。
- 行内容：动作名称、说明、当前快捷键 keycap、编辑按钮、清空按钮。
- 编辑状态：行内进入“按下新的快捷键”状态，支持 `Esc` 取消、`Backspace/Delete` 清空。
- 错误状态：行内显示冲突或保留键提示，不保存无效绑定。

视觉要求：

- 使用 `settings-panel`、`settings-input`、`settings-action-button` 等现有设置页样式。
- 新增 keycap 样式写入 `src/styles/app.css`，颜色、边框、背景全部来自 `--mx-*` token。
- 不使用原生 `<select>`；本任务不需要下拉。

## Conflict Rules

冲突检测按作用域保守处理：

- 相同快捷键绑定到两个 `global` 动作，冲突。
- `global` 与 `workspace` / `terminal` 使用相同快捷键，冲突。
- `terminal` 与 `terminal-search` 可以根据条件进一步放宽，但第一版按冲突处理，避免用户理解成本。
- `null` 表示禁用，不参与冲突。

保留键检测：

- 无修饰符的普通字符不允许作为全局快捷键。
- `Ctrl+C`、`Ctrl+V`、`Ctrl+X`、`Ctrl+A`、`Ctrl+E`、`Ctrl+L`、`Ctrl+R`、`Ctrl+W` 不允许绑定为应用快捷键。
- `Alt` 单修饰符组合默认不作为首批推荐，避免影响终端 Meta 输入。

## Compatibility

旧 settings 没有 `shortcuts` 字段时自动使用默认值。删除或重命名动作时，normalize 会丢弃未知 action id，避免旧配置污染。

当前主要面向 Windows；内部结构保留 `meta` 字段，后续跨平台可以将 `Mod` 映射到 macOS `Meta`，但本任务不主动做系统级全局热键。

## Testing

- 单元级纯函数通过 TypeScript 类型检查覆盖：解析、格式化、匹配、冲突检测应独立于 React。
- 手动验证：终端聚焦时应用快捷键可用，普通 shell 快捷键不被拦截。
- 手动验证：设置页输入框聚焦时快捷键不误触发。
- 运行 `npm run check`。
