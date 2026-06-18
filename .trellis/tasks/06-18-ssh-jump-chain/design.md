# 真实 SSH 跳板机链路设计

## Scope

本任务把共享 SSH 建连底座补齐真实跳板机链路，而不是只修某一个入口。目标是让所有复用 `ResolvedSshConfig` + `connect_resolved(...)` 的能力，在 `jump.kind = "ssh_jump"` 时都通过跳板机建立到目标机的真实 SSH 会话。

本次包含：

- 终端打开
- 测试连接
- 远程文件 exec / SFTP
- 远程监控 exec

本次不包含：

- 多级跳板机
- 跳板机 + 代理链的任意组合编排之外的新 UI
- 新增跳板机专属设置页

## Confirmed Constraints

- 现有 `ConnectionProfile` / `ResolvedSshConfig` 已持久化并透传 `jump: ConnectionJumpConfig`。
- 现有 `connect_ssh_client(...)` 只处理直连和代理。
- `russh 0.61.1` 已提供 `channel_open_direct_tcpip(...)`，`Channel` 还能 `into_stream()`。
- `russh::client::connect_stream(...)` 可以接收任意实现 `AsyncRead + AsyncWrite` 的流。

## Architecture

### Shared Transport Split

把“如何拿到底层双向字节流”和“如何在该流上跑目标机 SSH 握手”拆开：

1. **Outer transport resolution**
   - 直连：`TcpStream::connect(target)`
   - 代理：现有 `open_proxy_stream(...)`
   - 跳板机：先 SSH 登录跳板机，再 `channel_open_direct_tcpip(target_host, target_port, originator, originator_port)`，最后把 channel 转成 stream

2. **Inner target SSH handshake**
   - 无跳板机：在直连 / 代理流上 `russh::client::connect_stream(...)`
   - 有跳板机：在 bastion 打开的 direct-tcpip stream 上 `russh::client::connect_stream(...)`

这样终端、exec、SFTP 不需要各自理解“跳板机”是什么，只依赖统一的“拿到目标机 SSH client handle”能力。

### New Shared Path

建议新增两层共享函数，放在 `src-tauri/src/terminal/session.rs` 内部：

- `connect_jump_client(app, jump_config) -> SshHandle`
  - 读取 `jump.jump_connection_id`
  - `resolve_saved_connection(...)`
  - 阻止跳板机再次引用跳板机，避免递归 / 多级链路
  - 用现有 host-key / auth / proxy 流程连接到跳板机本身

- `connect_target_client(app, target_config) -> SshHandle`
  - `jump.kind = none`：沿用现有直连 / 代理
  - `jump.kind = ssh_jump`：
    1. 连接跳板机
    2. 在跳板机 handle 上 `channel_open_direct_tcpip(target_host, target_port, ...)`
    3. `channel.into_stream()`
    4. 用目标机自己的 host-key handler、认证材料、advanced timeout 在这个 stream 上 `connect_stream(...)`

### Why Reuse Session Module

- 终端 `TerminalSession::open(...)`
- `ReusableExecSession::connect_resolved(...)`
- `ReusableSftpSession::connect_resolved(...)`

都已经集中在 `terminal/session.rs`。把跳板机实现也留在这里，能让所有上层调用自动获益，避免在 `commands.rs`、`remote_files.rs`、`remote_monitor.rs` 分叉逻辑。

## Data Flow

1. 前端仅发送保存连接 id 或临时测试 profile。
2. `ssh_config.rs` 解析出目标连接与 `jump` 引用。
3. `terminal/session.rs` 决定底层 transport：
   - 直连 / 代理 / 跳板机
4. 如使用跳板机：
   - 跳板机配置通过 `resolve_saved_connection(...)` 再解析一次
   - 建立跳板机 SSH 会话
   - 通过 `direct-tcpip` 打开到目标机的原始通道
5. 在该通道流上继续跑目标机 SSH 握手、主机密钥校验、认证
6. 成功后返回目标机 `SshHandle` 给终端 / exec / SFTP

## Validation Rules

### Jump Validation

新增运行时校验：

- `jump_connection_id` 必须存在且能加载到保存连接
- 跳板机连接不能引用自己
- 本次禁止跳板机再带 `jump.kind = ssh_jump`
  - 返回新错误，例如 `connection_jump_nested_unsupported`
- 跳板机缺少认证材料、跳板机代理失败、跳板机 host key 异常，沿用现有 recoverable 错误语义

### Originator Metadata

`channel_open_direct_tcpip(...)` 需要 originator 地址。这里不需要暴露真实本机地址给上层逻辑，统一使用稳定占位即可，例如：

- originator address: `"127.0.0.1"`
- originator port: `0`

这样足够满足 SSH direct-tcpip 协议，不引入额外本地网络探测逻辑。

## Error Handling

新增或明确以下错误：

- `connection_jump_missing`
- `connection_jump_self_reference`
- `connection_jump_nested_unsupported`
- `jump_connect_failed`
- `jump_direct_tcpip_failed`

错误仍走现有 `AppError`，保持：

- `message` 可读
- `raw_message` 保留底层细节
- `recoverable` 与现有 host-key / auth / proxy 语义一致

## Compatibility

- 直连与代理路径行为不变
- 现有前端类型无需改动；`jump` 字段已存在
- 测试连接、远程文件、远程监控因为共用 `connect_resolved(...)`，会自动获得跳板机能力

## Testing Strategy

优先补 Rust 单测，覆盖不依赖真实网络的逻辑：

- 运行时跳板机校验
- 禁止 self-reference
- 禁止 nested jump
- `ResolvedSshConfig` round-trip 保持 jump 字段

对真实链路部分，本次至少完成编译级与单元级验证；手动联调可作为后续验证步骤。
