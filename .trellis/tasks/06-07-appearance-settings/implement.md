# 接入轻量设置页实现计划

## Steps

1. 原型阶段
   - 在 `prototype/light-neutral/mxterm-empty-session.html` 中接通左下角设置按钮。
   - 增加轻量设置视图、左侧基础设置/外观/终端配色导航、返回工作区按钮。
   - 增加外观预览区和 Windows Terminal 风格的终端配色方案卡片列表；配色数据不经过 Windows Terminal 格式。
   - 调整左下角设置按钮样式，和外观页控件统一。

2. 设置模型
   - 新增 `src/features/settings/settingsTypes.ts`，定义基础设置、外观、终端配色类型、默认值、normalize 和 CSS 变量解析。
   - 新增 `terminalColorSchemes` 数据和生成脚本，直接解析 iTerm2-Color-Schemes 的原始 `.itermcolors` 文件并转换为 xterm.js 兼容字段。
   - 在外观设置模型中加入界面字体和终端字体的预设 / 自定义模式，并通过统一 normalize 兜底坏配置。
   - 新增 `src/features/settings/useSettings.ts`，先封装读取/保存，不让组件直接访问存储。
   - 根据实现风险决定 localStorage 或 Tauri `settings.json`。若走 Tauri，先补 command wrapper 和 Rust 存储。

3. React UI
   - 新增设置控件组件，参考 Codem `SettingsControls.tsx` 的行布局、分段控件和步进器，但使用 mXterm 命名与 CSS。
   - 新增 `SettingsView`，包含左侧轻量导航和三类设置 section。
   - 新增 `BasicSettingsSection`、`AppearanceSettingsSection`、`TerminalThemeSettingsSection`；终端配色 section 使用纵向 scheme card 列表。
   - 外观 section 接入界面字体和终端字体控件；终端配色 section 接入全部 / 暗色 / 亮色筛选，并与搜索条件组合。
   - 修改 `WorkspaceShell`：添加 `activeView`、设置页渲染、返回工作区；工作区隐藏不卸载。
   - 修改 `WorkspaceShell` 和 `TerminalPanel`：解析终端字体设置并传入 xterm，字体切换后更新 `terminal.options.fontFamily` 并重新 fit。
   - 修改 `ConnectionPane`：新增 `onOpenSettings` prop，接入左下角设置按钮。

4. 样式接入
   - 在 `src/styles/app.css` 增加设置页、设置控件、外观预览、终端配色 scheme card、底部保存栏、设置入口按钮样式。
   - 在 `src/styles/tokens.css` 集中新增必要 CSS 变量。
   - 确保密度、字号、图标大小不会造成按钮文字溢出或面板高度跳动。

5. 验证
   - 运行 `npm run check`。
   - 运行 `npm run build`。
   - 可见 UI 改动后用浏览器/截图检查：打开设置页、切换设置项、返回工作区、左下角按钮 hover/active。

## Risk Points

- `WorkspaceShell` 已经有右侧文件管理 WIP，修改时要避免顺手重构现有 session/workbench 逻辑。
- 设置页打开时如果条件渲染工作区，可能导致终端重建；必须使用 hidden/class 方式保留节点。
- 字号和密度会影响 xterm FitAddon，终端字号接入后需要确认 resize/fit 行为。
- iTerm2-Color-Schemes 仓库是主题集合，仓库整体许可证与单个主题作者归属需要保留说明；首版全量导入上游原始主题用于挑选，并在生成数据里记录来源。

## Validation Commands

```bash
node scripts/check-settings-page-source.mjs
node scripts/check-terminal-chrome-source.mjs
npm run check
npm run build
npm test
```
