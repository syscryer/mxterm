# 工程基座与 SSH Spike 实施清单

## Step 1：确认环境

- [ ] 运行 `node --version`、`pnpm --version`、`rustc --version`、`cargo --version`。
- [ ] 运行 `trellis --version`。
- [ ] 运行 `python ./.trellis/scripts/task.py current --source`。
- [ ] 运行 `python ./.trellis/scripts/get_context.py --mode packages`。

## Step 2：生成工程基座

- [ ] 在仓库外临时目录运行 `pnpm create tauri-app@latest m-xterm-scaffold --manager pnpm --template react-ts --identifier com.mxterm.app --tauri-version 2 --yes`。
- [ ] 将脚手架工程文件迁入主仓库。
- [ ] 调整 `package.json` 名称为 `m-xterm`。
- [ ] 调整 `src-tauri/Cargo.toml` 包名和 lib 名称。
- [ ] 调整 `src-tauri/tauri.conf.json` productName、title 和窗口尺寸。
- [ ] 运行 `pnpm install`。

## Step 3：迁入布局骨架

- [ ] 创建 `src/styles/tokens.css`。
- [ ] 创建 `src/styles/app.css`。
- [ ] 创建 `src/features/layout/WorkspaceShell.tsx`。
- [ ] 修改 `src/App.tsx` 使用 `WorkspaceShell`。
- [ ] 运行 `pnpm check`。

## Step 4：建立 Rust terminal 边界

- [ ] 创建 `src-tauri/src/app_error.rs`。
- [ ] 创建 `src-tauri/src/events.rs`。
- [ ] 创建 `src-tauri/src/commands.rs`。
- [ ] 创建 `src-tauri/src/terminal/` 模块。
- [ ] 修改 `src-tauri/src/lib.rs` 注册 terminal commands。
- [ ] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。

## Step 5：接入 xterm.js

- [ ] 运行 `pnpm add xterm @xterm/addon-fit @xterm/addon-web-links`。
- [ ] 创建 `src/features/terminal/TerminalPanel.tsx`。
- [ ] 创建 `src/shared/tauri/commands.ts`。
- [ ] 创建 `src/shared/tauri/events.ts`。
- [ ] 在布局骨架中显示终端区域。
- [ ] 运行 `pnpm check`。

## Step 6：SSH Spike

- [ ] 添加 `russh` 相关 Rust 依赖。
- [ ] 实现 `terminal_connect`、`terminal_write`、`terminal_resize`、`terminal_close`。
- [ ] 使用运行时输入的 SSH 信息连接真实服务器。
- [ ] 验证 `pwd`、`ls -la`、`top`、`vim`、`seq 1 5000`、`tail -f`。
- [ ] 运行 `pnpm check`。
- [ ] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。

## Step 7：收尾

- [ ] 运行 `git diff --check`。
- [ ] 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/trellis/docs-check.ps1`。
- [ ] 扫描 staged diff 中的敏感信息。
- [ ] 执行 `git add` 暂存新增代码和 Trellis 文件。
- [ ] 检查通过后提交并推送。
