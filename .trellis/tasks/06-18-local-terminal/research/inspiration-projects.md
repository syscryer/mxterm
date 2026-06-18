# 本地终端可借鉴项目对照

## 总体结论

mXterm 的本地终端不应该只参考一个项目。推荐采用组合借鉴：

- **Windows Terminal**：借鉴 profile 数据模型、动态 profile、默认 profile、隐藏 profile、启动目录等配置结构。
- **VS Code Integrated Terminal**：借鉴跨平台 profile 探测策略、`path/source/args/env` 的 profile 形态、默认 profile 选择、unsafe path 提醒。
- **WezTerm**：借鉴 Rust PTY 抽象、启动程序/cwd/env 语义、launcher menu、从当前 pane 继承 cwd 的思路。
- **Tabby**：借鉴“本地终端 + SSH + 串口 + profile + 快捷入口”的产品范围，但不要照搬插件市场和过重设置。
- **WindTerm / electerm**：借鉴“终端、SSH、SFTP、文件管理在一个工作区里协同”的产品定位，以及本地 Shell 与远程会话并列的会话管理。WindTerm 官方 README 明确把 Shell 作为 SSH/Telnet/Serial/SFTP 同级协议，并列出 Windows Cmd、PowerShell、管理员 PowerShell，以及 Linux/macOS bash、zsh、PowerShell Core。
- **Alacritty / Ghostty**：借鉴终端配置边界，尤其是 shell、working directory、env、scrollback、字体和跨平台配置；但 mXterm 已用 xterm.js，不需要借鉴它们的渲染内核。

技术实现上，后端 PTY 继续以 `portable-pty` 为主线；产品模型更接近 Windows Terminal + VS Code，而不是 node-pty/Electron 体系。

## 项目对照

| 项目 | 可借鉴点 | 不适合照搬点 | 对 mXterm 的建议 |
| --- | --- | --- | --- |
| Windows Terminal | profile list/defaults、dynamic profiles、defaultProfile、hidden、commandline、startingDirectory、icon、tabTitle、elevate | 完整 JSON 配置暴露、Windows 专属字段、管理员窗口隔离机制 | 本地终端 profile 模型应包含 `name`、`command`、`args`、`cwd`、`env`、`icon`、`hidden`、`source`、`isDefault` |
| VS Code Integrated Terminal | 自动发现 Windows/Unix profiles、`path` 或 `source` 二选一、默认 profile、custom profile、unsafe path、WSL 探测、env 支持变量解析 | 任务/调试 automation profile、VS Code 工作区变量体系、过多 IDE 联动 | 重点借鉴 profile detection：Windows 检测 PowerShell/Git Bash/cmd/MSYS2/Cygwin/Cmder/WSL，Unix 读取 `/etc/shells` |
| WezTerm | `portable-pty`、default program、launcher menu、cwd/env 语义、从当前 pane 的 OSC 7/cwd 派生新 tab cwd | Lua 配置、mux/domain 体系、GPU 渲染、复杂 pane/window 模型 | 底层用 `portable-pty`，新建本地终端可支持“继承当前终端目录”作为后续能力 |
| Tabby | 本地终端、SSH、串口同属 profile/session 体系；支持 PowerShell、PS Core、WSL、Git Bash、Cygwin、MSYS2、Cmder、CMD；自定义 shell profiles | Electron/Angular 架构、插件市场、过多协议、加密容器等大范围能力 | 借鉴 profile 覆盖范围和新建终端 dropdown，不照搬重平台 |
| WindTerm | Shell/SSH/Telnet/Serial/SFTP 并列；本地 Shell、远程 Shell、SFTP、Explorer、同步输入、快速命令；明确支持 Windows Cmd、PowerShell、管理员 PowerShell，以及 Linux/macOS bash、zsh、PowerShell Core；高性能和会话恢复意识 | 部分开源、能力范围很大，管理员模式、同步输入、命令发送器、会话恢复等很多功能超出 mXterm 首版 | 借鉴“本地 Shell 是一等会话类型”和跨平台 Shell 覆盖范围；右侧远程工具只对 SSH 会话启用，管理员模式后续单独设计 |
| electerm | 终端、SSH/SFTP/FTP/Telnet/Serial/RDP/VNC 多协议客户端；quick commands、全局/session proxy、主题、AI 助手 | 范围过宽、Electron/Node 技术栈、很多协议不在 mXterm 目标内 | 只借鉴“连接管理 + 终端 + 文件管理”的产品整合，不扩协议 |
| Alacritty | 跨平台、高性能、配置清晰；`terminal.shell`、`working_directory`、`env`、scrollback、字体、颜色边界 | 无 tabs/splits，主张交给窗口管理器/tmux；渲染内核不需要 | 借鉴配置字段的克制程度，不借鉴“不要内置 tab”的产品哲学 |
| Ghostty | 现代终端配置边界非常完整，字体、cell、cursor、clipboard、working shell 等大量细节可作长期参考 | 配置项太细，首版照搬会拖慢实现 | 可作为后续终端高级设置参考，首版只取 profile 相关字段 |

## 借鉴细节

### 1. Profile 模型

Windows Terminal 与 VS Code 都证明 profile 应是“可启动命令配置”，不是单纯 shell 名称。

建议 mXterm 的 `LocalTerminalProfile` 首版包含：

- `id`
- `name`
- `platform`: `windows` / `macos` / `linux` / `all`
- `source`: `builtin` / `detected` / `custom`
- `kind`: `powershell` / `cmd` / `wsl` / `git_bash` / `msys2` / `cygwin` / `cmder` / `unix_shell` / `custom`
- `command`
- `args`
- `cwd`
- `env`
- `icon`
- `hidden`
- `isDefault`
- `detected`
- `unsafePath`
- `createdAt`
- `updatedAt`

字段说明：

- `source` 用于区分系统自动发现和用户自定义。
- `kind` 用于 UI 图标、默认排序和说明。
- `hidden` 借鉴 Windows Terminal，可隐藏自动发现但不删除。
- `unsafePath` 借鉴 VS Code，用于 Cygwin/MSYS2/Cmder 等默认可被其他用户写入的位置提示。
- `cwd` 初期可支持固定启动目录；后续支持从当前终端目录继承。
- `env` 首版可以是简单键值表，后续再做变量引用和删除变量。

### 2. 自动发现范围

推荐首版分平台定义自动发现器，而不是把路径写死在 UI。

Windows 推荐顺序：

1. PowerShell 7：`pwsh.exe` 或已安装路径。
2. Windows PowerShell：`System32\WindowsPowerShell\v1.0\powershell.exe`。
3. Command Prompt：`System32\cmd.exe`。
4. WSL：`wsl.exe -l -q` 枚举发行版，为每个发行版生成 profile。
5. Git Bash：PATH 中的 `git.exe` 推导安装目录，并检查常见安装路径。
6. MSYS2：常见 `C:\msys64\usr\bin\bash.exe`，带 `--login -i` 和 `CHERE_INVOKING=1`。
7. Cygwin：常见 `C:\cygwin64\bin\bash.exe` / `C:\cygwin\bin\bash.exe`。
8. Cmder：`CMDER_ROOT` 或常见路径下的 init 脚本。
9. 管理员 Cmd / PowerShell：参考 WindTerm 和 Windows Terminal 的 elevated profile 思路，但首版只在模型中保留能力边界，不直接实现提权启动。

macOS / Linux 推荐：

1. 读取用户登录 shell 或 `$SHELL`。
2. 读取 `/etc/shells`，生成 zsh、bash、fish 等可用 profile。
3. 检查 PowerShell Core `pwsh` 是否在 PATH。
4. 用户自定义 profile。

注意：

- 不可用 profile 不显示。
- 自动发现 profile 不能覆盖用户修改后的同名自定义 profile。
- Windows 的 WSL 输出编码需要注意；VS Code 使用 `utf16le` 处理 `wsl.exe -l -q`，实现时需要真实验证。

### 3. 默认 profile

推荐借鉴 Windows Terminal/VS Code：

- 首次启动自动选择“当前平台推荐默认 profile”。
- Windows 推荐 PowerShell 7，其次 Windows PowerShell，再次 cmd。
- macOS/Linux 推荐登录 shell 或 `$SHELL`。
- 设置页允许用户改默认 profile。
- 新建本地终端按钮左键打开默认 profile，右侧下拉选择其他 profile。

### 4. 入口设计

可借鉴 WezTerm/Windows Terminal/VS Code 的新建终端 dropdown：

- 主工作区空状态提供“新建本地终端”快捷入口。
- 终端 tab 区的 `+` 按钮默认新建当前上下文终端。
- `+` 旁边提供菜单，列出本地 profile 和 SSH 新建入口。
- 左侧连接树继续只放 SSH 连接，不把本地 profile 混进服务器分组，避免心智混乱。
- 设置页新增“本地终端”分类，用于管理 profile 和默认 profile。

### 5. 会话模型

参考 WindTerm/Tabby/electerm，本地 Shell 应是一等会话，但不要启用 SSH 专属工具：

- SSH terminal tab：绑定 `connectionId`，可显示右侧远程文件、监控、传输。
- Local terminal tab：绑定 `profileId`，不显示远程文件和远程监控。
- 二者共享终端渲染、输入、输出、resize、关闭、断开历史保留。
- 终端 tab 类型建议从现在的 `connecting | terminal` 扩展为：
  - `ssh_connecting`
  - `ssh_terminal`
  - `local_terminal`
  - `local_failed` 或统一 error state

### 6. 设置边界

Alacritty/Ghostty 的配置很细，但 mXterm 首版应保持可维护：

首版 profile 表单建议只做：

- 名称
- 命令路径
- 参数
- 启动目录
- 环境变量
- 是否默认
- 是否隐藏

后续再做：

- 终端 profile 专属配色
- profile 专属字体
- 启动时恢复上次本地终端
- 继承当前终端目录
- 快捷键绑定到特定 profile
- 管理员模式
- unsafe path 强确认

## 不建议借鉴或暂缓

- 不借鉴 node-pty 作为运行时依赖。
- 不借鉴 Alacritty “没有 tab/split”的产品取舍；mXterm 已经是多会话工作区。
- 不借鉴 WindTerm/electerm 的协议大扩张；RDP/VNC/Telnet/Serial 暂不进入本地终端任务。
- 不首版做 Tabby 插件市场、quick commands、sync config、AI terminal assistant。
- 不首版实现管理员模式。Windows Terminal 的 elevated profile 涉及窗口隔离和权限边界，后续单独设计。

## 推荐用于 mXterm 的组合方案

1. **产品心智**：WindTerm / electerm / Tabby
   本地终端与 SSH 终端同为会话，但 SSH 才有远程文件和监控。

2. **Profile 模型**：Windows Terminal + VS Code
   自动发现 profile、默认 profile、隐藏 profile、自定义 profile、启动目录、参数、环境变量。

3. **PTY 后端**：WezTerm 的 `portable-pty`
   Rust 内部封装，不引入 Node 运行时。

4. **终端配置边界**：Alacritty / Ghostty
   终端设置保持清晰，首版只放 profile 必需项，高级显示细节逐步打磨。

## 对 PRD 的建议调整

- 明确本地终端是“本地 profile + 会话”体系，而不是 SSH 连接的一种。
- 明确本地 profile 不进入左侧 SSH 连接树，入口放在首页/终端区新建菜单/设置页。
- 明确 Windows 首版自动发现 PowerShell 7、Windows PowerShell、cmd、WSL、Git Bash、MSYS2、Cygwin、Cmder；管理员 Cmd/PowerShell 先作为后续扩展；macOS/Linux 模型覆盖 bash、zsh、fish、PowerShell Core 和用户自定义 profile。
- 明确右侧远程文件和监控只绑定 SSH 会话，本地终端暂不显示这些工具。
