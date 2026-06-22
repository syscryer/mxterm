# SSH 端口转发 / 隧道技术设计

## Architecture

隧道能力保持独立 manager，不挂靠终端 tab。本轮在既有本地转发基础上补全动态 SOCKS 和远程转发：

- 后端新增 `src-tauri/src/tunnels.rs`，提供规则持久化、运行态管理、本地监听和 SSH direct-tcpip 转发。
- `TunnelManager` 根据 `TunnelKind` 启动三种运行循环：local accept loop、dynamic SOCKS accept loop、remote forwarded-tcpip loop。
- `src-tauri/src/lib.rs` 通过 `.manage(tunnels::TunnelManager::default())` 注册 manager，并在 `generate_handler!` 注册 Tauri commands。
- `src-tauri/src/commands.rs` 新增隧道请求/响应结构和命令函数。
- `src/shared/tauri/commands.ts` 新增 typed invoke wrapper。
- 前端新增 `src/features/tunnels/`，右侧工具页通过 `RemoteFilePanel` 的工具 tab 接入。

`TunnelManager` 与 `TerminalManager`、`RemoteFileManager`、`RemoteMonitorManager` 同级。这样没有打开终端 tab 时，也能使用保存连接启动隧道。

## Data Model

持久化文件建议为 app data 下的 `tunnels.json`：

```json
{
  "version": 1,
  "rules": []
}
```

规则结构：

```ts
type TunnelKind = "local" | "remote" | "dynamic";
type TunnelStatus = "stopped" | "starting" | "running" | "failed" | "credential_required";

interface TunnelRule {
  id: string;
  name: string;
  kind: TunnelKind;
  connection_id: string;
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
  created_at: string;
  updated_at: string;
}
```

三种类型共用字段，但语义按 `kind` 改变：

- `local`：`local_host:local_port` 是本机监听地址，`remote_host:remote_port` 是 SSH 服务器视角访问的目标。
- `dynamic`：`local_host:local_port` 是本机 SOCKS5 监听地址，`remote_host/remote_port` 不参与运行，持久化为空字符串和 `1`，UI 不展示远端目标字段。
- `remote`：`remote_host:remote_port` 是 SSH 服务器监听地址，`local_host:local_port` 是本机目标服务地址。

动态 SOCKS 使用 SOCKS5 无认证 TCP CONNECT。第一版不支持 UDP ASSOCIATE、BIND、用户名密码认证或 DNS 策略设置。

运行态结构：

```ts
interface TunnelRuntimeState {
  rule_id: string;
  status: TunnelStatus;
  bound_host?: string | null;
  bound_port?: number | null;
  started_at?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  active_connections?: number;
}
```

前端列表使用 `TunnelRule + TunnelRuntimeState` 合并后的视图模型。运行态不写入持久化文件。

## Backend Flow

命令建议：

- `tunnel_list() -> Vec<TunnelRuleWithState>`
- `tunnel_upsert(request: TunnelRuleInput) -> TunnelRuleWithState`
- `tunnel_delete(rule_id: String) -> ()`
- `tunnel_start(request: TunnelStartRequest) -> TunnelRuleWithState`
- `tunnel_stop(rule_id: String) -> TunnelRuleWithState`
- `tunnel_autostart() -> Vec<TunnelRuleWithState>`

`TunnelStartRequest` 需要支持 prompt 凭据：

```rust
pub struct TunnelStartRequest {
    pub rule_id: String,
    #[serde(default)]
    pub runtime_credential: Option<RuntimeCredentialInput>,
}
```

启动流程：

1. 读取并校验规则。
2. 通过 `resolve_saved_connection(app, connection_id, runtime_credential)` 解析连接。
3. prompt 凭据缺失时返回 `credential_prompt_required`。
4. 绑定 `TcpListener` 到 `local_host:local_port`，端口占用返回可恢复错误。
5. 建立 SSH 连接并认证，复用现有代理、跳板机、known_hosts 和 timeout 配置。
6. 状态置为 `running` 后启动 accept loop。
7. local 每个本地连接到来时打开 `channel_open_direct_tcpip(remote_host, remote_port, source_host, source_port)`，并通过 `tokio::io::copy_bidirectional` 桥接本地 TCP 与 SSH channel stream。
8. dynamic 每个本地连接到来时先完成 SOCKS5 握手，解析目标 host/port，再打开 `channel_open_direct_tcpip(target_host, target_port, source_host, source_port)` 双向桥接。
9. remote 启动时调用 `tcpip_forward(remote_host, remote_port)` 请求服务器监听；服务端发来 `forwarded-tcpip` channel 时，连接本机 `local_host:local_port` 并双向桥接。停止时调用 `cancel_tcpip_forward(remote_host, bound_remote_port)`，再关闭 SSH 会话。
10. 停止时关闭 accept loop 或 cancel remote forward、断开 SSH client 和 jump client，释放本地或远端监听。

为了减少重复 SSH 连接代码，`terminal/session.rs` 中的 `ReusableForwardSession` 继续复用现有私有 `connect_target_client`、`authenticate`、`auth_method`。本轮扩展它的 forwarding 能力：

- `forward_tcp_stream(local_stream, remote_host, remote_port)`：local 和 dynamic 共用。
- `request_remote_forward(remote_host, remote_port)`：remote 启动时请求服务器监听，返回实际监听端口。
- `cancel_remote_forward(remote_host, remote_port)`：remote 停止时取消监听。
- `set_remote_forward_target(local_host, local_port)`：把服务端发来的 forwarded-tcpip channel 转发到本机目标。

remote forwarded-tcpip 的回调来自 russh client handler。为避免把 russh handler 类型扩散到 `TunnelManager`，handler 内部通过 `Arc<RwLock<Option<RemoteForwardTarget>>>` 持有本机目标；收到 channel 后 spawn 桥接任务，并通过 `Arc<AtomicU32>` 或事件回调更新活跃连接计数。

如果服务端拒绝 `tcpip-forward`，映射为 `tunnel_remote_forward_denied`；如果本机目标不可连接，规则仍保持 running，但写入 `last_error`，因为远端监听已经存在，后续本机服务恢复后仍可继续使用。

## Prompt Credential

手动启动：

- `tunnel_start` 返回 `credential_prompt_required` 时，前端在隧道面板内打开凭据输入区域或 Radix 弹窗。
- 表单复用现有认证方式选项和 `AppSelect`：密码、私钥。
- 用户提交后再次调用 `tunnel_start({ rule_id, runtime_credential })`。
- 凭据只参与本次调用，不写入 `tunnels.json`、连接资料或凭据仓库。

自动启动：

- `tunnel_autostart` 只尝试 `auto_start = true` 的规则。
- 如果目标连接是 prompt 模式且没有 runtime credential，规则进入 `credential_required` 状态并显示“需要手动输入凭据”。
- 自动启动不弹凭据窗口。

## UI Design

入口：

- 扩展 `RemoteFileTool = "files" | "transfers" | "monitor" | "tunnels"`。
- `FilePanelTabs` 增加“隧道”按钮，使用 Lucide 网络/路由相关图标，例如 `Cable`、`Network` 或 `Route`。
- 保持右侧栏现有宽度和折叠行为。

面板结构：

- 顶部：标题、运行数量摘要、新建规则按钮。
- 主体：规则列表，按状态优先级排序，运行中和失败项更靠前。
- 行内容：名称、类型、连接名、路由描述、状态标签、自动启动标识、启动/停止/编辑/删除按钮。
- 空状态：没有规则时显示简短说明和新建按钮。
- 编辑/新增：使用 Radix Dialog，字段包括名称、类型、连接、监听地址/端口、目标地址/端口、自动启动。
- 类型切换字段：
  - 本地转发：本地监听地址/端口 + 远端目标地址/端口。
  - 动态 SOCKS：本地 SOCKS 地址/端口；隐藏目标字段，并提示“无认证 SOCKS5，仅支持 CONNECT”。
  - 远程转发：远端监听地址/端口 + 本机目标地址/端口。

视觉约束：

- 使用 `--mx-panel`、`--mx-panel-soft`、`--mx-line`、`--mx-text`、`--mx-muted`、`--mx-primary`、`--mx-success`、`--mx-danger`。
- 状态 badge 不只靠颜色，必须有文本。
- 下拉使用 `AppSelect` 或共享 Radix 菜单样式。
- 操作按钮复用 `mini-action` 或抽出共享小图标按钮，避免重复写 feature 私有按钮。

## Error Handling

后端 AppError 建议：

- `tunnel_rule_missing`：规则不存在。
- `tunnel_connection_missing`：连接不存在。
- `tunnel_local_host_missing`：监听地址为空。
- `tunnel_local_port_invalid`：监听端口无效。
- `tunnel_remote_host_missing`：远端目标为空。
- `tunnel_remote_port_invalid`：远端目标端口无效。
- `tunnel_local_bind_failed`：本地端口绑定失败。
- `tunnel_socks_handshake_failed`：SOCKS 握手失败或客户端请求不支持。
- `tunnel_socks_target_missing`：SOCKS CONNECT 目标解析失败。
- `tunnel_remote_forward_denied`：SSH 服务器拒绝远程转发。
- `tunnel_remote_forward_cancel_failed`：取消远程转发失败。
- `tunnel_remote_target_connect_failed`：远程转发回连本机目标失败。
- `tunnel_ssh_connect_failed`：SSH 连接失败。
- `tunnel_ssh_auth_failed`：SSH 认证失败。
- `tunnel_direct_tcpip_failed`：direct-tcpip 通道打开失败。
- `credential_prompt_required`：沿用连接解析错误码。

前端展示 `message`，调试详情仅保留在可展开详情或 tooltip，不把 raw error 塞满主列表。

## Compatibility

- `tunnels.json` 新文件独立于 `connections.json`，不会改变已有连接资料。
- 旧规则 `kind=local` 行为不变。
- 旧规则不会自动变成 dynamic/remote。
- dynamic 规则会持久化占位 `remote_host=""`、`remote_port=1`；读取旧版本时保持兼容。
- 删除规则时如果正在运行，先停止再删除。
- 连接被删除后，规则保留但状态显示连接不存在，用户可编辑或删除。

## Rollback

- 删除新增 Tauri commands、`tunnels.rs`、前端 `features/tunnels` 和右侧 tab 接入即可回滚功能。
- 持久化文件独立，不影响连接、凭据、known_hosts、文件传输和终端会话。
