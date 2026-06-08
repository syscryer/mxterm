import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
} from "../../features/connections/connectionTypes";
import type {
  RemoteFileDeleteInput,
  RemoteFileDownloadToLocalInput,
  RemoteFileDownloadToLocalResult,
  RemoteFileDownloadResult,
  RemoteFileEntry,
  RemoteFileEntryMetadata,
  RemoteFileArchiveUploadInput,
  RemoteFileArchiveUploadResult,
  RemoteFileMetadata,
  RemoteFileReadResult,
  RemoteFileRenameInput,
  RemoteFileUploadInput,
  RemoteFileUploadResult,
  RemoteFileWriteInput,
  RemoteFileWriteResult,
} from "../../features/files/remoteFileTypes";
import type { TerminalConnectRequest } from "../../features/terminal/terminalTypes";

export function connectionList() {
  return invoke<ConnectionProfile[]>("connection_list");
}

export function connectionUpsert(request: ConnectionProfileInput) {
  return invoke<ConnectionProfile>("connection_upsert", { request });
}

export function connectionDelete(id: string) {
  return invoke<void>("connection_delete", { id });
}

export function connectionProbeLatency(connectionId: string) {
  return invoke<{ latency_ms: number | null; reachable: boolean }>("connection_probe_latency", {
    request: {
      connection_id: connectionId,
    },
  });
}

export function terminalConnect(request: TerminalConnectRequest) {
  return invoke<string>("terminal_connect", { request });
}

export function terminalWrite(sessionId: string, data: string) {
  return invoke<void>("terminal_write", {
    request: {
      data,
      session_id: sessionId,
    },
  });
}

export function terminalResize(sessionId: string, cols: number, rows: number) {
  return invoke<void>("terminal_resize", {
    request: {
      cols,
      rows,
      session_id: sessionId,
    },
  });
}

export function terminalClose(sessionId: string) {
  return invoke<void>("terminal_close", { sessionId });
}

export function remoteFileList(connectionId: string, path?: string) {
  return invoke<RemoteFileEntry[]>("remote_file_list", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileRead(connectionId: string, path: string) {
  return invoke<RemoteFileReadResult>("remote_file_read", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileWrite({
  connectionId,
  content,
  expectedMtime,
  expectedSize,
  overwrite = false,
  path,
}: RemoteFileWriteInput) {
  return invoke<RemoteFileWriteResult>("remote_file_write", {
    request: {
      connection_id: connectionId,
      content,
      expected_mtime: expectedMtime,
      expected_size: expectedSize,
      overwrite,
      path,
    },
  });
}

export function remoteFileCreateFile(connectionId: string, path: string) {
  return invoke<RemoteFileMetadata>("remote_file_create_file", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileCreateDirectory(connectionId: string, path: string) {
  return invoke<void>("remote_file_create_directory", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileRename({ connectionId, newPath, path }: RemoteFileRenameInput) {
  return invoke<void>("remote_file_rename", {
    request: {
      connection_id: connectionId,
      new_path: newPath,
      path,
    },
  });
}

export function remoteFileDelete({ connectionId, path, recursive = false }: RemoteFileDeleteInput) {
  return invoke<void>("remote_file_delete", {
    request: {
      connection_id: connectionId,
      path,
      recursive,
    },
  });
}

export function remoteFileMetadata(connectionId: string, path: string) {
  return invoke<RemoteFileEntryMetadata>("remote_file_metadata", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileUploadFile({
  connectionId,
  content,
  conflictPolicy = "rename",
  path,
}: RemoteFileUploadInput) {
  return invoke<RemoteFileUploadResult>("remote_file_upload_file", {
    request: {
      connection_id: connectionId,
      content: Array.from(content),
      conflict_policy: conflictPolicy,
      path,
    },
  });
}

export function remoteFileUploadArchive({
  archiveContent,
  connectionId,
  conflictPolicy = "rename",
  keepArchive = false,
  rootName,
  targetDir,
}: RemoteFileArchiveUploadInput) {
  return invoke<RemoteFileArchiveUploadResult>("remote_file_upload_archive", {
    request: {
      archive_content: Array.from(archiveContent),
      connection_id: connectionId,
      conflict_policy: conflictPolicy,
      keep_archive: keepArchive,
      root_name: rootName,
      target_dir: targetDir,
    },
  });
}

export function remoteFileDownload(connectionId: string, path: string) {
  return invoke<RemoteFileDownloadResult>("remote_file_download", {
    request: {
      connection_id: connectionId,
      path,
    },
  });
}

export function remoteFileDownloadToLocal({
  connectionId,
  conflictPolicy = "rename",
  directory = false,
  downloadRoot,
  groupBySession = true,
  keepArchives = false,
  path,
  sessionName,
  timestampDirectory = true,
  timestampName,
}: RemoteFileDownloadToLocalInput) {
  return invoke<RemoteFileDownloadToLocalResult>("remote_file_download_to_local", {
    request: {
      connection_id: connectionId,
      conflict_policy: conflictPolicy,
      directory,
      download_root: downloadRoot,
      group_by_session: groupBySession,
      keep_archives: keepArchives,
      path,
      session_name: sessionName,
      timestamp_directory: timestampDirectory,
      timestamp_name: timestampName,
    },
  });
}
