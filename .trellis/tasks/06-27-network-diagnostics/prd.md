# 网络诊断工具

## Goal

在右侧工具箱的“网络诊断”页接入可用的远端排障能力，让用户可以从当前 SSH 主机视角快速检查目标网络、DNS、端口和 HTTP 状态，而不需要手动记命令或切换到终端。

## Requirements

- 网络诊断入口复用现有工具箱 tab，不新增独立导航或独立视觉体系。
- 网络诊断命令必须通过 saved `connection_id` 执行，前端不得传 SSH 密码、私钥、主机用户名等敏感连接字段。
- 支持 5 类诊断：
  - Ping：输入目标主机，执行有限次数探测。
  - TCP 端口：输入目标主机和端口，检查远端 TCP 连通性。
  - DNS：输入域名，解析 A/AAAA/CNAME 等基础结果。
  - 路由追踪：输入目标主机，执行有限跳数追踪。
  - HTTP：输入 URL，检查状态码、重定向和响应头。
- 后端需要对用户输入做校验、shell quote 和命令超时，不能拼接未转义参数。
- 远端环境命令存在差异时采用成熟工具优先级：
  - Ping：`ping`
  - TCP：`nc`，缺失时用 bash `/dev/tcp`
  - DNS：`dig`，缺失时用 `nslookup`，再缺失用 `getent hosts`
  - Trace：`tracepath`，缺失时用 `traceroute`
  - HTTP：`curl`
- 结果展示需要包含状态、耗时、退出码、使用的命令标签和原始输出。
- 失败时展示中文错误，不吞掉远端 stderr。
- 浏览器预览或无 Tauri 环境时提供稳定预览结果，方便检查 UI。
- UI 必须使用 Lucide、现有工具箱按钮/输入样式和全局 `--mx-*` token。

## Acceptance Criteria

- [ ] 用户在网络诊断 tab 选择诊断类型并填写目标后，可以点击运行。
- [ ] Ping/TCP/DNS/路由/HTTP 都通过 typed Tauri wrapper 调用后端。
- [ ] 后端构造命令有单元测试覆盖，包括 shell quote、工具 fallback 和端口校验。
- [ ] 运行中按钮禁用并显示加载状态，结果返回后显示状态摘要和原始输出。
- [ ] 连接为空时保持现有不可用/预览逻辑，不调用后端。
- [ ] `npm run check` 通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml network_tools --lib` 通过。

## Out of Scope

- 不做持续监控、历史记录、图表、批量目标、自动定时诊断。
- 不实现本机网络诊断；第一版只从当前 SSH 主机视角执行。
- 不引入 sudo 密码提示或安装缺失工具。
- 不解析所有命令输出为强结构化指标；第一版以摘要和原始输出为主。
