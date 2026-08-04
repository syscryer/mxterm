# 高频终端输出调研

## 现有实现结论

- SSH reader 当前对每个 `ChannelMsg::Data` 立即触发一次 `terminal:output`。
- `TerminalPanel` 虽按 animation frame 合并字符串，但不等待 xterm parser callback；持续输出会在 xterm 内部继续排队。
- 每个原始输出块都会更新 `WorkspaceShell` 的最近输出状态；语义高亮在每次 `onWriteParsed` 后通过 microtask 扫描最近行。
- Docker 日志每个 chunk 执行一次 400,000 字符窗口拼接和 React 状态提交，并持续启动跟随滚动。

## 成熟实现依据

### xterm.js

- 来源：仓库已安装的 `@xterm/xterm` 6.0.0，MIT License。
- `Terminal.write(data, callback)` 明确说明数据异步解析，callback 在 parser 完成后触发。
- `WriteBuffer` 源码按约 12ms 时间片解析；其注释指出待处理数据超过约 500KB 时通常已经无响应，50MB 仅是防止浏览器崩溃的最后安全阈值，并明确要求上层实施 flow control。
- 采用原则：应用只保留一个 xterm write batch 在途，等待 callback 再继续；不复制 xterm 实现代码。

## 设计取舍

- 不使用输出截断、吞日志或关闭 ANSI 解析作为修复手段。
- 后端先减少事件频率，前端再按真实 parser 消费速度排队，两层分别解决 IPC 风暴和 xterm 内部积压。
- Docker 日志是可见文本投影，保留既有 400,000 字符窗口，但降低 React/DOM 提交频率。
- 语义高亮属于增强功能，高压时允许几十毫秒延迟，但不能影响输入和 Ctrl+C。
