use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::ResolvedSshConfig;
use crate::terminal::session::{ExecOutput, ReusableExecSession};

const REMOTE_MONITOR_REFRESH_HINT_MS: u64 = 3000;
const MONITOR_SESSION_IDLE_TIMEOUT_MS: u64 = 30_000;
const MONITOR_MAX_CACHED_SESSIONS: usize = 1;
const DEFAULT_PROCESS_LIMIT: u16 = 80;
const MAX_PROCESS_LIMIT: u16 = 300;
const DISK_SECTOR_BYTES: f64 = 512.0;

#[derive(Clone, Default)]
pub struct RemoteMonitorManager {
    counters: Arc<Mutex<HashMap<String, MonitorCounters>>>,
    sessions: Arc<Mutex<HashMap<String, RemoteMonitorSessionHandle>>>,
}

#[derive(Clone)]
struct RemoteMonitorSessionHandle {
    signature: String,
    last_used_ms: Arc<Mutex<u64>>,
    session: Arc<Mutex<ReusableExecSession>>,
}

#[derive(Clone, Debug)]
struct MonitorSessionMeta {
    signature: String,
    last_used_ms: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct RemoteMonitorCollectionOptions {
    pub include_processes: bool,
    pub process_limit: Option<u16>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteProcessSignal {
    Term,
    Kill,
    Hup,
}

impl RemoteProcessSignal {
    fn shell_flag(self) -> &'static str {
        match self {
            Self::Term => "TERM",
            Self::Kill => "KILL",
            Self::Hup => "HUP",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteMonitorSnapshot {
    pub collected_at_ms: u64,
    pub refresh_hint_ms: u64,
    pub host: RemoteHostSummary,
    pub cpu: RemoteCpuSummary,
    pub memory: RemoteMemorySummary,
    pub gpus: Vec<RemoteGpuDevice>,
    pub disks: RemoteDiskSummary,
    pub network: RemoteNetworkSummary,
    pub processes: RemoteProcessList,
}

#[derive(Clone, Debug, Serialize)]
pub struct MonitorSourceError {
    pub source: String,
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteHostSummary {
    pub hostname: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub os: Option<RemoteHostOsSummary>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteHostOsSummary {
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub kernel: Option<String>,
    pub arch: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteCpuSummary {
    pub model: Option<String>,
    pub sockets: Option<u16>,
    pub is_virtualized: bool,
    pub physical_cores: Option<u16>,
    pub logical_cores: Option<u16>,
    pub usage_percent: Option<f64>,
    pub load_avg: Option<[f64; 3]>,
    pub current_frequency_mhz: Option<f64>,
    pub base_frequency_mhz: Option<f64>,
    pub max_frequency_mhz: Option<f64>,
    pub temperature_celsius: Option<f64>,
    pub cores: Vec<RemoteCpuCoreSummary>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteCpuCoreSummary {
    pub id: u16,
    pub label: String,
    pub usage_percent: Option<f64>,
    pub current_frequency_mhz: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteMemorySummary {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub free_bytes: Option<u64>,
    pub cached_bytes: Option<u64>,
    pub buffers_bytes: Option<u64>,
    pub swap_total_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteGpuDevice {
    pub index: u16,
    pub name: String,
    pub usage_percent: Option<f64>,
    pub memory_used_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub temperature_celsius: Option<f64>,
    pub power_watts: Option<f64>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteDiskSummary {
    pub mounts: Vec<RemoteDiskMountUsage>,
    pub devices: Vec<RemoteDiskDevice>,
    pub io: Vec<RemoteDiskIoSample>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteDiskMountUsage {
    pub filesystem: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "snake_case")]
pub enum RemoteDiskDeviceKind {
    Disk,
    Part,
    Raid,
    Lvm,
    Rom,
    Loop,
    Other,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteDiskDevice {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: RemoteDiskDeviceKind,
    pub size_bytes: Option<u64>,
    pub model: Option<String>,
    pub transport: Option<String>,
    pub mount_points: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteDiskIoSample {
    pub name: String,
    pub read_bytes_per_sec: Option<f64>,
    pub write_bytes_per_sec: Option<f64>,
    pub busy_percent: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteNetworkSummary {
    pub primary: Option<RemoteNetworkInterfaceSummary>,
    pub interfaces: Option<Vec<RemoteNetworkInterfaceSummary>>,
    pub traffic: Vec<RemoteNetworkTrafficSample>,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteNetworkInterfaceSummary {
    pub name: String,
    pub display_name: Option<String>,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub state: Option<RemoteNetworkInterfaceState>,
    pub speed_mbps: Option<f64>,
    pub is_virtual: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "snake_case")]
pub enum RemoteNetworkInterfaceState {
    Up,
    Down,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteNetworkTrafficSample {
    pub interface_name: String,
    pub rx_bytes_per_sec: Option<f64>,
    pub tx_bytes_per_sec: Option<f64>,
    pub rx_total_bytes: Option<u64>,
    pub tx_total_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteProcessList {
    pub items: Vec<RemoteProcessSummary>,
    pub can_signal: bool,
    pub errors: Option<Vec<MonitorSourceError>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteProcessSummary {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub user: Option<String>,
    pub command: String,
    pub args: Option<String>,
    pub cpu_percent: Option<f64>,
    pub memory_percent: Option<f64>,
    pub rss_bytes: Option<u64>,
    pub state: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteProcessActionResult {
    pub ok: bool,
    pub pid: u32,
    pub signal: RemoteProcessSignal,
    pub message: String,
}

impl RemoteMonitorManager {
    pub async fn snapshot(
        &self,
        app: &AppHandle,
        config: ResolvedSshConfig,
        options: RemoteMonitorCollectionOptions,
    ) -> Result<RemoteMonitorSnapshot, AppError> {
        let connection_id = config.connection_id.clone();
        let command = build_monitor_collect_command(options);
        let output = self
            .exec_with_cached_session(app, &config, &command)
            .await?;

        if output.exit_status != Some(0) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(AppError::new(
                "remote_monitor_collect_failed",
                "远程监控采集失败。",
                detail,
                true,
            ));
        }

        let previous = self.counters.lock().await.get(&connection_id).cloned();
        let (snapshot, counters) =
            parse_monitor_snapshot_output(&output.stdout, options, previous.as_ref(), now_millis());
        self.counters.lock().await.insert(connection_id, counters);
        Ok(snapshot)
    }

    pub async fn signal_process(
        &self,
        app: &AppHandle,
        config: ResolvedSshConfig,
        pid: u32,
        signal: RemoteProcessSignal,
    ) -> Result<RemoteProcessActionResult, AppError> {
        let command = build_process_signal_command(pid, signal)?;
        let output = self
            .exec_with_cached_session(app, &config, &command)
            .await?;

        if output.exit_status != Some(0) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            return Err(AppError::new(
                "remote_monitor_process_signal_failed",
                "进程操作失败。",
                detail,
                true,
            ));
        }

        Ok(RemoteProcessActionResult {
            ok: true,
            pid,
            signal,
            message: "进程信号已发送。".to_string(),
        })
    }

    async fn exec_with_cached_session(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
        command: &str,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        self.mark_handle_used(&handle).await;
        let result = {
            let session = handle.session.lock().await;
            session.exec(command).await
        };

        match result {
            Ok(output) => {
                self.mark_handle_used(&handle).await;
                Ok(output)
            }
            Err(error) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                Err(error)
            }
        }
    }

    async fn session_handle(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
    ) -> Result<RemoteMonitorSessionHandle, AppError> {
        let now_ms = now_millis();
        let connection_id = config.connection_id.as_str();
        let signature = config.signature();

        self.prune_idle_sessions(now_ms).await;

        if let Some(existing) = self.lookup_handle(connection_id).await {
            let last_used_ms = *existing.last_used_ms.lock().await;
            let meta = MonitorSessionMeta {
                signature: existing.signature.clone(),
                last_used_ms,
            };
            if can_reuse_monitor_session(&meta, &signature, now_ms) {
                return Ok(existing);
            }
            self.invalidate_handle(connection_id, &existing).await;
        }

        self.connect_and_store(app, config, signature, now_ms).await
    }

    async fn lookup_handle(&self, connection_id: &str) -> Option<RemoteMonitorSessionHandle> {
        self.sessions.lock().await.get(connection_id).cloned()
    }

    async fn connect_and_store(
        &self,
        app: &AppHandle,
        config: &ResolvedSshConfig,
        signature: String,
        now_ms: u64,
    ) -> Result<RemoteMonitorSessionHandle, AppError> {
        self.close_other_sessions(&config.connection_id).await;

        let new_handle = RemoteMonitorSessionHandle {
            signature,
            last_used_ms: Arc::new(Mutex::new(now_ms)),
            session: Arc::new(Mutex::new(
                ReusableExecSession::connect_resolved(app, config).await?,
            )),
        };

        let replaced = {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get(&config.connection_id).cloned() {
                if existing.signature == new_handle.signature {
                    existing
                } else {
                    sessions.insert(config.connection_id.clone(), new_handle.clone());
                    drop(sessions);
                    self.close_handle(existing).await;
                    return Ok(new_handle);
                }
            } else {
                sessions.insert(config.connection_id.clone(), new_handle.clone());
                return Ok(new_handle);
            }
        };

        self.close_handle(new_handle).await;
        Ok(replaced)
    }

    async fn prune_idle_sessions(&self, now_ms: u64) {
        let handles = {
            let sessions = self.sessions.lock().await;
            sessions
                .iter()
                .map(|(connection_id, handle)| (connection_id.clone(), handle.clone()))
                .collect::<Vec<_>>()
        };

        for (connection_id, handle) in handles {
            let last_used_ms = *handle.last_used_ms.lock().await;
            let meta = MonitorSessionMeta {
                signature: handle.signature.clone(),
                last_used_ms,
            };
            if !can_reuse_monitor_session(&meta, &handle.signature, now_ms) {
                self.invalidate_handle(&connection_id, &handle).await;
            }
        }
    }

    async fn close_other_sessions(&self, active_connection_id: &str) {
        let stale = {
            let mut sessions = self.sessions.lock().await;
            if sessions.len() < MONITOR_MAX_CACHED_SESSIONS {
                Vec::new()
            } else {
                let stale_ids = sessions
                    .keys()
                    .filter(|connection_id| connection_id.as_str() != active_connection_id)
                    .cloned()
                    .collect::<Vec<_>>();
                stale_ids
                    .into_iter()
                    .filter_map(|connection_id| sessions.remove(&connection_id))
                    .collect::<Vec<_>>()
            }
        };

        for handle in stale {
            self.close_handle(handle).await;
        }
    }

    async fn invalidate_handle(&self, connection_id: &str, handle: &RemoteMonitorSessionHandle) {
        let removed = {
            let mut sessions = self.sessions.lock().await;
            if let Some(current) = sessions.get(connection_id) {
                if Arc::ptr_eq(&current.session, &handle.session) {
                    sessions.remove(connection_id)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(stale) = removed {
            self.close_handle(stale).await;
        }
    }

    async fn close_handle(&self, handle: RemoteMonitorSessionHandle) {
        let session = handle.session.lock().await;
        session.close().await;
    }

    async fn mark_handle_used(&self, handle: &RemoteMonitorSessionHandle) {
        *handle.last_used_ms.lock().await = now_millis();
    }
}

fn can_reuse_monitor_session(meta: &MonitorSessionMeta, signature: &str, now_ms: u64) -> bool {
    meta.signature == signature
        && now_ms.saturating_sub(meta.last_used_ms) <= MONITOR_SESSION_IDLE_TIMEOUT_MS
}

pub fn validate_process_pid(pid: u32) -> Result<(), AppError> {
    if pid <= 1 {
        return Err(AppError::new(
            "remote_monitor_process_pid_invalid",
            "不能操作该系统进程。",
            format!("pid={pid}"),
            true,
        ));
    }

    Ok(())
}

pub fn build_process_signal_command(
    pid: u32,
    signal: RemoteProcessSignal,
) -> Result<String, AppError> {
    validate_process_pid(pid)?;
    Ok(format!("kill -{} {}", signal.shell_flag(), pid))
}

#[derive(Clone, Debug, Default)]
pub struct MonitorCounters {
    pub collected_at_ms: u64,
    pub cpu: Option<CpuCounters>,
    pub disks: HashMap<String, DiskIoCounter>,
    pub networks: HashMap<String, NetworkCounter>,
}

#[derive(Clone, Debug)]
pub struct CpuCounters {
    total: CpuCounter,
    cores: HashMap<u16, CpuCounter>,
}

#[derive(Clone, Copy, Debug)]
struct CpuCounter {
    idle: u64,
    total: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct DiskIoCounter {
    read_sectors: u64,
    write_sectors: u64,
    io_time_ms: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct NetworkCounter {
    rx_bytes: u64,
    tx_bytes: u64,
}

fn build_monitor_collect_command(options: RemoteMonitorCollectionOptions) -> String {
    let process_limit = options
        .process_limit
        .unwrap_or(DEFAULT_PROCESS_LIMIT)
        .clamp(1, MAX_PROCESS_LIMIT);
    let process_section = if options.include_processes {
        format!(
            r#"
emit_begin processes
ps -eo pid,ppid,user,comm,pcpu,pmem,rss,stat,args --sort=-pcpu 2>/dev/null | head -n {}
emit_end processes
"#,
            u32::from(process_limit) + 1
        )
    } else {
        String::new()
    };

    let script = format!(
        r#"
emit_begin() {{ printf 'MXBEGIN\t%s\n' "$1"; }}
emit_end() {{ printf 'MXEND\t%s\n' "$1"; }}

emit_begin host
printf 'hostname\t%s\n' "$(hostname 2>/dev/null || true)"
printf 'uptime\t%s\n' "$(cut -d' ' -f1 /proc/uptime 2>/dev/null || true)"
printf 'uname\t%s\n' "$(uname -srmo 2>/dev/null || true)"
emit_end host

emit_begin os_release
cat /etc/os-release 2>/dev/null || true
emit_end os_release

emit_begin cpu_stat
grep '^cpu' /proc/stat 2>/dev/null || true
emit_end cpu_stat

emit_begin loadavg
cat /proc/loadavg 2>/dev/null || true
emit_end loadavg

emit_begin lscpu
if command -v lscpu >/dev/null 2>&1; then lscpu 2>/dev/null || true; fi
emit_end lscpu

emit_begin cpuinfo
grep -E '^(processor|model name|Hardware|Processor|cpu MHz|cpu cores|physical id)' /proc/cpuinfo 2>/dev/null || true
emit_end cpuinfo

emit_begin cpu_freq
for f in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq; do
  [ -r "$f" ] || continue
  cpu=${{f#/sys/devices/system/cpu/cpu}}
  cpu=${{cpu%%/*}}
  printf 'cur\t%s\t%s\n' "$cpu" "$(cat "$f" 2>/dev/null || true)"
done
for kind in base_frequency cpuinfo_min_freq cpuinfo_max_freq; do
  label=$kind
  [ "$kind" = base_frequency ] && label=base
  [ "$kind" = cpuinfo_min_freq ] && label=min
  [ "$kind" = cpuinfo_max_freq ] && label=max
  for f in /sys/devices/system/cpu/cpu[0-9]*/cpufreq/$kind; do
    [ -r "$f" ] || continue
    cpu=${{f#/sys/devices/system/cpu/cpu}}
    cpu=${{cpu%%/*}}
    printf '%s\t%s\t%s\n' "$label" "$cpu" "$(cat "$f" 2>/dev/null || true)"
  done
done
emit_end cpu_freq

emit_begin temp
for f in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp*_input; do
  [ -r "$f" ] || continue
  cat "$f" 2>/dev/null || true
done
emit_end temp

emit_begin meminfo
cat /proc/meminfo 2>/dev/null || true
emit_end meminfo

emit_begin gpu
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null || true
fi
emit_end gpu

emit_begin df
df -P -B1 2>/dev/null || true
emit_end df

emit_begin lsblk
if command -v lsblk >/dev/null 2>&1; then
  lsblk -b -P -o NAME,TYPE,SIZE,MODEL,TRAN,MOUNTPOINTS 2>/dev/null || true
fi
emit_end lsblk

emit_begin diskstats
cat /proc/diskstats 2>/dev/null || true
emit_end diskstats

emit_begin net_route
if command -v ip >/dev/null 2>&1; then
  ip route get 1.1.1.1 2>/dev/null | head -n 1
  ip route show default 2>/dev/null | head -n 1
fi
emit_end net_route

emit_begin net_addr
if command -v ip >/dev/null 2>&1; then ip -o addr show 2>/dev/null || true; fi
emit_end net_addr

emit_begin net_sys
for d in /sys/class/net/*; do
  [ -d "$d" ] || continue
  name=${{d##*/}}
  state=$(cat "$d/operstate" 2>/dev/null || true)
  speed=$(cat "$d/speed" 2>/dev/null || true)
  printf '%s\t%s\t%s\n' "$name" "$state" "$speed"
done
emit_end net_sys

emit_begin net_dev
cat /proc/net/dev 2>/dev/null || true
emit_end net_dev
{process_section}
"#
    );

    format!("sh -lc {}", quote_posix_shell(&script))
}

fn parse_monitor_snapshot_output(
    output: &[u8],
    options: RemoteMonitorCollectionOptions,
    previous: Option<&MonitorCounters>,
    collected_at_ms: u64,
) -> (RemoteMonitorSnapshot, MonitorCounters) {
    let sections = parse_monitor_sections(output);
    let cpu_counters = sections
        .get("cpu_stat")
        .map(|section| parse_cpu_counters(section));
    let disk_counters = sections
        .get("diskstats")
        .map(|section| parse_disk_counters(section))
        .unwrap_or_default();
    let network_counters = sections
        .get("net_dev")
        .map(|section| parse_network_counters(section))
        .unwrap_or_default();
    let counters = MonitorCounters {
        collected_at_ms,
        cpu: cpu_counters.clone(),
        disks: disk_counters.clone(),
        networks: network_counters.clone(),
    };

    let snapshot = RemoteMonitorSnapshot {
        collected_at_ms,
        refresh_hint_ms: REMOTE_MONITOR_REFRESH_HINT_MS,
        host: parse_host_summary(&sections),
        cpu: parse_cpu_summary(
            &sections,
            cpu_counters.as_ref(),
            previous.and_then(|item| item.cpu.as_ref()),
        ),
        memory: parse_memory_summary(sections.get("meminfo")),
        gpus: parse_gpu_devices(sections.get("gpu")),
        disks: parse_disk_summary(&sections, &disk_counters, previous, collected_at_ms),
        network: parse_network_summary(&sections, &network_counters, previous, collected_at_ms),
        processes: parse_process_list(sections.get("processes"), options),
    };

    (snapshot, counters)
}

fn parse_monitor_sections(output: &[u8]) -> HashMap<String, String> {
    let text = String::from_utf8_lossy(output);
    let mut sections = HashMap::new();
    let mut current_name: Option<String> = None;
    let mut current_body = Vec::new();

    for line in text.lines() {
        if let Some(name) = line.strip_prefix("MXBEGIN\t") {
            current_name = Some(name.trim().to_string());
            current_body.clear();
            continue;
        }
        if let Some(name) = line.strip_prefix("MXEND\t") {
            if current_name.as_deref() == Some(name.trim()) {
                if let Some(name) = current_name.take() {
                    sections.insert(name, current_body.join("\n"));
                }
            }
            current_body.clear();
            continue;
        }
        if current_name.is_some() {
            current_body.push(line.to_string());
        }
    }

    sections
}

fn parse_host_summary(sections: &HashMap<String, String>) -> RemoteHostSummary {
    let host_fields = parse_tab_fields(sections.get("host").map(String::as_str).unwrap_or(""));
    let os_fields =
        parse_shell_key_values(sections.get("os_release").map(String::as_str).unwrap_or(""));
    let uname = host_fields
        .get("uname")
        .cloned()
        .filter(|value| !value.is_empty());
    let arch = uname
        .as_deref()
        .and_then(|value| value.split_whitespace().rev().nth(1))
        .map(str::to_string);

    RemoteHostSummary {
        hostname: host_fields
            .get("hostname")
            .cloned()
            .filter(|value| !value.is_empty()),
        uptime_seconds: host_fields
            .get("uptime")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|value| value.floor() as u64),
        os: Some(RemoteHostOsSummary {
            id: os_fields.get("ID").cloned(),
            name: os_fields.get("NAME").cloned(),
            version: os_fields.get("VERSION_ID").cloned(),
            kernel: uname,
            arch,
        }),
        errors: None,
    }
}

fn parse_cpu_summary(
    sections: &HashMap<String, String>,
    current: Option<&CpuCounters>,
    previous: Option<&CpuCounters>,
) -> RemoteCpuSummary {
    let lscpu = sections.get("lscpu").map(String::as_str).unwrap_or("");
    let cpuinfo = sections.get("cpuinfo").map(String::as_str).unwrap_or("");
    let lscpu_fields = parse_colon_fields(lscpu);
    let cpuinfo_fields = parse_repeated_colon_fields(cpuinfo);
    let frequencies = parse_cpu_frequencies(sections.get("cpu_freq"), cpuinfo);
    let logical_cores = parse_u16(lscpu_fields.get("CPU(s)").map(String::as_str))
        .or_else(|| current.map(|item| item.cores.len() as u16))
        .or_else(|| {
            cpuinfo_fields
                .get("processor")
                .map(|items| items.len() as u16)
        });
    let sockets = parse_u16(lscpu_fields.get("Socket(s)").map(String::as_str));
    let cores_per_socket = parse_u16(lscpu_fields.get("Core(s) per socket").map(String::as_str));
    let is_virtualized = is_virtualized_lscpu(&lscpu_fields);
    let physical_cores = if is_virtualized {
        None
    } else {
        sockets
            .zip(cores_per_socket)
            .map(|(sockets, cores)| sockets.saturating_mul(cores))
            .or_else(|| parse_u16(cpuinfo_fields.first_value("cpu cores")))
    };

    let mut core_ids = BTreeSet::new();
    if let Some(current) = current {
        core_ids.extend(current.cores.keys().copied());
    }
    core_ids.extend(frequencies.current.keys().copied());
    if core_ids.is_empty() {
        if let Some(count) = logical_cores {
            core_ids.extend(0..count);
        }
    }

    let cores = core_ids
        .into_iter()
        .map(|id| RemoteCpuCoreSummary {
            id,
            label: format!("CPU {}", id),
            usage_percent: current
                .and_then(|current| current.cores.get(&id))
                .zip(previous.and_then(|previous| previous.cores.get(&id)))
                .and_then(|(current, previous)| cpu_usage_percent(*previous, *current)),
            current_frequency_mhz: frequencies.current.get(&id).copied(),
        })
        .collect::<Vec<_>>();

    RemoteCpuSummary {
        model: lscpu_fields
            .get("Model name")
            .cloned()
            .or_else(|| cpuinfo_fields.first_value("model name").map(str::to_string))
            .or_else(|| cpuinfo_fields.first_value("Hardware").map(str::to_string))
            .or_else(|| cpuinfo_fields.first_value("Processor").map(str::to_string)),
        sockets,
        is_virtualized,
        physical_cores,
        logical_cores,
        usage_percent: current
            .zip(previous)
            .and_then(|(current, previous)| cpu_usage_percent(previous.total, current.total)),
        load_avg: sections
            .get("loadavg")
            .and_then(|section| parse_load_average(section)),
        current_frequency_mhz: average_values(frequencies.current.values().copied()),
        base_frequency_mhz: average_values(frequencies.base.values().copied())
            .or_else(|| average_values(frequencies.min.values().copied())),
        max_frequency_mhz: average_values_with_fallback(
            frequencies.max.values().copied(),
            parse_f64(lscpu_fields.get("CPU max MHz").map(String::as_str)),
        ),
        temperature_celsius: sections
            .get("temp")
            .and_then(|section| parse_temperature(section)),
        cores,
        errors: current.is_none().then(|| {
            vec![source_error(
                "cpu_stat",
                "remote_monitor_cpu_stat_missing",
                "CPU usage counters are unavailable.",
            )]
        }),
    }
}

fn parse_memory_summary(section: Option<&String>) -> RemoteMemorySummary {
    let values = section
        .map(|section| parse_meminfo_values(section))
        .unwrap_or_default();
    let total = values.get("MemTotal").copied().unwrap_or(0);
    let free = values.get("MemFree").copied();
    let buffers = values.get("Buffers").copied();
    let cached = values.get("Cached").copied();
    let reclaimable = values.get("SReclaimable").copied();
    let shmem = values.get("Shmem").copied();
    let buff_cache = cached.map(|cached| {
        cached
            .saturating_add(buffers.unwrap_or(0))
            .saturating_add(reclaimable.unwrap_or(0))
            .saturating_sub(shmem.unwrap_or(0))
    });
    let available = values
        .get("MemAvailable")
        .copied()
        .or_else(|| Some(free.unwrap_or(0) + buff_cache.unwrap_or(0)))
        .unwrap_or(0);
    let used = total.saturating_sub(available);
    let swap_total = values.get("SwapTotal").copied();
    let swap_free = values.get("SwapFree").copied();

    RemoteMemorySummary {
        total_bytes: total,
        used_bytes: used,
        available_bytes: available,
        free_bytes: free,
        cached_bytes: buff_cache,
        buffers_bytes: buffers,
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_total
            .zip(swap_free)
            .map(|(total, free)| total.saturating_sub(free)),
        errors: (total == 0).then(|| {
            vec![source_error(
                "meminfo",
                "remote_monitor_meminfo_missing",
                "Memory information is unavailable.",
            )]
        }),
    }
}

fn parse_gpu_devices(section: Option<&String>) -> Vec<RemoteGpuDevice> {
    section
        .map(|section| {
            section
                .lines()
                .filter_map(|line| {
                    let parts = line.split(',').map(str::trim).collect::<Vec<_>>();
                    if parts.len() < 5 {
                        return None;
                    }
                    let name = parts.get(1)?.to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(RemoteGpuDevice {
                        index: parse_u16(parts.first().copied()).unwrap_or(0),
                        name,
                        usage_percent: parse_f64(parts.get(2).copied()),
                        memory_used_bytes: parse_mib(parts.get(3).copied()),
                        memory_total_bytes: parse_mib(parts.get(4).copied()),
                        temperature_celsius: parse_f64(parts.get(5).copied()),
                        power_watts: parse_f64(parts.get(6).copied()),
                        errors: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_disk_summary(
    sections: &HashMap<String, String>,
    current_counters: &HashMap<String, DiskIoCounter>,
    previous: Option<&MonitorCounters>,
    collected_at_ms: u64,
) -> RemoteDiskSummary {
    let elapsed =
        previous.and_then(|previous| elapsed_seconds(previous.collected_at_ms, collected_at_ms));
    let mounts = sections
        .get("df")
        .map(|section| parse_disk_mounts(section))
        .unwrap_or_default();
    let devices = sections
        .get("lsblk")
        .map(|section| parse_disk_devices(section))
        .unwrap_or_default();
    let mut names = current_counters.keys().cloned().collect::<Vec<_>>();
    names.sort();
    let io = names
        .into_iter()
        .map(|name| {
            let current = current_counters.get(&name).copied();
            let previous = previous.and_then(|previous| previous.disks.get(&name).copied());
            let rates = current.zip(previous).zip(elapsed);
            RemoteDiskIoSample {
                name,
                read_bytes_per_sec: rates.map(|((current, previous), elapsed)| {
                    round1(
                        current.read_sectors.saturating_sub(previous.read_sectors) as f64
                            * DISK_SECTOR_BYTES
                            / elapsed,
                    )
                }),
                write_bytes_per_sec: rates.map(|((current, previous), elapsed)| {
                    round1(
                        current.write_sectors.saturating_sub(previous.write_sectors) as f64
                            * DISK_SECTOR_BYTES
                            / elapsed,
                    )
                }),
                busy_percent: rates.map(|((current, previous), elapsed)| {
                    round1(
                        current.io_time_ms.saturating_sub(previous.io_time_ms) as f64
                            / (elapsed * 1000.0)
                            * 100.0,
                    )
                }),
            }
        })
        .collect();

    RemoteDiskSummary {
        mounts,
        devices,
        io,
        errors: None,
    }
}

fn parse_network_summary(
    sections: &HashMap<String, String>,
    current_counters: &HashMap<String, NetworkCounter>,
    previous: Option<&MonitorCounters>,
    collected_at_ms: u64,
) -> RemoteNetworkSummary {
    let sys = sections
        .get("net_sys")
        .map(|section| parse_network_sys(section))
        .unwrap_or_default();
    let addresses = sections
        .get("net_addr")
        .map(|section| parse_network_addresses(section))
        .unwrap_or_default();
    let route = sections
        .get("net_route")
        .and_then(|section| parse_default_route(section));
    let elapsed =
        previous.and_then(|previous| elapsed_seconds(previous.collected_at_ms, collected_at_ms));
    let mut names = BTreeSet::new();
    names.extend(sys.keys().cloned());
    names.extend(addresses.keys().cloned());
    names.extend(current_counters.keys().cloned());

    let mut interfaces = names
        .into_iter()
        .map(|name| build_network_interface(name, &sys, &addresses))
        .collect::<Vec<_>>();
    interfaces.sort_by(|left, right| left.name.cmp(&right.name));
    let primary_name =
        choose_primary_interface(route.as_ref().map(|item| item.0.as_str()), &interfaces);
    let primary = primary_name
        .as_deref()
        .and_then(|name| interfaces.iter().find(|item| item.name == name).cloned())
        .map(|mut iface| {
            if iface.ipv4.is_none() {
                iface.ipv4 = route.as_ref().and_then(|item| item.1.clone());
            }
            iface
        });

    let mut traffic_names = current_counters.keys().cloned().collect::<Vec<_>>();
    traffic_names.sort_by(|left, right| match primary_name.as_deref() {
        Some(primary) if left == primary && right != primary => std::cmp::Ordering::Less,
        Some(primary) if right == primary && left != primary => std::cmp::Ordering::Greater,
        _ => left.cmp(right),
    });
    let traffic = traffic_names
        .into_iter()
        .map(|name| {
            let current = current_counters.get(&name).copied();
            let previous = previous.and_then(|previous| previous.networks.get(&name).copied());
            let rates = current.zip(previous).zip(elapsed);
            RemoteNetworkTrafficSample {
                interface_name: name,
                rx_bytes_per_sec: rates.map(|((current, previous), elapsed)| {
                    round1(current.rx_bytes.saturating_sub(previous.rx_bytes) as f64 / elapsed)
                }),
                tx_bytes_per_sec: rates.map(|((current, previous), elapsed)| {
                    round1(current.tx_bytes.saturating_sub(previous.tx_bytes) as f64 / elapsed)
                }),
                rx_total_bytes: current.map(|counter| counter.rx_bytes),
                tx_total_bytes: current.map(|counter| counter.tx_bytes),
            }
        })
        .collect();

    RemoteNetworkSummary {
        primary,
        interfaces: Some(interfaces),
        traffic,
        errors: None,
    }
}

fn parse_process_list(
    section: Option<&String>,
    options: RemoteMonitorCollectionOptions,
) -> RemoteProcessList {
    let limit = options
        .process_limit
        .unwrap_or(DEFAULT_PROCESS_LIMIT)
        .clamp(1, MAX_PROCESS_LIMIT) as usize;
    let items = if options.include_processes {
        section
            .map(|section| parse_processes(section, limit))
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    RemoteProcessList {
        items,
        can_signal: true,
        errors: None,
    }
}

fn parse_cpu_counters(section: &str) -> CpuCounters {
    let mut total = CpuCounter { idle: 0, total: 0 };
    let mut cores = HashMap::new();

    for line in section.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        let Some(label) = parts.first().copied() else {
            continue;
        };
        if !label.starts_with("cpu") {
            continue;
        }
        let values = parts
            .iter()
            .skip(1)
            .filter_map(|value| value.parse::<u64>().ok())
            .collect::<Vec<_>>();
        if values.len() < 4 {
            continue;
        }
        let idle = values.get(3).copied().unwrap_or(0) + values.get(4).copied().unwrap_or(0);
        let counter = CpuCounter {
            idle,
            total: values.iter().sum(),
        };
        if label == "cpu" {
            total = counter;
        } else if let Ok(id) = label.trim_start_matches("cpu").parse::<u16>() {
            cores.insert(id, counter);
        }
    }

    CpuCounters { total, cores }
}

fn cpu_usage_percent(previous: CpuCounter, current: CpuCounter) -> Option<f64> {
    let total_delta = current.total.checked_sub(previous.total)?;
    if total_delta == 0 {
        return None;
    }
    let idle_delta = current.idle.saturating_sub(previous.idle).min(total_delta);
    Some(round1(
        (total_delta - idle_delta) as f64 / total_delta as f64 * 100.0,
    ))
}

fn parse_cpu_frequencies(section: Option<&String>, cpuinfo: &str) -> CpuFrequencies {
    let mut frequencies = CpuFrequencies::default();
    if let Some(section) = section {
        for line in section.lines() {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if parts.len() < 3 {
                continue;
            }
            let Some(id) = parse_u16(parts.get(1).copied()) else {
                continue;
            };
            let Some(value) = parse_frequency_mhz(parts.get(2).copied()) else {
                continue;
            };
            match parts[0] {
                "cur" => {
                    frequencies.current.insert(id, value);
                }
                "base" => {
                    frequencies.base.insert(id, value);
                }
                "min" => {
                    frequencies.min.insert(id, value);
                }
                "max" => {
                    frequencies.max.insert(id, value);
                }
                _ => {}
            }
        }
    }

    if frequencies.current.is_empty() {
        let mut current_id = None;
        for line in cpuinfo.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim();
            if key == "processor" {
                current_id = value.parse::<u16>().ok();
            } else if key == "cpu MHz" {
                if let Some(id) = current_id {
                    if let Some(value) = parse_f64(Some(value)) {
                        frequencies.current.insert(id, round1(value));
                    }
                }
            }
        }
    }

    frequencies
}

#[derive(Default)]
struct CpuFrequencies {
    current: HashMap<u16, f64>,
    base: HashMap<u16, f64>,
    min: HashMap<u16, f64>,
    max: HashMap<u16, f64>,
}

fn parse_frequency_mhz(value: Option<&str>) -> Option<f64> {
    let value = parse_f64(value)?;
    if value > 10_000.0 {
        Some(round1(value / 1000.0))
    } else {
        Some(round1(value))
    }
}

fn parse_load_average(section: &str) -> Option<[f64; 3]> {
    let parts = section.split_whitespace().collect::<Vec<_>>();
    Some([
        parse_f64(parts.first().copied())?,
        parse_f64(parts.get(1).copied())?,
        parse_f64(parts.get(2).copied())?,
    ])
}

fn parse_temperature(section: &str) -> Option<f64> {
    section
        .lines()
        .filter_map(|line| parse_f64(Some(line.trim())))
        .map(|value| {
            if value > 1000.0 {
                value / 1000.0
            } else {
                value
            }
        })
        .filter(|value| *value > 0.0 && *value < 150.0)
        .map(round1)
        .max_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal))
}

fn parse_meminfo_values(section: &str) -> HashMap<String, u64> {
    let mut values = HashMap::new();
    for line in section.lines() {
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let Some(value) = rest.split_whitespace().next() else {
            continue;
        };
        if let Ok(kib) = value.parse::<u64>() {
            values.insert(key.trim().to_string(), kib.saturating_mul(1024));
        }
    }
    values
}

fn parse_disk_mounts(section: &str) -> Vec<RemoteDiskMountUsage> {
    let mut mounts = Vec::new();
    for line in section.lines().skip(1) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 6 {
            continue;
        }
        let filesystem = parts[0];
        let mount_point = parts[5];
        if is_pseudo_mount(filesystem, mount_point) {
            continue;
        }
        let total = parts[1].parse::<u64>().unwrap_or(0);
        let used = parts[2].parse::<u64>().unwrap_or(0);
        let available = parts[3].parse::<u64>().unwrap_or(0);
        let usage_percent = parts[4]
            .trim_end_matches('%')
            .parse::<f64>()
            .unwrap_or_else(|_| {
                if total == 0 {
                    0.0
                } else {
                    used as f64 / total as f64 * 100.0
                }
            });
        mounts.push(RemoteDiskMountUsage {
            filesystem: filesystem.to_string(),
            mount_point: mount_point.to_string(),
            total_bytes: total,
            used_bytes: used,
            available_bytes: available,
            usage_percent: round1(usage_percent),
            kind: None,
        });
    }
    mounts
}

fn parse_disk_devices(section: &str) -> Vec<RemoteDiskDevice> {
    section
        .lines()
        .filter_map(|line| {
            let fields = parse_lsblk_pairs(line);
            let name = fields.get("NAME")?.to_string();
            let kind = disk_kind_from_str(fields.get("TYPE").map(String::as_str));
            if !is_monitor_storage_device(&kind, &name) {
                return None;
            }

            Some(RemoteDiskDevice {
                name,
                kind,
                size_bytes: fields
                    .get("SIZE")
                    .and_then(|value| value.parse::<u64>().ok()),
                model: fields
                    .get("MODEL")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                transport: fields
                    .get("TRAN")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                mount_points: fields.get("MOUNTPOINTS").map(|value| {
                    value
                        .replace("\\x0a", "\n")
                        .lines()
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                }),
            })
        })
        .collect()
}

fn parse_disk_counters(section: &str) -> HashMap<String, DiskIoCounter> {
    let mut counters = HashMap::new();
    for line in section.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 13 {
            continue;
        }
        let name = parts[2].to_string();
        if name.starts_with("loop") || name.starts_with("ram") {
            continue;
        }
        counters.insert(
            name,
            DiskIoCounter {
                read_sectors: parts[5].parse::<u64>().unwrap_or(0),
                write_sectors: parts[9].parse::<u64>().unwrap_or(0),
                io_time_ms: parts[12].parse::<u64>().unwrap_or(0),
            },
        );
    }
    counters
}

fn parse_network_sys(section: &str) -> HashMap<String, NetworkSysInfo> {
    let mut items = HashMap::new();
    for line in section.lines() {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.is_empty() || parts[0].trim().is_empty() {
            continue;
        }
        items.insert(
            parts[0].trim().to_string(),
            NetworkSysInfo {
                state: match parts.get(1).map(|value| value.trim()) {
                    Some("up") => Some(RemoteNetworkInterfaceState::Up),
                    Some("down") => Some(RemoteNetworkInterfaceState::Down),
                    Some(_) => Some(RemoteNetworkInterfaceState::Unknown),
                    None => None,
                },
                speed_mbps: parse_f64(parts.get(2).copied()).filter(|value| *value > 0.0),
            },
        );
    }
    items
}

#[derive(Clone)]
struct NetworkSysInfo {
    state: Option<RemoteNetworkInterfaceState>,
    speed_mbps: Option<f64>,
}

#[derive(Default, Clone)]
struct NetworkAddressInfo {
    ipv4: Option<String>,
    ipv6: Option<String>,
}

fn parse_network_addresses(section: &str) -> HashMap<String, NetworkAddressInfo> {
    let mut addresses = HashMap::<String, NetworkAddressInfo>::new();
    for line in section.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 4 {
            continue;
        }
        let iface = parts[1].trim_end_matches(':').to_string();
        let entry = addresses.entry(iface).or_default();
        match parts[2] {
            "inet" => {
                if entry.ipv4.is_none() {
                    entry.ipv4 = parts[3].split('/').next().map(str::to_string);
                }
            }
            "inet6" => {
                if entry.ipv6.is_none() {
                    entry.ipv6 = parts[3].split('/').next().map(str::to_string);
                }
            }
            _ => {}
        }
    }
    addresses
}

fn parse_default_route(section: &str) -> Option<(String, Option<String>)> {
    for line in section.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        let dev = token_after(&parts, "dev");
        if dev.is_none() {
            continue;
        }
        return Some((
            dev?.to_string(),
            token_after(&parts, "src").map(str::to_string),
        ));
    }
    None
}

fn build_network_interface(
    name: String,
    sys: &HashMap<String, NetworkSysInfo>,
    addresses: &HashMap<String, NetworkAddressInfo>,
) -> RemoteNetworkInterfaceSummary {
    let sys = sys.get(&name);
    let address = addresses.get(&name);
    RemoteNetworkInterfaceSummary {
        display_name: Some(name.clone()),
        ipv4: address.and_then(|item| item.ipv4.clone()),
        ipv6: address.and_then(|item| item.ipv6.clone()),
        state: sys.and_then(|item| item.state.clone()),
        speed_mbps: sys.and_then(|item| item.speed_mbps),
        is_virtual: Some(is_virtual_interface(&name)),
        name,
    }
}

fn choose_primary_interface(
    route_iface: Option<&str>,
    interfaces: &[RemoteNetworkInterfaceSummary],
) -> Option<String> {
    if let Some(route_iface) = route_iface {
        if !is_virtual_interface(route_iface) {
            return Some(route_iface.to_string());
        }
    }

    interfaces
        .iter()
        .find(|iface| {
            !is_virtual_interface(&iface.name)
                && matches!(iface.state, Some(RemoteNetworkInterfaceState::Up) | None)
        })
        .map(|iface| iface.name.clone())
        .or_else(|| route_iface.map(str::to_string))
}

fn parse_network_counters(section: &str) -> HashMap<String, NetworkCounter> {
    let mut counters = HashMap::new();
    for line in section.lines() {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        let values = rest.split_whitespace().collect::<Vec<_>>();
        if values.len() < 16 {
            continue;
        }
        let name = iface.trim().to_string();
        counters.insert(
            name,
            NetworkCounter {
                rx_bytes: values[0].parse::<u64>().unwrap_or(0),
                tx_bytes: values[8].parse::<u64>().unwrap_or(0),
            },
        );
    }
    counters
}

fn parse_processes(section: &str, limit: usize) -> Vec<RemoteProcessSummary> {
    section
        .lines()
        .filter_map(|line| {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if parts.len() < 8 {
                return None;
            }
            let pid = parts[0].parse::<u32>().ok()?;
            let args = (parts.len() > 8).then(|| truncate_process_args(&parts[8..].join(" ")));
            Some(RemoteProcessSummary {
                pid,
                ppid: parts[1].parse::<u32>().ok(),
                user: Some(parts[2].to_string()),
                command: parts[3].to_string(),
                args,
                cpu_percent: parse_f64(parts.get(4).copied()),
                memory_percent: parse_f64(parts.get(5).copied()),
                rss_bytes: parts[6]
                    .parse::<u64>()
                    .ok()
                    .map(|kib| kib.saturating_mul(1024)),
                state: Some(parts[7].to_string()),
            })
        })
        .take(limit)
        .collect()
}

fn truncate_process_args(args: &str) -> String {
    const LIMIT: usize = 512;
    if args.len() <= LIMIT {
        args.to_string()
    } else {
        args.chars().take(LIMIT).collect()
    }
}

fn parse_tab_fields(section: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    for line in section.lines() {
        let Some((key, value)) = line.split_once('\t') else {
            continue;
        };
        fields.insert(key.trim().to_string(), value.trim().to_string());
    }
    fields
}

fn parse_shell_key_values(section: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for line in section.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        values.insert(key.trim().to_string(), strip_quotes(value.trim()));
    }
    values
}

fn parse_colon_fields(section: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for line in section.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values.insert(key.trim().to_string(), value.trim().to_string());
    }
    values
}

fn is_virtualized_lscpu(fields: &HashMap<String, String>) -> bool {
    has_non_empty_lscpu_field(fields, "Hypervisor vendor")
        || fields
            .get("Virtualization type")
            .map(|value| {
                let value = value.trim();
                !value.is_empty() && !value.eq_ignore_ascii_case("none")
            })
            .unwrap_or(false)
}

fn has_non_empty_lscpu_field(fields: &HashMap<String, String>, key: &str) -> bool {
    fields
        .get(key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn parse_repeated_colon_fields(section: &str) -> HashMap<String, Vec<String>> {
    let mut values = HashMap::<String, Vec<String>>::new();
    for line in section.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values
            .entry(key.trim().to_string())
            .or_default()
            .push(value.trim().to_string());
    }
    values
}

trait RepeatedFieldExt {
    fn first_value(&self, key: &str) -> Option<&str>;
}

impl RepeatedFieldExt for HashMap<String, Vec<String>> {
    fn first_value(&self, key: &str) -> Option<&str> {
        self.get(key)
            .and_then(|values| values.first())
            .map(String::as_str)
            .filter(|value| !value.is_empty())
    }
}

fn parse_lsblk_pairs(line: &str) -> HashMap<String, String> {
    let mut pairs = HashMap::new();
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let key_start = index;
        while index < bytes.len() && bytes[index] != b'=' {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let key = &line[key_start..index];
        index += 1;
        let value = if index < bytes.len() && bytes[index] == b'"' {
            index += 1;
            let value_start = index;
            while index < bytes.len() && bytes[index] != b'"' {
                index += 1;
            }
            let value = line[value_start..index].to_string();
            index += usize::from(index < bytes.len());
            value
        } else {
            let value_start = index;
            while index < bytes.len() && !bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            line[value_start..index].to_string()
        };
        if !key.is_empty() {
            pairs.insert(key.to_string(), value);
        }
    }
    pairs
}

fn parse_u16(value: Option<&str>) -> Option<u16> {
    value?.trim().parse::<u16>().ok()
}

fn parse_f64(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("[not supported]") {
        return None;
    }
    value.parse::<f64>().ok()
}

fn parse_mib(value: Option<&str>) -> Option<u64> {
    parse_f64(value).map(|mib| (mib * 1024.0 * 1024.0) as u64)
}

fn average_values(values: impl Iterator<Item = f64>) -> Option<f64> {
    let values = values.collect::<Vec<_>>();
    if values.is_empty() {
        None
    } else {
        Some(round1(values.iter().sum::<f64>() / values.len() as f64))
    }
}

fn average_values_with_fallback(
    values: impl Iterator<Item = f64>,
    fallback: Option<f64>,
) -> Option<f64> {
    average_values(values).or_else(|| fallback.map(round1))
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn elapsed_seconds(previous_ms: u64, current_ms: u64) -> Option<f64> {
    let delta_ms = current_ms.checked_sub(previous_ms)?;
    if delta_ms == 0 {
        None
    } else {
        Some(delta_ms as f64 / 1000.0)
    }
}

fn strip_quotes(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn token_after<'a>(parts: &'a [&str], token: &str) -> Option<&'a str> {
    parts
        .windows(2)
        .find(|window| window[0] == token)
        .map(|window| window[1])
}

fn disk_kind_from_str(value: Option<&str>) -> RemoteDiskDeviceKind {
    match value.unwrap_or_default() {
        "disk" => RemoteDiskDeviceKind::Disk,
        "part" => RemoteDiskDeviceKind::Part,
        "raid" => RemoteDiskDeviceKind::Raid,
        "lvm" => RemoteDiskDeviceKind::Lvm,
        "rom" => RemoteDiskDeviceKind::Rom,
        "loop" => RemoteDiskDeviceKind::Loop,
        _ => RemoteDiskDeviceKind::Other,
    }
}

fn is_monitor_storage_device(kind: &RemoteDiskDeviceKind, name: &str) -> bool {
    match kind {
        RemoteDiskDeviceKind::Disk | RemoteDiskDeviceKind::Raid => !is_pseudo_disk_name(name),
        RemoteDiskDeviceKind::Part
        | RemoteDiskDeviceKind::Lvm
        | RemoteDiskDeviceKind::Rom
        | RemoteDiskDeviceKind::Loop
        | RemoteDiskDeviceKind::Other => false,
    }
}

fn is_pseudo_disk_name(name: &str) -> bool {
    name.starts_with("zram") || name.starts_with("ram") || name.starts_with("fd")
}

fn is_pseudo_mount(filesystem: &str, mount_point: &str) -> bool {
    matches!(
        filesystem,
        "tmpfs"
            | "devtmpfs"
            | "overlay"
            | "squashfs"
            | "proc"
            | "sysfs"
            | "devfs"
            | "cgroup"
            | "cgroup2"
    ) || mount_point.starts_with("/proc")
        || mount_point.starts_with("/sys")
        || mount_point.starts_with("/run")
}

fn is_virtual_interface(name: &str) -> bool {
    name == "lo"
        || name.starts_with("docker")
        || name.starts_with("br-")
        || name.starts_with("veth")
        || name.starts_with("virbr")
        || name.starts_with("vmnet")
        || name.starts_with("vboxnet")
        || name.starts_with("tun")
        || name.starts_with("tap")
        || name.starts_with("wg")
        || name.starts_with("tailscale")
        || name.starts_with("cni")
        || name.starts_with("flannel")
        || name.starts_with("kube-ipvs")
}

fn source_error(source: &str, code: &str, message: &str) -> MonitorSourceError {
    MonitorSourceError {
        source: source.to_string(),
        code: code.to_string(),
        message: message.to_string(),
        recoverable: true,
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        build_process_signal_command, parse_monitor_snapshot_output, validate_process_pid,
        RemoteMonitorCollectionOptions, RemoteProcessSignal,
    };

    #[test]
    fn monitor_session_cache_reuses_only_matching_active_signature() {
        let meta = super::MonitorSessionMeta {
            signature: "host-a|user-a".to_string(),
            last_used_ms: 1_000,
        };

        assert!(super::can_reuse_monitor_session(
            &meta,
            "host-a|user-a",
            5_000
        ));
        assert!(!super::can_reuse_monitor_session(
            &meta,
            "host-b|user-a",
            5_000
        ));
        assert!(!super::can_reuse_monitor_session(
            &meta,
            "host-a|user-a",
            40_001
        ));
    }

    #[test]
    fn process_signal_command_uses_fixed_signal_and_numeric_pid() {
        assert_eq!(
            build_process_signal_command(4242, RemoteProcessSignal::Term).unwrap(),
            "kill -TERM 4242"
        );
        assert_eq!(
            build_process_signal_command(4242, RemoteProcessSignal::Kill).unwrap(),
            "kill -KILL 4242"
        );
        assert_eq!(
            build_process_signal_command(4242, RemoteProcessSignal::Hup).unwrap(),
            "kill -HUP 4242"
        );
    }

    #[test]
    fn process_signal_rejects_init_and_zero_pid() {
        assert!(validate_process_pid(0).is_err());
        assert!(validate_process_pid(1).is_err());
        assert!(validate_process_pid(2).is_ok());
    }

    #[test]
    fn parse_monitor_snapshot_output_maps_linux_sections() {
        let (snapshot, counters) = parse_monitor_snapshot_output(
            fixture_snapshot_output(),
            RemoteMonitorCollectionOptions {
                include_processes: true,
                process_limit: Some(5),
            },
            None,
            10_000,
        );

        assert_eq!(snapshot.refresh_hint_ms, 3000);
        assert_eq!(snapshot.host.hostname.as_deref(), Some("mx-node-01"));
        assert_eq!(snapshot.host.uptime_seconds, Some(12345));
        assert_eq!(
            snapshot.host.os.as_ref().and_then(|os| os.name.as_deref()),
            Some("Ubuntu")
        );
        assert_eq!(
            snapshot
                .host
                .os
                .as_ref()
                .and_then(|os| os.kernel.as_deref()),
            Some("Linux 6.8.0-31-generic x86_64 GNU/Linux")
        );
        assert_eq!(
            snapshot.cpu.model.as_deref(),
            Some("Intel(R) Xeon(R) Gold 6338N CPU @ 2.20GHz")
        );
        assert_eq!(snapshot.cpu.logical_cores, Some(2));
        assert!(!snapshot.cpu.is_virtualized);
        assert_eq!(snapshot.cpu.cores.len(), 2);
        assert_eq!(snapshot.cpu.usage_percent, None);
        assert_eq!(snapshot.cpu.current_frequency_mhz, Some(2200.0));
        assert_eq!(snapshot.cpu.base_frequency_mhz, Some(2000.0));
        assert_eq!(snapshot.cpu.max_frequency_mhz, Some(3500.0));
        assert_eq!(snapshot.cpu.temperature_celsius, Some(45.0));
        assert_eq!(snapshot.memory.total_bytes, 16_384 * 1024);
        assert_eq!(snapshot.memory.used_bytes, 8_384 * 1024);
        assert_eq!(snapshot.memory.available_bytes, 8_000 * 1024);
        assert_eq!(snapshot.memory.free_bytes, Some(4_000 * 1024));
        assert_eq!(snapshot.memory.buffers_bytes, Some(500 * 1024));
        assert_eq!(snapshot.memory.cached_bytes, Some(4_400 * 1024));
        assert_eq!(snapshot.memory.swap_total_bytes, Some(2_048 * 1024));
        assert_eq!(snapshot.memory.swap_used_bytes, Some(1_024 * 1024));
        assert_eq!(snapshot.gpus.len(), 2);
        assert_eq!(snapshot.gpus[0].name, "NVIDIA H200 141GB HBM3");
        assert_eq!(snapshot.gpus[1].temperature_celsius, None);
        assert_eq!(snapshot.disks.mounts.len(), 2);
        assert_eq!(snapshot.disks.mounts[0].mount_point, "/");
        assert_eq!(
            snapshot
                .disks
                .devices
                .iter()
                .map(|device| device.name.as_str())
                .collect::<Vec<_>>(),
            vec!["nvme0n1"]
        );
        assert_eq!(
            snapshot
                .network
                .primary
                .as_ref()
                .map(|nic| nic.name.as_str()),
            Some("eno1")
        );
        assert_eq!(
            snapshot
                .network
                .primary
                .as_ref()
                .and_then(|nic| nic.ipv4.as_deref()),
            Some("192.168.1.20")
        );
        assert_eq!(snapshot.processes.items.len(), 2);
        assert_eq!(snapshot.processes.items[0].pid, 2450);
        assert_eq!(snapshot.processes.items[0].rss_bytes, Some(10_240 * 1024));

        assert!(counters.cpu.is_some());
        assert!(counters.disks.contains_key("nvme0n1"));
        assert!(counters.networks.contains_key("eno1"));
    }

    #[test]
    fn parse_monitor_snapshot_output_marks_virtualized_cpu_topology() {
        let (snapshot, _) = parse_monitor_snapshot_output(
            fixture_virtual_cpu_topology_output(),
            RemoteMonitorCollectionOptions {
                include_processes: false,
                process_limit: None,
            },
            None,
            10_000,
        );

        assert!(snapshot.cpu.is_virtualized);
        assert_eq!(snapshot.cpu.logical_cores, Some(8));
        assert_eq!(snapshot.cpu.physical_cores, None);
        assert_eq!(snapshot.cpu.cores.len(), 8);
    }

    #[test]
    fn parse_monitor_snapshot_output_calculates_usage_and_rates_from_previous_counters() {
        let (_, previous) = parse_monitor_snapshot_output(
            fixture_snapshot_output(),
            RemoteMonitorCollectionOptions {
                include_processes: false,
                process_limit: None,
            },
            None,
            10_000,
        );
        let (snapshot, _) = parse_monitor_snapshot_output(
            fixture_snapshot_output_next(),
            RemoteMonitorCollectionOptions {
                include_processes: false,
                process_limit: None,
            },
            Some(&previous),
            12_000,
        );

        assert_eq!(snapshot.cpu.usage_percent, Some(50.0));
        assert_eq!(snapshot.cpu.cores[0].usage_percent, Some(50.0));
        assert_eq!(
            snapshot.disks.io[0].read_bytes_per_sec,
            Some(512.0 * 100.0 / 2.0)
        );
        assert_eq!(
            snapshot.disks.io[0].write_bytes_per_sec,
            Some(512.0 * 200.0 / 2.0)
        );
        assert_eq!(snapshot.network.traffic[0].rx_bytes_per_sec, Some(2048.0));
        assert_eq!(snapshot.network.traffic[0].tx_bytes_per_sec, Some(4096.0));
        assert!(snapshot.processes.items.is_empty());
    }

    fn fixture_snapshot_output() -> &'static [u8] {
        br#"MXBEGIN	host
hostname	mx-node-01
uptime	12345.67
uname	Linux 6.8.0-31-generic x86_64 GNU/Linux
MXEND	host
MXBEGIN	os_release
ID=ubuntu
NAME="Ubuntu"
VERSION_ID="24.04"
MXEND	os_release
MXBEGIN	cpu_stat
cpu  100 0 100 800 0 0 0 0 0 0
cpu0 50 0 50 400 0 0 0 0 0 0
cpu1 50 0 50 400 0 0 0 0 0 0
MXEND	cpu_stat
MXBEGIN	loadavg
0.10 0.20 0.30 1/200 12345
MXEND	loadavg
MXBEGIN	lscpu
CPU(s):                          2
Socket(s):                       1
Core(s) per socket:              1
Model name:                      Intel(R) Xeon(R) Gold 6338N CPU @ 2.20GHz
CPU max MHz:                     3500.0000
CPU min MHz:                     2000.0000
MXEND	lscpu
MXBEGIN	cpuinfo
processor	: 0
model name	: Intel(R) Xeon(R) Gold 6338N CPU @ 2.20GHz
cpu MHz		: 2200.000
processor	: 1
model name	: Intel(R) Xeon(R) Gold 6338N CPU @ 2.20GHz
cpu MHz		: 2200.000
MXEND	cpuinfo
MXBEGIN	cpu_freq
cur	0	2200000
cur	1	2200000
min	0	2000000
min	1	2000000
max	0	3500000
max	1	3500000
MXEND	cpu_freq
MXBEGIN	temp
45000
MXEND	temp
MXBEGIN	meminfo
MemTotal:       16384 kB
MemFree:         4000 kB
MemAvailable:    8000 kB
Buffers:          500 kB
Cached:          3500 kB
SReclaimable:     700 kB
Shmem:            300 kB
SwapTotal:       2048 kB
SwapFree:        1024 kB
MXEND	meminfo
MXBEGIN	gpu
0, NVIDIA H200 141GB HBM3, 63, 8192, 143360, 58, 420.50
1, NVIDIA H200 141GB HBM3, 12, 1024, 143360, ,
MXEND	gpu
MXBEGIN	df
Filesystem     1B-blocks      Used Available Use% Mounted on
/dev/nvme0n1p2 1000000000 600000000 400000000 60% /
/dev/nvme1n1p1 2000000000 500000000 1500000000 25% /data
tmpfs             1000000         0   1000000  0% /run
MXEND	df
MXBEGIN	lsblk
NAME="nvme0n1" TYPE="disk" SIZE="1000204886016" MODEL="Samsung SSD" TRAN="nvme" MOUNTPOINTS=""
NAME="nvme0n1p2" TYPE="part" SIZE="999000000000" MODEL="" TRAN="" MOUNTPOINTS="/"
NAME="loop0" TYPE="loop" SIZE="67108864" MODEL="" TRAN="" MOUNTPOINTS="/snap/core20/2015"
NAME="sr0" TYPE="rom" SIZE="1073741312" MODEL="Virtual DVD" TRAN="sata" MOUNTPOINTS=""
NAME="ubuntu--vg-root" TYPE="lvm" SIZE="998000000000" MODEL="" TRAN="" MOUNTPOINTS="/"
NAME="zram0" TYPE="disk" SIZE="4294967296" MODEL="" TRAN="" MOUNTPOINTS="[SWAP]"
MXEND	lsblk
MXBEGIN	diskstats
259 0 nvme0n1 10 0 1000 0 20 0 2000 0 0 300 0
MXEND	diskstats
MXBEGIN	net_route
default via 192.168.1.1 dev eno1 proto dhcp src 192.168.1.20 metric 100
MXEND	net_route
MXBEGIN	net_addr
2: eno1    inet 192.168.1.20/24 brd 192.168.1.255 scope global eno1
2: eno1    inet6 fe80::1/64 scope link
4: docker0    inet 172.17.0.1/16 scope global docker0
MXEND	net_addr
MXBEGIN	net_sys
eno1	up	1000
docker0	down
MXEND	net_sys
MXBEGIN	net_dev
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 eno1: 100000 1 0 0 0 0 0 0 200000 1 0 0 0 0 0 0
 docker0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
MXEND	net_dev
MXBEGIN	processes
    PID    PPID USER     COMMAND         %CPU %MEM   RSS STAT COMMAND
   2450       1 root     python3         38.5  1.2 10240 Sl   python3 train.py --epochs 4
    900       1 root     sshd             0.1  0.1  2048 Ss   sshd: root@pts/0
MXEND	processes
"#
    }

    fn fixture_snapshot_output_next() -> &'static [u8] {
        br#"MXBEGIN	cpu_stat
cpu  150 0 150 900 0 0 0 0 0 0
cpu0 75 0 75 450 0 0 0 0 0 0
cpu1 75 0 75 450 0 0 0 0 0 0
MXEND	cpu_stat
MXBEGIN	meminfo
MemTotal:       16384 kB
MemAvailable:    8000 kB
MXEND	meminfo
MXBEGIN	diskstats
259 0 nvme0n1 10 0 1100 0 20 0 2200 0 0 320 0
MXEND	diskstats
MXBEGIN	net_sys
eno1	up	1000
MXEND	net_sys
MXBEGIN	net_route
default via 192.168.1.1 dev eno1 src 192.168.1.20
MXEND	net_route
MXBEGIN	net_addr
2: eno1    inet 192.168.1.20/24 scope global eno1
MXEND	net_addr
MXBEGIN	net_dev
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 eno1: 104096 1 0 0 0 0 0 0 208192 1 0 0 0 0 0 0
MXEND	net_dev
"#
    }

    fn fixture_virtual_cpu_topology_output() -> &'static [u8] {
        br#"MXBEGIN	cpu_stat
cpu  100 0 100 800 0 0 0 0 0 0
cpu0 10 0 10 80 0 0 0 0 0 0
cpu1 10 0 10 80 0 0 0 0 0 0
cpu2 10 0 10 80 0 0 0 0 0 0
cpu3 10 0 10 80 0 0 0 0 0 0
cpu4 10 0 10 80 0 0 0 0 0 0
cpu5 10 0 10 80 0 0 0 0 0 0
cpu6 10 0 10 80 0 0 0 0 0 0
cpu7 10 0 10 80 0 0 0 0 0 0
MXEND	cpu_stat
MXBEGIN	lscpu
CPU(s):                          8
Socket(s):                       1
Core(s) per socket:              1
Thread(s) per core:              8
Hypervisor vendor:               KVM
Virtualization type:             full
Model name:                      Intel(R) Xeon(R) CPU E5-2695 v2 @ 2.40GHz
MXEND	lscpu
"#
    }
}
