# 连接仓库与终端会话实施清单

## Step 1：任务准备

- [x] 设置 Trellis 当前任务。
- [x] 确认工作区状态。
- [x] 显式关闭 Trellis 自动提交。

## Step 2：Rust 连接仓库

- [x] 为连接校验写失败单测。
- [x] 实现连接类型和校验。
- [x] 为 JSON store 写失败单测。
- [x] 实现 JSON load/save/upsert/delete。
- [x] 为按 id 获取和删除写失败单测。
- [x] 暴露 Tauri connection commands。

## Step 3：前端连接仓库

- [x] 创建连接类型和 Tauri command 封装。
- [x] 创建连接仓库组件。
- [x] 创建新增/编辑连接弹窗。
- [x] 将 `WorkspaceShell` 的硬编码连接替换为真实连接状态。

## Step 4：终端会话模型

- [x] 定义 `TerminalTab` 状态。
- [x] 支持从连接打开新的终端 tab。
- [x] 支持同连接多个 tab。
- [x] 断开后保留 tab 输出和状态。

## Step 5：验证和收尾

- [x] 运行 Rust 单测。
- [x] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- [x] 运行 `pnpm check`。
- [x] 运行 Trellis docs check。
- [x] 扫描敏感信息。
- [x] 暂存新增代码和 Trellis 文件，不自动提交。
