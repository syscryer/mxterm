# 接入轻量设置页设计

## Architecture

新增一个轻量的 settings feature，而不是迁入 Codem 的完整设置中心。首版只有三个分类：基础设置、外观、终端配色。

- `src/features/settings/SettingsView.tsx`：设置页容器，负责左侧轻量导航、返回工作区和当前分类内容。
- `src/features/settings/BasicSettingsSection.tsx`：基础设置分类。
- `src/features/settings/AppearanceSettingsSection.tsx`：外观设置分类，负责预览区、设置行和视觉参数。
- `src/features/settings/TerminalThemeSettingsSection.tsx`：终端配色分类，负责内置配色方案卡片列表、搜索筛选和当前方案状态。
- `src/features/settings/SettingsControls.tsx`：承载可复用设置控件，如设置行、分段控件、步进器、色块选择、开关。
- `src/features/settings/settingsTypes.ts`：类型、默认值、normalize、CSS 变量解析。
- `src/features/settings/useSettings.ts`：读取、更新、持久化设置。
- `WorkspaceShell`：新增工作区/设置页视图状态，将设置页与工作区并列渲染；工作区在设置页打开时隐藏但不卸载。
- `ConnectionPane`：新增 `onOpenSettings` prop，将左下角设置按钮接到 `WorkspaceShell`。

## Data Model

建议首版字段：

```ts
type MxtermSettings = {
  basic: {
    restoreWorkspaceOnLaunch: boolean;
    reopenLastTerminal: boolean;
    keepFailedTerminalTabs: boolean;
    filePanelFollowsActiveConnection: boolean;
  };
  appearance: {
    themeMode: "system" | "light" | "dark";
    accentColor: "blue" | "slate" | "emerald" | "rose" | "violet" | "custom";
    accentColorCustom: string;
    density: "comfortable" | "compact";
    uiFontMode: "preset" | "custom";
    uiFontPreset: UiFontPreset;
    uiFontCustom: string;
    terminalFontMode: "preset" | "custom";
    terminalFontPreset: TerminalFontPreset;
    terminalFontCustom: string;
    uiFontSize: 12 | 13 | 14 | 15;
    terminalFontSize: 12 | 13 | 14 | 15 | 16;
    iconSize: "small" | "medium" | "large";
    rememberPaneWidths: boolean;
  };
  terminalTheme: {
    scheme: TerminalColorSchemeId;
  };
};
```

字段通过 normalize 函数兜底，避免坏的 localStorage 或旧版本配置破坏 UI。实现阶段如果选择 Tauri 设置存储，应把命令 wrapper 集中在 `src/shared/tauri/commands.ts`，不要让组件直接 `invoke(...)`。

终端配色数据采用 mXterm 内部 xterm.js 兼容 schema：`background`、`foreground`、`cursor`、`selectionBackground` 和 16 个 ANSI 色值。主题主来源为 iTerm2-Color-Schemes 的原始 `.itermcolors` 文件，生成脚本在开发阶段直接转换为本地 `terminalColorSchemes.ts` 常量；运行时不拉取远程数据，也不使用 Windows Terminal JSON 作为中间格式。首版导入上游原始主题全集，再加 mXterm 默认主题，列表通过搜索和背景亮度推导出的亮色 / 暗色过滤控制浏览成本。

字体设置沿用 Codem 的“预设 / 自定义”模式，但收敛到 mXterm 需要的两类：界面字体和终端字体。预设只写入 `font-family` 栈，终端字体参考 Cascadia Code、JetBrains Mono、Fira Code、Source Code Pro、Iosevka、Hack、Noto Sans Mono 等常见开源等宽字体，并依赖本机已安装字体和 fallback，不下载、不打包字体文件。

## UI Flow

1. 用户点击左下角设置按钮。
2. `WorkspaceShell` 将 `activeView` 切到 `settings`，默认打开基础设置或上次设置分类。
3. 工作区节点保持挂载但隐藏，设置页显示。
4. 用户在基础设置、外观、终端配色之间切换。
5. 用户修改设置项，设置 hook 更新状态并同步 CSS 变量。
6. 用户点击“返回工作区”，回到原来的终端/连接/文件面板状态。

## Visual Design

参考 Codem 设置页的节奏，但 mXterm 预览内容改为 SSH 工具语境：

- 左侧导航只包含“基础设置”“外观”“终端配色”和“返回工作区”。
- 外观预览区展示左侧连接仓库、中间终端、右侧文件树的简化缩略图。
- 终端配色页采用 Windows Terminal 式纵向方案列表：每个方案是一张终端背景色卡片，左侧为 16 色色块矩阵，右侧为方案名；选中项使用强调色边框/浅背景高亮。
- 终端配色页顶部保留标题“配色方案”和简短说明，可放一个“新增”按钮作为后续自定义入口。
- 终端配色页搜索框旁提供“全部 / 暗色 / 亮色”分段筛选，筛选结果和搜索条件取交集。
- 终端配色页底部可以固定“保存 / 放弃更改”操作区，和 Windows Terminal 的确认模型保持一致。
- 设置行使用紧凑图标、标题、说明、右侧控件布局。
- 外观页字体行使用同一轻量字体控件：左侧分段切换预设 / 自定义，预设模式选择本地字体栈，自定义模式输入完整 font-family 栈并在 blur / Enter 时归一化保存。
- 左下角设置按钮与设置页按钮语言统一：28-30px 图标按钮、圆角 7-8px、轻 hover 背景、活动态使用同一强调色或 active surface。

## Compatibility

- 当前右侧文件管理 WIP 有大量未提交改动，实现时必须只改与外观设置相关的区域，并避免重写文件面板逻辑。
- 设置视图切换必须遵守 frontend spec：不能卸载 terminal 和 remote-file surfaces。
- CSS 应复用 `--mx-*` tokens；新增变量要集中在 `tokens.css` 或设置 feature 的明确段落。

## Out Of Scope

- 不接入 Codem 的全设置分类。
- 不接入模型、插件、MCP、使用情况、会话管理。
- 不实现终端配色方案导入/导出。
- 不实现完整暗色主题，除非实现阶段确认现有 CSS 足以安全支持。
