# 本地终端

## Goal

为 mXterm 增加完整的本地终端能力，让用户可以在同一个工作区里打开和管理本机 Shell 会话，并复用现有 xterm.js 终端视觉、标签页和输入输出体验。产品设计需要从一开始考虑跨平台 profile 体系，允许实现分阶段推进，但数据模型、入口和能力边界不能只服务单个 Windows 默认 Shell。

## Confirmed Facts

- 当前项目是 Windows 优先的 Tauri v2 + React + TypeScript + Rust 桌面应用。
- 当前终端后端位于 `src-tauri/src/terminal/`，现有实现是 SSH 会话：`terminal_connect` 打开远程 SSH、请求远程 PTY、启动远程 Shell，再通过 `terminal:output` 等事件推送给前端。
- 当前前端终端渲染位于 `src/features/terminal/TerminalPanel.tsx`，使用 xterm.js、FitAddon 和 WebLinksAddon。
- 当前工作区的终端 tab 模型位于 `src/features/layout/WorkspaceShell.tsx`，tab 目前绑定 `connectionId`，支持连接步骤页、同连接多终端、warmup output 交接、断开状态和右侧远程文件/监控面板联动。
- 当前仓库没有引入 `node-pty`、`portable-pty`、ConPTY 相关 Rust crate 或本地 PTY 抽象。
- 项目总体需求中已经把 SSH 终端作为核心能力，但尚未明确“本地终端”的产品范围、入口、默认 Shell、会话生命周期和与远程连接的关系。
- 用户希望先参考成熟开源项目，优先复用成熟实现，不硬造 PTY 细节。
- 已完成开源调研，详见 `research/pty-open-source-survey.md`。初步技术结论是底层优先使用 WezTerm 作者维护的 `portable-pty`，在 mXterm 内部封装自己的本地终端 manager；`node-pty` 成熟但不适合作为本项目运行时依赖，`tauri-plugin-pty` 可参考但不宜直接作为产品边界。
- 用户明确要求“要做就要做完整，再慢慢打磨”，并要求考虑后续跨平台。因此本任务按完整本地终端 profile 体系进行需求和技术设计，而不是只做一个临时默认终端入口。
- 已完成可借鉴项目对照，详见 `research/inspiration-projects.md`。推荐组合借鉴 Windows Terminal / VS Code 的 profile 模型，WezTerm 的 PTY 和 launcher 思路，Tabby / WindTerm / electerm 的产品心智，Alacritty / Ghostty 的配置边界。
- WindTerm 官方 README 明确把 Shell 作为 SSH/Telnet/Serial/SFTP 同级协议，并列出 Windows Cmd、PowerShell、管理员 PowerShell，以及 Linux/macOS bash、zsh、PowerShell Core；这支持 mXterm 将本地终端设计成完整 profile 体系，而不是单个默认 Shell 快捷入口。
- 用户确认首版普通 Shell 覆盖做完整，管理员 Cmd / PowerShell 只保留设计口子，后续单独设计提权启动和安全提示。
- 用户确认入口放在顶栏。本地终端应像首页一样是一个顶栏标签，打开后默认创建一个 PowerShell 终端子 tab，默认 profile 可在设置中修改；本地终端工作区内部可通过 `+` 号创建默认终端，也可通过下拉选择具体 Shell 类型。

## Requirements Draft

- 本地终端必须是真实交互式 PTY，而不是一次性命令执行。
- 本地终端应复用现有 xterm.js 终端视觉、字体、字号、配色和 resize 行为。
- 本地终端应与 SSH 终端共享尽量一致的输入、输出、关闭和断开状态体验。
- 本地终端需要有跨平台 profile 模型，支持内置自动发现 profile 和用户自定义 profile。
- 本地终端需要考虑 Windows、macOS、Linux 的 Shell 差异，Windows 优先落地，但模型不能阻塞后续平台。
- 本地终端 profile 体系需要覆盖主流本地 Shell 家族：Windows PowerShell / PowerShell 7 / cmd / WSL / Git Bash / MSYS2 / Cygwin / Cmder，以及 macOS/Linux 的登录 Shell、bash、zsh、fish、PowerShell Core 和自定义可执行文件。
- 本地终端应作为“本地 profile + 会话”体系存在，不应伪装成 SSH 连接，也不应进入左侧 SSH 连接树。
- 本地终端与 SSH 终端共享终端渲染、输入、输出、resize、关闭和历史保留体验；SSH 专属的远程文件、远程监控和传输能力不绑定本地终端。
- Profile 模型应至少覆盖名称、命令路径、参数、启动目录、环境变量、图标、隐藏状态、默认状态、来源和平台。
- 本地终端顶栏标签应与首页、SSH 会话标签处在同一层级；左侧 SSH 连接树不混入本地 profile。
- 点击顶栏“本地终端”标签时，如果当前没有本地终端会话，自动创建一个默认 profile 的子 tab；如果已有本地终端会话，则恢复最近激活的本地终端子 tab。
- 本地终端工作区内部使用子 tab 管理多个本地终端实例。`+` 按钮直接创建默认 profile；`+` 旁下拉菜单列出可用 profile 供用户选择。
- 设置中需要新增本地终端默认 profile 配置，并允许后续扩展 profile 管理。
- 不同类型会话需要有稳定的小图标体系，至少覆盖顶栏本地终端入口、SSH 顶栏标签、本地终端子 tab 以及 profile 下拉菜单中的类型识别。
- 本地终端首版范围、入口、profile 管理、默认 Shell、工作目录和设置项需要进一步对齐。
- 后端实现必须遵守运行时不使用 Node/Express 本地后端的红线。
- 优先研究成熟开源项目和库后再确定技术方案。

## Research Questions

- 前端现有 `TerminalPanel` 是否适合抽象为 SSH/local 共用的渲染层。
- 本地终端默认 Shell 的探测顺序和失败提示需要如何设计。
- 本地终端和 SSH 终端是否复用同一组 `terminal:*` event，还是拆成 `local_terminal:*` 独立事件。

## Open Product Questions

- 本地终端的顶栏标签是否允许关闭：更像首页的固定入口，还是像 SSH 会话一样可关闭并保留会话历史。
- 本地终端 profile 如何保存和展示：只保存用户自定义 profile，还是把自动发现 profile 和用户 profile 都统一展示。
- 本地终端是否和远程连接共享同一个工作区 tab 体系，还是独立于连接会话。
- 首版是否支持启动目录、环境变量、启动命令和重连。

## Acceptance Criteria Draft

- [ ] 已调研至少 3 个成熟开源终端实现或 PTY 库，并把结论写入 `research/`。
- [ ] PRD 明确本地终端 profile 范围、入口、默认 profile、会话生命周期和非目标范围。
- [ ] 设计文档明确跨平台 profile 模型、后端 PTY 抽象、前端 tab 数据模型、事件命名、错误处理和平台兼容边界。
- [ ] 实施计划列出按顺序可验证的开发步骤和验证命令。
- [ ] 用户评审并认可 PRD、设计和实施计划后，才进入实现。

## Out of Scope Draft

- 首轮不实现代码。
- 首版不做远程命令批量执行、命令审计、会话录像或命令回放。
- 首版不引入 Node/Express 运行时后端。
