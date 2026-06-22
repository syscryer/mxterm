# File Transfer Dock UI Design

## Scope

只调整右侧文件工具区的布局和传输列表呈现方式。`WorkspaceShell` 中的传输状态、进度事件、失败重试、取消、路径操作继续复用现有实现。

## Layout

- `RemoteFilePanel` 不再把 `transfers` 当作一级工具 tab。
- 文件工具内容使用网格分为：路径栏、文件操作栏、文件树、底部传输 dock。
- 传输 dock 默认只显示 38px 左右状态条。
- 点击展开后显示现有传输队列内容，作为文件面板底部抽屉。

## Component Boundary

- `RemoteFileTransferPanel` 继续由 `WorkspaceShell` 提供数据和操作回调。
- `RemoteFilePanel` 只负责把 `transferPanel` 渲染到文件 tab 底部，不理解传输业务。
- `RemoteFileTransferPanel` 内部负责折叠/展开的 UI 状态和任务行呈现。

## Visual Model

- 常态列表展示精简信息：文件类型图标、名称、方向、状态点、进度、大小、速度、状态和操作按钮。
- 运行态状态使用阶段感知文案，目录压缩/打包阶段显示“压缩中”，扫描阶段显示“扫描中”，传输阶段显示“上传中/下载中”。
- 失败态保留最后一次真实进度，使用红色状态和重试入口表达失败，不把进度条强行填满。
- 详情信息通过 `Tooltip` 展示：阶段、速度、远程路径、本地路径、错误。
- 使用现有 token：`--mx-panel`、`--mx-panel-soft`、`--mx-line`、`--mx-primary`、`--mx-danger` 等。
- 文件类型图标使用 Lucide/本地 SVG 风格，不使用上传下载箭头表达对象类型。

## Non-Goals

- 不新增传输功能。
- 不改变传输任务生命周期。
- 不改变后端命令、事件和设置项。
- 不做跨模块重构。
