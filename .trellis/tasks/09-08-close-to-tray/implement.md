# 关闭到系统托盘：实施计划

## 范围与分拆判断

这是一个前端设置、主窗口生命周期和 Tauri 原生托盘共同构成的单一可验收功能，三个层面不能独立交付，因此不拆分子任务。

## 实施步骤

1. 进入实现前运行 trellis-before-dev，读取当前前端、Rust/Tauri 和共享 UI 规范；重新检查工作树，避开用户已有改动。
2. 扩展 settingsTypes、启动设置归一化和已有设置测试/静态检查：新增 closeWindowToTray，默认 true，并验证缺失字段迁移。
3. 在 SettingsView 的基础设置中接入共享设置行和开关；不新增局部 CSS，也不新增会阻塞窗口交互的模态错误提示。
4. 在 Rust 后端新增受管托盘运行时、显示窗口辅助函数和 set_close_to_tray_enabled 命令；启动时创建托盘，注册主窗口 native close-requested 处理器，并补齐最小依赖 feature。
5. 在 WorkspaceShell 仅同步实时设置到 Rust；不再接入前端 close-requested 监听、异步隐藏或模态错误弹窗。
6. 保持 AppTitlebar 只发起普通 close 动作；确认 VNC/RDP 运行窗口的关闭监听不受影响。
7. 补充 Rust 状态/命令契约测试或等价静态检查，覆盖设置默认值/归一化、native 关闭拦截、托盘命令注册、菜单显示/退出路径和标题栏统一关闭入口。

## 验证

- npm run check
- node scripts/check-close-to-tray-source.mjs
- npm run build
- node scripts/check-startup-module-boundary-source.mjs
- cargo check --manifest-path src-tauri/Cargo.toml
- git diff --check
- 在桌面开发版人工验证：默认开启时关闭按钮与 Alt+F4 隐藏窗口且终端保持；左键和菜单显示可恢复窗口；菜单退出真实结束进程；关闭开关后关闭主窗口真实退出；VNC/RDP 子窗口语义不变。

## 风险点

- Tauri tray feature、菜单事件 API 与当前锁定版本必须以本地 Cargo 编译结果为准。
- close-requested 是异步边界，必须在等待原生命令之前阻止默认关闭，并防止重复请求。
- 隐藏失败和托盘创建失败必须可见且可恢复，不能吞错或导致窗口消失。
- 不应停止当前桌面开发版或清理其他任务遗留的未跟踪文件。

## 开始实现前检查

- [x] 产品默认值、右键菜单和左键恢复交互已确认。
- [x] PRD、技术设计与实施计划已完成。
- [x] 用户审阅规划并明确同意开始实现。
