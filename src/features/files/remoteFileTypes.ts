export type RemoteFileKind = "directory" | "file" | "symlink" | "other";

export interface RemoteFileEntry {
  name: string;
  path: string;
  type: RemoteFileKind;
}

export interface RemoteFileMetadata {
  name: string;
  path: string;
  size: number;
  mtime: number;
  mode?: string | null;
}

export interface RemoteFileEntryMetadata extends RemoteFileMetadata {
  type: RemoteFileKind;
}

export interface RemoteFilePathCheckResult {
  exists: boolean;
  path: string;
  type?: RemoteFileKind | null;
}

export interface RemoteFileReadResult {
  content: string;
  editable: boolean;
  encoding: "utf-8";
  is_binary: boolean;
  metadata: RemoteFileMetadata;
  mode?: string | null;
  mtime: number;
  name: string;
  path: string;
  size: number;
}

export interface RemoteFileWriteResult {
  conflict: boolean;
  metadata: RemoteFileMetadata;
}

export interface RemoteFileWriteInput {
  connectionId: string;
  content: string;
  expectedMtime: number;
  expectedSize: number;
  overwrite?: boolean;
  path: string;
}

export interface RemoteFileRenameInput {
  connectionId: string;
  newPath: string;
  path: string;
}

export interface RemoteFileDeleteInput {
  connectionId: string;
  path: string;
  recursive?: boolean;
}

export interface RemoteFileUploadInput {
  connectionId: string;
  content: Uint8Array | number[];
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  path: string;
  transferId?: string;
}

export interface RemoteFileUploadLocalInput {
  connectionId: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  localPath: string;
  path: string;
  transferId?: string;
}

export type RemoteFileTransferConflictPolicy = "ask" | "overwrite" | "skip" | "rename";

export interface RemoteFileUploadResult {
  metadata?: RemoteFileMetadata | null;
  name: string;
  path: string;
  skipped: boolean;
}

export interface RemoteFileArchiveUploadInput {
  archiveContent: Uint8Array | number[];
  connectionId: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  keepArchive?: boolean;
  rootName: string;
  targetDir: string;
  transferId?: string;
}

export interface RemoteFileArchiveUploadLocalInput {
  connectionId: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  keepArchive?: boolean;
  localPath: string;
  rootName: string;
  targetDir: string;
  transferId?: string;
}

export interface RemoteFileArchiveUploadResult {
  archive_path?: string | null;
  name: string;
  path: string;
  skipped: boolean;
}

export interface RemoteFileDownloadResult {
  content: number[];
  name: string;
  path: string;
}

export interface RemoteFileDownloadToLocalInput {
  connectionId: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  directory?: boolean;
  downloadRoot?: string;
  groupBySession?: boolean;
  keepArchives?: boolean;
  path: string;
  sessionName?: string;
  timestampDirectory?: boolean;
  timestampName?: string;
  transferId?: string;
}

export interface RemoteFileDownloadTargetCheckInput {
  connectionId: string;
  directory?: boolean;
  downloadRoot?: string;
  groupBySession?: boolean;
  path: string;
  sessionName?: string;
  timestampDirectory?: boolean;
  timestampName?: string;
}

export interface RemoteFileDownloadTargetCheckResult {
  directory: boolean;
  exists: boolean;
  local_directory: string;
  local_path: string;
  name: string;
  remote_path: string;
}

export interface RemoteFileDownloadToLocalResult {
  archive_path?: string | null;
  directory: boolean;
  local_directory: string;
  local_path: string;
  name: string;
  remote_path: string;
  skipped: boolean;
}

export interface RemoteFileTransferProgressEvent {
  direction: "upload" | "download";
  loaded_bytes: number;
  total_bytes?: number | null;
  transfer_id: string;
}

export interface LocalUploadTempResult {
  local_path: string;
}

export type LocalPathKind = "directory" | "file" | "other";

export interface LocalPathMetadataResult {
  kind: LocalPathKind;
  name: string;
  path: string;
}
