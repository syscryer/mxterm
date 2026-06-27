# 启动速度优化设计

## 范围

本轮只处理前端启动路径和首屏模块图。保留现有 Tauri 窗口隐藏、记忆窗口恢复、启动主题预应用策略，不改底层终端会话生命周期。

## 技术方案

1. 入口按视图拆分
   - `App` 不再静态导入 `WorkspaceShell` 和 `VncRunnerWindowApp`。
   - 根据 URL `view` 参数动态加载目标应用组件，避免主窗口启动解析 VNC runner，避免 VNC runner 解析完整工作区。
   - `main.tsx` 只等待窗口状态恢复和轻量 `App` 壳加载；真实视图由 `App` 内部 `React.lazy` 加载，减少 release 启动时窗口显示前的等待。

2. 工作区重面板按需加载
   - 将设置页、连接弹窗、快速连接搜索、Docker 面板、远程文件面板、VNC 视图、监控/隧道/命令库等从 `WorkspaceShell` 顶层静态 import 改为 `React.lazy`。
   - 首屏可能立即显示的 fallback 使用现有全局样式和轻量 DOM，不引入新视觉体系。
   - `TerminalPanel` 也拆为 lazy chunk；SSH/本地终端渲染点用现有状态面板做 fallback，保持 warmup output handoff、resize 和会话状态逻辑在 `TerminalPanel` 内部。

3. 空闲预热
   - 保留终端配色完整数据的延后加载。
   - 如发现预热仍过早，改为首帧后再安排 idle task，避免与首屏连接列表和布局初始化竞争。

## 风险控制

- 动态加载只发生在组件边界，不改变业务状态模型。
- 保持工作区模式切换时现有组件 mounted/hidden 语义；仅让初次进入某个功能时加载代码。
- 修改后用 typecheck 和 production build 验证模块拆分。
- 新增 `scripts/check-startup-module-boundary-source.mjs` 守住入口和重模块边界，避免后续静态 import 回流到启动路径。
