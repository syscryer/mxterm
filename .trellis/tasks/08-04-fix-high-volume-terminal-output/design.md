# 高频日志输出稳定性设计

## Data Flow

SSH/exec 数据源 -> Rust 解码与定时/定量合并 -> Tauri typed event -> 前端待写队列 -> xterm parser callback -> 最近输出投影/渲染。

Docker 日志数据源 -> Rust 流式 exec 合并 -> `docker:log_stream` -> 前端日志缓冲器 -> React 有界文本状态 -> `<pre>` 展示。

## Boundaries

### Rust output batching

- 在共享终端 session 层提供小型字节批处理器，SSH shell 和 streaming exec 共用同一批次大小与等待窗口。
- 达到批次上限立即发送；低流量在等待窗口到期时发送；关闭、错误或 EOF 前 flush 尾部。
- 合并只改变事件粒度，不改变字节顺序和内容。

### xterm write queue

- 新建纯 TypeScript 队列，显式接收 scheduler 和 `terminal.write(data, callback)` writer。
- 每批字符数有上限；写入回调前不启动下一批。
- 最近终端输出在批次提交时更新，而不是在每个 Tauri 原始事件上更新。
- dispose/clear 取消未开始批次，不能让旧会话输出进入重连后的终端。

### Docker log buffering

- 新建可测试的文本缓冲器，把一个短窗口内的 chunk 合并后提交。
- terminal/error/finished 事件前主动 flush；close/restart/clear 使用 discard，防止旧 stream 内容回流。
- 保留现有 400,000 字符可见缓冲合同，但取消持续 smooth-scroll 动画。

### Semantic highlighting

- `onWriteParsed` 只安排低频定时刷新，不使用连续微任务。
- 保留现有 token 类型、最近 180 行范围和装饰数量上限。

## Compatibility

- 不改变 Tauri event payload 和 command 注册。
- 不改变终端编码、ANSI/OSC 处理、scrollback、Docker stream id 校验及停止语义。
- Browser preview 不依赖 Tauri，继续使用相同组件路径。

## Failure And Rollback

- writer 抛错或组件卸载时队列停止调度，避免回调继续访问 disposed terminal。
- 后端批处理器只在 SSH shell 与 streaming stdout 路径启用；可按文件回滚，不影响普通短命令输出。
- 若节流造成高亮短暂滞后，输出与输入优先，最大延迟限制在一个短刷新窗口。
