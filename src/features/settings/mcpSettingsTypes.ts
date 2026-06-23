export type McpConnectionExposureMode = "all" | "custom";

export interface McpSettings {
  enabled: boolean;
  expose_connections: boolean;
  ssh_operations_enabled: boolean;
  allow_dangerous_commands: boolean;
  connection_exposure_mode: McpConnectionExposureMode;
  exposed_connection_ids: string[];
}

export const defaultMcpSettings: McpSettings = {
  enabled: false,
  expose_connections: false,
  ssh_operations_enabled: false,
  allow_dangerous_commands: false,
  connection_exposure_mode: "all",
  exposed_connection_ids: [],
};
