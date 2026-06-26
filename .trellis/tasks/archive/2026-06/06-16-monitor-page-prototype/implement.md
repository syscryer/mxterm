# 监控页真实实现计划

## 原型一致性原则

真实实现必须严格按当前原型迁移：

- UI 源头：`prototype/light-neutral/mxterm-monitor-panel.html`
- CPU 参考：`prototype/light-neutral/mxterm-monitor-cpu-grid.html`
- 不重新设计，不换信息架构，不改成另一套视觉风格。
- 保持右侧窄面板结构、`状态 / 硬件 / 网络 / 进程` tab、卡片密度、圆角、线条、字号、图标尺度、轻滚动和紧凑表格风格。
- 使用项目现有 Radix + Lucide + shared UI 方式实现；不要引入新 UI 框架或普通 UI 第二图标库。
- 无 GPU 时隐藏 GPU 卡片；温度取不到时隐藏温度项；CPU 全核心过多时卡片内部轻滚动；进程危险操作必须显式确认。

每次前端迁移后都要对照原型截图/页面检查，发现偏离先修 UI，再继续做数据接入。

## 实现顺序

### 1. 固化前后端类型契约

- 新增 `src/features/monitor/monitorTypes.ts`。
- 按 `design.md` 定义 `RemoteMonitorSnapshot`、CPU、Memory、GPU、Disk、Network、Process 类型。
- 在 `src/shared/tauri/commands.ts` 增加 typed wrappers：
  - `remoteMonitorSnapshot(connectionId, options)`
  - `remoteMonitorProcessSignal(input)`
- Rust 侧在 `src-tauri/src/commands.rs` 增加 request/result command 边界。
- 注册 command 到 `src-tauri/src/lib.rs`。

验证：

- `pnpm check`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### 2. 实现 Linux 采集器与解析器

- 新增 `src-tauri/src/remote_monitor.rs`。
- 复用 `resolve_saved_connection(...)` 和 `ReusableExecSession::connect_resolved(...)`。
- 固定生成只读 Linux 采集脚本，不接受前端传任意命令。
- 采集并解析：
  - Host/OS：`hostname`、`/proc/uptime`、`/etc/os-release`、`uname`
  - CPU：`/proc/stat`、`/proc/loadavg`、`lscpu`、`/proc/cpuinfo`、cpufreq
  - Memory：`/proc/meminfo`
  - GPU：`nvidia-smi`，缺失时 `gpus: []`
  - Disk：`df -P -B1`、`lsblk -P`、`/proc/diskstats`
  - Network：默认路由、物理主网卡、`/proc/net/dev`
  - Processes：`ps -eo ... --sort=-pcpu`
- `RemoteMonitorManager` 保存上一轮 CPU/磁盘/网络计数器，计算百分比和实时速率。
- section 级错误进入 `MonitorSourceError`，整体 SSH 失败才返回 command-level `AppError`。

验证：

- 为 parser 加 fixture 单测。
- `cargo test --manifest-path src-tauri/Cargo.toml remote_monitor --lib`
- `cargo check --manifest-path src-tauri/Cargo.toml`

### 3. 实现进程操作

- `remote_monitor_process_signal` 只允许 `term / kill / hup`。
- Rust 验证 `connection_id`、`pid > 1`、signal enum。
- 远端命令只由固定 signal + 数字 pid 拼出。
- 权限不足返回 recoverable error，前端行内显示失败。

验证：

- 单测 PID 校验、signal 白名单、命令构造。
- `cargo test --manifest-path src-tauri/Cargo.toml remote_monitor --lib`

### 4. 迁移右侧监控面板 UI

- 在 `src/features/monitor/` 新增面板组件和 hook。
- 优先把原型结构迁移成真实 React：
  - `MonitorPanel`
  - `MonitorStatusView`
  - `MonitorHardwareView`
  - `MonitorNetworkView`
  - `MonitorProcessView`
- 保持原型的右侧窄面板布局和四 tab 交互。
- 样式优先复用现有 `src/styles/app.css` token 与共享 pane/card/list 模式。
- 如需新增样式，集中在现有全局样式体系中，避免 feature 内散落一套新视觉。

原型一致性验收：

- 状态页：CPU 型号、使用率、频率、全核心轻滚动、内存圆环、磁盘读写、主物理网卡与 IP，布局与原型一致。
- 硬件页：硬件档案、核心部件、存储与网络、GPU 多卡，密度和行样式与原型一致。
- 网络页：主网卡身份、上下行、图表、连接列表与原型一致。
- 进程页：搜索/筛选/刷新、行操作、确认状态与原型一致。
- 无 GPU、无温度、很多核心、很多磁盘时，展示规则与原型一致。

验证：

- `pnpm check`
- `npm run build`
- 浏览器/桌面截图对照原型，至少检查普通桌面高度和较窄右侧面板状态。

### 5. 接入真实轮询状态

- hook 管理：
  - 状态页默认 3 秒刷新。
  - 网络/磁盘细节页可 1-2 秒刷新。
  - 进程页激活时 5 秒刷新并请求进程列表。
  - 面板折叠、窗口不可见、无活动连接时暂停。
- 前端保留最近 60 秒图表历史。
- command 失败显示连接级错误，section 失败显示卡片级轻警告。
- 浏览器预览无 Tauri 时保留静态 mock，方便 UI 检查。

验证：

- `pnpm check`
- 手动验证刷新、tab 切换、暂停/恢复、错误状态。

### 6. 集成到 Workspace 右侧工具区

- 将监控 tab 接入现有右侧 pane，不破坏文件/传输面板。
- 使用活动 SSH 连接的 `connection.id` 调用监控命令。
- 无活动连接时显示空状态，不调用后端。
- 保持终端和文件面板 mounted 规则，避免影响 SSH 会话和文件树状态。

验证：

- 打开终端后切到监控，再切回文件/终端，确认状态不丢。
- `pnpm check`
- `npm run build`

## 最终验收

- 原型文件仍可直接打开。
- 真实 UI 与原型视觉一致，不出现额外大卡片、营销式布局、重渐变、第二套图标风格或松散间距。
- 无 GPU 时不展示 GPU 卡片。
- CPU 温度取不到时不展示温度卡片。
- CPU 频率可取时展示当前/基准/最大频率。
- 内存频率首版不展示。
- 多核心使用卡片内部轻滚动。
- 多磁盘默认展示摘要 + 前几项 + 展开。
- 主网卡优先物理网卡，过滤 docker/veth/bridge 等虚拟接口。
- 进程页支持操作，并有显式确认。
- `pnpm check`、`npm run build`、`cargo fmt --check`、`cargo check` 通过。
