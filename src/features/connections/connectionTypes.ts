export type ConnectionAuthKind = "password" | "private_key";
export type ConnectionCredentialMode = "saved" | "inline" | "prompt";
export type ConnectionProxyKind = "none" | "http_connect" | "socks5";

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
  advanced: ConnectionAdvancedConfig;
  notes?: string | null;
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
  inline_private_key_path?: string;
  inline_private_key_passphrase?: string;
  prompt_auth_kind?: ConnectionAuthKind;
  proxy: ConnectionProxyConfig;
  advanced: ConnectionAdvancedConfig;
  notes?: string;
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}

export interface CredentialProfile {
  id: string;
  name: string;
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
  kind: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  notes?: string;
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

export const defaultAdvancedConfig: ConnectionAdvancedConfig = {
  auth_timeout_ms: 45000,
  connect_timeout_ms: 30000,
  keepalive_interval_ms: 20000,
};
