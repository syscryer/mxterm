import {
  Activity,
  AlertTriangle,
  CircleStop,
  Cpu,
  Database,
  Download,
  Filter,
  Gauge,
  Gpu,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  Info,
  List,
  MemoryStick,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Thermometer,
  Upload,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import type {
  MonitorSourceError,
  RemoteCpuSummary,
  RemoteDiskSummary,
  RemoteGpuDevice,
  RemoteMemorySummary,
  RemoteMonitorSnapshot,
  RemoteNetworkSummary,
  RemoteProcessSignal,
  RemoteProcessSummary,
} from "./monitorTypes";
import {
  useRemoteMonitor,
  type MonitorPanelView,
} from "./useRemoteMonitor";
import "./monitor.css";

interface MonitorPanelProps {
  active: boolean;
  connection: ConnectionProfile | null;
}

interface ProcessActionTarget {
  command: string;
  pid: number;
  signal: RemoteProcessSignal;
}

const monitorViews: Array<{
  icon: LucideIcon;
  label: string;
  value: MonitorPanelView;
}> = [
  { icon: Activity, label: "状态", value: "status" },
  { icon: Server, label: "硬件", value: "hardware" },
  { icon: Network, label: "网络", value: "network" },
  { icon: List, label: "进程", value: "processes" },
];

export function MonitorPanel({ active, connection }: MonitorPanelProps) {
  const [view, setView] = useState<MonitorPanelView>("status");
  const [diskExpanded, setDiskExpanded] = useState(false);
  const [processQuery, setProcessQuery] = useState("");
  const [busyOnly, setBusyOnly] = useState(false);
  const [selectedProcessPid, setSelectedProcessPid] = useState<number | null>(null);
  const [pendingProcessAction, setPendingProcessAction] =
    useState<ProcessActionTarget | null>(null);
  const [processErrors, setProcessErrors] = useState<Record<number, string>>({});
  const {
    error,
    history,
    loading,
    refresh,
    refreshing,
    signalProcess,
    snapshot,
  } = useRemoteMonitor({
    active,
    connectionId: connection?.id || null,
    view,
  });
  const hostName = snapshot?.host.hostname || connection?.name || "监控";
  const hostMeta = hostMetaText(snapshot);
  const selectedProcess = selectedProcessPid
    ? snapshot?.processes.items.find((item) => item.pid === selectedProcessPid) || null
    : null;

  return (
    <section className="monitor-shell" aria-label="远程监控">
      <header className="monitor-host">
        <div className="monitor-host-main">
          <div className="monitor-host-title-row">
            <strong className="monitor-host-name">{hostName}</strong>
            <span className="monitor-status-pill">
              <span className="monitor-status-dot" />
              {connection ? "采集中" : "待连接"}
            </span>
          </div>
          <div className="monitor-host-meta-row">
            <span>{hostMeta}</span>
            <span>{snapshot ? formatUptime(snapshot.host.uptime_seconds) : "等待快照"}</span>
          </div>
        </div>
        <div className="monitor-host-actions">
          <Tooltip label="刷新监控">
            <button
              className="monitor-icon-action"
              type="button"
              aria-label="刷新监控"
              disabled={!connection || refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`ui-icon ${refreshing ? "spin" : ""}`} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>

      <nav className="monitor-view-switcher" aria-label="监控视图">
        {monitorViews.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`monitor-view-tab ${view === item.value ? "active" : ""}`}
              key={item.value}
              type="button"
              aria-current={view === item.value ? "page" : undefined}
              onClick={() => setView(item.value)}
            >
              <Icon className="ui-icon" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="monitor-scroll">
        {!connection ? (
          <MonitorEmptyState title="打开一个 SSH 会话后显示监控数据。" />
        ) : error ? (
          <MonitorInlineAlert message={error} onRetry={() => void refresh()} />
        ) : null}

        {connection && !snapshot && !error ? (
          <MonitorEmptyState title={loading ? "正在读取监控快照..." : "等待下一次监控快照。"} />
        ) : null}

        {snapshot ? (
          <>
            {view === "status" ? (
              <MonitorStatusView
                diskExpanded={diskExpanded}
                history={history}
                snapshot={snapshot}
                onDiskExpandedChange={setDiskExpanded}
              />
            ) : null}
            {view === "hardware" ? <MonitorHardwareView snapshot={snapshot} /> : null}
            {view === "network" ? (
              <MonitorNetworkView history={history} network={snapshot.network} />
            ) : null}
            {view === "processes" ? (
              <MonitorProcessView
                busyOnly={busyOnly}
                processErrors={processErrors}
                query={processQuery}
                selectedProcess={selectedProcess}
                snapshot={snapshot}
                onBusyOnlyChange={setBusyOnly}
                onProcessQueryChange={setProcessQuery}
                onProcessSelect={setSelectedProcessPid}
                onProcessSignal={(process, signal) =>
                  setPendingProcessAction({
                    command: process.command,
                    pid: process.pid,
                    signal,
                  })
                }
                onRefresh={() => void refresh()}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel={processConfirmLabel(pendingProcessAction?.signal)}
        description={processConfirmDescription(pendingProcessAction)}
        open={Boolean(pendingProcessAction)}
        title="确认进程操作"
        onOpenChange={(open) => {
          if (!open) {
            setPendingProcessAction(null);
          }
        }}
        onConfirm={async () => {
          if (!pendingProcessAction) {
            return;
          }
          try {
            await signalProcess(pendingProcessAction.pid, pendingProcessAction.signal);
            setProcessErrors((current) => {
              const next = { ...current };
              delete next[pendingProcessAction.pid];
              return next;
            });
            await refresh({ silent: true });
          } catch (nextError) {
            setProcessErrors((current) => ({
              ...current,
              [pendingProcessAction.pid]: formatError(nextError),
            }));
          } finally {
            setPendingProcessAction(null);
          }
        }}
      />
    </section>
  );
}

function MonitorStatusView({
  diskExpanded,
  history,
  snapshot,
  onDiskExpandedChange,
}: {
  diskExpanded: boolean;
  history: RemoteMonitorSnapshot[];
  snapshot: RemoteMonitorSnapshot;
  onDiskExpandedChange: (expanded: boolean) => void;
}) {
  return (
    <>
      <CpuCard cpu={snapshot.cpu} />
      {snapshot.gpus.length > 0 ? <GpuCard gpus={snapshot.gpus} /> : null}
      <MemoryCard memory={snapshot.memory} />
      <DiskCard
        diskExpanded={diskExpanded}
        disks={snapshot.disks}
        onDiskExpandedChange={onDiskExpandedChange}
      />
      <NetworkCard history={history} network={snapshot.network} />
      <MonitorCard
        badge={formatTime(snapshot.collected_at_ms)}
        icon={<Activity className="ui-icon" aria-hidden="true" />}
        title="采集状态"
      >
        <div className="monitor-activity-list">
          <MonitorActivityRow
            icon={<Server className="ui-icon" aria-hidden="true" />}
            title="主机快照"
            detail={`${snapshot.host.hostname || "远程主机"} · ${formatUptime(snapshot.host.uptime_seconds)}`}
          />
          <MonitorActivityRow
            icon={<Gauge className="ui-icon" aria-hidden="true" />}
            title="负载"
            detail={formatLoadAvg(snapshot.cpu.load_avg)}
          />
          <MonitorActivityRow
            icon={<AlertTriangle className="ui-icon" aria-hidden="true" />}
            title="采集警告"
            detail={sourceErrorCount(snapshot) > 0 ? `${sourceErrorCount(snapshot).toString()} 项` : "无"}
            tone={sourceErrorCount(snapshot) > 0 ? "warn" : undefined}
          />
        </div>
      </MonitorCard>
    </>
  );
}

function CpuCard({ cpu }: { cpu: RemoteCpuSummary }) {
  const coreCount = cpu.cores.length || cpu.logical_cores || 0;

  return (
    <MonitorCard
      badge={coreCount ? `${coreCount.toString()} 核心` : undefined}
      errors={cpu.errors}
      icon={<Cpu className="ui-icon" aria-hidden="true" />}
      title="CPU"
    >
      <p className="monitor-component-model">{cpu.model || "CPU 型号未识别"}</p>
      <div className="monitor-metric-grid">
        <MetricTile
          icon={<Gauge className="ui-icon" aria-hidden="true" />}
          label="占用"
          value={formatPercent(cpu.usage_percent, 1)}
          sub={formatLoadAvg(cpu.load_avg)}
        />
        <MetricTile
          icon={<Zap className="ui-icon" aria-hidden="true" />}
          label="当前频率"
          value={formatFrequency(cpu.current_frequency_mhz)}
          sub={`基准 ${formatFrequency(cpu.base_frequency_mhz)} · 最大 ${formatFrequency(cpu.max_frequency_mhz)}`}
        />
        {cpu.temperature_celsius != null ? (
          <MetricTile
            icon={<Thermometer className="ui-icon" aria-hidden="true" />}
            label="温度"
            value={`${cpu.temperature_celsius.toFixed(1)}°C`}
            sub="传感器可读"
          />
        ) : null}
      </div>
      <div className="monitor-core-list-head">
        <span>全部核心</span>
        <span>{coreCount > 10 ? "内部滚动" : "实时占用"}</span>
      </div>
      <div className="monitor-core-list-scroll">
        <div className="monitor-core-list">
          {cpu.cores.map((core) => (
            <div className="monitor-core-row" key={core.id}>
              <span>{core.label || `Core ${core.id.toString()}`}</span>
              <ProgressBar value={core.usage_percent} />
              <strong>{formatPercent(core.usage_percent, 1)}</strong>
            </div>
          ))}
        </div>
      </div>
    </MonitorCard>
  );
}

function GpuCard({ gpus }: { gpus: RemoteGpuDevice[] }) {
  return (
    <MonitorCard
      badge={gpus.length === 1 ? "1 张卡" : `${gpus.length.toString()} 张卡`}
      icon={<Gpu className="ui-icon" aria-hidden="true" />}
      title="GPU"
    >
      <div className="monitor-device-list">
        {gpus.map((gpu) => {
          const memoryPercent = percentOf(gpu.memory_used_bytes, gpu.memory_total_bytes);
          return (
            <article className="monitor-device-row" key={`${gpu.index.toString()}-${gpu.name}`}>
              <div className="monitor-device-head">
                <strong>GPU {gpu.index.toString()}</strong>
                <span>{formatPercent(gpu.usage_percent, 0)}</span>
              </div>
              <p>{gpu.name}</p>
              <ProgressBar value={gpu.usage_percent} />
              <div className="monitor-device-meta">
                <span>显存 {formatBytePair(gpu.memory_used_bytes, gpu.memory_total_bytes)}</span>
                {memoryPercent != null ? <span>{memoryPercent.toFixed(0)}%</span> : null}
                {gpu.temperature_celsius != null ? (
                  <span>{gpu.temperature_celsius.toFixed(0)}°C</span>
                ) : null}
                {gpu.power_watts != null ? <span>{gpu.power_watts.toFixed(0)} W</span> : null}
              </div>
              <SourceErrors errors={gpu.errors} />
            </article>
          );
        })}
      </div>
    </MonitorCard>
  );
}

function MemoryCard({ memory }: { memory: RemoteMemorySummary }) {
  const usedPercent = percentOf(memory.used_bytes, memory.total_bytes) || 0;

  return (
    <MonitorCard
      errors={memory.errors}
      icon={<MemoryStick className="ui-icon" aria-hidden="true" />}
      title="内存"
    >
      <div className="monitor-donut-wrap monitor-memory-usage">
        <Donut percent={usedPercent} label={`${usedPercent.toFixed(0)}%`} />
        <div className="monitor-legend">
          <LegendRow label="已用" value={formatBytes(memory.used_bytes)} color="var(--mx-primary)" />
          <LegendRow label="可用" value={formatBytes(memory.available_bytes)} color="#16a34a" />
          <LegendRow label="缓存" value={formatBytes(memory.cached_bytes)} color="#d97706" />
          {memory.swap_total_bytes ? (
            <LegendRow
              label="Swap"
              value={formatBytePair(memory.swap_used_bytes, memory.swap_total_bytes)}
              color="#8b5cf6"
            />
          ) : null}
        </div>
      </div>
    </MonitorCard>
  );
}

function DiskCard({
  diskExpanded,
  disks,
  onDiskExpandedChange,
}: {
  diskExpanded: boolean;
  disks: RemoteDiskSummary;
  onDiskExpandedChange: (expanded: boolean) => void;
}) {
  const summary = summarizeDisks(disks);
  const visibleMounts = diskExpanded ? disks.mounts : disks.mounts.slice(0, 3);
  const hiddenCount = Math.max(0, disks.mounts.length - visibleMounts.length);

  return (
    <MonitorCard
      badge={`${disks.mounts.length.toString()} 挂载点`}
      errors={disks.errors}
      icon={<Database className="ui-icon" aria-hidden="true" />}
      title="磁盘"
    >
      <div className="monitor-disk-summary">
        <div className="monitor-disk-total">
          <strong>{formatBytePair(summary.used, summary.total)}</strong>
          <span>{formatPercent(percentOf(summary.used, summary.total), 0)} 已使用</span>
        </div>
        <span className="monitor-disk-count">{disks.devices.length.toString()} 块设备</span>
      </div>
      <div className="monitor-io-grid">
        <MetricTile
          icon={<HardDriveDownload className="ui-icon" aria-hidden="true" />}
          label="读取"
          value={formatByteRate(summary.read)}
        />
        <MetricTile
          icon={<HardDriveUpload className="ui-icon" aria-hidden="true" />}
          label="写入"
          value={formatByteRate(summary.write)}
        />
      </div>
      <div className="monitor-disk-list">
        {visibleMounts.map((mount) => (
          <article className="monitor-disk-row" key={`${mount.filesystem}:${mount.mount_point}`}>
            <div className="monitor-disk-head">
              <span className="monitor-disk-mount">
                <HardDrive className="ui-icon" aria-hidden="true" />
                <span>{mount.mount_point}</span>
              </span>
              <small>{formatPercent(mount.usage_percent, 0)}</small>
            </div>
            <ProgressBar value={mount.usage_percent} />
            <div className="monitor-disk-meta">
              <span>{mount.filesystem}</span>
              <span>{formatBytePair(mount.used_bytes, mount.total_bytes)}</span>
            </div>
          </article>
        ))}
      </div>
      {hiddenCount > 0 || diskExpanded ? (
        <button
          className="monitor-section-foot-button"
          type="button"
          aria-expanded={diskExpanded}
          onClick={() => onDiskExpandedChange(!diskExpanded)}
        >
          {diskExpanded ? "收起更多磁盘" : `展开 ${hiddenCount.toString()} 个更多磁盘`}
        </button>
      ) : null}
    </MonitorCard>
  );
}

function NetworkCard({
  history,
  network,
}: {
  history: RemoteMonitorSnapshot[];
  network: RemoteNetworkSummary;
}) {
  const primary = network.primary;
  const traffic = primaryTraffic(network);

  return (
    <MonitorCard
      errors={network.errors}
      icon={<Network className="ui-icon" aria-hidden="true" />}
      title="网络"
    >
      <NetworkIdentity network={network} />
      <div className="monitor-io-grid">
        <MetricTile
          icon={<Download className="ui-icon" aria-hidden="true" />}
          label="下行"
          value={formatByteRate(traffic?.rx_bytes_per_sec)}
          sub={traffic?.rx_total_bytes != null ? `Total ${formatBytes(traffic.rx_total_bytes)}` : undefined}
        />
        <MetricTile
          icon={<Upload className="ui-icon" aria-hidden="true" />}
          label="上行"
          value={formatByteRate(traffic?.tx_bytes_per_sec)}
          sub={traffic?.tx_total_bytes != null ? `Total ${formatBytes(traffic.tx_total_bytes)}` : undefined}
        />
      </div>
      <TrafficChart history={history} interfaceName={primary?.name || traffic?.interface_name || null} />
    </MonitorCard>
  );
}

function MonitorHardwareView({ snapshot }: { snapshot: RemoteMonitorSnapshot }) {
  const os = snapshot.host.os;
  const totalDiskSize = snapshot.disks.devices.reduce(
    (total, device) => total + (device.size_bytes || 0),
    0,
  );

  return (
    <>
      <section className="monitor-hardware-profile">
        <div className="monitor-hardware-mark">
          <Server className="ui-icon" aria-hidden="true" />
        </div>
        <div className="monitor-hardware-title">
          <strong>{snapshot.host.hostname || "远程主机"}</strong>
          <span>{[os?.name, os?.version].filter(Boolean).join(" ") || "Linux"}</span>
        </div>
      </section>

      <MonitorCard icon={<Server className="ui-icon" aria-hidden="true" />} title="系统信息">
        <div className="monitor-hardware-kv-list">
          <HardwareKv label="操作系统" value={[os?.name, os?.version].filter(Boolean).join(" ") || "未识别"} />
          <HardwareKv label="内核" value={os?.kernel || "未识别"} />
          <HardwareKv label="架构" value={os?.arch || "未识别"} />
          <HardwareKv label="运行时间" value={formatUptime(snapshot.host.uptime_seconds)} />
        </div>
      </MonitorCard>

      <MonitorCard
        badge={`${(snapshot.cpu.logical_cores || snapshot.cpu.cores.length).toString()} 线程`}
        errors={snapshot.cpu.errors}
        icon={<Cpu className="ui-icon" aria-hidden="true" />}
        title="处理器"
      >
        <div className="monitor-hardware-part-list">
          <HardwarePart
            icon={<Cpu className="ui-icon" aria-hidden="true" />}
            title={snapshot.cpu.model || "CPU 型号未识别"}
            detail={`${formatCoreShape(snapshot.cpu)} · 当前 ${formatFrequency(snapshot.cpu.current_frequency_mhz)}`}
            badge={`最大 ${formatFrequency(snapshot.cpu.max_frequency_mhz)}`}
          />
        </div>
      </MonitorCard>

      {snapshot.gpus.length > 0 ? (
        <MonitorCard
          badge={`${snapshot.gpus.length.toString()} 张卡`}
          icon={<Gpu className="ui-icon" aria-hidden="true" />}
          title="加速卡"
        >
          <div className="monitor-hardware-part-list">
            {snapshot.gpus.map((gpu) => (
              <HardwarePart
                badge={formatBytePair(gpu.memory_used_bytes, gpu.memory_total_bytes)}
                detail={[
                  gpu.temperature_celsius != null ? `${gpu.temperature_celsius.toFixed(0)}°C` : null,
                  gpu.power_watts != null ? `${gpu.power_watts.toFixed(0)} W` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                icon={<Gpu className="ui-icon" aria-hidden="true" />}
                key={`${gpu.index.toString()}-${gpu.name}`}
                title={`GPU ${gpu.index.toString()} · ${gpu.name}`}
              />
            ))}
          </div>
        </MonitorCard>
      ) : null}

      <MonitorCard
        badge={formatBytes(totalDiskSize)}
        icon={<Database className="ui-icon" aria-hidden="true" />}
        title="存储与网络"
      >
        <div className="monitor-hardware-part-list">
          {snapshot.disks.devices.map((device) => (
            <HardwarePart
              badge={device.transport || device.type}
              detail={(device.mount_points || []).join(", ") || "未挂载"}
              icon={<Database className="ui-icon" aria-hidden="true" />}
              key={device.name}
              title={`${device.name} · ${device.model || "Storage Device"}`}
            />
          ))}
          {snapshot.network.primary ? (
            <HardwarePart
              badge={snapshot.network.primary.state || "unknown"}
              detail={`${snapshot.network.primary.ipv4 || "无 IPv4"} · ${formatNetworkSpeed(snapshot.network.primary.speed_mbps)}`}
              icon={<Network className="ui-icon" aria-hidden="true" />}
              title={snapshot.network.primary.display_name || snapshot.network.primary.name}
            />
          ) : null}
        </div>
      </MonitorCard>
    </>
  );
}

function MonitorNetworkView({
  history,
  network,
}: {
  history: RemoteMonitorSnapshot[];
  network: RemoteNetworkSummary;
}) {
  const interfaces = network.interfaces || [];

  return (
    <>
      <NetworkCard history={history} network={network} />
      <MonitorCard badge={`${interfaces.length.toString()} 个接口`} title="接口列表">
        <div className="monitor-interface-list">
          {interfaces.length ? (
            interfaces.map((item) => (
              <div className="monitor-interface-row" key={item.name}>
                <span>
                  <strong>{item.display_name || item.name}</strong>
                  <small>{item.name} · {item.ipv4 || item.ipv6 || "无 IP"}</small>
                </span>
                <em className={item.is_virtual ? "virtual" : undefined}>
                  {item.is_virtual ? "虚拟" : item.state || "unknown"}
                </em>
              </div>
            ))
          ) : (
            <p className="monitor-muted-copy">未采集到可展示网卡。</p>
          )}
        </div>
      </MonitorCard>
    </>
  );
}

function MonitorProcessView({
  busyOnly,
  processErrors,
  query,
  selectedProcess,
  snapshot,
  onBusyOnlyChange,
  onProcessQueryChange,
  onProcessSelect,
  onProcessSignal,
  onRefresh,
}: {
  busyOnly: boolean;
  processErrors: Record<number, string>;
  query: string;
  selectedProcess: RemoteProcessSummary | null;
  snapshot: RemoteMonitorSnapshot;
  onBusyOnlyChange: (busyOnly: boolean) => void;
  onProcessQueryChange: (query: string) => void;
  onProcessSelect: (pid: number | null) => void;
  onProcessSignal: (process: RemoteProcessSummary, signal: RemoteProcessSignal) => void;
  onRefresh: () => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const processes = snapshot.processes.items.filter((process) => {
    const haystack = `${process.pid.toString()} ${process.user || ""} ${process.command} ${process.args || ""}`.toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    const matchesBusy = !busyOnly || (process.cpu_percent || 0) >= 1;
    return matchesQuery && matchesBusy;
  });

  return (
    <MonitorCard errors={snapshot.processes.errors} title="进程管理">
      <div className="monitor-process-tools">
        <label className="monitor-search-field">
          <Search className="ui-icon" aria-hidden="true" />
          <input
            aria-label="搜索进程"
            placeholder="搜索进程..."
            value={query}
            onChange={(event) => onProcessQueryChange(event.target.value)}
          />
        </label>
        <Tooltip label={busyOnly ? "显示全部进程" : "只看活跃进程"}>
          <button
            className={`monitor-icon-action ${busyOnly ? "active" : ""}`}
            type="button"
            aria-label={busyOnly ? "显示全部进程" : "只看活跃进程"}
            aria-pressed={busyOnly}
            onClick={() => onBusyOnlyChange(!busyOnly)}
          >
            <Filter className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip label="刷新进程">
          <button className="monitor-icon-action" type="button" aria-label="刷新进程" onClick={onRefresh}>
            <RefreshCw className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {selectedProcess ? (
        <div className="monitor-process-detail">
          <Info className="ui-icon" aria-hidden="true" />
          <span>
            <strong>{selectedProcess.command}</strong>
            {selectedProcess.args || `PID ${selectedProcess.pid.toString()}`}
          </span>
          <button type="button" onClick={() => onProcessSelect(null)}>关闭</button>
        </div>
      ) : null}

      <div className="monitor-process-head">
        <span>NAME / PID</span>
        <span>CPU% ↓ &nbsp; MEM% &nbsp; ACT</span>
      </div>
      <div className="monitor-process-list">
        {processes.length ? (
          processes.map((process) => (
            <div
              className={`monitor-process-row ${selectedProcess?.pid === process.pid ? "is-focused" : ""}`}
              key={process.pid}
            >
              <span className="monitor-process-main">
                <strong className="monitor-process-name">{process.command}</strong>
                <span className="monitor-process-pid">
                  PID {process.pid.toString()} · {process.user || "unknown"}
                </span>
              </span>
              <span className={`monitor-process-metric ${(process.cpu_percent || 0) >= 80 ? "hot" : ""}`}>
                {formatPercent(process.cpu_percent, 1)}
              </span>
              <span className="monitor-process-metric">{formatPercent(process.memory_percent, 1)}</span>
              <span className="monitor-process-actions">
                <Tooltip label="查看详情">
                  <button
                    className="monitor-process-action-button"
                    type="button"
                    aria-label={`查看 ${process.command} 详情`}
                    onClick={() => onProcessSelect(process.pid)}
                  >
                    <Info className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="结束进程">
                  <button
                    className="monitor-process-action-button danger"
                    type="button"
                    aria-label={`结束 ${process.command}`}
                    disabled={!snapshot.processes.can_signal || process.pid <= 1}
                    onClick={() => onProcessSignal(process, "term")}
                  >
                    <CircleStop className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="强制结束">
                  <button
                    className="monitor-process-action-button danger"
                    type="button"
                    aria-label={`强制结束 ${process.command}`}
                    disabled={!snapshot.processes.can_signal || process.pid <= 1}
                    onClick={() => onProcessSignal(process, "kill")}
                  >
                    <ShieldAlert className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
              </span>
              {processErrors[process.pid] ? (
                <p className="monitor-process-error">{processErrors[process.pid]}</p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="monitor-muted-copy">没有匹配的进程。</p>
        )}
      </div>
    </MonitorCard>
  );
}

function MonitorCard({
  badge,
  children,
  errors,
  icon,
  title,
}: {
  badge?: string;
  children: ReactNode;
  errors?: MonitorSourceError[] | null;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section className="monitor-card">
      <div className="monitor-card-title-row">
        <span className="monitor-card-title">
          {icon}
          {title}
        </span>
        {badge ? <span className="monitor-small-pill">{badge}</span> : null}
      </div>
      <SourceErrors errors={errors} />
      {children}
    </section>
  );
}

function MetricTile({
  icon,
  label,
  sub,
  value,
}: {
  icon?: ReactNode;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="monitor-metric-tile">
      <div className="monitor-metric-head">
        <span className="monitor-metric-name">
          {icon}
          <span>{label}</span>
        </span>
      </div>
      <strong className="monitor-metric-value">{value}</strong>
      {sub ? <span className="monitor-metric-sub">{sub}</span> : null}
    </div>
  );
}

function ProgressBar({ value }: { value?: number | null }) {
  return (
    <div className="monitor-bar">
      <span className="monitor-bar-fill" style={barStyle(value)} />
    </div>
  );
}

function Donut({ label, percent }: { label: string; percent: number }) {
  const value = clampPercent(percent);

  return (
    <div className="monitor-donut" style={{ "--donut-value": value.toFixed(2) } as CSSProperties}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="monitor-donut-track" cx="60" cy="60" r="44" pathLength="100" />
        <circle
          className="monitor-donut-segment"
          cx="60"
          cy="60"
          r="44"
          pathLength="100"
          strokeDasharray={`${value.toFixed(2)} ${(100 - value).toFixed(2)}`}
        />
      </svg>
      <span className="monitor-donut-label">
        <strong>{label}</strong>
        <small>used</small>
      </span>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="monitor-legend-row">
      <span className="monitor-legend-dot" style={{ "--legend-color": color } as CSSProperties} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NetworkIdentity({ network }: { network: RemoteNetworkSummary }) {
  const primary = network.primary;

  if (!primary) {
    return <p className="monitor-muted-copy">未识别到物理主网卡。</p>;
  }

  return (
    <div className="monitor-network-identity">
      <span className="monitor-network-icon">
        <Network className="ui-icon" aria-hidden="true" />
      </span>
      <span className="monitor-network-main">
        <strong>{primary.display_name || primary.name}</strong>
        <span>{primary.name} · {primary.ipv4 || primary.ipv6 || "无 IP"}</span>
      </span>
      <span className={`monitor-small-pill ${primary.is_virtual ? "warn" : ""}`}>
        {primary.is_virtual ? "虚拟" : formatNetworkSpeed(primary.speed_mbps)}
      </span>
    </div>
  );
}

function TrafficChart({
  history,
  interfaceName,
}: {
  history: RemoteMonitorSnapshot[];
  interfaceName: string | null;
}) {
  const samples = history
    .map((snapshot) => {
      const traffic = interfaceName
        ? snapshot.network.traffic.find((item) => item.interface_name === interfaceName)
        : snapshot.network.traffic[0];
      return {
        rx: traffic?.rx_bytes_per_sec || 0,
        tx: traffic?.tx_bytes_per_sec || 0,
      };
    })
    .slice(-24);
  const rxValues = samples.map((sample) => sample.rx);
  const txValues = samples.map((sample) => sample.tx);
  const maxValue = Math.max(1, ...rxValues, ...txValues);
  const rxPath = linePath(rxValues, maxValue);
  const txPath = linePath(txValues, maxValue);
  const rxArea = areaPath(rxValues, maxValue);

  return (
    <div className="monitor-traffic-chart">
      <svg viewBox="0 0 320 122" preserveAspectRatio="none" aria-hidden="true">
        <path className="monitor-chart-grid" d="M0 30H320M0 61H320M0 92H320" />
        {rxArea ? <path className="monitor-download-area" d={rxArea} /> : null}
        {rxPath ? <path className="monitor-download-line" d={rxPath} /> : null}
        {txPath ? <path className="monitor-upload-line" d={txPath} /> : null}
      </svg>
    </div>
  );
}

function HardwareKv({ label, value }: { label: string; value: string }) {
  return (
    <div className="monitor-hardware-kv-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HardwarePart({
  badge,
  detail,
  icon,
  title,
}: {
  badge?: string | null;
  detail: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <article className="monitor-hardware-part">
      <span className="monitor-hardware-part-icon">{icon}</span>
      <span className="monitor-hardware-part-main">
        <strong>{title}</strong>
        <span>{detail || "暂无详细信息"}</span>
      </span>
      {badge ? <span className="monitor-hardware-badge">{badge}</span> : null}
    </article>
  );
}

function MonitorActivityRow({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone?: "warn";
}) {
  return (
    <div className="monitor-activity-row">
      <span className={`monitor-activity-icon ${tone || ""}`}>{icon}</span>
      <span className="monitor-activity-text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

function MonitorInlineAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="monitor-inline-alert">
      <AlertTriangle className="ui-icon" aria-hidden="true" />
      <span>{message}</span>
      <button type="button" onClick={onRetry}>重试</button>
    </section>
  );
}

function MonitorEmptyState({ title }: { title: string }) {
  return (
    <section className="monitor-empty-state">
      <Activity className="ui-icon" aria-hidden="true" />
      <span>{title}</span>
    </section>
  );
}

function SourceErrors({ errors }: { errors?: MonitorSourceError[] | null }) {
  if (!errors?.length) {
    return null;
  }

  return (
    <p className="monitor-card-warning">
      {errors.slice(0, 2).map((error) => error.message).join("；")}
    </p>
  );
}

function summarizeDisks(disks: RemoteDiskSummary) {
  return {
    total: disks.mounts.reduce((sum, mount) => sum + mount.total_bytes, 0),
    used: disks.mounts.reduce((sum, mount) => sum + mount.used_bytes, 0),
    read: disks.io.reduce((sum, item) => sum + (item.read_bytes_per_sec || 0), 0),
    write: disks.io.reduce((sum, item) => sum + (item.write_bytes_per_sec || 0), 0),
  };
}

function primaryTraffic(network: RemoteNetworkSummary) {
  const primary = network.primary;
  if (primary) {
    return network.traffic.find((item) => item.interface_name === primary.name) || network.traffic[0] || null;
  }
  return network.traffic[0] || null;
}

function sourceErrorCount(snapshot: RemoteMonitorSnapshot) {
  return [
    snapshot.host.errors,
    snapshot.cpu.errors,
    snapshot.memory.errors,
    snapshot.disks.errors,
    snapshot.network.errors,
    snapshot.processes.errors,
    ...snapshot.gpus.map((gpu) => gpu.errors),
  ].reduce((total, errors) => total + (errors?.length || 0), 0);
}

function hostMetaText(snapshot: RemoteMonitorSnapshot | null) {
  if (!snapshot) {
    return "SSH";
  }
  const os = snapshot.host.os;
  return [os?.name, os?.version, os?.arch].filter(Boolean).join(" · ") || "Linux";
}

function processConfirmLabel(signal?: RemoteProcessSignal) {
  if (signal === "kill") {
    return "强制结束";
  }
  if (signal === "hup") {
    return "重新加载";
  }
  return "结束进程";
}

function processConfirmDescription(target: ProcessActionTarget | null) {
  if (!target) {
    return "确认要操作该进程吗？";
  }
  const signalLabel = target.signal === "kill" ? "SIGKILL" : target.signal === "hup" ? "SIGHUP" : "SIGTERM";
  return `将向 ${target.command} · PID ${target.pid.toString()} 发送 ${signalLabel}。失败时进程行会保留并显示错误。`;
}

function formatCoreShape(cpu: RemoteCpuSummary) {
  const physical = cpu.physical_cores || cpu.cores.length || cpu.logical_cores || 0;
  const logical = cpu.logical_cores || cpu.cores.length || physical;
  const sockets = cpu.sockets || 1;
  return `${sockets.toString()} 路 · ${physical.toString()} 核 · ${logical.toString()} 线程`;
}

function percentOf(used?: number | null, total?: number | null) {
  if (used == null || total == null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

function clampPercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function barStyle(value?: number | null) {
  const percent = clampPercent(value);
  return {
    "--value": `${percent.toFixed(2)}%`,
    "--bar-color": percent >= 80 ? "#d97706" : "var(--mx-primary)",
  } as CSSProperties;
}

function formatPercent(value?: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) {
    return "采样中";
  }
  return `${value.toFixed(digits)}%`;
}

function formatFrequency(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return "未获取";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} GHz`;
  }
  return `${value.toFixed(0)} MHz`;
}

function formatBytes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "采样中";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let next = Math.max(0, value);
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex <= 1 ? 0 : next >= 100 ? 0 : 1;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}

function formatByteRate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "采样中";
  }
  return `${formatBytes(value)}/s`;
}

function formatBytePair(used?: number | null, total?: number | null) {
  if (used == null && total == null) {
    return "采样中";
  }
  if (total == null) {
    return formatBytes(used);
  }
  return `${formatBytes(used || 0)} / ${formatBytes(total)}`;
}

function formatNetworkSpeed(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return "未知速率";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)}GbE` : `${value.toFixed(0)}Mbps`;
}

function formatUptime(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "运行时间未知";
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days.toString()} 天 ${hours.toString()} 小时`;
  }
  if (hours > 0) {
    return `${hours.toString()} 小时 ${minutes.toString()} 分`;
  }
  return `${minutes.toString()} 分钟`;
}

function formatLoadAvg(loadAvg?: [number, number, number] | null) {
  if (!loadAvg) {
    return "负载采样中";
  }
  return `Load ${loadAvg.map((item) => item.toFixed(2)).join(" / ")}`;
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function linePath(values: number[], maxValue: number) {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    const y = chartY(values[0], maxValue);
    return `M0 ${y.toFixed(2)}L320 ${y.toFixed(2)}`;
  }
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 320;
      const y = chartY(value, maxValue);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join("");
}

function areaPath(values: number[], maxValue: number) {
  const path = linePath(values, maxValue);
  if (!path) {
    return "";
  }
  return `${path}L320 122L0 122Z`;
}

function chartY(value: number, maxValue: number) {
  const normalized = maxValue > 0 ? value / maxValue : 0;
  return 112 - Math.min(1, Math.max(0, normalized)) * 94;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
