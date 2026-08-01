# 多协议字符会话扩展技术设计

## Architecture

本任务采用“字符会话统一底座”的路线：Telnet 和串口都接入现有终端标签与 xterm 渲染，避免为每种协议新建一套工作区。

边界划分：

- `src-tauri/src/terminal/manager.rs` 继续作为终端会话生命周期入口。
- 新增或扩展后端字符会话模块：Telnet 使用 Tokio TCP，串口使用 `serialport` 在线程中阻塞读写。
- `src-tauri/src/commands.rs` 暴露 typed commands，例如创建 Telnet/串口会话、枚举串口。
- `src/shared/tauri/commands.ts` 增加 TypeScript wrapper 和 payload 类型。
- `src/features/terminal/` 增加 Telnet/串口相关类型，不复用 SSH-only 的连接凭据字段。
- `src/features/connections/ConnectionDialog.tsx` 收口协议入口：SSH/RDP/VNC/Telnet/串口都是同一个连接资料编辑主体；Telnet/串口不再跳到独立快速会话弹窗。
- `src/features/layout/WorkspaceShell.tsx` 负责触发创建会话、维护标签页、传递 xterm props。

## Session Model

新增字符会话类型建议：

```ts
type CharacterSessionKind = "telnet" | "serial";
```

Telnet 创建请求：

```ts
type TelnetSessionRequest = {
  name?: string;
  host: string;
  port: number;
  enter_mode: "cr" | "lf" | "crlf";
  backspace_mode: "del" | "ctrl_h";
  local_echo?: boolean;
};
```

串口创建请求：

```ts
type SerialSessionRequest = {
  name?: string;
  port_name: string;
  baud_rate: number;
  data_bits: 5 | 6 | 7 | 8;
  parity: "none" | "odd" | "even";
  stop_bits: "1" | "2";
  flow_control: "none" | "software" | "hardware";
  backspace_mode: "del" | "ctrl_h";
};
```

Telnet 和串口作为与 SSH/RDP/VNC 同级的连接协议持久化到连接仓库。Telnet 保存 `host`、`port`、Enter Mode、Backspace Mode；串口保存 `serial.port_name`、波特率、数据位、校验位、停止位、流控和 Backspace Mode。串口为了兼容现有连接表的非空目标字段，保存时使用 `host = serial.port_name`、`port = 1`，真正运行参数以 `serial` JSON 为准。

## Backend Flow

### Telnet

1. 校验 host、port、enter mode、backspace mode。
2. `TcpStream::connect(host:port)` 建立连接。
3. 读 loop 解析 Telnet IAC 控制序列：
   - ECHO 和 SUPPRESS-GO-AHEAD 采用常见客户端响应。
   - DO NAWS 时响应 WILL NAWS。
   - resize 时发送 NAWS 子协商。
4. 普通字节转成 UTF-8 lossless 文本输出到现有 terminal output event。
5. 写入时按配置处理 Backspace 和 Enter。
6. 关闭时移除会话并通知前端。

### Serial

1. `serialport::available_ports()` 枚举可用串口。
2. 创建会话时校验 port_name、baud_rate、data_bits、parity、stop_bits、flow_control。
3. 用 `serialport::new(...).timeout(100ms)` 打开端口。
4. 串口读取是阻塞 API，放在线程中执行，通过现有事件发送输出。
5. 写入命令从 Tokio channel 收到后写入串口并 flush。
6. 关闭会话时设置退出标记、唤醒读线程并释放端口句柄。

## UI Flow

协议入口保留在现有连接弹窗顶部，但语义收口：

- SSH：当前连接资料编辑。
- RDP：保持即将支持，等待外部分支。
- Telnet：可点击，切换到内联 Telnet 连接资料表单，可保存、编辑、搜索、收藏和双击打开。
- 串口：可点击，切换到内联串口连接资料表单，可保存、编辑、搜索、收藏和双击打开。
- VNC：保持即将支持。
- 隧道：不作为连接协议 chip；保留在 SSH 右侧工具或 SSH 高级区域的说明入口。

Telnet/串口表单采用现有 dialog 风格：

- 8px 内圆角以内。
- 输入、下拉、按钮走共享样式与 `--mx-*` token。
- 下拉使用 `AppSelect`。
- 图标使用 Lucide。
- 错误信息在表单内显示中文。

工作区中 Telnet/串口标签：

- 标签 badge 显示 `Telnet` 或 `串口`。
- 右侧 SSH 专属工具隐藏，只保留命令类/终端类能力。
- xterm 主题、字体、搜索、复制粘贴沿用现有 TerminalPanel。

## Compatibility

- 不迁移现有 SSH 连接 JSON。
- 不改 RDP/VNC 尚未提交的数据模型。
- `serialport` 是新增 Rust 依赖，需确认 Windows 构建可用。
- Telnet/串口连接配置存入 `ConnectionProfile` 的独立协议字段；运行时 session id 仍只存在于终端标签和 `TerminalManager`，不持久化。

## Error Handling

建议 AppError code：

- `telnet_host_missing`
- `telnet_port_invalid`
- `telnet_connect_failed`
- `serial_port_missing`
- `serial_baud_rate_invalid`
- `serial_data_bits_invalid`
- `serial_parity_invalid`
- `serial_stop_bits_invalid`
- `serial_flow_control_invalid`
- `serial_list_failed`
- `serial_open_failed`
- `serial_write_failed`

前端展示 `message`，调试详情保留在错误对象，不把底层英文堆栈直接铺满 UI。

## Rollback

回滚范围清晰：

- 移除新增 Telnet/串口后端模块和命令。
- 移除 `commands.ts` wrapper 与前端入口。
- 恢复 ConnectionDialog 协议 chip。
- 删除新增依赖 `serialport`。

不会影响已有 SSH、SFTP、远程文件、隧道和设置数据。
