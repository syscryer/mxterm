export type McpConnectionExposureMode = "all" | "custom";

export interface McpRemoteServiceStatus {
  enabled: boolean;
  running: boolean;
  host: string;
  port: number;
  url: string;
  sse_url: string;
  pid?: number | null;
  token_saved: boolean;
  token_preview?: string | null;
  error?: string | null;
  healthy: boolean;
  started_at?: string | null;
  last_health_at?: string | null;
  restart_count: number;
  consecutive_failures: number;
  log_path?: string | null;
}

export interface McpRemoteLogOutput {
  content: string;
  path: string;
  truncated: boolean;
  updated_at: string;
}

export interface McpUpdateBlockerStatus {
  process_count: number;
  managed_remote_running: boolean;
}

export interface McpLocalNetworkInfo {
  primary_ip?: string | null;
  ip_addresses: string[];
}

export interface McpSettings {
  enabled: boolean;
  expose_connections: boolean;
  ssh_operations_enabled: boolean;
  allow_dangerous_commands: boolean;
  remote_enabled: boolean;
  remote_host: string;
  remote_port: number;
  remote_token?: string | null;
  remote_token_saved: boolean;
  remote_token_preview?: string | null;
  generated_remote_token?: string | null;
  remote_status?: McpRemoteServiceStatus | null;
  connection_exposure_mode: McpConnectionExposureMode;
  exposed_connection_ids: string[];
}

export const defaultMcpSettings: McpSettings = {
  enabled: false,
  expose_connections: false,
  ssh_operations_enabled: false,
  allow_dangerous_commands: false,
  remote_enabled: false,
  remote_host: "0.0.0.0",
  remote_port: 8765,
  remote_token: null,
  remote_token_saved: false,
  remote_token_preview: null,
  generated_remote_token: null,
  remote_status: null,
  connection_exposure_mode: "all",
  exposed_connection_ids: [],
};
