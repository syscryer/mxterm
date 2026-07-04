# 远程 MCP HTTP 服务设计

## 边界

- `src-tauri/src/bin/mxterm_mcp.rs` 继续拥有 MCP JSON-RPC 工具分发，并新增 HTTP transport。
- `src-tauri/src/mcp.rs` 扩展持久化设置、token 哈希、sidecar 服务管理和 Tauri 命令。
- `src/features/settings/SettingsView.tsx` 只扩展现有 MCP 设置区，复用 `SettingsRow`、`SettingsToggle`、`settings-input`、`settings-action-button` 和全局 token 样式。
- `src/shared/tauri/commands.ts` 和 `src/features/settings/mcpSettingsTypes.ts` 作为前端命令/类型边界。

## 数据流

1. 用户在设置页开启远程 MCP。
2. React 调用 `mcp_settings_save({ remote_enabled: true, ... })`。
3. Rust 规范化 host/port；如果 token 哈希为空则生成 token、保存哈希和预览文本。
4. `McpRemoteServiceManager` 使用当前 app data dir 启动 `mxterm-mcp serve`，传入 `--token-sha256`，不传 token 明文。
5. Agent 通过 HTTP 调用 `/mcp` 或 `/sse`，sidecar 校验 token 后复用现有 MCP 工具分发。
6. `tools/call` 仍从本地数据库加载 MCP 设置并执行现有权限检查。

## 设置字段

持久化设置新增：

```rust
remote_enabled: bool
remote_host: String
remote_port: u16
remote_token: Option<String>
remote_token_hash: Option<String>
remote_token_preview: Option<String>
```

Tauri 返回给前端的公开设置不包含 `remote_token_hash`，只包含：

```rust
remote_token_saved: bool
remote_token_preview: Option<String>
generated_remote_token: Option<String>
remote_status: McpRemoteServiceStatus
```

## HTTP Transport

- `POST /mcp`：读取单个 JSON-RPC 请求，返回 JSON-RPC 响应；通知类无响应时返回 202。
- `GET /mcp`：返回 SSE 流，当前仅保持 transport 可建立，不主动推送工具消息。
- `GET /sse`：创建 legacy session，返回 `event: endpoint`，data 指向 `/messages?session_id=...`。
- `POST /messages?session_id=...`：处理 JSON-RPC 后把响应发送到对应 SSE session。
- `GET /health`：同样需要 token，返回最小运行状态。

## 安全

- token 明文保存在设置中用于客户端配置回填，但不写入日志、错误详情或 sidecar 进程参数。
- sidecar 只收到 token 哈希，避免进程参数暴露 token 明文。
- HTTP 鉴权接受 `Authorization: Bearer <token>` 和 `X-MXterm-MCP-Token`。
- 有 `Origin` 的请求只允许同 host 或 localhost origin，降低浏览器 DNS rebinding 风险；普通非浏览器 MCP 客户端通常没有 Origin。
- 服务开启默认监听 `0.0.0.0` 是用户确认的产品决策。

## 回滚

- 关闭 `remote_enabled` 会停止由 MXterm 管理的 sidecar，stdio sidecar 不受影响。
- token 重置失败时保留旧 token 哈希；重启失败时设置仍保存，但状态中显示启动错误，便于用户改端口后重试。
