# 终端完整分屏设计

## State Model

分屏是终端子 Tab 的一种内容类型，不再使用“只要存在布局就接管整个工作区”的全局模式。

```text
TerminalSplitGroup
├── host：SSH 连接工作区或本地终端工作区
├── anchorIndex：分屏组在原子 Tab 行中的位置
├── layout：TerminalSplitNode
├── focusedPaneId
└── active：当前是否选中分屏组 Tab
```

底层会话仍保存在现有 `terminalTabs` / `localTerminalTabs` 中。分屏布局只保存 binding；子 Tab 渲染时过滤已经属于分屏组的 binding，组外会话继续正常显示。

## Layout Model

继续使用 `TerminalSplitNode` 二叉布局树：

```text
leaf(paneId, binding?)
split(id, direction=row|column, ratio, first, second)
```

- pane 几何收集结果按 `top`、`left` 排序，保证行优先编号和键盘顺序。
- 四分屏重建标准 2×2 树时按行优先保留已有 binding，不清空已有分配。
- 比例仍限制在父节点范围内，同时渲染层根据容器像素和最终叶子尺寸限制拖拽。

## Stable Terminal Host

SSH 与本地终端必须进入同一个稳定 terminal stack。所有 `TerminalPanel` 按会话只挂载一次：

- 普通 Tab 激活时，目标面板占满 stack。
- 分屏组激活时，成员面板使用 pane bounds 绝对定位。
- 隐藏视图只改变 `visible`、样式和焦点，不卸载组件。
- pane 聚焦只更新终端上下文，不改变分屏组宿主工作区。

## Tab Behavior

- 初次分屏记录源 Tab 在当前子 Tab 行的位置，并显示合成的分屏组 Tab。
- 分屏成员从普通子 Tab 行过滤，但会话对象与运行实例保留。
- 普通 Tab 点击会把分屏组设为非活动；分屏组点击恢复布局。
- 外部导航命中一个分屏成员时，激活分屏组并聚焦对应 pane。
- `+` 仍调用现有新建逻辑，因此编号由原有 tab index 规则继续维护。

## Pane Operations

pane header 使用会话选择器和紧凑图标操作：

- 搜索：复用现有 `terminalSearchByTabId`。
- 清屏：通过 `TerminalPanel` 的受控 clear request 调用 xterm clear，只清理当前 pane。
- 关闭：关闭对应运行会话并移除 pane。
- 空 pane：紧凑选择器位于 pane 标题栏；需要手动选择时通过受控 open request 自动展开。
- 布局菜单保存会话期内的“同会话”开关，默认开启。开启时根据源 binding 新建同连接或同 profile 终端并直接绑定；关闭时创建空 pane，并通过受控 open request 展开标题栏选择器。
- pane 选择器过滤已经被其他 pane 占用的 binding，只保留当前 pane 自己的 binding 和未占用会话。
- pane 选择器额外列出没有运行终端 Tab 的已保存 SSH 连接。选择后先创建 connecting tab 并绑定目标 pane，再运行现有 `ConnectionStepPanel` 流程；创建过程不得修改分屏宿主、活动连接或工作区模式。
- pane 选择器启用共享 `AppSelect` 的可选搜索能力，通过 option `searchText` 汇总连接名称、用户名、主机、端口和终端标题；搜索输入位于浮层顶部并保留键盘选择行为。

不提供解散、移出或批量转 Tab。

## Group Operations

分屏组右侧工具区只保留：

- 布局菜单：向右、向下、四分屏。
- 同步输入：开启/关闭，并选择参与同步的 pane。
- 均分：把当前布局树所有 ratio 恢复为 0.5。
- 右侧工具面板开关等原有工作区操作继续保留。

关闭分屏组使用 Tab 自身关闭按钮，多会话时复用共享 `ConfirmDialog`。

## Synchronized Input

`TerminalPanel` 在用户 `onData` 时通知父层，但仍只负责写入自己的 session。父层在同步开启时把同一份数据写入其它参与 pane 的 session：

- 排除当前主输入 pane。
- 排除无 session、断开或未选中的 pane。
- UI 快捷键在进入 xterm `onData` 前已经被应用层处理，因此不会广播。
- 任一目标写入失败时关闭同步并显示可见错误状态，不能静默失败。
- 离开分屏组、布局退化或目标不足两个时自动关闭。

## Visual System

- pane header、空状态、焦点、同步状态、分隔线全部使用 `--mx-panel`、`--mx-panel-soft`、`--mx-line`、`--mx-text`、`--mx-muted`、`--mx-primary`、`--mx-active` 等 token。
- 不使用孤立硬编码浅色、黑线、渐变或阴影。
- pane 不是卡片，不增加外层圆角和浮动阴影；使用细分隔线和轻量 header 状态表达层级。
- 当前 pane 使用 token 化 header 强调和细焦点线；同步参与状态同时包含文字/图标，不只依赖颜色。
- AppSelect 和浮层继续使用共享 portal、玻璃 token 与键盘导航。

## Compatibility

- Command Sender、AI 选区、目录跟踪和搜索上下文跟随 focused binding。
- 远程文件上下分屏与统一标签模式保持原行为。
- RDP / VNC 不进入终端分屏。
- 不新增首屏静态重模块。
