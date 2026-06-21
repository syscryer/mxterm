export interface WebDavSettings {
  enabled: boolean;
  base_url: string;
  username: string | null;
  password_saved: boolean;
  remote_root: string;
  profile: string;
  last_sync_at: string | null;
  last_snapshot_id: string | null;
  last_remote_device_name: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface WebDavSettingsInput {
  enabled: boolean;
  base_url: string;
  username?: string | null;
  password?: string | null;
  password_touched: boolean;
  remote_root: string;
  profile: string;
}

export interface WebDavUploadRequest {
  sync_password?: string | null;
  device_id?: string | null;
  device_name?: string | null;
}

export interface WebDavDownloadRequest {
  sync_password?: string | null;
}

export interface WebDavRemoteInfo {
  exists: boolean;
  compatible: boolean;
  snapshot_id: string | null;
  device_name: string | null;
  created_at: string | null;
  protocol_version: number | null;
  data_size: number | null;
  secrets_size: number | null;
}

export interface WebDavTestResult {
  ok: boolean;
  message: string;
}

export interface WebDavSyncResult {
  snapshot_id: string;
  device_name: string;
  created_at: string;
  uploaded: boolean;
  downloaded: boolean;
  secrets_skipped: boolean;
}
