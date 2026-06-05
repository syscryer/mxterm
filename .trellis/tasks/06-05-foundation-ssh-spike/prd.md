# 工程基座与 SSH Spike

## Goal

建立 mXterm 可运行的 Tauri + React + TypeScript + Rust 工程基座，并用真实 SSH 会话验证终端输入输出体验。

## Requirements

- 使用 Tauri v2 作为桌面壳。
- 使用 React + TypeScript 承载前端界面。
- 使用 Rust 后端承载 SSH 会话和 Tauri command/event。
- 运行时不引入 Node/Express 本地后端。
- 主界面先迁入当前 light-neutral 原型的三栏布局骨架。
- SSH Spike 使用 `russh` 主线验证真实连接。
- 终端渲染使用 xterm.js。
- 终端输入、输出、resize、关闭和断线状态需要形成最小闭环。
- 大量输出不能冻结 UI。
- 后续开发直接在 `master` 分支进行，提交前必须检查敏感信息。

## Acceptance Criteria

- [x] `pnpm install` 可以完成依赖安装。
- [x] `pnpm check` 可以执行 TypeScript 检查。
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` 可以执行 Rust 检查。
- [ ] `pnpm tauri dev` 可以启动 Windows 开发版。
- [x] 主界面出现连接仓库、编辑器/终端区、右侧工具面板的布局骨架。
- [x] Rust 后端存在 terminal command 和 event 边界。
- [x] xterm.js 能显示终端区域。
- [ ] 真实 SSH 连接可以打开 shell。
- [ ] 终端输入回显顺畅。
- [ ] `vim`、`top`、`tail -f` 和大量输出场景可验证。
- [ ] resize 能同步到远端 PTY。
- [ ] 断开后终端 tab 不丢历史输出。
- [ ] Trellis 当前任务、项目规范、Codex hooks 和本地技能文件已入仓。

## Constraints

- 不提交真实主机、真实密码、真实私钥或真实环境连接信息。
- 不提交 `.trellis/.developer`、`.trellis/.runtime/`、Python 缓存、`.superpowers/`、`.learnings/`、日志目录和本地附件目录。
- 新增代码文件完成后执行 `git add` 暂存。
- 不自动提交 git；检查通过后等待人工审核，再按需要提交并推送。
