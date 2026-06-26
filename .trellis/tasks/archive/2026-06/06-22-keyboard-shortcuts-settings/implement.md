# 快捷键设置实现计划

## 1. 准备

- 读取 `.trellis/spec/frontend/index.md` 和组件规范。
- 确认工作区干净。
- 不改 Rust，不跑 cargo。

## 2. 快捷键核心模块

- 新建 `src/features/shortcuts/shortcutTypes.ts`。
- 新建 `shortcutRegistry.ts`，定义首批动作、分类和默认快捷键。
- 新建 `shortcutKeys.ts`，实现解析、格式化、KeyboardEvent 匹配。
- 新建 `shortcutValidation.ts`，实现冲突检测和保留键检测。

## 3. Settings 数据接入

- `settingsTypes.ts` 增加 `ShortcutSettings` 和 `shortcuts` 字段。
- `defaultSettings` 从注册表生成默认绑定。
- `normalizeSettings` 归一化快捷键配置。
- `useSettings.ts` 增加 `updateShortcuts`。

## 4. 共享 keycap UI

- 新建 `src/shared/ui/Keybinding.tsx`。
- 在 `src/styles/app.css` 增加共享 keycap 和快捷键设置列表样式，全部使用 `--mx-*` token。
- 将连接搜索里现有 `<kbd>` 展示迁移到共享组件。

## 5. 设置页 UI

- `SettingsView.tsx` 新增“快捷键”导航项。
- 新建 `ShortcutSettingsSection.tsx`，支持搜索、分组、编辑、清空、恢复默认。
- 编辑时捕获 keydown，显示冲突和保留键错误。

## 6. 快捷键运行时

- 新建 `useShortcutManager.ts`。
- 在 `WorkspaceShell.tsx` 接入 settings 快捷键和 action handlers。
- 首批接入：
  - 快速打开连接
  - 打开设置
  - 新建当前上下文终端 tab
  - 关闭当前终端 tab
  - 打开/关闭终端搜索
  - 搜索下一个/上一个
  - 打开/关闭 Command Sender
- 处理 xterm helper textarea 与普通表单输入的差异。

## 7. 验证

- 运行 `npm run check`。
- 手动验证：
  - 设置页可查看、搜索、编辑、清空、恢复默认。
  - 冲突绑定不能保存。
  - 保留键不能保存。
  - 终端聚焦时 `Ctrl+Shift+F`、`Ctrl+Shift+K` 等应用快捷键可用。
  - 终端聚焦时 `Ctrl+C`、`Ctrl+L`、`Ctrl+A` 不被应用层拦截。
  - 普通输入框聚焦时全局快捷键不误触发。

## 8. 收尾

- 检查 `git status --short` 和 staged diff。
- 新增代码文件按项目规则 `git add` 暂存，等待人工审核。
- 不自动提交、不自动推送。
