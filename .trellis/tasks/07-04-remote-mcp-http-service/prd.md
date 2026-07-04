# 远程 MCP HTTP 服务

## Goal

让其它机器上的 Agent 能通过网络访问 MXterm MCP，同时保留现有本机 stdio sidecar 能力。远程服务由 MXterm 设置页管理，默认面向局域网可用，但必须通过 token 控制访问。

## Requirements

- 保留现有 `mxterm-mcp` stdio JSON-RPC 能力，不破坏本机 Agent 配置。
- 新增远程 MCP HTTP 服务开关，开启后由 MXterm 主进程管理 sidecar 生命周期。
- 远程服务默认监听 `0.0.0.0:8765`，用户可在设置页调整监听地址和端口。
- 开启远程服务时如果没有 token，自动生成高强度 token；设置中保存 token 明文用于客户端配置回填，同时保存 token 哈希供 sidecar 鉴权。
- HTTP 请求必须校验 `Authorization: Bearer <token>`，并兼容 `X-MXterm-MCP-Token: <token>`。
- 主入口支持 MCP Streamable HTTP：`POST /mcp` 处理 JSON-RPC，`GET /mcp` 返回 `text/event-stream`。
- 兼容旧 SSE 客户端：`GET /sse` 建立会话，`POST /messages?session_id=...` 投递 JSON-RPC 响应。
- 远程服务继续复用现有 MCP 设置：总开关、连接暴露范围、SSH 操作开关、危险命令确认逻辑全部仍由 Rust sidecar 执行。
- 设置页展示远程服务状态、URL、客户端配置片段，并支持重启服务、刷新状态和重置 token。
- 不在日志、错误详情、进程参数或非必要返回值中泄露 token 明文；前端不得接收 token 哈希，sidecar 只接收 token 哈希。

## Acceptance Criteria

- [ ] `mxterm-mcp` 默认无参数仍按 stdio NDJSON 工作。
- [ ] `mxterm-mcp serve --host 0.0.0.0 --port 8765 --token-sha256 <hash>` 可提供 `/mcp`、`/sse`、`/messages`。
- [ ] 未携带 token 或 token 错误的 HTTP 请求返回 401。
- [ ] `POST /mcp` 能完成 `initialize`、`tools/list`、`tools/call` 的 JSON-RPC 往返。
- [ ] 旧 SSE `/sse` 会返回 messages endpoint，`/messages` 能把响应发回对应 SSE 会话。
- [ ] 设置页保存远程服务开关后能启动或停止由 MXterm 管理的 sidecar，并显示运行状态/错误。
- [ ] token 重置会停止旧鉴权、生成新 token、保存明文与哈希、重启远程服务并刷新客户端配置片段。
- [ ] 现有连接暴露和 SSH 操作权限测试仍通过。
- [ ] 前后端 MCP 设置字段和 Tauri wrapper 合同保持同步。

## Notes

- 用户已确认默认给其他机器使用，安全边界由 token 控制。
- MCP 官方当前推荐 Streamable HTTP；旧 SSE 仅作为兼容入口。
