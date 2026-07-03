# 统一终端和远程文件标签布局设计

## 范围和边界

本次改动只覆盖 SSH 工作区里的终端 tab 与远程文件编辑 tab。现有本地终端、RDP、VNC、右侧工具面板、远程文件读写命令保持原结构。

“当前会话”在实现中定义为当前 SSH connectionId 下的工作区布局状态。布局状态是运行时内存状态：用户通过拖拽切换后影响当前连接；重新打开会话时按设置默认值决定初始布局。

## 设置模型

在 `BasicSettings` 中新增远程文件打开方式：

```ts
type RemoteFileOpenMode = "split" | "unified";
remoteFileOpenMode: RemoteFileOpenMode;
```

默认值为 `"split"`，`normalizeSettings` 使用 `normalizeOneOf` 保证历史设置和异常值回落到默认值。设置页基础设置区新增一行，使用共享 `AppSelect`，选项展示为“上下分屏”和“统一 tab”。

## WorkspaceShell 状态

新增两类轻量状态：

- `terminalFileLayoutByConnectionId: Record<string, "split" | "unified">`
- `activeUnifiedTabByConnectionId: Record<string, { kind: "terminal" | "file"; id: string }>`

布局读取规则：

1. 如果当前连接有运行时布局状态，优先使用该状态。
2. 否则使用 `settings.basic.remoteFileOpenMode` 作为默认布局。
3. 没有远程文件 tab 时不显示编辑器区域；终端保持现有显示。

统一 tab 激活规则：

- 点击终端 tab：设置 `activeTabId`，记录 unified active 为 `{ kind: "terminal", id }`。
- 点击文件 tab：调用现有 `activateRemoteFileTab`，记录 unified active 为 `{ kind: "file", id }`。
- 打开远程文件：如果当前连接布局为 unified 或默认设置为 unified，则新文件成为 unified active file；split 模式保持现有分屏行为。
- 关闭 active 文件或终端后，沿用现有 fallback，再同步清理不存在的 unified active id。

## 渲染结构

split 模式保留现有结构：

- `remote-editor-pane`：远程文件 tab 栏 + 编辑器 stack
- `editor-terminal-resizer`
- `terminal-workbench-pane`：终端 tab 栏 + 终端 stack

unified 模式渲染单个顶部 tab 栏：

- 统一 tab 栏复用 `terminal-subtabs` / `subtab-shell` 样式，终端 tab 与文件 tab 放在同一 nav。
- 文件 tab 保留 dirty dot、关闭、复制路径等菜单动作。
- 终端 tab 保留关闭、关闭其他、关闭右侧、全部关闭等菜单动作。
- “新建同连接终端”、终端搜索、Command Sender、右侧面板开关仍在统一 tab 栏右侧 actions 区。
- 内容区同时挂载终端 stack 和编辑器 stack，按 active unified item 控制可见性，避免卸载 xterm 或 Monaco 实例。

## 拖拽切换

第一版使用 WorkspaceShell 内部鼠标拖拽状态做布局切换，不依赖原生 HTML drag/drop，不排序。

- 终端 tab / 文件 tab 在 `mousedown` 后记录 `{ kind, id, connectionId }` 和起始坐标；移动超过阈值后进入拖拽状态。
- split 模式下，文件 tab 拖到终端 tab 栏、终端 tab 拖到文件 tab 栏时，将对应 connectionId 的布局设为 `"unified"`，并激活被拖拽的 tab。
- unified 模式下，内容区显示上下两个临时 drop zone；把任意终端或文件 tab 拖入内容区后，将对应 connectionId 的布局设为 `"split"`，恢复文件上、终端下的上下分屏。
- unified 模式下，终端和文件 tab 右键菜单都提供“恢复上下分屏”作为非拖拽入口。
- tab 拖拽过程中鼠标保持普通箭头样式，不显示原生 drag/drop 禁用光标或 grab/grabbing 手型。
- unified 模式内拖拽不改变顺序；重复 drop 只保持当前布局状态。

## 性能和兼容性

- 不改终端 PTY、shell integration、xterm 写入链路和远程文件后端命令。
- 终端组件必须保持挂载，切换 tab 只改变 active/hidden 状态。
- `RemoteFileEditor` 仍通过现有 lazy import 加载，不能把 Monaco 静态引入首屏。
- CSS 只扩展现有 token 和 tab/workbench 类，不新增独立视觉体系。

## 回滚点

如果统一渲染影响终端稳定性，保留 split 分支可作为回退：删除 unified 状态和统一 tab 渲染，设置项默认仍可回退到 split。
