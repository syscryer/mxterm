export type DockerContainerAction = "start" | "stop" | "restart" | "remove";

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
