# 接入轻量设置页

## Goal

接入 mXterm 的轻量设置页，首版包含“基础设置”“外观”“终端配色”三个分类。参考 `D:\project\codem` 的设置页布局、控件密度和左侧设置视图气质，但不迁移 Codem 的全套设置中心、模型、插件、会话管理或 server API。

用户价值：让 mXterm 可以从左下角设置入口进入一个统一、安静、桌面工具感的设置界面，并能调整影响日常 SSH 工作区体验的基础行为、界面外观和终端配色。

## Confirmed Facts

- mXterm 当前左下角已有设置齿轮入口，位于 `src/features/connections/ConnectionPane.tsx` 的 `settings-foot`，但按钮还没有实际打开设置界面。
- Codem 的外观页在 `D:\project\codem\src\components\settings\AppearanceSettings.tsx`，可参考其预览区、设置行、分段控件、强调色选择、字号步进器等 UI 模式。
- Codem 的设置数据层绑定 `/api/settings` 和自己的 server store，不应直接迁入 mXterm。
- mXterm 现有规范要求前端复用 Radix + Lucide + `src/shared/ui/`，不要另起 UI 框架或零散手写一套通用控件。
- mXterm 原型规范已明确左下角只放设置按钮，设置结构里包含终端、编辑器、文件传输、连接、外观和安全；本轮先收敛为基础设置、外观、终端配色三个可落地分类。

## Requirements

- 只实现轻量设置页的三类内容：基础设置、外观、终端配色；不实现 Codem 的模型、插件、MCP、工作树、会话管理等分类。
- 左下角设置按钮要接入打开设置页，并调整成与新设置页一致的按钮样式、hover/active/focus 状态和 tooltip/aria-label。
- 设置页视觉参考 Codem 设置页，但文案、预览和选项要贴合 mXterm：终端、连接仓库、文件树、工具面板，而不是聊天、模型或工作树。
- 首版基础设置包含：
  - 启动时恢复上次工作区布局。
  - 自动打开上次活动连接/终端。
  - 连接失败时保留终端标签并显示错误。
  - 文件面板跟随活动连接。
- 首版外观设置包含：
  - 主题模式：系统 / 浅色 / 深色；如果深色还未完整适配，允许先展示为禁用或明确不应用到全局。
  - 强调色：预设色块 + 自定义颜色，用于主按钮、选中态和关键提示色。
  - 界面密度：舒适 / 紧凑，影响连接树、文件树、工具栏和设置页行距。
  - 界面字体：参考 Codem 外观设置的字体系统，提供预设 / 自定义两种模式，用于菜单、侧栏、按钮和设置页。
  - UI 字号：步进选择，影响普通界面文字。
  - 终端字体：参考常见开源等宽字体方案，提供预设 / 自定义两种模式；首版只使用 font-family 栈和本机 fallback，不下载或打包字体文件。
  - 终端字号：步进选择，影响终端字体大小；终端配色不放入本任务。
  - 图标大小：紧凑树和工具按钮图标尺寸，适配 mXterm 的连接树/文件树场景。
  - 面板宽度记忆：是否记住左侧/右侧面板拖拽宽度。
- 首版终端配色包含：
  - 终端配色页参考 Windows Terminal 的“配色方案”页面节奏：上方标题与说明，下面是纵向配色方案卡片列表；数据来源不经过 Windows Terminal 格式。
  - 每个配色方案卡片展示 16 色色块矩阵、终端背景色和方案名称，当前选中项用强调色边框/背景高亮。
  - 内置配色方案直接从 iTerm2-Color-Schemes 的原始 `.itermcolors` 文件转换为 mXterm 内部 xterm theme schema，用于首版全量挑选。
  - 首选检查候选：mXterm 默认、One Half Dark、One Half Light、iTerm2 Solarized Dark、Dracula、TokyoNight、Gruvbox Dark。
  - 全量方案列表需要提供搜索和亮色 / 暗色过滤入口，方便从数百个主题里挑选。
  - 可保留“新增”入口作为首版占位/后续入口，但首版不要求实现完整自定义编辑器。
  - 底部可出现“保存 / 放弃更改”操作区，让配色切换具备 Windows Terminal 式确认感。
  - 终端配色只影响终端 surface，不改变整个应用主题。
  - 自定义导入/导出不进入首版。
- 设置页从工作区切换时不能销毁 SSH 终端、远程文件树或当前连接会话状态；应隐藏/切换视图，而不是卸载运行中的工作区。
- 持久化优先采用 mXterm 自己的设置模型。若实现阶段选择 localStorage，必须封装在设置 hook/工具里；若选择 Tauri 存储，必须走 `src/shared/tauri/commands.ts` typed wrapper。
- 原型阶段默认先基于 `prototype/light-neutral/mxterm-empty-session.html` 迭代，不另起无关原型。

## Acceptance Criteria

- [ ] 左下角设置齿轮按钮能打开设置界面，并且视觉状态与设置页控件一致。
- [ ] 设置页只显示基础设置、外观、终端配色三个分类，不出现 Codem 的模型、插件、MCP、工作树、会话管理等分类。
- [ ] 外观页包含 mXterm 语境的预览区，能展示连接仓库、终端/文件树/工具面板的视觉效果。
- [ ] 基础设置、强调色、密度、界面字体、终端字体、UI 字号、终端字号、图标大小、面板宽度记忆、终端配色方案至少在 UI 状态中可交互，并通过统一设置模型持久化。
- [ ] 终端字体设置传入 xterm，会话已创建后切换字体能更新终端字体并重新适配尺寸。
- [ ] 终端配色页使用卡片列表呈现方案，每张卡片包含色块矩阵、背景色和方案名称，选中项高亮。
- [ ] 终端配色页支持全部 / 暗色 / 亮色过滤，并能与搜索条件组合使用。
- [ ] 返回工作区后，已打开的终端 tab、活动连接、远程文件面板状态不因进入设置页而重建。
- [ ] 设置控件使用 Lucide 图标、项目现有 CSS token 和共享/可复用组件模式，不引入新的 UI 框架。
- [ ] 原型文件先体现完整点击路径：左下角设置按钮 -> 基础设置 / 外观 / 终端配色 -> 返回工作区。
- [ ] `npm run check` 通过；涉及可见 UI 后运行 `npm run build`，或说明无法通过的既有原因。

## Notes

- 参考项目：
  - `D:\project\codem\src\components\settings\AppearanceSettings.tsx`
  - `D:\project\codem\src\components\settings\SettingsControls.tsx`
  - `D:\project\codem\src\styles.css` 中 `.settings-*` 与 `.appearance-preview-*` 样式片段
  - 主题来源优先参考 `https://github.com/mbadolato/iTerm2-Color-Schemes`
- 不直接复制 Codem 的 `/api/settings`、`useAppSettings`、模型设置、插件设置或 server store。
- 终端配色进入本任务，但仅做内置方案选择和预览，不做导入、导出或完整终端主题编辑器。
