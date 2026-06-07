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
  path: string;
}

export interface RemoteFileDownloadResult {
  content: number[];
  name: string;
  path: string;
}
