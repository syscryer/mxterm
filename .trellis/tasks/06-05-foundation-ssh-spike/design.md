# 工程基座与 SSH Spike 设计

## Boundaries

前端负责界面布局、xterm.js 渲染、用户输入采集和状态展示。Rust 后端负责 SSH 连接生命周期、PTY channel 输入输出、resize、关闭和事件推送。

首轮只实现工程基座和 SSH Spike，不实现 SQLite、系统钥匙串、SFTP、传输队列和远程编辑业务闭环。

## Frontend Shape

- `src/features/layout/WorkspaceShell.tsx` 负责主布局骨架。
- `src/features/terminal/TerminalPanel.tsx` 负责 xterm.js 容器。
- `src/shared/tauri/commands.ts` 封装 Tauri command。
- `src/shared/tauri/events.ts` 封装 Tauri event。
- `src/styles/tokens.css` 和 `src/styles/app.css` 承载 light-neutral 外观变量和布局样式。

## Backend Shape

- `src-tauri/src/app_error.rs` 定义简单错误包装。
- `src-tauri/src/events.rs` 定义事件名。
- `src-tauri/src/commands.rs` 暴露 terminal command。
- `src-tauri/src/terminal/manager.rs` 管理 session id 到会话的映射。
- `src-tauri/src/terminal/session.rs` 管理单个 SSH 会话。
- `src-tauri/src/terminal/pty.rs` 负责 PTY 请求、shell、resize 和读写桥接。

## Runtime Rules

- Node 只用于开发期构建和 Vite dev server。
- 产品核心能力不通过 Node/Express 本地服务实现。
- 终端输出从 Rust 批量发送给前端，避免单字符事件风暴。
- 真实 SSH 测试信息只能在运行时输入，不能写入代码、文档或日志。

## Validation

先验证工程可运行，再验证 SSH Spike 手感。SSH 手感验证通过后，再进入连接管理、SFTP 和远程编辑阶段。
