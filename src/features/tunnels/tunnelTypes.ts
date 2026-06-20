import type { ConnectionAuthKind } from "../connections/connectionTypes";

export type TunnelKind = "local" | "remote" | "dynamic";
export type TunnelStatus = "stopped" | "starting" | "running" | "failed" | "credential_required";

export interface TunnelRule {
  id: string;
  name: string;
  kind: TunnelKind;
  connection_id: string;
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
  created_at: string;
  updated_at: string;
}

export interface TunnelRuntimeState {
  rule_id: string;
  status: TunnelStatus;
  bound_host?: string | null;
  bound_port?: number | null;
  started_at?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  active_connections: number;
}

export interface TunnelRuleWithState {
  rule: TunnelRule;
  state: TunnelRuntimeState;
}

export interface TunnelRuleInput {
  id?: string;
  name?: string;
  kind: TunnelKind;
  connection_id: string;
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
}

export interface TunnelRuntimeCredentialInput {
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}