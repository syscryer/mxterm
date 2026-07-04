# 远程 MCP HTTP 服务实施计划

## 步骤

1. 扩展 MCP 设置模型和 token 工具函数。
2. 抽出 sidecar JSON-RPC 异步处理函数，保持 stdio 行协议不变。
3. 在 sidecar 中实现最小 HTTP server：鉴权、`/mcp`、`/sse`、`/messages`、`/health`。
4. 新增 `McpRemoteServiceManager`，负责启动、停止、重启和状态查询。
5. 注册新的 Tauri commands，并在应用启动时根据设置尝试自动启动远程服务。
6. 更新前端 MCP 类型、typed wrappers 和设置页 UI。
7. 更新 `.trellis/spec` 中 MCP command contract。
8. 运行验证并修复发现的问题。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml mcp --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin mxterm-mcp`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check`

## 检查点

- 任何 token 明文不能出现在 git diff、日志、错误 raw_message 或持久化设置中。
- 前端只通过 `src/shared/tauri/commands.ts` 调用新命令。
- 设置页新增 UI 使用现有 token 样式，不引入新的视觉体系。
