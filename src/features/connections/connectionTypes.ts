export type ConnectionAuthKind = "password" | "private_key";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_kind: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionProfileInput {
  id?: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_kind: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  notes?: string;
}
