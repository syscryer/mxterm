# Command Sender MVP implementation

## Goal

Implement the approved Command Sender MVP in the real React/Tauri app. Keep Sync Input as later work.

## Requirements

- 在真实 React/Tauri 应用中实现已确认的 Command Sender MVP，不再停留在 HTML 原型。
- Command Sender 入口放在 SSH 子 tab 工具条右侧，使用紧凑图标按钮；不使用大号常驻按钮。
- 点击入口后从当前终端区域底部打开命令操作台抽屉；默认关闭，不常驻占用终端高度。
- 面板布局参考 `prototype/light-neutral/mxterm-empty-session.html`：顶部工具栏、左侧目标列表、右侧命令编辑区、底部发送动作。
- 目标列表来自当前已连接 SSH 会话和其子 tab；默认选中每个会话的当前活跃子 tab，而不是固定第一个 tab。
- 多子 tab 会话在目标行内提供子 tab 切换。
- 目标区域支持全选、取消全选、部分选中状态。
- 命令编辑区支持命令输入、最近命令下拉、追加回车选项、发送并回车、发送不回车、清空。
- 点击发送后调用现有终端输入写入链路，将命令写入选中目标终端的输入流。
- 发送状态只表示“命令已写入目标终端输入流”，不判断远端命令执行是否成功。
- 目标行展示投递状态：未发送、已写入、失败；点击状态可切换到对应会话/子 tab 查看终端输出。
- 检测高风险片段并在面板内提示，但本轮不做强制拦截、审批或权限系统。
- Sync Input 本轮不做真实输入镜像，只保留现有弱化入口或后续提示。

## Acceptance Criteria

- [ ] 子 tab 工具条右侧出现 Command Sender 图标入口，默认不打开面板。
- [ ] 点击入口可打开底部命令操作台，点击关闭可收起。
- [ ] 面板目标列表正确展示已连接 SSH 会话和当前目标子 tab。
- [ ] 多子 tab 会话可在目标行切换投递子 tab。
- [ ] 全选、取消全选、半选状态和已选数量正确。
- [ ] 发送按钮在没有目标或命令为空时禁用。
- [ ] 发送并回车会写入命令加回车，发送不回车只写入命令文本。
- [ ] 发送后目标行投递状态更新，失败目标显示失败状态。
- [ ] 点击投递状态可切换到对应会话/子 tab。
- [ ] 最近命令下拉可回填命令输入。
- [ ] 高风险命令片段出现提示。
- [ ] Command Sender 面板连续发送后不自动关闭。
- [ ] Sync Input 不接入真实实时输入镜像。
- [ ] 相关源码检查、类型检查或可用测试通过；如未运行完整编译，需要说明原因。

## Notes

- 原型参考：`prototype/light-neutral/mxterm-empty-session.html`。
- 已确认 UX：Command Sender 是一次或连续投递命令的批量发送工具；Sync Input 是后续实时键盘输入镜像能力，不混入本轮 MVP。
