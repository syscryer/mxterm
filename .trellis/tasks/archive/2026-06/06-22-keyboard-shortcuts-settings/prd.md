# 快捷键设置

## Goal

为 mXterm 增加统一的应用内快捷键设置能力，让高频操作可以键盘触达、可查看、可修改，并避免快捷键逻辑继续散落在各个功能组件里。

第一版只做应用内快捷键，不注册系统级全局热键；命令面板作为后续功能，不在本任务实现。

## Requirements

- 设置页新增“快捷键”分类，风格延续现有设置页、全局 token、Radix/Lucide/shared ui 体系。
- 新增统一快捷键动作注册表，动作至少包含：ID、名称、说明、分类、默认快捷键、作用域、是否允许在终端聚焦时触发。
- 快捷键配置持久化到现有 settings 体系，支持默认值归一化和旧配置兼容。
- 支持查看、搜索、编辑、清空单个动作快捷键，并支持恢复全部默认。
- 快捷键编辑必须捕获组合键并做规范化展示，例如 `Ctrl + Shift + F`。
- 保存快捷键前必须检测冲突；同一作用域内冲突时不允许保存，并提示冲突动作。
- 禁止设置明显会破坏终端输入的快捷键，例如无修饰符的普通字符、`Ctrl+C`、`Ctrl+V`、`Ctrl+L` 等常见 shell/readline 输入键。
- 终端聚焦时只拦截明确标记为应用级且终端安全的快捷键，普通终端输入继续交给 xterm/shell。
- 普通输入框、文本域、可编辑区域聚焦时，不触发全局快捷键，避免打断表单输入。
- 首批默认快捷键覆盖高频动作：
  - 快速打开连接：`Ctrl+Shift+O`
  - 新建同连接终端 tab：`Ctrl+Shift+T`
  - 关闭当前终端 tab：`Ctrl+Shift+W`
  - 打开/关闭终端搜索：`Ctrl+Shift+F`
  - 打开/关闭 Command Sender：`Ctrl+Shift+K`
  - 打开设置：`Ctrl+,`
  - 终端搜索下一个：`F3`
  - 终端搜索上一个：`Shift+F3`
- 首批动作可以只覆盖已经存在的可靠功能入口；无法安全执行的动作不强行加入默认快捷键。

## Non-goals

- 不做系统级全局快捷键，不在应用失焦或最小化时响应热键。
- 不做命令面板，但快捷键动作注册表要为后续命令面板复用留接口。
- 不做多键序列、Vim 风格 leader key、profile 级快捷键。
- 不做连接级或会话级快捷键覆盖。
- 不重构整个 WorkspaceShell，只做接入快捷键所需的最小动作分发整理。

## Acceptance Criteria

- [x] 设置页左侧出现“快捷键”分类，进入后可搜索和查看动作快捷键。
- [x] 用户可以编辑、清空、恢复默认快捷键，配置刷新后仍保留。
- [x] 冲突快捷键不能保存，界面能说明与哪个动作冲突。
- [x] 禁止绑定普通字符和常见终端保留组合键。
- [x] `Ctrl+Shift+O` 能打开快速连接搜索。
- [x] `Ctrl+Shift+F` 能打开/关闭当前 SSH 或本地终端搜索。
- [x] `Ctrl+Shift+K` 能打开/关闭 Command Sender。
- [x] `Ctrl+Shift+T` 能基于当前上下文创建合理的新终端 tab。
- [x] `Ctrl+Shift+W` 能关闭当前活动终端 tab，并沿用现有关闭逻辑。
- [x] `Ctrl+,` 能打开设置页。
- [x] xterm 聚焦时，常见 shell 快捷键不被拦截；本任务新增的应用级快捷键可以触发。
- [x] Settings UI 使用全局 token 和共享 UI；不引入原生 select、新 UI 框架或孤立视觉体系。
- [x] `npm run check` 通过，或明确记录既有阻塞。

## Notes

- UI/UX 审查结论：该页属于桌面生产力工具设置界面，应保持信息密度、清晰分组、可搜索、可恢复默认；视觉实现必须贴合现有 mXterm 设置页，而不是新建独立视觉风格。
- 验证：`node scripts/check-shortcuts-source.mjs`、`node scripts/check-connection-quick-search-source.mjs`、`npm run check` 已通过；`npm test` 当前为项目占位命令，输出 `frontend tests not configured yet`。
