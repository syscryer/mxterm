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
