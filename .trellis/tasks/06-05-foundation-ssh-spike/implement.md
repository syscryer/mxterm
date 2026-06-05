# 工程基座与 SSH Spike 实施清单

## Step 1：确认环境

- [x] 运行 `node --version`、`pnpm --version`、`rustc --version`、`cargo --version`。
- [x] 运行 `trellis --version`。
- [x] 运行 `python ./.trellis/scripts/task.py current --source`。
- [x] 运行 `python ./.trellis/scripts/get_context.py --mode packages`。

## Step 2：生成工程基座

- [x] 在仓库外临时目录运行 `pnpm create tauri-app@latest m-xterm-scaffold --manager pnpm --template react-ts --identifier com.mxterm.app --tauri-version 2 --yes`。
- [x] 将脚手架工程文件迁入主仓库。
- [x] 调整 `package.json` 名称为 `m-xterm`。
- [x] 调整 `src-tauri/Cargo.toml` 包名和 lib 名称。
- [x] 调整 `src-tauri/tauri.conf.json` productName、title 和窗口尺寸。
- [x] 运行 `pnpm install`。

## Step 3：迁入布局骨架

- [x] 创建 `src/styles/tokens.css`。
- [x] 创建 `src/styles/app.css`。
- [x] 创建 `src/features/layout/WorkspaceShell.tsx`。
- [x] 修改 `src/App.tsx` 使用 `WorkspaceShell`。
- [x] 运行 `pnpm check`。

## Step 4：建立 Rust terminal 边界

- [x] 创建 `src-tauri/src/app_error.rs`。
- [x] 创建 `src-tauri/src/events.rs`。
- [x] 创建 `src-tauri/src/commands.rs`。
- [x] 创建 `src-tauri/src/terminal/` 模块。
- [x] 修改 `src-tauri/src/lib.rs` 注册 terminal commands。
- [x] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。

## Step 5：接入 xterm.js

- [x] 运行 `pnpm add xterm @xterm/addon-fit @xterm/addon-web-links`。
- [x] 创建 `src/features/terminal/TerminalPanel.tsx`。
- [x] 创建 `src/shared/tauri/commands.ts`。
- [x] 创建 `src/shared/tauri/events.ts`。
- [x] 在布局骨架中显示终端区域。
- [x] 运行 `pnpm check`。

## Step 6：SSH Spike

- [x] 添加 `russh` 相关 Rust 依赖。
- [x] 实现 `terminal_connect`、`terminal_write`、`terminal_resize`、`terminal_close`。
- [x] 使用运行时输入的 SSH 信息连接真实服务器。
- [x] 验证 `pwd`、`ls -la`、`top`、`vim`、`seq 1 5000`、`tail -f`。
- [x] 运行 `pnpm check`。
- [x] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。

## Step 7：收尾

- [x] 运行 `git diff --check`。
- [x] 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/trellis/docs-check.ps1`。
- [x] 扫描 staged diff 中的敏感信息。
- [x] 执行 `git add` 暂存新增代码和 Trellis 文件。
- [ ] 检查通过后等待人工审核，再按需要提交并推送。
