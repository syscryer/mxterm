# 网络诊断工具技术设计

## Architecture

网络诊断沿用现有右侧工具箱结构，在 `DockerToolPanel.tsx` 的 `network` tab 中替换占位内容。后端新增 `network_tools.rs`，作为独立命令模块，不放进 Docker 命令集合，避免 Docker 依赖污染通用网络能力。

数据流：

```text
NetworkDiagnosticsView -> networkDiagnosticRun(connectionId, request)
  -> Tauri command network_diagnostic_run
  -> network_tools::run_diagnostic
  -> RemoteExecSessionPool via NetworkDiagnosticSessionManager
  -> remote shell command
  -> NetworkDiagnosticResult
```

## Backend Contract

新增命令：

```rust
network_diagnostic_run(
  app: AppHandle,
  manager: State<NetworkDiagnosticSessionManager>,
  request: NetworkDiagnosticRequest,
) -> Result<NetworkDiagnosticResult, AppError>
```

请求字段：

- `connection_id: String`
- `kind: ping | tcp | dns | trace | http`
- `target: String`
- `port: Option<u16>`

响应字段：

- `kind`
- `target`
- `command_label`
- `ok`
- `exit_status`
- `duration_ms`
- `summary`
- `stdout`
- `stderr`

命令执行规则：

- 所有用户输入通过 `quote_posix_shell`。
- 每个诊断命令用远端 `timeout` 包裹，避免卡死。
- 命令 fallback 在远端 shell 中判断 `command -v`。
- 读类诊断允许 cached SSH exec session stale 后重连重试一次。
- 后端只接受 saved connection id，并通过 `resolve_saved_connection` 解析连接。

## Frontend Flow

UI 结构：

- 顶部诊断类型 segmented control：Ping、TCP、DNS、路由、HTTP。
- 表单区域：
  - `target` 输入。
  - TCP 显示 `port` 输入。
  - 运行按钮和重置按钮。
- 结果区域：
  - 状态摘要卡片：成功/失败、耗时、退出码、命令类型。
  - 原始输出块：stdout/stderr，支持复制。

状态：

- `diagnosticKind`
- `diagnosticTarget`
- `diagnosticPort`
- `diagnosticRunning`
- `diagnosticResult`
- `diagnosticError`

## UI Constraints

- 复用工具箱现有 `.toolbox-*` 样式和全局 token。
- 不使用原生 select；诊断类型用按钮组，TCP 端口用普通输入。
- 输出块使用固定高度滚动，避免撑坏右侧面板。
- 暗色主题和 system-dark 下边框、背景、文本都使用 token。

## Validation

- 前端做轻量必填提示，但后端是权威校验。
- TCP 端口必须在 `1..=65535`。
- HTTP URL 允许 `http://` / `https://`，若用户只输入域名，后端按 `https://` 补全。
- 目标为空返回 recoverable AppError。

## Rollback

回滚新增 `network_tools.rs`、命令注册、前端 wrapper/type 和 `DockerToolPanel` 网络 tab 改动即可，不影响 Docker 已有功能。
