# SSH 端口转发 / 隧道技术设计

## Architecture

新增独立隧道能力，不挂靠终端 tab：

- 后端新增 `src-tauri/src/tunnels.rs`，提供规则持久化、运行态管理、本地监听和 SSH direct-tcpip 转发。
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

MVP 中 `kind` 只允许 `local`，但持久化保留枚举字段。`remote_host` 表示从 SSH 服务器视角访问的目标地址，常见值是 `127.0.0.1`、数据库主机或远端内网域名。

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
7. 每个本地连接到来时打开 `channel_open_direct_tcpip(remote_host, remote_port, source_host, source_port)`，并通过 `tokio::io::copy_bidirectional` 桥接本地 TCP 与 SSH channel stream。
8. 停止时关闭 accept loop、断开 SSH client 和 jump client，释放本地端口。

为了减少重复 SSH 连接代码，优先在 `terminal/session.rs` 内新增可复用的 forwarding session 包装，例如 `ReusableForwardSession`，内部复用现有私有 `connect_target_client`、`authenticate`、`auth_method`。对外只暴露 `connect_resolved`、`open_direct_tcpip`、`close`，避免把 `KnownHostClient` 和 `russh` handle 类型扩散到业务 manager。

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
- 行内容：名称、连接名、本地绑定、远端目标、状态标签、自动启动标识、启动/停止/编辑/删除按钮。
- 空状态：没有规则时显示简短说明和新建按钮。
- 编辑/新增：使用 Radix Dialog 或右侧内联表单，字段包括名称、连接、监听地址、监听端口、目标地址、目标端口、自动启动。

视觉约束：

- 使用 `--mx-panel`、`--mx-panel-soft`、`--mx-line`、`--mx-text`、`--mx-muted`、`--mx-primary`、`--mx-success`、`--mx-danger`。
- 状态 badge 不只靠颜色，必须有文本。
- 下拉使用 `AppSelect` 或共享 Radix 菜单样式。
- 操作按钮复用 `mini-action` 或抽出共享小图标按钮，避免重复写 feature 私有按钮。

## Error Handling

后端 AppError 建议：

- `tunnel_rule_missing`：规则不存在。
- `tunnel_connection_missing`：连接不存在。
- `tunnel_kind_unsupported`：非本地转发暂不支持。
- `tunnel_local_host_missing`：监听地址为空。
- `tunnel_local_port_invalid`：监听端口无效。
- `tunnel_remote_host_missing`：远端目标为空。
- `tunnel_remote_port_invalid`：远端目标端口无效。
- `tunnel_local_bind_failed`：本地端口绑定失败。
- `tunnel_ssh_connect_failed`：SSH 连接失败。
- `tunnel_ssh_auth_failed`：SSH 认证失败。
- `tunnel_direct_tcpip_failed`：direct-tcpip 通道打开失败。
- `credential_prompt_required`：沿用连接解析错误码。

前端展示 `message`，调试详情仅保留在可展开详情或 tooltip，不把 raw error 塞满主列表。

## Compatibility

- `tunnels.json` 新文件独立于 `connections.json`，不会改变已有连接资料。
- `kind` 预留扩展，但 MVP 校验只接受 `local`。
- 删除规则时如果正在运行，先停止再删除。
- 连接被删除后，规则保留但状态显示连接不存在，用户可编辑或删除。

## Rollback

- 删除新增 Tauri commands、`tunnels.rs`、前端 `features/tunnels` 和右侧 tab 接入即可回滚功能。
- 持久化文件独立，不影响连接、凭据、known_hosts、文件传输和终端会话。