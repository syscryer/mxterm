# 监控页数据契约与 SSH/Linux 采集设计

## 目标

把当前 HTML 原型中已经确认的监控体验，沉淀成后续 React/Radix + Rust/Tauri 实现可以直接遵守的数据契约和采集边界。

本设计覆盖：

- 监控面板需要的快照数据结构。
- 前端 typed Tauri wrapper 与 Rust command 签名。
- Linux SSH 采集来源、刷新节奏和缺失数据策略。
- 进程操作的安全边界。
- UI 页面与数据字段的映射关系。

本设计暂不修改生产 React/Rust 代码。

## 范围

首版只面向已保存 SSH 连接的 Linux 主机监控。前端只发送 `connection_id`、进程 `pid` 和白名单信号，Rust 负责加载保存的连接、凭据、代理、跳板机和超时配置。

首版使用轮询快照，不做长连接流式推送。后续如果需要更高频图表，再在同一数据契约上追加事件流。

非目标：

- 不支持前端传任意 shell 命令。
- 不展示 GPU 占位卡片；没有 GPU 时 `gpus: []`，UI 直接隐藏 GPU 区域。
- 不默认暴露硬盘序列号、网卡 MAC、机器 UUID 等敏感硬件标识。
- 不要求 root 权限；需要 root 才能读取的温度、内存条 SPD、硬件序列号等字段缺失时保持为空。
- 内存频率/时序首版不做；Linux 上可靠读取 DIMM 速度通常依赖 `dmidecode` / `lshw` 和权限，先避免展示不稳定指标。

## 架构边界

```text
MonitorPanel / useRemoteMonitor
  -> src/shared/tauri/commands.ts typed wrappers
  -> src-tauri/src/commands.rs Tauri commands
  -> remote_monitor module / manager
  -> resolve_saved_connection(...)
  -> ReusableExecSession::connect_resolved(...)
  -> fixed Linux collector scripts
```

关键约束：

- 复用现有 `resolve_saved_connection(...)` 与 `ReusableExecSession::connect_resolved(...)`，保持连接、凭据、代理、跳板和 host-key 行为一致。
- command 失败统一返回 `AppError { code, message, raw_message, recoverable }`。
- 部分数据源失败不应导致整个快照失败；只有 SSH 连接、认证、host-key、命令通道这类整体链路失败才返回 command-level `AppError`。
- Rust 侧应有 `RemoteMonitorManager` 保存每个连接的上一次 CPU、磁盘、网络计数器，用于计算百分比和速率。冷启动或缓存过期时允许返回 `null` 或做一次短间隔双采样。

## Tauri Command 签名

### Rust

```rust
#[derive(Debug, Deserialize)]
pub struct RemoteMonitorSnapshotRequest {
    pub connection_id: String,
    #[serde(default)]
    pub include_processes: bool,
    #[serde(default)]
    pub process_limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct RemoteProcessSignalRequest {
    pub connection_id: String,
    pub pid: u32,
    pub signal: RemoteProcessSignal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteProcessSignal {
    Term,
    Kill,
    Hup,
}

#[tauri::command]
pub async fn remote_monitor_snapshot(
    app: AppHandle,
    manager: State<'_, RemoteMonitorManager>,
    request: RemoteMonitorSnapshotRequest,
) -> Result<RemoteMonitorSnapshot, AppError>

#[tauri::command]
pub async fn remote_monitor_process_signal(
    app: AppHandle,
    request: RemoteProcessSignalRequest,
) -> Result<RemoteProcessActionResult, AppError>
```

### TypeScript wrapper

```ts
export function remoteMonitorSnapshot(
  connectionId: string,
  options: { includeProcesses?: boolean; processLimit?: number } = {},
) {
  return invoke<RemoteMonitorSnapshot>("remote_monitor_snapshot", {
    request: {
      connection_id: connectionId,
      include_processes: options.includeProcesses ?? false,
      process_limit: options.processLimit,
    },
  });
}

export function remoteMonitorProcessSignal(input: {
  connectionId: string;
  pid: number;
  signal: "term" | "kill" | "hup";
}) {
  return invoke<RemoteProcessActionResult>("remote_monitor_process_signal", {
    request: {
      connection_id: input.connectionId,
      pid: input.pid,
      signal: input.signal,
    },
  });
}
```

## 数据契约

字段命名保持 Rust serde 的 snake_case。前端 feature 类型可以保存在 `src/features/monitor/monitorTypes.ts`。

```ts
export type RemoteMonitorSnapshot = {
  collected_at_ms: number;
  refresh_hint_ms: number;
  host: RemoteHostSummary;
  cpu: RemoteCpuSummary;
  memory: RemoteMemorySummary;
  gpus: RemoteGpuDevice[];
  disks: RemoteDiskSummary;
  network: RemoteNetworkSummary;
  processes: RemoteProcessList;
};

export type MonitorSourceError = {
  source: string;
  code: string;
  message: string;
  recoverable: boolean;
};

export type RemoteHostSummary = {
  hostname?: string;
  uptime_seconds?: number;
  os?: {
    id?: string;
    name?: string;
    version?: string;
    kernel?: string;
    arch?: string;
  };
  errors?: MonitorSourceError[];
};

export type RemoteCpuSummary = {
  model?: string;
  sockets?: number;
  physical_cores?: number;
  logical_cores?: number;
  usage_percent?: number | null;
  load_avg?: [number, number, number];
  current_frequency_mhz?: number | null;
  base_frequency_mhz?: number | null;
  max_frequency_mhz?: number | null;
  temperature_celsius?: number | null;
  cores: Array<{
    id: number;
    label: string;
    usage_percent?: number | null;
    current_frequency_mhz?: number | null;
  }>;
  errors?: MonitorSourceError[];
};

export type RemoteMemorySummary = {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  free_bytes?: number;
  cached_bytes?: number;
  buffers_bytes?: number;
  swap_total_bytes?: number;
  swap_used_bytes?: number;
  errors?: MonitorSourceError[];
};

export type RemoteGpuDevice = {
  index: number;
  name: string;
  usage_percent?: number | null;
  memory_used_bytes?: number | null;
  memory_total_bytes?: number | null;
  temperature_celsius?: number | null;
  power_watts?: number | null;
  errors?: MonitorSourceError[];
};

export type RemoteDiskSummary = {
  mounts: RemoteDiskMountUsage[];
  devices: RemoteDiskDevice[];
  io: RemoteDiskIoSample[];
  errors?: MonitorSourceError[];
};

export type RemoteDiskMountUsage = {
  filesystem: string;
  mount_point: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  usage_percent: number;
  type?: string;
};

export type RemoteDiskDevice = {
  name: string;
  type: "disk" | "part" | "raid" | "lvm" | "rom" | "loop" | "other";
  size_bytes?: number;
  model?: string;
  transport?: string;
  mount_points?: string[];
};

export type RemoteDiskIoSample = {
  name: string;
  read_bytes_per_sec?: number | null;
  write_bytes_per_sec?: number | null;
  busy_percent?: number | null;
};

export type RemoteNetworkSummary = {
  primary?: RemoteNetworkInterfaceSummary;
  interfaces?: RemoteNetworkInterfaceSummary[];
  traffic: RemoteNetworkTrafficSample[];
  errors?: MonitorSourceError[];
};

export type RemoteNetworkInterfaceSummary = {
  name: string;
  display_name?: string;
  ipv4?: string;
  ipv6?: string;
  state?: "up" | "down" | "unknown";
  speed_mbps?: number | null;
  is_virtual?: boolean;
};

export type RemoteNetworkTrafficSample = {
  interface_name: string;
  rx_bytes_per_sec?: number | null;
  tx_bytes_per_sec?: number | null;
  rx_total_bytes?: number;
  tx_total_bytes?: number;
};

export type RemoteProcessList = {
  items: RemoteProcessSummary[];
  can_signal: boolean;
  errors?: MonitorSourceError[];
};

export type RemoteProcessSummary = {
  pid: number;
  ppid?: number;
  user?: string;
  command: string;
  args?: string;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  rss_bytes?: number;
  state?: string;
};

export type RemoteProcessActionResult = {
  ok: boolean;
  pid: number;
  signal: "term" | "kill" | "hup";
  message: string;
};
```

## Linux 采集来源

所有采集脚本由 Rust 固定生成，使用 `sh -lc` 运行。优先使用 `/proc`、`/sys` 和常见基础命令，输出采用带 section 的文本格式，由 Rust 解析和归一化，不依赖远端安装 Python、Node、jq。

建议输出格式：

```text
MXBEGIN<TAB>cpu_stat
...
MXEND<TAB>cpu_stat
```

每个 section 解析失败只进入对应 `errors`，不影响其它 section。

### Host / OS

来源：

- `hostname`
- `/proc/uptime`
- `/etc/os-release`
- `uname -srmo`

用途：

- 状态页顶部主机信息。
- 硬件页系统信息。
- 连接列表已有 `remote_os_*` 字段仍由 `connection_probe_system` 维护，监控快照不写回连接仓库。

### CPU

来源：

- `/proc/stat`：总 CPU 与每个 `cpuN` 原始计数。
- `/proc/loadavg`：1/5/15 分钟负载。
- `lscpu`：型号、插槽、物理核心、逻辑核心；没有时回退 `/proc/cpuinfo`。
- `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq`：每个核心当前频率，单位 kHz；没有 cpufreq 时回退 `/proc/cpuinfo` 的 `cpu MHz`。
- `/sys/devices/system/cpu/cpu*/cpufreq/base_frequency`、`cpuinfo_min_freq`、`cpuinfo_max_freq`：基准/最大频率，单位 kHz；没有时回退 `lscpu` 的 `CPU max MHz` / `CPU min MHz`。
- `/sys/class/thermal/thermal_zone*/temp`、`/sys/class/hwmon/hwmon*/temp*_input`：温度，读取不到则 `temperature_celsius: null`。

处理：

- CPU 使用率由 Rust 使用前后两次 `/proc/stat` 计数器 delta 计算。
- `cores` 返回所有逻辑核心；UI 在核心数很多时使用卡片内部轻滚动。
- `current_frequency_mhz` 返回可读核心频率的平均值；每个核心可读时也填入 core item。读取不到时返回 `null`，UI 显示 `N/A` 或隐藏频率子行。
- `base_frequency_mhz` 与 `max_frequency_mhz` 属于硬件/能力信息；远端不支持 cpufreq 或虚拟机环境缺失时保持 `null`。
- `temperature_celsius: null` 时 UI 不展示 CPU 温度卡片或 N/A 占位；CPU 卡片只保留使用率、频率和核心列表。
- 首次采样没有 delta 时，允许 `usage_percent: null` 和核心 `usage_percent: null`，或在 Rust 中短间隔双采样后返回首屏数值。

### Memory

来源：

- `/proc/meminfo`

处理：

- `total_bytes = MemTotal`
- `available_bytes = MemAvailable`，缺失时用 `MemFree + Buffers + Cached` 估算。
- `used_bytes = total_bytes - available_bytes`
- swap 来自 `SwapTotal` / `SwapFree`。

### GPU

来源：

- `command -v nvidia-smi`
- `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits`

处理：

- 没有 `nvidia-smi` 或没有 NVIDIA GPU 时返回 `gpus: []`，不作为可见错误。
- 多卡逐条返回，例如多张 `NVIDIA H200`。
- 后续可追加 AMD/ROCm collector，但首版不引入额外依赖。

### Disk

来源：

- `df -P -B1`：挂载点容量。
- `lsblk -b -P -o NAME,TYPE,SIZE,MODEL,TRAN,MOUNTPOINTS`：物理磁盘和分区；没有 `lsblk` 时回退 `/sys/block/*` 的 `size`、`device/model`。
- `/proc/diskstats`：读写扇区和 IO 时间原始计数。

处理：

- 状态页按 mount point 展示容量，默认展示前 3 个，很多磁盘时 UI 展开/收起。
- 硬件页按 physical device 展示磁盘。
- `io` 的 `read_bytes_per_sec` / `write_bytes_per_sec` 由 Rust 基于 `/proc/diskstats` delta 计算，默认扇区大小按 512 bytes。
- 过滤明显的伪挂载和临时挂载，例如 `tmpfs`、`devtmpfs`、`overlay`、`squashfs`、`proc`、`sysfs`、`cgroup*`，但不要在 UI 层用隐藏掩盖解析错误。

### Network

来源：

- `ip route get 1.1.1.1`：默认出口网卡与源 IP。
- `ip route show default`：默认路由回退。
- `ip -o addr show dev <iface>`：IPv4 / IPv6。
- `/sys/class/net/<iface>/operstate`
- `/sys/class/net/<iface>/speed`
- `/proc/net/dev`：收发字节原始计数。

处理：

- 主网卡优先取默认路由上的非虚拟接口。
- 过滤虚拟接口名称：`lo`、`docker*`、`br-*`、`veth*`、`virbr*`、`vmnet*`、`vboxnet*`、`tun*`、`tap*`、`wg*`、`tailscale*`、`cni*`、`flannel*`、`kube-ipvs*`。
- 如果默认路由只落在虚拟接口上，返回该接口但标记 `is_virtual: true`，UI 可弱提示“未识别到物理主网卡”。
- 实时上传/下载速率由 Rust 基于 `/proc/net/dev` delta 计算。

### Processes

来源：

- `ps -eo pid,ppid,user,comm,pcpu,pmem,rss,stat,args --sort=-pcpu`
- 若远端 BusyBox `ps` 不支持这些列，首版返回 process section error；后续再实现 `/proc/<pid>` fallback。

处理：

- `process_limit` 默认 80，进程页激活时请求进程列表；普通状态刷新可以不带进程以降低开销。
- `rss` 从 KiB 转为 bytes。
- `args` 可能很长，Rust 可限制为 512 字符以内，避免 IPC payload 过大。

## 进程操作

`remote_monitor_process_signal` 只允许白名单信号：

| UI 动作 | signal | 远端命令 |
| --- | --- | --- |
| 结束进程 | `term` | `kill -TERM <pid>` |
| 强制结束 | `kill` | `kill -KILL <pid>` |
| 重新加载 | `hup` | `kill -HUP <pid>` |

安全规则：

- Rust 验证 `pid > 1`，拒绝 `0`、`1` 和负数语义。
- signal 是 enum，不接受前端字符串拼命令。
- 命令中只插入 Rust 验证后的整数 pid 和 enum 映射出的固定信号。
- 权限不足返回 recoverable `AppError`，UI 在当前行附近显示失败，不移除进程。
- 成功后返回 `ok: true`，UI 可以先乐观隐藏或标记该行，再等待下一次进程刷新确认。

建议错误码：

| 条件 | code | recoverable |
| --- | --- | --- |
| `connection_id` 为空 | `remote_monitor_connection_missing` | false |
| `pid <= 1` | `remote_monitor_process_pid_invalid` | true |
| kill 命令非 0 | `remote_monitor_process_signal_failed` | true |
| 快照脚本启动失败 | `remote_monitor_collect_failed` | true |
| 快照 section 解析失败 | section `MonitorSourceError` | true |

## 刷新策略

- 状态页：默认 3 秒刷新一次。
- 网络/磁盘速率：跟随状态快照，必要时细节页可降到 1-2 秒。
- 进程页：激活时 5 秒刷新一次，搜索/筛选只在前端本地过滤当前列表。
- 面板折叠、窗口不可见、连接断开时暂停轮询。
- 后端返回 `refresh_hint_ms`，前端在没有特殊用户操作时尊重该建议。
- 图表历史首版由前端保留最近 60 秒快照；后续详情页再扩展 5/15 分钟。

## UI 映射

- `状态`：host、CPU 型号/总占用/当前频率/所有核心、GPU 多卡、内存圆环、磁盘容量 + 实时读写、物理主网卡 + IP + 上下行。
- `硬件`：OS/kernel/arch、CPU 型号与核心数/基准频率/最大频率、GPU 设备列表、物理磁盘列表、主网卡。隐藏序列号、MAC、UUID。
- `网络`：`network.primary` 作为顶部身份，`traffic` 作为图表和实时速率，虚拟网卡默认不进入主身份。
- `进程`：`processes.items` 列表、搜索/筛选、详情、结束/强制结束操作；危险操作需要显式确认。

缺失数据表现：

- `gpus: []`：不展示 GPU 卡片。
- `cpu.current_frequency_mhz: null`：显示 `N/A` 或隐藏频率子行，不影响 CPU 使用率和核心列表。
- `cpu.temperature_celsius: null`：隐藏 CPU 温度卡片/指标，不展示 `N/A` 占位。
- `gpu.temperature_celsius: null`：隐藏该 GPU 的温度片段，其它 GPU 利用率、显存和功耗继续展示。
- 单个 section 有 `errors`：对应卡片出现轻量警告/不可用状态，其它卡片继续展示。
- 全量 command 失败：面板显示连接级错误和重试入口。

## 后续实现文件建议

- `src/features/monitor/monitorTypes.ts`
- `src/features/monitor/useRemoteMonitor.ts`
- `src/features/monitor/MonitorPanel.tsx`
- `src/shared/tauri/commands.ts`
- `src-tauri/src/remote_monitor.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`

## 验证计划

实现阶段至少需要：

- Rust parser 单元测试：`/proc/stat`、`/proc/meminfo`、`df -P -B1`、`lsblk -P`、`/proc/diskstats`、`/proc/net/dev`、`nvidia-smi csv`、`ps` fixture。
- Rust command 注册后运行 `cargo fmt --manifest-path src-tauri/Cargo.toml --check`。
- Rust command/serde 变更后运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- 前端 wrapper/types/组件变更后运行 `pnpm check`。
- 浏览器原型迁移时用实际 SSH 连接验证：无 GPU 主机、多 GPU 主机、多磁盘主机、CPU 温度不可用主机隐藏温度卡片、无 `nvidia-smi` 主机、权限不足 kill 进程。
