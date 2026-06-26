# 多协议字符会话扩展

## Goal

在现有 SSH、本地终端、隧道能力基础上，补齐 Telnet 和串口两类字符会话，并收口连接编辑弹窗里的协议入口，让 mXterm 可以覆盖传统网络设备、实验环境和嵌入式调试场景。

## User Value

- 用户可以在同一个工作区中打开 SSH、本地终端、Telnet 和串口标签，不需要切换到其他工具。
- Telnet 适合旧设备、实验环境和不支持 SSH 的内网终端。
- 串口适合路由器、交换机、开发板、嵌入式设备和 Windows COM 口调试。
- 隧道不再作为一个未实现连接协议误导用户，而是回到 SSH 相关工具入口。

## Confirmed Facts

- 当前项目是 Tauri + React + Rust，终端渲染使用 xterm，SSH 和本地终端已有会话管理。
- 现有连接编辑弹窗已经展示 SSH、RDP、Telnet、VNC、隧道协议按钮，其中 Telnet、VNC、隧道为禁用“即将”状态。
- RDP 正在另一台机器开发且未提交，本任务不能调整 RDP 数据模型或图形会话实现。
- `src/features/tunnels/`、`src-tauri/src/tunnels.rs` 和相关 Tauri wrapper 已存在，隧道应作为 SSH 工具/规则管理能力收口，不做独立连接协议。
- NyaTerm 是可参考的 MIT 项目，采用 Tauri + React + Rust + xterm，支持 SSH、本地终端、Telnet、串口和隧道。
- NyaTerm 的 Telnet 实现包含 IAC 协商、NAWS、Enter Mode、Backspace Mode 和可选本地回显/行编辑。
- NyaTerm 的串口实现使用 Rust `serialport` crate，枚举串口并在线程中读写串口，再桥接到会话管理。
- electerm 是 MIT 项目，覆盖 SSH/SFTP/Telnet/Serial/RDP/VNC 等，适合作为产品入口和表单组织参考，但其 Electron/JS 后端不适合直接搬到本项目。

## Requirements

- 连接弹窗协议入口保留 SSH/RDP/VNC/Telnet/串口作为可编辑连接协议；Telnet 和串口应作为可保存连接配置进入连接列表，不再使用独立快速会话弹窗。
- 移除或弱化“隧道 即将”作为连接协议的表达，避免把 SSH 端口转发误导成独立主机连接类型。
- Telnet MVP 支持主机、端口、名称、分组、说明、Enter Mode、Backspace Mode。
- Telnet 配置需要持久化到现有连接仓库，可编辑、收藏、搜索、双击打开。
- Telnet 默认端口为 23，支持基本 IAC 协商，至少处理 WILL/WONT/DO/DONT、ECHO、SUPPRESS-GO-AHEAD、NAWS。
- Telnet resize 时可发送 NAWS，输入 Enter 可按配置发送 CR、LF 或 CRLF。
- 串口 MVP 支持串口枚举、串口名称、波特率、数据位、校验位、停止位、流控、Backspace Mode。
- 串口配置需要持久化到现有连接仓库，可编辑、收藏、搜索、双击打开。
- 串口默认参数为 9600、8N1、无流控，并支持 Windows COM 口。
- Telnet 和串口会话应复用现有 xterm 展示、标签页、关闭、输入写入、搜索、主题和字体设置。
- Telnet 和串口会话不展示 SSH 专属右侧工具，如远程文件、监控、Docker、隧道。
- 前端 UI 必须使用现有 Radix、Lucide、共享组件、`AppSelect` 和全局 `--mx-*` token，不使用原生业务下拉，不新增独立视觉体系。
- 后端命令必须通过 `src/shared/tauri/commands.ts` typed wrapper 暴露，业务组件不得直接散落 `invoke(...)`。
- 功能实现尽可能参考成熟方案，但提交代码必须保持本项目结构、命名、中文文案和 UTF-8 编码规范。

## Acceptance Criteria

- [ ] 用户可以从界面打开 Telnet 会话，成功连接后在 xterm 标签中交互输入输出。
- [ ] 用户可以保存、编辑、收藏、搜索 Telnet 连接，并从连接列表打开。
- [ ] Telnet 连接失败时前端展示中文错误，且不会留下不可关闭的半成品标签。
- [ ] Telnet 支持 Backspace Mode 和 Enter Mode，且关键 IAC/NAWS 行为有后端测试覆盖。
- [ ] 用户可以枚举串口并打开串口会话，成功后在 xterm 标签中读写串口。
- [ ] 用户可以保存、编辑、收藏、搜索串口连接，并从连接列表打开。
- [ ] 串口打开失败或端口占用时前端展示中文错误，且释放会话资源。
- [ ] 串口参数转换和基础校验有后端测试覆盖。
- [ ] Telnet/串口会话复用现有终端视觉、主题、字体和标签页，不引入硬编码颜色或独立样式系统。
- [ ] 连接弹窗不再把“隧道”展示成一个即将支持的独立连接协议；隧道入口保留在 SSH 工具/右侧工具上下文。
- [ ] `npm run check` 通过。
- [ ] 后端相关 targeted 测试通过；若未运行重型编译，最终说明原因。

## Out of Scope

- 不实现 RDP/VNC，本任务等待外部分支提交后再衔接图形会话。
- Telnet 第一版不做完整登录脚本、代理、跳板机、文件传输或 SSH 专属能力。
- 串口第一版不做十六进制视图、Modbus/AT 指令模板、自动重连、日志录制、文件发送或 ZMODEM。
- 不把 Telnet/串口强行塞进 SSH 连接资料结构的敏感凭据体系。
- 不自动提交 git。

## Open Questions

- 无阻塞项。用户已授权直接实现；MVP 默认采用成熟终端工具常见参数集，复杂增强后续单独做。
