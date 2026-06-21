export type ConnectionAuthKind = "password" | "private_key";
export type ConnectionCredentialMode = "saved" | "inline" | "prompt";
export type ConnectionJumpKind = "none" | "ssh_jump";
export type ConnectionProxyKind = "none" | "http_connect" | "socks5";
export type ConnectionTerminalEncoding =
  | "utf-8"
  | "gbk"
  | "gb18030"
  | "big5"
  | "euc-jp"
  | "iso-2022-jp"
  | "shift-jis"
  | "euc-kr";

export interface ConnectionJumpConfig {
  kind: ConnectionJumpKind;
  jump_connection_id?: string | null;
}

export interface ConnectionProxyConfig {
  kind: ConnectionProxyKind;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
}

export interface ConnectionAdvancedConfig {
  connect_timeout_ms: number;
  auth_timeout_ms: number;
  keepalive_interval_ms: number;
  terminal_encoding: ConnectionTerminalEncoding;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  group?: string | null;
  host: string;
  port: number;
  username: string;
  credential_mode: ConnectionCredentialMode;
  credential_id?: string | null;
  inline_auth_kind?: ConnectionAuthKind | null;
  inline_password?: string | null;
  inline_private_key_path?: string | null;
  inline_private_key_passphrase?: string | null;
  prompt_auth_kind?: ConnectionAuthKind | null;
  proxy: ConnectionProxyConfig;
  jump: ConnectionJumpConfig;
  advanced: ConnectionAdvancedConfig;
  notes?: string | null;
  is_favorite: boolean;
  last_connected_at?: string | null;
  remote_os_id?: string | null;
  remote_os_name?: string | null;
  remote_os_version?: string | null;
  created_at: string;
  updated_at: string;
  auth_kind?: ConnectionAuthKind | null;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
}

export interface ConnectionProfileInput {
  id?: string;
  name?: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  credential_mode: ConnectionCredentialMode;
  credential_id?: string;
  inline_auth_kind?: ConnectionAuthKind;
  inline_password?: string;
  inline_password_touched?: boolean;
  inline_private_key_path?: string;
  inline_private_key_passphrase?: string;
  inline_private_key_passphrase_touched?: boolean;
  prompt_auth_kind?: ConnectionAuthKind;
  proxy: ConnectionProxyConfig;
  jump: ConnectionJumpConfig;
  advanced: ConnectionAdvancedConfig;
  notes?: string;
  is_favorite?: boolean;
  last_connected_at?: string;
  remote_os_id?: string;
  remote_os_name?: string;
  remote_os_version?: string;
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}

export interface CredentialProfile {
  id: string;
  name: string;
  username?: string | null;
  kind: ConnectionAuthKind;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialProfileInput {
  id?: string;
  name?: string;
  username?: string;
  kind: ConnectionAuthKind;
  password?: string;
  password_touched?: boolean;
  private_key_path?: string;
  private_key_passphrase?: string;
  private_key_passphrase_touched?: boolean;
  notes?: string;
}

export interface RevealedConnectionSecret {
  auth_kind: ConnectionAuthKind;
  password?: string | null;
  private_key_passphrase?: string | null;
}

export interface RevealedCredentialSecret {
  kind: ConnectionAuthKind;
  password?: string | null;
  private_key_passphrase?: string | null;
}

export interface ConnectionRuntimeCredentialRequest {
  connection_id: string;
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}

export interface HostKeyInfo {
  host: string;
  port: number;
  key_algorithm: string;
  fingerprint_sha256: string;
  public_key: string;
}

export interface ConnectionStepResult {
  ok: boolean;
  message: string;
}

export const defaultProxyConfig: ConnectionProxyConfig = {
  kind: "none",
  host: "",
  password: "",
  port: 8080,
  username: "",
};

export const defaultJumpConfig: ConnectionJumpConfig = {
  kind: "none",
  jump_connection_id: "",
};

export const defaultAdvancedConfig: ConnectionAdvancedConfig = {
  auth_timeout_ms: 45000,
  connect_timeout_ms: 30000,
  keepalive_interval_ms: 20000,
  terminal_encoding: "utf-8",
};

export const terminalEncodingOptions: Array<{
  label: string;
  value: ConnectionTerminalEncoding;
}> = [
  { label: "UTF-8", value: "utf-8" },
  { label: "GBK", value: "gbk" },
  { label: "GB18030", value: "gb18030" },
  { label: "Big5", value: "big5" },
  { label: "EUC-JP", value: "euc-jp" },
  { label: "ISO-2022-JP", value: "iso-2022-jp" },
  { label: "Shift_JIS", value: "shift-jis" },
  { label: "EUC-KR", value: "euc-kr" },
];

export function normalizeTerminalEncoding(
  value?: string | null,
): ConnectionTerminalEncoding {
  const normalized = (value || "").trim().toLowerCase().replace(/_/g, "-");
  const option = terminalEncodingOptions.find((item) => item.value === normalized);
  return option?.value || defaultAdvancedConfig.terminal_encoding;
}
