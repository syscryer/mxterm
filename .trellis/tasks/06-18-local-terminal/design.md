# 本地终端设计

## 目标

在现有 mXterm SSH 终端体系旁边，增加完整的本地终端能力：

- 顶栏固定“本地终端”一级入口
- 工作区内部支持多个本地终端子 tab
- 支持跨平台 profile 探测和用户自定义 profile
- 复用现有 `TerminalPanel`、终端主题、输入输出与 resize 体验
- 不把本地终端混入左侧 SSH 连接树

## 总体方案

### 后端

后端新增本地终端能力，但不新增 Node/Electron 依赖，继续走 Rust/Tauri 路线：

- 引入 `portable-pty`
- 在 `src-tauri/src/terminal/` 下新增本地 PTY 会话实现
- `TerminalManager` 升级为统一管理两类会话：
  - SSH 会话
  - Local PTY 会话
- 继续复用现有事件：
  - `terminal:output`
  - `terminal:state_changed`
- 新增本地终端相关命令：
  - `local_terminal_list_profiles`
  - `local_terminal_open`
- 继续复用现有通用命令：
  - `terminal_write`
  - `terminal_resize`
  - `terminal_close`

原因：

- 这样 `TerminalPanel` 不需要分裂成 SSH/local 两套输入输出逻辑
- 会话只要拿到 `session_id`，后续写入、resize、关闭都统一走现有终端命令
- 事件层继续只有一套，前端状态机更稳

### 前端

前端新增一个“本地终端工作区”，与首页、SSH 工作区并列：

- 顶栏固定入口：
  - 首页
  - 本地终端
  - 各个 SSH 会话
- 当激活“本地终端”时：
  - 中间工作区显示本地终端子 tab
  - 右侧远程文件/监控面板隐藏
- 本地终端子 tab 使用独立状态，不再复用 `connectionId`
- 继续复用 `TerminalPanel` 渲染真实终端

## 数据模型

### 本地 profile

后端返回探测到的 profile，前端再合并设置中的自定义 profile。

建议结构：

```ts
interface LocalTerminalProfile {
  id: string;
  name: string;
  kind:
    | "powershell"
    | "powershell_core"
    | "cmd"
    | "wsl"
    | "git_bash"
    | "msys2"
    | "cygwin"
    | "cmder"
    | "bash"
    | "zsh"
    | "fish"
    | "pwsh"
    | "custom";
  platform: "windows" | "macos" | "linux" | "all";
  source: "detected" | "custom";
  command: string;
  args: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  icon?: string | null;
  detected: boolean;
}
```

首版约束：

- 自动发现 profile 由后端生成
- 自定义 profile 由前端设置持久化
- 启动时前端把最终要运行的 profile 内容传给后端

### 本地终端设置

在现有 `MxtermSettings` 中新增 `localTerminal`：

```ts
interface LocalTerminalSettings {
  defaultProfileId: string | null;
  hiddenProfileIds: string[];
  customProfiles: LocalTerminalProfile[];
  reopenLastLocalWorkspace: boolean;
}
```

说明：

- `defaultProfileId`：默认打开哪个 profile
- `hiddenProfileIds`：隐藏自动发现 profile
- `customProfiles`：用户自定义 profile
- `reopenLastLocalWorkspace`：为后续恢复本地工作区预留开关，首版先存模型

### 本地子 tab

本地终端工作区维护自己的子 tab 列表：

```ts
interface LocalTerminalTab {
  id: string;
  profileId: string;
  profileKind: LocalTerminalProfile["kind"];
  title: string;
  requestId?: string;
  sessionId?: string;
  status: string;
  error?: string | null;
  warmupOutput: number[];
}
```

## 后端设计

### 本地 PTY 会话

新增 `LocalTerminalSession`：

- 打开 `portable_pty::native_pty_system()`
- `openpty(PtySize)`
- 用 `CommandBuilder` 启动目标 shell
- 保存：
  - `session id`
  - `writer`
  - `child`
  - `reader task`

### 会话统一抽象

`TerminalManager` 的会话存储从单一 SSH 会话升级为枚举：

```rust
enum ManagedTerminalSession {
    Ssh(Arc<TerminalSession>),
    Local(Arc<LocalTerminalSession>),
}
```

统一提供：

- `write`
- `resize`
- `close`

这样 `terminal_write` / `terminal_resize` / `terminal_close` 不需要感知会话类型。

### profile 自动发现

Windows 首版自动发现：

- PowerShell 7
- Windows PowerShell
- cmd
- WSL 发行版
- Git Bash
- MSYS2
- Cygwin
- Cmder

macOS / Linux 首版模型保留，并支持基础探测：

- `$SHELL`
- `/etc/shells`
- `pwsh`

首版不实现管理员 Cmd / PowerShell。

### 事件

继续复用：

- `terminal:output`
- `terminal:state_changed`

本地终端无需额外 event name。

理由：

- `TerminalPanel` 已经稳定监听这两个事件
- SSH/local 只是 session 来源不同

## 前端设计

### 顶栏

`AppTitlebar` 扩展为三种顶层工作区入口：

- 首页
- 本地终端
- SSH 会话

图标规则：

- 首页：Home
- 本地终端：Terminal
- SSH 会话：Server / 远端系统图标

### 工作区切换

现有 `homeActive + activeConnectionId` 模型扩展为显式工作区：

- `home`
- `local`
- `ssh`

但实现上可先保留现有 SSH 状态，再新增本地工作区状态，减少回归风险。

### 本地终端子 tab

本地终端工作区顶部显示子 tab 和新建按钮：

- `+`：新建默认 profile
- `⌄`：打开 profile 菜单

左侧图标规则：

- PowerShell / PowerShell 7：终端图标 + 品类样式
- cmd：方窗/命令行样式
- WSL：Linux 发行版图标或通用 Linux 图标
- Git Bash / MSYS2 / Cygwin / Cmder：对应类型图标
- SSH：继续用远端系统图标

### 设置页

新增“本地终端”设置分区：

- 默认 profile
- 自动发现 profile 列表
  - 可隐藏
- 自定义 profile 列表
  - 新增
  - 编辑
  - 删除

## 错误和关闭策略

### 启动失败

如果 profile 启动失败：

- 保留失败子 tab
- 显示错误信息
- 提供“选择其他终端”和“打开本地终端设置”

### 关闭子 tab

如果本地 PTY 仍在运行：

- 关闭前确认
- 文案明确说明会结束该终端及其子进程

如果是失败状态或未建立 session：

- 可直接关闭

## 兼容与边界

- 不改左侧 SSH 连接树的心智
- 不让本地终端接入右侧远程文件/监控
- 不引入管理员模式
- 不做会话恢复、命令审计、同步输入
- 不新增第二套终端渲染组件

## 风险

### WorkspaceShell 体量大

当前 `WorkspaceShell.tsx` 体量很大，本次只做必要抽象：

- 增加本地终端状态
- 保持 SSH 工作流不拆大重构

### Windows 探测路径复杂

Git Bash / Cmder / MSYS2 / Cygwin 路径存在环境差异，因此：

- 探测优先 PATH
- 再尝试常见安装路径
- 探测失败则不展示

### PTY 读线程

本地 PTY 输出读取需要持续后台读取，必须确保：

- reader 生命周期与 session 生命周期一致
- close 后及时清理
