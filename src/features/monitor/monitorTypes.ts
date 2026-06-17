export interface RemoteMonitorSnapshotOptions {
  includeProcesses?: boolean;
  processLimit?: number;
}

export type RemoteProcessSignal = "term" | "kill" | "hup";

export interface RemoteMonitorProcessSignalInput {
  connectionId: string;
  pid: number;
  signal: RemoteProcessSignal;
}

export interface RemoteMonitorSnapshot {
  collected_at_ms: number;
  refresh_hint_ms: number;
  host: RemoteHostSummary;
  cpu: RemoteCpuSummary;
  memory: RemoteMemorySummary;
  gpus: RemoteGpuDevice[];
  disks: RemoteDiskSummary;
  network: RemoteNetworkSummary;
  processes: RemoteProcessList;
}

export interface MonitorSourceError {
  source: string;
  code: string;
  message: string;
  recoverable: boolean;
}

export interface RemoteHostSummary {
  hostname?: string | null;
  uptime_seconds?: number | null;
  os?: RemoteHostOsSummary | null;
  errors?: MonitorSourceError[] | null;
}

export interface RemoteHostOsSummary {
  id?: string | null;
  name?: string | null;
  version?: string | null;
  kernel?: string | null;
  arch?: string | null;
}

export interface RemoteCpuSummary {
  model?: string | null;
  sockets?: number | null;
  physical_cores?: number | null;
  logical_cores?: number | null;
  usage_percent?: number | null;
  load_avg?: [number, number, number] | null;
  current_frequency_mhz?: number | null;
  base_frequency_mhz?: number | null;
  max_frequency_mhz?: number | null;
  temperature_celsius?: number | null;
  cores: RemoteCpuCoreSummary[];
  errors?: MonitorSourceError[] | null;
}

export interface RemoteCpuCoreSummary {
  id: number;
  label: string;
  usage_percent?: number | null;
  current_frequency_mhz?: number | null;
}

export interface RemoteMemorySummary {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  free_bytes?: number | null;
  cached_bytes?: number | null;
  buffers_bytes?: number | null;
  swap_total_bytes?: number | null;
  swap_used_bytes?: number | null;
  errors?: MonitorSourceError[] | null;
}

export interface RemoteGpuDevice {
  index: number;
  name: string;
  usage_percent?: number | null;
  memory_used_bytes?: number | null;
  memory_total_bytes?: number | null;
  temperature_celsius?: number | null;
  power_watts?: number | null;
  errors?: MonitorSourceError[] | null;
}

export interface RemoteDiskSummary {
  mounts: RemoteDiskMountUsage[];
  devices: RemoteDiskDevice[];
  io: RemoteDiskIoSample[];
  errors?: MonitorSourceError[] | null;
}

export interface RemoteDiskMountUsage {
  filesystem: string;
  mount_point: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  usage_percent: number;
  type?: string | null;
}

export type RemoteDiskDeviceKind =
  | "disk"
  | "part"
  | "raid"
  | "lvm"
  | "rom"
  | "loop"
  | "other";

export interface RemoteDiskDevice {
  name: string;
  type: RemoteDiskDeviceKind;
  size_bytes?: number | null;
  model?: string | null;
  transport?: string | null;
  mount_points?: string[] | null;
}

export interface RemoteDiskIoSample {
  name: string;
  read_bytes_per_sec?: number | null;
  write_bytes_per_sec?: number | null;
  busy_percent?: number | null;
}

export interface RemoteNetworkSummary {
  primary?: RemoteNetworkInterfaceSummary | null;
  interfaces?: RemoteNetworkInterfaceSummary[] | null;
  traffic: RemoteNetworkTrafficSample[];
  errors?: MonitorSourceError[] | null;
}

export type RemoteNetworkInterfaceState = "up" | "down" | "unknown";

export interface RemoteNetworkInterfaceSummary {
  name: string;
  display_name?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  state?: RemoteNetworkInterfaceState | null;
  speed_mbps?: number | null;
  is_virtual?: boolean | null;
}

export interface RemoteNetworkTrafficSample {
  interface_name: string;
  rx_bytes_per_sec?: number | null;
  tx_bytes_per_sec?: number | null;
  rx_total_bytes?: number | null;
  tx_total_bytes?: number | null;
}

export interface RemoteProcessList {
  items: RemoteProcessSummary[];
  can_signal: boolean;
  errors?: MonitorSourceError[] | null;
}

export interface RemoteProcessSummary {
  pid: number;
  ppid?: number | null;
  user?: string | null;
  command: string;
  args?: string | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  rss_bytes?: number | null;
  state?: string | null;
}

export interface RemoteProcessActionResult {
  ok: boolean;
  pid: number;
  signal: RemoteProcessSignal;
  message: string;
}
