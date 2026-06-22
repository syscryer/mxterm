# SSH 端口转发 / 隧道实施计划

## Before Start

- 用户审阅并确认 `prd.md`、`design.md`、`implement.md`。
- 运行 `python ./.trellis/scripts/task.py start .trellis/tasks/06-20-ssh-port-forwarding-tunnels` 后进入实现阶段。
- 实现前加载 `trellis-before-dev`，读取 `.trellis/spec/` 前后端规范。
- 本轮增强范围：在既有本地转发基础上补动态 SOCKS `ssh -D` 和远程转发 `ssh -R`；命令片段和历史命令另起后续任务，不混入本任务。

## Ordered Checklist

1. 文档与任务范围
   - 更新 `prd.md`：把 dynamic/remote 纳入要求和验收。
   - 更新 `design.md`：明确三类隧道字段语义、SOCKS5 限制和 remote forward 生命周期。
   - 更新本计划：保持命令片段/历史命令在后续任务。

2. 后端校验测试先行
   - 修改 `src-tauri/src/tunnels.rs` 单元测试。
   - 将“非 local 类型必须拒绝”的旧测试改为 dynamic/remote 合法。
   - 新增 dynamic 允许空远端目标、remote 要求远端监听和本地目标、端口为 0 拒绝的测试。
   - 先运行针对 `tunnels` 的 Rust 测试，确认测试按预期失败。

3. 后端规则模型
   - 修改 `validate_tunnel_rule_input`，按 `TunnelKind` 校验字段。
   - local：本地监听 + 远端目标都必填。
   - dynamic：本地监听必填，远端字段允许为空并规范为 `remote_host=""`、`remote_port=1`。
   - remote：远端监听 + 本机目标都必填。
   - 默认名称按类型生成：`L local -> remote`、`D local SOCKS`、`R remote -> local`。

4. SOCKS5 动态转发后端
   - 在 `src-tauri/src/tunnels.rs` 增加 SOCKS5 握手解析 helper，支持无认证 CONNECT 和 IPv4/IPv6/domain。
   - 对不支持的方法、命令和地址类型返回结构化 `AppError`。
   - dynamic accept loop 每个本地连接先解析目标，再调用 `ReusableForwardSession::forward_tcp_stream`。
   - 新增握手解析纯函数单元测试。

5. 远程转发后端
   - 扩展 `ReusableForwardSession`，增加 remote forward target 状态和 russh handler 回调处理。
   - 实现 `request_remote_forward` 和 `cancel_remote_forward`。
   - `TunnelManager` remote 启动时先连接 SSH，再请求远端监听，成功后进入 running。
   - remote 停止时取消远端监听并关闭 SSH 会话。
   - 服务端 forwarded-tcpip channel 到来时连接本机目标并双向转发；目标失败只更新 `last_error`，不直接停止规则。

6. 前端类型和表单
   - 修改 `src/features/tunnels/tunnelTypes.ts`，沿用 `TunnelKind = "local" | "remote" | "dynamic"`。
   - 修改 `TunnelPanel.tsx`：类型下拉开放三种类型。
   - 按类型切换字段文案和显示：dynamic 隐藏目标字段，remote 显示远端监听 + 本机目标。
   - `formToInput` 按类型生成 payload，并保持编辑旧 local 规则行为不变。
   - 列表路由展示按类型格式化，不再统一显示 `local -> remote`。

7. prompt 凭据和 host key 回归
   - 手动启动返回 `credential_prompt_required` 时弹本次凭据输入。
   - host key unknown/changed 复用现有 known host trust 流程或抽出共享确认组件；如果首版无法优雅复用，至少在隧道面板内提供同等确认能力。
   - 自动启动 prompt 规则只标记需要凭据，不弹窗。

8. 样式与复用
   - 样式写入 `src/styles/app.css`，使用 `--mx-*` token。
   - 下拉使用 `AppSelect`，弹窗/菜单使用 Radix 和共享类。
   - 若小图标按钮、状态 badge、字段组件出现两次以上，抽到 `src/shared/ui/` 或共享 CSS。
   - 本轮只做必要 UI 调整，不重画整个隧道面板。

9. 验证
   - 运行 targeted Rust 测试：`cargo test --manifest-path src-tauri/Cargo.toml tunnels --lib`。
   - 运行 `npm run check`。
   - 如时间允许，运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
   - 手动确认：创建 local/dynamic/remote 规则、启动、停止释放端口、prompt 凭据手动启动、自动启动 prompt 跳过、SOCKS5 CONNECT 可建立。

## Risk Points

- `russh` channel stream 和 `TcpStream` 双向 copy 的生命周期要处理干净，避免停止后端口仍占用。
- dynamic SOCKS 不应尝试解析或记录用户访问内容，只解析 CONNECT 目标。
- remote forward 可能被服务器配置拒绝；拒绝必须明确展示，不要伪装成运行中。
- remote forward 运行后本机目标可能临时不可达；这类错误应更新规则 `last_error`，但不能误导用户以为远端监听一定停止。
- 自动启动不能弹凭据窗口，否则应用启动体验会被阻塞。
- known_hosts 错误必须保持可恢复，不能把未知主机密钥吞成普通连接失败。
- 右侧工具 tab 已经拥挤，新增按钮时要保持普通字号和紧凑间距，不扩大整体工具栏高度。

## Validation Commands

```powershell
npm run check
```

后端单跑测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tunnels --lib
```

后端类型检查：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

是否运行更重的全量测试，以用户当时要求为准。
