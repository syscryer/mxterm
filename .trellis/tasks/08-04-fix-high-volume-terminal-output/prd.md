# 修复高频日志导致界面卡死

## Goal

修复 SSH 终端或 Docker 容器日志持续高速输出时 MXterm 主界面卡死、键盘输入和 Ctrl+C 无响应、日志窗口无法及时关闭的问题，同时保持日志内容与终端控制序列的真实语义。

## Requirements

- SSH、Local、Telnet、Serial 终端继续通过既有 `terminal:output` 合同显示原始输出，不过滤或静默丢弃日志。
- SSH 终端后端必须减少高频小块 Tauri 事件；低吞吐输出仍需在短时间内可见。
- 前端必须等待上一批 xterm 数据解析完成后再提交下一批，避免 xterm 内部写队列无界积压。
- 最近终端输出上下文不得在每个原始 SSH 数据块上触发 WorkspaceShell 顶层状态更新。
- Docker 实时日志必须合并高频 chunk 后再更新 React 状态；暂停、关闭、清空和重连不得重新注入旧的待刷新内容。
- 高频输出期间语义高亮不得通过连续微任务长期占用主线程。
- 修复必须配套确定性压力测试；真实 SSH / Docker smoke 只能作为补充。

## Acceptance Criteria

- [x] 10,000 个小块按顺序进入终端写队列时，输出字节/字符顺序完整，且任意时刻最多只有一个 xterm 写入批次在途。
- [x] 单个终端写入批次有明确上限，只有 xterm 回调完成后才继续排下一批。
- [x] Rust SSH/流式 exec 输出合并器在高频小块输入下显著减少事件数量，并在结束时完整 flush 尾部数据。
- [x] Docker 日志高频 chunk 在一个刷新窗口内只触发一次内容提交；clear/dispose 后旧 chunk 不会回流。
- [x] 终端输出、Docker 日志暂停/关闭、Ctrl+C 和普通键盘输入的既有合同保持不变。
- [x] `npm run check`、新增 Node 压力测试、相关 Rust 单元测试、`cargo fmt --check` 和 `cargo check` 通过。

## Out of Scope

- 不增加日志搜索、过滤、持久化或下载能力。
- 不通过降低 scrollback、缩短 Docker 日志保留量或隐藏输出制造“不卡顿”的假象。
- 不重写 SSH、PTY 或 Docker exec 基础设施。
