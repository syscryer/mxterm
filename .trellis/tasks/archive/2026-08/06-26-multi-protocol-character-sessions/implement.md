# 多协议字符会话扩展实施计划

## Ordered Checklist

1. 读规范和现有代码
   - 加载 `trellis-before-dev`。
   - 读前端组件规范、Tauri command contract、共享思考指南。
   - 定位终端创建、输出事件、写入、关闭、resize、tab 数据结构。

2. 测试先行
   - 为 Telnet IAC 协商、NAWS、Enter/Backspace 转换写 Rust 单元测试。
   - 为串口参数解析和校验写 Rust 单元测试。
   - 先运行 targeted 测试，确认新增测试因缺少实现失败或无法编译到目标行为。

3. 后端 Telnet
   - 增加 Telnet request/config。
   - 增加 Telnet 会话创建和 loop。
   - 接入 terminal manager 命令通道、输出事件、resize 和 close。

4. 后端串口
   - 增加 `serialport` 依赖。
   - 增加串口枚举命令。
   - 增加串口会话创建、读线程、写入和关闭释放。

5. Tauri command contract
   - 在 `src-tauri/src/commands.rs` 注册命令。
   - 在 `src/shared/tauri/commands.ts` 增加 typed wrappers。
   - 补前端类型。

6. 前端 UI
   - 收口 `ConnectionDialog` 协议 chip：Telnet/串口切换到同一个连接资料弹窗内编辑，不再打开独立快速会话弹窗。
   - 增加可持久化 Telnet/串口表单，使用 `AppSelect`、Radix、Lucide 和全局 token。
   - `WorkspaceShell` 增加从已保存 Telnet/串口连接创建字符终端标签的动作。
   - 确保 SSH-only 右侧工具不在 Telnet/串口会话中显示。

7. 隧道入口收口
   - 不重写隧道面板。
   - 只调整误导性的连接协议入口和文案，让用户从 SSH 工具语义理解隧道。

8. 验证
   - 运行 targeted Rust tests。
   - 运行 `npm run check`。
   - 如不触发超长编译，运行 `cargo test --manifest-path src-tauri/Cargo.toml terminal --lib` 或更小范围测试。

## Risk Points

- 不能覆盖当前用户未提交的设置/主题改动。
- 串口读写是阻塞 API，不能放到 Tokio async task 中直接阻塞 runtime。
- Telnet 协商必须过滤 IAC 控制字节，不能把协商字节直接写到 xterm。
- 串口关闭必须释放 COM 口，否则 Windows 上会残留占用。
- UI 不能硬编码颜色或新建独立视觉体系。

## Validation Commands

```powershell
npm run check
cargo test --manifest-path src-tauri/Cargo.toml terminal --lib
```

若 Rust 全量测试耗时过长，至少运行新增模块相关 targeted tests，并在最终说明未跑的重型验证。
