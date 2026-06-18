# 本地终端 PTY 开源实现调研

## 结论

推荐本地终端首版在 mXterm 后端新增自有 `LocalTerminalManager` / `LocalTerminalSession`，底层优先使用 `portable-pty`，前端复用现有 xterm.js 渲染和 `terminal:*` 风格事件。不要直接引入 `node-pty`，也不建议首版直接采用 `tauri-plugin-pty` 作为外部插件边界。

理由：

- `portable-pty` 是 WezTerm 作者维护的 Rust 跨平台 PTY 抽象，许可证 MIT，当前默认版本 `0.9.0`，crates.io 显示累计下载量较高，且 Windows 原生后端是 ConPTY。
- mXterm 当前运行时红线是核心能力由 Rust/Tauri 承载，不使用 Node/Express 本地后端；`node-pty` 成熟但属于 Node/Electron 路线，不适合直接进入本项目运行时。
- `tauri-plugin-pty` 自身也依赖 `portable-pty`，但 README 标注仍在 developing，Rust 代码以 `spawn/read/write/resize/kill/exitstatus` command 为主，需要前端主动 `read`，错误类型是字符串，和 mXterm 当前 `AppError` + 后端主动 event 推送的模式不一致。
- Windows ConPTY 官方文档强调输入、输出通信管道应由独立线程/任务持续服务，避免同步 I/O 死锁；这更适合在 mXterm 后端封装成项目内 manager，而不是把细节散到前端轮询。

## 调研对象

### WezTerm / portable-pty

来源：

- <https://crates.io/api/v1/crates/portable-pty>
- <https://docs.rs/portable-pty/latest/portable_pty/>
- <https://raw.githubusercontent.com/wezterm/wezterm/main/pty/src/lib.rs>
- <https://raw.githubusercontent.com/wezterm/wezterm/main/pty/src/cmdbuilder.rs>
- <https://raw.githubusercontent.com/wezterm/wezterm/main/pty/src/win/conpty.rs>

关键信息：

- crate 描述为 `Cross platform pty interface`，许可证 MIT，repository 指向 WezTerm。
- `native_pty_system()` 在 Windows 上返回 `win::conpty::ConPtySystem`，Unix 上返回 `UnixPtySystem`。
- 核心 API：
  - `PtySystem::openpty(PtySize) -> PtyPair`
  - `SlavePty::spawn_command(CommandBuilder) -> Child`
  - `MasterPty::try_clone_reader()`
  - `MasterPty::take_writer()`
  - `MasterPty::resize(PtySize)`
  - `Child::try_wait()` / `wait()` / `process_id()`
  - `ChildKiller::kill()`
- `PtySize` 包含 `rows`、`cols`、`pixel_width`、`pixel_height`，mXterm 首版可先传 0 像素尺寸，与现有 SSH resize 的 cols/rows 保持一致。
- `CommandBuilder` 会读取基础环境变量。Windows 逻辑会合并系统和用户环境变量，默认程序来自 `ComSpec`，回退 `cmd.exe`。
- 如果使用 `CommandBuilder::new_default_prog()`，Windows 默认不是 PowerShell，而是 `ComSpec`。如果产品希望默认 PowerShell，需要 mXterm 自己解析 shell profile。

适配建议：

- 直接依赖 `portable-pty = "0.9"`，在 `src-tauri/src/terminal/` 下新增 local 模块。
- 不复用 SSH 的 `TerminalSession`，而是抽象共同的 manager 行为：connect/open、write、resize、close、reader task、state event。
- 本地 PTY 输出是原始 bytes，前端可以沿用 `TerminalOutputEvent.data: number[]`。首版不要引入本地编码下拉，先按 UTF-8/VT 序列流处理；Windows 控制台程序经 ConPTY 输出 VT/UTF-8 序列是主流路径。
- reader 需要在 Rust 后端持续读取并 emit event，避免前端轮询。
- child 退出后应清理 session store，并发送 state changed event，包含 exit code。

### Windows Terminal / ConPTY

来源：

- <https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session>
- <https://api.github.com/repos/microsoft/terminal/contents/samples/ConPTY>

关键信息：

- ConPTY 是 Windows 提供的 pseudo console 机制，用于让外部 host 承载字符模式程序的交互。
- 宿主需要先创建输入/输出通信管道，再创建 pseudoconsole，再通过扩展启动信息创建子进程。
- 官方文档明确提示：为了避免竞态和死锁，输入和输出通信管道建议分别由独立线程服务。
- resize 通过 `ResizePseudoConsole` 同步字符行列。
- 关闭 pseudoconsole 会终止附着的客户端程序；Shell 型应用产生的相关子进程也会受影响。

适配建议：

- 不直接手写 ConPTY，除非 `portable-pty` 无法满足需求。
- 本地终端 close 应向用户表达为“关闭本地终端会结束该 Shell 及其子进程树”，首版不用自动恢复。
- reader/write/resize/kill 需要在后端有清晰生命周期，不能只依赖前端卸载。

### node-pty

来源：

- <https://raw.githubusercontent.com/microsoft/node-pty/main/README.md>

关键信息：

- `node-pty` 是成熟 Node.js PTY 库，支持 Linux、macOS、Windows，Windows 1809+ 使用 ConPTY。
- README 示例是 `spawn(shell, [], { name, cols, rows, cwd, env })`，通过 `onData`、`write`、`resize` 完成交互闭环。
- 真实使用者包括 VS Code、Hyper、Theia、electerm 等。
- 安全提示：启动的进程拥有父进程同等权限；如果暴露给网络服务，需要隔离。
- README 明确 Node.js/Electron 版本依赖和 Windows C++ build tool 依赖。

适配建议：

- 不作为 mXterm 运行时依赖。
- 可以借鉴 API 形状：`spawn` 参数应包含 shell、args、cols、rows、cwd、env。
- 可以借鉴安全边界：本地终端执行权限等同 mXterm 进程权限，UI 和文档不要暗示沙箱隔离。

### Tabby

来源：

- <https://raw.githubusercontent.com/Eugeny/tabby/master/README.md>

关键信息：

- Tabby 是跨平台终端、SSH 和串口客户端，支持 Windows、macOS、Linux。
- README 提到本地终端支持 PowerShell、PowerShell Core、WSL、Git-Bash、Cygwin、MSYS2、Cmder、CMD。
- 产品能力包括自定义 shell profiles、tab、split panes、主题、快捷键、快速输出处理、bracketed paste、多行粘贴警告等。
- Tabby 明确“不是一个新 shell，也不是 MinGW/Cygwin 替代品”，只是终端宿主。

适配建议：

- mXterm 首版不要追 Tabby 的完整 profile 体系，可以先提供一个“本地终端”默认入口，再扩展 profile。
- UI 文案应把本地终端定位为“打开本机 Shell”，不是创建新的 shell 环境。
- 后续可扩展 profile：PowerShell、cmd、Git Bash、WSL、自定义可执行文件。

### tauri-plugin-pty

来源：

- <https://crates.io/api/v1/crates/tauri-plugin-pty>
- <https://crates.io/api/v1/crates/tauri-plugin-pty/0.3.0/readme>
- <https://crates.io/api/v1/crates/tauri-plugin-pty/0.3.0/dependencies>
- <https://raw.githubusercontent.com/Tnze/tauri-plugin-pty/main/src/lib.rs>

关键信息：

- crate 描述为 Tauri PTY plugin，许可证 MIT，最新 `0.3.0`，依赖 `portable-pty ^0.9.0`。
- README 标注 `Developing! Wellcome to contribute!`。
- 暴露 command：`spawn`、`write`、`read`、`resize`、`kill`、`exitstatus`。
- `spawn` 创建 `portable_pty::native_pty_system()`，打开 PTY，生成 writer/reader，使用 `CommandBuilder::new(file)` 和 args/cwd/env 启动。
- `read` 是 command，同步读取 4096 bytes 后返回；这意味着前端或插件 JS 需要循环读取，而不是 Rust 后端主动通过 Tauri event 推送。
- `term_name`、`encoding`、flow control 参数目前在 Rust 里 TODO 未支持。

适配建议：

- 作为实现参考，不建议直接作为产品依赖。
- mXterm 已有 `AppError`、事件命名、终端 warmup output、tab 生命周期、连接步骤状态，直接使用插件会产生两套接口。
- 可以借鉴它的最小实现：`PtyPair`、reader/writer、child killer、resize 的组织。

### alacritty_terminal

来源：

- <https://crates.io/api/v1/crates/alacritty_terminal>

关键信息：

- crate 描述为 `Library for writing terminal emulators`，许可证 Apache-2.0，代码量和职责都明显更偏“终端模拟器内核”。
- mXterm 已经使用 xterm.js 负责终端渲染和 VT 解析，不需要再引入另一个终端 emulator 内核。

适配建议：

- 不用于本地 PTY 首版。

## 对 mXterm 的架构建议

### 后端

- 新增本地 PTY 会话模型，不要把 SSH 连接字段塞进本地终端请求。
- 建议命令：
  - `local_terminal_open`
  - `local_terminal_write`
  - `local_terminal_resize`
  - `local_terminal_close`
- 建议事件：
  - 复用 `terminal:output` / `terminal:state_changed`，但 payload 增加 `kind: "ssh" | "local"`；或新增 `local_terminal:*`。为了减少前端分叉，推荐前者，但需要评估现有监听匹配逻辑。
- local session store 中保存：
  - session id
  - child
  - writer
  - reader task / close token
  - shell profile 信息
  - cwd
- reader task 使用 blocking read 时需要放入 `spawn_blocking` 或独立线程，避免堵住 tokio runtime。
- close 时调用 child killer，并从 session store 移除，发送 closed state。

### 前端

- 将 `TerminalPanel` 改造成仅负责渲染和终端 I/O，不直接决定 SSH/local 后端。
- 将 `TerminalTab` 从强绑定 `connectionId` 改为支持：
  - `kind: "ssh" | "local"`
  - SSH tab 继续有 `connectionId`
  - Local tab 有 `profileId`、`cwd`、`shell`
- 本地终端不应启用右侧远程文件/监控面板，除非后续单独设计本地文件联动。
- 本地终端首版可以放在首页或标题栏/终端区的新增菜单中，避免混进 SSH 连接树。

### 产品范围建议

首版推荐：

- 一个“新建本地终端”入口。
- 默认打开 PowerShell 7，如果系统没有 `pwsh.exe`，回退 Windows PowerShell，再回退 `cmd.exe`。
- 支持关闭、输入输出、resize、断开状态、保留历史输出。
- 支持从设置中选择默认本地 Shell 可以作为二期；首版可先只做自动探测和打开。

首版不推荐：

- 本地终端 profile 管理。
- WSL/Git Bash/Cygwin/MSYS2 自动发现。
- 自定义启动命令、环境变量编辑器。
- 本地文件管理联动。
- 会话恢复、自动重连、命令审计。

## 风险

- Windows Shell 默认选择会影响用户第一印象。`portable-pty` 默认走 `ComSpec`，通常是 `cmd.exe`；如果产品希望现代体验，需要 mXterm 自己选择 `pwsh.exe` / `powershell.exe`。
- 本地终端拥有 mXterm 进程同等权限，不能把它设计成安全沙箱。
- 关闭终端会终止 Shell 及其子进程，长任务可能丢失；需要明确关闭确认策略。
- 本地 PTY 输出读取如果放在 async runtime 上阻塞，可能影响其他后台任务；需要使用 blocking task/thread。
