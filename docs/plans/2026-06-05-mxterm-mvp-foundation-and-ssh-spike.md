# mXterm MVP Foundation And SSH Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本仓库规则优先级更高：不要自动提交 git；完成阶段性变更后只执行 `git add` 暂存，等待人工审核。

**Goal:** 建立 mXterm 可运行工程基座，并用真实 SSH 会话验证终端输入输出体验。

**Architecture:** Tauri v2 承载桌面壳，React + TypeScript 负责界面，Rust 后端负责 SSH 会话和事件推送。首轮只实现工程基座、原型迁移和 `russh` SSH 体验 Spike，不实现 SFTP、SQLite 和系统钥匙串业务闭环。

**Tech Stack:** Tauri v2, React, TypeScript, Rust, Tokio, russh, xterm.js, Trellis, Windows PowerShell.

---

## 0. 共同约束

- 所有回答和文档使用中文。
- 不自动提交 git。
- 新增代码文件完成后执行 `git add` 暂存。
- 不引入 Node/Express 运行时后端。
- Node、npm、pnpm 和 `node_modules` 只用于前端构建和依赖管理。
- 首轮以 Windows 开发验证为主。
- 后续 agents 进入仓库后先阅读 `AGENTS.md`、`.trellis/workflow.md`、`.trellis/config.yaml` 和本计划。
- 使用 trytrellis.app 的 `trellis` CLI，不使用 `trellis-ctl`。
- 开发前通过 `python ./.trellis/scripts/task.py current --source` 查看当前任务。

## 1. 目标文件结构

工程基座完成后建议形成以下结构：

```text
m-xterm/
  package.json
  pnpm-lock.yaml
  index.html
  src/
    App.tsx
    main.tsx
    styles/
      tokens.css
      app.css
    features/
      layout/
        WorkspaceShell.tsx
      terminal/
        TerminalPanel.tsx
        terminalTypes.ts
        useTerminalSession.ts
      connections/
        connectionTypes.ts
        mockConnections.ts
    shared/
      tauri/
        commands.ts
        events.ts
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      lib.rs
      app_error.rs
      commands.rs
      events.rs
      terminal/
        mod.rs
        session.rs
        manager.rs
        pty.rs
  docs/
    requirements/
      m-xterm-requirements.md
    plans/
      2026-06-05-mxterm-mvp-foundation-and-ssh-spike.md
  scripts/
    trellis/
      docs-check.ps1
```

## 2. Task 1：确认开发工具链

**Files:**
- Read: `AGENTS.md`
- Read: `.trellis/workflow.md`
- Read: `.trellis/config.yaml`
- Read: `docs/requirements/m-xterm-requirements.md`

- [ ] **Step 1: 查看 git 状态**

Run:

```powershell
git status --short --branch
```

Expected:

```text
## master
```

后面可以跟随已暂存或未跟踪文件，但不能出现未知敏感文件。

- [ ] **Step 2: 检查 Trellis 命令**

Run:

```powershell
trellis --version
python ./.trellis/scripts/task.py list
python ./.trellis/scripts/get_context.py --mode packages
```

Expected if installed:

```text
输出 Trellis 版本、任务列表和可用规范包
```

Expected if Trellis CLI is not installed:

```text
trellis 命令不可用
```

如果 `trellis` 命令不可用，先安装 `@mindfoldhq/trellis`，再继续工程基座。

- [ ] **Step 3: 检查 Node、pnpm、Rust**

Run:

```powershell
node --version
npm --version
pnpm --version
rustc --version
cargo --version
```

Expected:

```text
每条命令输出版本号
```

如果 `pnpm` 不存在，使用 `corepack enable` 后再检查 `pnpm --version`。

## 3. Task 2：初始化 Tauri + React + TypeScript 工程

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: 使用官方 Tauri 脚手架创建工程文件**

Run from `D:\ai_proj\mXterm\m-xterm`:

```powershell
pnpm create tauri-app@latest .
```

Expected:

```text
交互式脚手架启动，前端选择 React，语言选择 TypeScript，包管理器选择 pnpm
```

如果脚手架拒绝非空目录，在临时目录 `D:\ai_proj\mXterm\m-xterm-scaffold` 生成工程，然后只把脚手架产生的工程文件复制回当前仓库。复制前用 `git status --short` 确认不会覆盖已存在文档和原型文件。

- [ ] **Step 2: 安装依赖**

Run:

```powershell
pnpm install
```

Expected:

```text
依赖安装完成，生成 pnpm-lock.yaml
```

- [ ] **Step 3: 第一次本地检查**

Run:

```powershell
pnpm tauri info
```

Expected:

```text
输出 Tauri、Rust、WebView2 和系统信息
```

## 4. Task 3：迁入原型主布局

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Create: `src/features/layout/WorkspaceShell.tsx`
- Modify: `src/App.tsx`
- Reference: `prototype/light-neutral/mxterm-light-neutral.html`
- Reference: `prototype/light-neutral/mxterm-light-neutral-design.md`

- [ ] **Step 1: 创建设计 token**

Create `src/styles/tokens.css` with app-level tokens based on the light neutral prototype. Keep colors neutral and avoid green in application chrome.

Required token names:

```css
:root {
  --mx-bg: #f5f6f8;
  --mx-panel: #ffffff;
  --mx-panel-soft: #f8f9fb;
  --mx-line: #dde1e7;
  --mx-line-strong: #c9ced6;
  --mx-text: #20242a;
  --mx-muted: #626b78;
  --mx-subtle: #8a93a0;
  --mx-active: rgba(156, 163, 175, 0.12);
  --mx-primary: #2563eb;
  --mx-danger: #dc2626;
}
```

- [ ] **Step 2: 创建工作区组件**

Create `src/features/layout/WorkspaceShell.tsx` with static sections:

```tsx
export function WorkspaceShell() {
  return (
    <main className="workspace-shell">
      <aside className="connection-pane" aria-label="连接仓库" />
      <section className="editor-terminal-pane" aria-label="编辑器和终端" />
      <aside className="tool-pane" aria-label="右侧工具面板" />
    </main>
  );
}
```

后续再把连接树、编辑器和工具面板拆成独立组件。

- [ ] **Step 3: 接入 App**

Modify `src/App.tsx`:

```tsx
import { WorkspaceShell } from "./features/layout/WorkspaceShell";
import "./styles/tokens.css";
import "./styles/app.css";

export default function App() {
  return <WorkspaceShell />;
}
```

- [ ] **Step 4: 运行前端检查**

Run:

```powershell
pnpm check
```

Expected:

```text
TypeScript 和前端检查通过
```

如果脚手架没有 `check` script，先在 `package.json` 增加：

```json
{
  "scripts": {
    "check": "tsc --noEmit"
  }
}
```

## 5. Task 4：建立 Rust 后端模块边界

**Files:**
- Create: `src-tauri/src/app_error.rs`
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/events.rs`
- Create: `src-tauri/src/terminal/mod.rs`
- Create: `src-tauri/src/terminal/session.rs`
- Create: `src-tauri/src/terminal/manager.rs`
- Create: `src-tauri/src/terminal/pty.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 创建简单错误包装**

Create `src-tauri/src/app_error.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub raw_message: String,
    pub recoverable: bool,
}

impl AppError {
    pub fn new(code: &str, message: &str, raw_message: impl ToString, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            raw_message: raw_message.to_string(),
            recoverable,
        }
    }
}
```

- [ ] **Step 2: 创建事件名常量**

Create `src-tauri/src/events.rs`:

```rust
pub const TERMINAL_OUTPUT: &str = "terminal.output";
pub const TERMINAL_STATE_CHANGED: &str = "terminal.state_changed";
pub const TERMINAL_ERROR: &str = "terminal.error";
```

- [ ] **Step 3: 创建终端模块入口**

Create `src-tauri/src/terminal/mod.rs`:

```rust
pub mod manager;
pub mod pty;
pub mod session;
```

- [ ] **Step 4: 注册模块**

Modify `src-tauri/src/lib.rs`:

```rust
mod app_error;
mod commands;
mod events;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::terminal_connect,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 6. Task 5：实现 SSH 体验 Spike 命令

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/terminal/session.rs`
- Modify: `src-tauri/src/terminal/manager.rs`
- Modify: `src-tauri/src/terminal/pty.rs`

- [ ] **Step 1: 添加 Rust 依赖**

Modify `src-tauri/Cargo.toml` dependencies or use `cargo add` to add these crates:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "io-util"] }
uuid = { version = "1", features = ["v4", "serde"] }
russh = "0.61.1"
russh-keys = "0.50.0-beta.7"
```

The current registry check on 2026-06-05 returned:

```powershell
cargo search russh --limit 1
cargo search russh-keys --limit 1
```

Expected:

```text
russh = "0.61.1"
russh-keys = "0.50.0-beta.7"
```

- [ ] **Step 2: 定义连接输入类型**

Create request structs in `src-tauri/src/commands.rs`:

```rust
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TerminalConnectRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}
```

- [ ] **Step 3: 暴露 Tauri commands**

Add command signatures in `src-tauri/src/commands.rs`:

```rust
use crate::app_error::AppError;

#[tauri::command]
pub async fn terminal_connect(
    app: tauri::AppHandle,
    request: TerminalConnectRequest,
) -> Result<String, AppError> {
    crate::terminal::manager::connect(app, request).await
}

#[tauri::command]
pub async fn terminal_write(request: TerminalWriteRequest) -> Result<(), AppError> {
    crate::terminal::manager::write(request).await
}

#[tauri::command]
pub async fn terminal_resize(request: TerminalResizeRequest) -> Result<(), AppError> {
    crate::terminal::manager::resize(request).await
}

#[tauri::command]
pub async fn terminal_close(session_id: String) -> Result<(), AppError> {
    crate::terminal::manager::close(session_id).await
}
```

- [ ] **Step 4: 实现会话管理最小闭环**

Implement `connect` to return a UUID session id, open SSH, request PTY, start shell, spawn reader task, and emit `terminal.output` chunks. Keep writer and resize paths separate.

Acceptance behavior:

```text
terminal_connect 返回 session_id
terminal.output event 持续推送远端输出
terminal_write 可以发送用户输入
terminal_resize 可以同步 cols/rows
terminal_close 可以关闭 session
```

- [ ] **Step 5: Rust 检查**

Run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
Finished `dev` profile
```

## 7. Task 6：接入 xterm.js 前端 Spike

**Files:**
- Modify: `package.json`
- Create: `src/features/terminal/TerminalPanel.tsx`
- Create: `src/features/terminal/terminalTypes.ts`
- Create: `src/features/terminal/useTerminalSession.ts`
- Modify: `src/features/layout/WorkspaceShell.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: 安装终端依赖**

Run:

```powershell
pnpm add @tauri-apps/api xterm @xterm/addon-fit @xterm/addon-web-links
```

Expected:

```text
package.json 和 pnpm-lock.yaml 更新
```

- [ ] **Step 2: 创建终端组件**

Create `src/features/terminal/TerminalPanel.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 13,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();
    terminal.writeln("mXterm SSH spike ready");

    return () => {
      terminal.dispose();
    };
  }, []);

  return <div className="terminal-host" ref={hostRef} />;
}
```

- [ ] **Step 3: 接入布局**

Place `<TerminalPanel />` into the bottom terminal area of `WorkspaceShell`.

- [ ] **Step 4: 前端检查**

Run:

```powershell
pnpm check
```

Expected:

```text
TypeScript 检查通过
```

## 8. Task 7：端到端 SSH 手感验证

**Files:**
- Modify: `src/features/terminal/useTerminalSession.ts`
- Modify: `src/features/terminal/TerminalPanel.tsx`
- Modify: `src/shared/tauri/commands.ts`
- Modify: `src/shared/tauri/events.ts`

- [ ] **Step 1: 创建 Tauri command 封装**

Create `src/shared/tauri/commands.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface TerminalConnectRequest {
  host: string;
  port: number;
  username: string;
  password: string;
  cols: number;
  rows: number;
}

export function terminalConnect(request: TerminalConnectRequest) {
  return invoke<string>("terminal_connect", { request });
}

export function terminalWrite(sessionId: string, data: string) {
  return invoke<void>("terminal_write", {
    request: { sessionId, data },
  });
}

export function terminalResize(sessionId: string, cols: number, rows: number) {
  return invoke<void>("terminal_resize", {
    request: { sessionId, cols, rows },
  });
}
```

- [ ] **Step 2: 创建事件封装**

Create `src/shared/tauri/events.ts`:

```ts
import { listen } from "@tauri-apps/api/event";

export interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

export function listenTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
  return listen<TerminalOutputEvent>("terminal.output", (event) => handler(event.payload));
}
```

- [ ] **Step 3: 连接真实 SSH**

Temporarily wire the TerminalPanel to a local form or hardcoded development-only input guarded by a clear `dev only` label in the UI. Do not commit real host, username, password, IP, or private key values.

Required test inputs must be entered by the developer at runtime.

- [ ] **Step 4: 手感验证命令**

In the connected terminal, run:

```bash
pwd
ls -la
top
vim /tmp/mxterm-spike.txt
seq 1 5000
tail -f /tmp/mxterm-spike-tail.log
```

Expected:

```text
输入回显顺畅
resize 后 top/vim 布局同步
大量输出期间 UI 不冻结
关闭连接后 tab 保留并显示断开状态
```

## 9. Task 8：补 Trellis 任务和工程脚本

**Files:**
- Modify: `.trellis/tasks/`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: 创建或确认 Trellis 任务**

Run:

```powershell
python ./.trellis/scripts/task.py list
python ./.trellis/scripts/task.py create "工程基座与 SSH Spike" --slug foundation-ssh-spike
python ./.trellis/scripts/task.py start foundation-ssh-spike
```

Expected:

```text
任务创建并进入 in_progress 状态
```

- [ ] **Step 2: 增加 dev 脚本**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "tauri": "tauri",
    "tauri:dev": "tauri dev"
  }
}
```

- [ ] **Step 3: 增加 check 脚本**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "check": "tsc --noEmit"
  }
}
```

- [ ] **Step 4: 增加 test 脚本**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "test": "node -e \"console.log('frontend tests not configured yet')\""
  }
}
```

Replace this with real tests when test files are introduced.

- [ ] **Step 5: 验证 Trellis 上下文**

Run:

```powershell
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/get_context.py --mode packages
```

Expected:

```text
输出当前任务和可用规范包
```

## 10. Task 9：最终检查和暂存

**Files:**
- Modify: all files changed in this plan

- [ ] **Step 1: 检查格式和空白**

Run:

```powershell
git diff --check
```

Expected:

```text
无输出，退出码为 0
```

- [ ] **Step 2: 运行文档检查**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\trellis\docs-check.ps1
```

Expected:

```text
docs check passed.
```

- [ ] **Step 3: 运行工程检查**

Run:

```powershell
pnpm check
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
前端 TypeScript 检查通过
Rust cargo check 通过
```

- [ ] **Step 4: 暂存变更**

Run:

```powershell
git add -- package.json pnpm-lock.yaml index.html src src-tauri README.md docs .trellis .codex .agents
git status --short
```

Expected:

```text
新增和修改文件处于 staged 状态
没有敏感信息、真实密码、真实私钥、真实环境连接信息
```

不要执行 `git commit`，等待人工审核。

## 11. 第一轮验收清单

- [ ] Tauri 开发版能在 Windows 启动。
- [ ] 主界面出现当前原型的三栏布局骨架。
- [ ] 应用运行时没有 Node/Express 本地后端服务。
- [ ] Rust 后端存在 terminal command 和 event 边界。
- [ ] xterm.js 能显示终端区域。
- [ ] 真实 SSH 连接可以打开 shell。
- [ ] 输入回显顺畅。
- [ ] 大量输出不冻结 UI。
- [ ] resize 能同步到远端 PTY。
- [ ] 断开后终端 tab 不丢历史输出。
- [ ] Trellis 已有当前任务、项目规范、Codex hooks 和本地技能文件。
- [ ] `package.json` 至少有 `dev`、`check`、`test` 和 `tauri:dev` 脚本。
