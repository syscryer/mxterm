export type DockerContainerAction = "start" | "stop" | "restart" | "remove";
export type DockerEngineAction = "start" | "stop" | "restart";

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  command?: string | null;
  created_at?: string | null;
  running_for?: string | null;
  ports?: string | null;
  state: string;
  status: string;
}

export interface DockerImageSummary {
  id: string;
  repository: string;
  tag: string;
  digest?: string | null;
  created_at?: string | null;
  created_since?: string | null;
  size: string;
}

export type DockerImagePullStatus = "running" | "success" | "failed";

export interface DockerImagePullProgressEvent {
  pull_id: string;
  connection_id: string;
  image: string;
  status: DockerImagePullStatus;
  message: string;
  percent?: number | null;
  current_layer?: string | null;
}

export interface DockerActionResult {
  ok: boolean;
  message: string;
  output?: string | null;
}

export interface DockerLogsResult {
  container_id: string;
  tail: number;
  content: string;
}

export interface DockerEngineStatus {
  installed: boolean;
  running: boolean;
  service_status?: string | null;
  version?: string | null;
  api_version?: string | null;
  server_os?: string | null;
  root_dir?: string | null;
  storage_driver?: string | null;
  cgroup_driver?: string | null;
  containers?: number | null;
  containers_running?: number | null;
  images?: number | null;
  networks?: number | null;
  volumes?: number | null;
  daemon_cpu_percent?: number | null;
  daemon_memory_bytes?: number | null;
  docker_disk_used_bytes?: number | null;
  root_disk_used_bytes?: number | null;
  root_disk_total_bytes?: number | null;
  can_control_service: boolean;
  raw_error?: string | null;
}

export interface DockerEngineConfigResult {
  path: string;
  exists: boolean;
  content: string;
}
