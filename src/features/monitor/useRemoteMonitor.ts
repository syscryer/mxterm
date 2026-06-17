import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  remoteMonitorProcessSignal,
  remoteMonitorSnapshot,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type {
  RemoteMonitorSnapshot,
  RemoteProcessActionResult,
  RemoteProcessSignal,
} from "./monitorTypes";

export type MonitorPanelView = "status" | "hardware" | "network" | "processes";

interface UseRemoteMonitorInput {
  active: boolean;
  connectionId: string | null;
  view: MonitorPanelView;
}

interface RefreshOptions {
  silent?: boolean;
}

const statusPollMs = 3000;
const networkPollMs = 2000;
const processPollMs = 5000;
const processLimit = 80;
const historyWindowMs = 60_000;

export function useRemoteMonitor({ active, connectionId, view }: UseRemoteMonitorInput) {
  const [snapshot, setSnapshot] = useState<RemoteMonitorSnapshot | null>(null);
  const [history, setHistory] = useState<RemoteMonitorSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const mountedRef = useRef(true);
  const requestRunRef = useRef(0);
  const snapshotRef = useRef<RemoteMonitorSnapshot | null>(null);
  const includeProcesses = view === "processes";

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        requestRunRef.current += 1;
      };
    },
    [],
  );

  useEffect(() => {
    function handleVisibilityChange() {
      setDocumentVisible(document.visibilityState !== "hidden");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    requestRunRef.current += 1;
    setSnapshot(null);
    setHistory([]);
    setError(null);
    setLoading(false);
    setRefreshing(false);
  }, [connectionId]);

  const pollingMs = useMemo(() => {
    if (view === "processes") {
      return processPollMs;
    }
    if (view === "network") {
      return networkPollMs;
    }
    return snapshot?.refresh_hint_ms || statusPollMs;
  }, [snapshot?.refresh_hint_ms, view]);

  const refresh = useCallback(
    async ({ silent = false }: RefreshOptions = {}) => {
      if (!connectionId) {
        return null;
      }

      const runId = requestRunRef.current + 1;
      requestRunRef.current = runId;
      if (!silent) {
        setLoading(true);
      }
      setRefreshing(true);

      try {
        const nextSnapshot = hasTauriRuntime()
          ? await remoteMonitorSnapshot(connectionId, {
              includeProcesses,
              processLimit: includeProcesses ? processLimit : undefined,
            })
          : await previewMonitorSnapshot(includeProcesses);

        if (!mountedRef.current || requestRunRef.current !== runId) {
          return nextSnapshot;
        }

        setSnapshot(nextSnapshot);
        setHistory((current) => appendHistory(current, nextSnapshot));
        setError(null);
        return nextSnapshot;
      } catch (nextError) {
        if (mountedRef.current && requestRunRef.current === runId) {
          setError(formatError(nextError));
        }
        return null;
      } finally {
        if (mountedRef.current && requestRunRef.current === runId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [connectionId, includeProcesses],
  );

  useEffect(() => {
    if (!connectionId || !active || !documentVisible) {
      return;
    }

    void refresh({ silent: Boolean(snapshotRef.current) });
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, pollingMs);

    return () => window.clearInterval(timer);
  }, [active, connectionId, documentVisible, pollingMs, refresh]);

  const signalProcess = useCallback(
    async (pid: number, signal: RemoteProcessSignal): Promise<RemoteProcessActionResult> => {
      if (!connectionId) {
        throw new Error("没有活动 SSH 连接。");
      }

      if (!hasTauriRuntime()) {
        return {
          ok: true,
          pid,
          signal,
          message: `预览模式已模拟发送 ${signal.toUpperCase()}`,
        };
      }

      return remoteMonitorProcessSignal({ connectionId, pid, signal });
    },
    [connectionId],
  );

  return {
    error,
    history,
    loading,
    refresh,
    refreshing,
    signalProcess,
    snapshot,
  };
}

function appendHistory(current: RemoteMonitorSnapshot[], snapshot: RemoteMonitorSnapshot) {
  const since = snapshot.collected_at_ms - historyWindowMs;
  return [...current.filter((item) => item.collected_at_ms >= since), snapshot].slice(-40);
}

async function previewMonitorSnapshot(includeProcesses: boolean) {
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return createPreviewMonitorSnapshot(includeProcesses);
}

function createPreviewMonitorSnapshot(includeProcesses: boolean): RemoteMonitorSnapshot {
  const now = Date.now();
  const wave = (period: number, shift = 0) =>
    (Math.sin(now / period + shift) + 1) / 2;
  const cpuUsage = 36 + wave(4600) * 31;
  const memoryTotal = 64 * 1024 ** 3;
  const memoryUsed = 37.5 * 1024 ** 3;
  const diskRead = 12 * 1024 ** 2 + wave(2500, 1.1) * 18 * 1024 ** 2;
  const diskWrite = 5 * 1024 ** 2 + wave(3100, 2.2) * 9 * 1024 ** 2;
  const rx = 42 * 1024 ** 2 + wave(2100, 0.3) * 52 * 1024 ** 2;
  const tx = 8 * 1024 ** 2 + wave(2700, 1.7) * 18 * 1024 ** 2;

  return {
    collected_at_ms: now,
    refresh_hint_ms: statusPollMs,
    host: {
      hostname: "orange-pi-prod",
      uptime_seconds: 9 * 24 * 3600 + 5 * 3600 + 21 * 60,
      os: {
        id: "ubuntu",
        name: "Ubuntu Server",
        version: "24.04 LTS",
        kernel: "6.8.0-35-generic",
        arch: "aarch64",
      },
      errors: null,
    },
    cpu: {
      model: "Rockchip RK3588S / 8-Core ARM",
      sockets: 1,
      physical_cores: 8,
      logical_cores: 8,
      usage_percent: cpuUsage,
      load_avg: [1.21, 0.98, 0.76],
      current_frequency_mhz: 2208,
      base_frequency_mhz: 1800,
      max_frequency_mhz: 2400,
      temperature_celsius: 48.6,
      cores: Array.from({ length: 16 }, (_, index) => ({
        id: index,
        label: `Core ${index}`,
        usage_percent: 8 + wave(1700 + index * 120, index) * 84,
        current_frequency_mhz: 1800 + Math.round(wave(2300, index) * 600),
      })),
      errors: null,
    },
    memory: {
      total_bytes: memoryTotal,
      used_bytes: memoryUsed,
      available_bytes: memoryTotal - memoryUsed,
      free_bytes: 8.4 * 1024 ** 3,
      cached_bytes: 14.1 * 1024 ** 3,
      buffers_bytes: 1.2 * 1024 ** 3,
      swap_total_bytes: 8 * 1024 ** 3,
      swap_used_bytes: 1.1 * 1024 ** 3,
      errors: null,
    },
    gpus: [
      {
        index: 0,
        name: "NVIDIA H200 141GB HBM3e",
        usage_percent: 71 + wave(3400) * 12,
        memory_used_bytes: 96 * 1024 ** 3,
        memory_total_bytes: 141 * 1024 ** 3,
        temperature_celsius: 57,
        power_watts: 514,
        errors: null,
      },
      {
        index: 1,
        name: "NVIDIA H200 141GB HBM3e",
        usage_percent: 43 + wave(3900, 1.8) * 18,
        memory_used_bytes: 52 * 1024 ** 3,
        memory_total_bytes: 141 * 1024 ** 3,
        temperature_celsius: 51,
        power_watts: 386,
        errors: null,
      },
    ],
    disks: {
      mounts: [
        {
          filesystem: "/dev/nvme0n1p2",
          mount_point: "/",
          total_bytes: 512 * 1024 ** 3,
          used_bytes: 286 * 1024 ** 3,
          available_bytes: 226 * 1024 ** 3,
          usage_percent: 55.9,
          type: "ext4",
        },
        {
          filesystem: "/dev/nvme1n1",
          mount_point: "/data",
          total_bytes: 3.6 * 1024 ** 4,
          used_bytes: 2.1 * 1024 ** 4,
          available_bytes: 1.5 * 1024 ** 4,
          usage_percent: 58.3,
          type: "xfs",
        },
        {
          filesystem: "/dev/sda1",
          mount_point: "/backup",
          total_bytes: 7.2 * 1024 ** 4,
          used_bytes: 5.8 * 1024 ** 4,
          available_bytes: 1.4 * 1024 ** 4,
          usage_percent: 80.6,
          type: "ext4",
        },
        {
          filesystem: "/dev/sdb1",
          mount_point: "/archive",
          total_bytes: 10 * 1024 ** 4,
          used_bytes: 4.2 * 1024 ** 4,
          available_bytes: 5.8 * 1024 ** 4,
          usage_percent: 42,
          type: "xfs",
        },
      ],
      devices: [
        {
          name: "nvme0n1",
          type: "disk",
          size_bytes: 512 * 1024 ** 3,
          model: "Samsung PM9A1 NVMe",
          transport: "nvme",
          mount_points: ["/"],
        },
        {
          name: "nvme1n1",
          type: "disk",
          size_bytes: 3.6 * 1024 ** 4,
          model: "Micron 7450 MAX",
          transport: "nvme",
          mount_points: ["/data"],
        },
      ],
      io: [
        {
          name: "nvme0n1",
          read_bytes_per_sec: diskRead,
          write_bytes_per_sec: diskWrite,
          busy_percent: 13 + wave(2800) * 21,
        },
      ],
      errors: null,
    },
    network: {
      primary: {
        name: "eth0",
        display_name: "Intel I226-V 2.5GbE",
        ipv4: "192.168.31.190",
        ipv6: "fe80::9d72:72ff:fe23:98d1",
        state: "up",
        speed_mbps: 2500,
        is_virtual: false,
      },
      interfaces: [
        {
          name: "eth0",
          display_name: "Intel I226-V 2.5GbE",
          ipv4: "192.168.31.190",
          state: "up",
          speed_mbps: 2500,
          is_virtual: false,
        },
        {
          name: "wlan0",
          display_name: "Wireless LAN",
          ipv4: "192.168.31.208",
          state: "down",
          speed_mbps: null,
          is_virtual: false,
        },
      ],
      traffic: [
        {
          interface_name: "eth0",
          rx_bytes_per_sec: rx,
          tx_bytes_per_sec: tx,
          rx_total_bytes: 912 * 1024 ** 3,
          tx_total_bytes: 188 * 1024 ** 3,
        },
      ],
      errors: null,
    },
    processes: {
      can_signal: true,
      items: includeProcesses
        ? [
            {
              pid: 565345,
              ppid: 1,
              user: "deploy",
              command: "openclaw-gateway",
              args: "node /srv/openclaw/gateway.js",
              cpu_percent: 155,
              memory_percent: 6.9,
              rss_bytes: 1830 * 1024 ** 2,
              state: "R",
            },
            {
              pid: 3906,
              ppid: 1,
              user: "mysql",
              command: "mysqld",
              args: "/usr/sbin/mysqld",
              cpu_percent: 1.5,
              memory_percent: 5.7,
              rss_bytes: 1420 * 1024 ** 2,
              state: "S",
            },
            {
              pid: 10234,
              ppid: 990,
              user: "app",
              command: "node",
              args: "node /app/server.js",
              cpu_percent: 0.2,
              memory_percent: 12.4,
              rss_bytes: 2980 * 1024 ** 2,
              state: "S",
            },
            {
              pid: 845,
              ppid: 1,
              user: "root",
              command: "rsyslogd",
              args: "/usr/sbin/rsyslogd -n -iNONE",
              cpu_percent: 1.4,
              memory_percent: 0.1,
              rss_bytes: 31 * 1024 ** 2,
              state: "S",
            },
          ]
        : [],
      errors: null,
    },
  };
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
