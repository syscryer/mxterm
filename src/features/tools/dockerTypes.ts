export type DockerContainerAction = "start" | "stop" | "restart" | "remove";
export type DockerEngineAction = "start" | "stop" | "restart";
export type DockerRestartPolicyKind = "no" | "always" | "unless-stopped" | "on-failure";

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

export interface DockerImageRunPort {
  host_port: string;
  container_port: string;
}

export interface DockerImageRunKeyValue {
  key: string;
  value: string;
}

export interface DockerImageRunVolume {
  host_path: string;
  container_path: string;
}

export interface DockerImageRunRequest {
  image: string;
  name?: string | null;
  command?: string | null;
  entrypoint?: string | null;
  network?: string | null;
  restart_policy?: DockerRestartPolicyKind | null;
  privileged: boolean;
  ports: DockerImageRunPort[];
  env: DockerImageRunKeyValue[];
  volumes: DockerImageRunVolume[];
}

export interface DockerLogsResult {
  container_id: string;
  tail: number;
  content: string;
}

export interface DockerKeyValue {
  key: string;
  value: string;
  sensitive: boolean;
}

export interface DockerRestartPolicy {
  name: DockerRestartPolicyKind | string;
  maximum_retry_count?: number | null;
}

export interface DockerContainerPort {
  private_port: string;
  host_ip?: string | null;
  host_port?: string | null;
}

export interface DockerContainerMount {
  kind?: string | null;
  source?: string | null;
  destination: string;
  name?: string | null;
  driver?: string | null;
  rw: boolean;
}

export interface DockerContainerNetworkAttachment {
  name: string;
  ip_address?: string | null;
  gateway?: string | null;
  mac_address?: string | null;
}

export interface DockerContainerDetail {
  id: string;
  name: string;
  image: string;
  image_id?: string | null;
  created?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  status: string;
  running: boolean;
  ip_address?: string | null;
  command: string[];
  entrypoint: string[];
  working_dir?: string | null;
  restart_policy: DockerRestartPolicy;
  ports: DockerContainerPort[];
  env: DockerKeyValue[];
  mounts: DockerContainerMount[];
  networks: DockerContainerNetworkAttachment[];
  labels: DockerKeyValue[];
  raw_json: string;
}

export interface DockerNetworkSummary {
  id: string;
  name: string;
  driver?: string | null;
  scope?: string | null;
}

export type DockerLogStreamEventKind = "chunk" | "error" | "finished";

export interface DockerLogStreamEvent {
  stream_id: string;
  connection_id: string;
  container_id: string;
  kind: DockerLogStreamEventKind;
  content?: string | null;
  message?: string | null;
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
