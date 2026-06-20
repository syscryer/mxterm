# SSH 端口转发 / 隧道实施计划

## Before Start

- 用户审阅并确认 `prd.md`、`design.md`、`implement.md`。
- 运行 `python ./.trellis/scripts/task.py start .trellis/tasks/06-20-ssh-port-forwarding-tunnels` 后进入实现阶段。
- 实现前加载 `trellis-before-dev`，读取 `.trellis/spec/` 前后端规范。

## Ordered Checklist

1. 后端数据层
   - 新增 `src-tauri/src/tunnels.rs`。
   - 实现 `TunnelRule`、`TunnelRuleInput`、`TunnelStoreDocument`、校验函数和 `tunnel_store_path`。
   - 覆盖规则 roundtrip、端口校验、空地址校验、仅支持 local 的测试。

2. 后端 SSH forwarding session
   - 在 `terminal/session.rs` 增加 `ReusableForwardSession`。
   - 复用现有 `connect_target_client`、proxy、jump、known_hosts、auth、timeout。
   - 提供 `open_direct_tcpip` 和 `close` 方法，避免 tunnel manager 直接依赖私有 russh handler。

3. 后端 TunnelManager
   - 实现运行态 map、start、stop、delete、autostart。
   - start 先 bind 本地端口，再建立 SSH 连接并进入 accept loop。
   - accept loop 为每个 TCP 连接打开 direct-tcpip channel 并双向转发。
   - stop 必须释放 listener、SSH client 和 jump client。

4. Tauri commands
   - 在 `commands.rs` 增加隧道请求/响应结构和命令。
   - 在 `lib.rs` 注册 `TunnelManager` 和 handler。
   - 在 `src/shared/tauri/commands.ts` 增加 typed wrapper。

5. 前端类型和 API
   - 新增 `src/features/tunnels/tunnelTypes.ts`。
   - 新增 `src/features/tunnels/TunnelPanel.tsx`。
   - 支持列表、空状态、新增/编辑、启动、停止、删除、自动启动开关、错误提示。

6. 右侧工具栏接入
   - 扩展 `RemoteFileTool` 为 `files | transfers | monitor | tunnels`。
   - `FilePanelTabs` 增加“隧道”入口。
   - `WorkspaceShell` 持有隧道状态，挂载 `TunnelPanel`，启动时调用一次 autostart。

7. prompt 凭据和 host key
   - 手动启动返回 `credential_prompt_required` 时弹本次凭据输入。
   - host key unknown/changed 复用现有 known host trust 流程或抽出共享确认组件；如果首版无法优雅复用，至少在隧道面板内提供同等确认能力。
   - 自动启动 prompt 规则只标记需要凭据，不弹窗。

8. 样式与复用
   - 样式写入 `src/styles/app.css`，使用 `--mx-*` token。
   - 下拉使用 `AppSelect`，弹窗/菜单使用 Radix 和共享类。
   - 若小图标按钮、状态 badge、字段组件出现两次以上，抽到 `src/shared/ui/` 或共享 CSS。

9. 验证
   - 运行 `npm run check`。
   - 如 Rust 测试可单独跑，补充执行相关 `cargo test` 或项目既有检查命令。
   - 手动确认：创建规则、启动、端口占用失败、停止释放端口、prompt 凭据手动启动、自动启动 prompt 跳过。

## Risk Points

- `russh` channel stream 和 `TcpStream` 双向 copy 的生命周期要处理干净，避免停止后端口仍占用。
- 自动启动不能弹凭据窗口，否则应用启动体验会被阻塞。
- known_hosts 错误必须保持可恢复，不能把未知主机密钥吞成普通连接失败。
- 右侧工具 tab 已经拥挤，新增按钮时要保持普通字号和紧凑间距，不扩大整体工具栏高度。

## Validation Commands

```powershell
npm run check
```

后端如需单跑测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

是否运行编译或更重的测试，以用户当时要求为准。