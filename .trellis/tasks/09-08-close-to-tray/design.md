# 关闭到系统托盘：技术设计

## 架构边界

- 前端设置层负责开关的持久化、迁移和设置页交互；沿用现有 MxtermSettings.basic、useSettings 和 localStorage，不另建 Rust 设置源，避免两个来源竞争。
- Rust/Tauri 是主窗口运行时的唯一关闭拦截点。标题栏继续请求普通关闭，让标题栏 X、操作系统关闭按钮和 Alt+F4 归入同一条 native close-requested 生命周期；前端不再注册异步关闭监听。
- Rust 层负责创建并持有系统托盘、菜单事件和显式退出。托盘句柄必须保存在进程状态中，不能在命令结束时被释放。
- VNC/RDP 独立运行窗口保持自己的关闭处理；native 主窗口策略仅匹配 `main` 标签。

## 设置与兼容性

1. BasicSettings 增加 closeWindowToTray 布尔字段。
2. defaultSettings.basic.closeWindowToTray 设为 true；normalizeSettings 对缺失或非法历史字段回退到此默认值。
3. 基础设置页使用既有 SettingsRow 和 SettingsToggle 增加说明性开关，不新增局部颜色或私有控件。
4. 开关关闭仅恢复关闭即退出语义；已创建的托盘会随进程退出释放，不为本次开关操作额外重置会话或断开连接。

## 关闭与恢复数据流

1. AppTitlebar 的关闭动作仍调用 currentWindow.close()。
2. Tauri Builder 启动时创建并持有托盘；托盘不可用时不开启隐藏行为，主窗口仍按普通关闭退出。
3. 主窗口的 native CloseRequested 读取受管运行时开关。开启时立即 prevent_close 并 hide；关闭时不阻止事件，保持真实退出语义。
4. WorkspaceShell 仅把持久化设置同步到 Rust 命令，不参与关闭竞态；终端、SSH、传输和后台服务仍保留在同一进程中。
5. 托盘左键、菜单“显示 MXterm”均走同一个原生恢复函数：show、unminimize、set_focus。
6. 菜单“退出 MXterm”直接从 Rust 应用句柄退出，绕过主窗口关闭拦截，确保是真实退出。

## 原生托盘设计

- 新增独立 tray 运行时模块或等价的受管状态；在 Tauri Builder 注册 TrayRuntimeState 和 set_close_to_tray_enabled 命令。
- 使用 Tauri 2 的原生托盘构建能力与应用包图标，创建一次后复用同一托盘句柄。若当前 Tauri feature 未包含托盘能力，按当前锁定版本补齐最小 Cargo feature。
- 系统菜单仅含“显示 MXterm”和“退出 MXterm”。左键单击恢复窗口；右键保留系统菜单。
- 托盘创建和窗口恢复均返回可观察的 Result；错误不得被吞掉。

## 错误与可访问性

- 托盘初始化失败时不启用隐藏行为并写入原生日志；窗口 hide/show/focus 失败返回结构化错误并写入原生日志，避免把失败伪装成已隐藏或让前端弹窗锁住主界面。
- 该设置继续使用共享 token 和 SettingsToggle，亮色、暗色、system-dark 不增加单独视觉分支。

## 权衡与回滚

- 选择启动时创建托盘：关闭事件不需要等待异步前端命令，避免 close-requested 竞态和按钮失活；托盘句柄在进程状态中持续到显式退出。
- 默认开启会让缺失字段的历史配置改为关闭到托盘，这是本需求明确选择的产品默认值；用户可在设置关闭。
- 若托盘在某个平台不可用，命令报错并保持窗口可见，不以隐藏窗口伪装成功。
- 回滚只需移除设置字段、native 关闭处理和托盘模块；不会迁移或破坏连接数据。
