import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionRuntimeCredentialRequest,
  ConnectionStepResult,
  CredentialProfile,
  CredentialProfileInput,
  ConnectionProfile,
  ConnectionProfileInput,
  HostKeyInfo,
} from "../../features/connections/connectionTypes";
import type {
  LocalPathMetadataResult,
  LocalUploadTempResult,
  RemoteFileDeleteInput,
  RemoteFileDownloadToLocalInput,
  RemoteFileDownloadToLocalResult,
  RemoteFileDownloadResult,
  RemoteFileDownloadTargetCheckInput,
  RemoteFileDownloadTargetCheckResult,
  RemoteFileEntry,
  RemoteFileEntryMetadata,
  RemoteFileArchiveUploadInput,
  RemoteFileArchiveUploadLocalInput,
  RemoteFileArchiveUploadResult,
  RemoteFileMetadata,
  RemoteFilePathCheckResult,
  RemoteFileReadResult,
  RemoteFileRenameInput,
  RemoteFileUploadInput,
  RemoteFileUploadLocalInput,
  RemoteFileUploadResult,
  RemoteFileWriteInput,
  RemoteFileWriteResult,
} from "../../features/files/remoteFileTypes";
import type { TerminalConnectRequest } from "../../features/terminal/terminalTypes";

export interface NativeWindowMaterial {
  id: number;
  name: string;
}

export function connectionList() {
  return invoke<ConnectionProfile[]>("connection_list");
}

export function connectionUpsert(request: ConnectionProfileInput) {
  return invoke<ConnectionProfile>("connection_upsert", { request });
}

export function connectionSetFavorite(connectionId: string, isFavorite: boolean) {
  return invoke<ConnectionProfile>("connection_set_favorite", {
    request: {
      connection_id: connectionId,
      is_favorite: isFavorite,
    },
  });
}

export function connectionMarkConnected(connectionId: string) {
  return invoke<ConnectionProfile>("connection_mark_connected", {
    request: {
      connection_id: connectionId,
    },
  });
}

export function connectionDelete(id: string) {
  return invoke<void>("connection_delete", { id });
}

export function credentialList() {
  return invoke<CredentialProfile[]>("credential_list");
}

export function credentialUpsert(request: CredentialProfileInput) {
  return invoke<CredentialProfile>("credential_upsert", { request });
}

export function credentialDelete(id: string) {
  return invoke<void>("credential_delete", { id });
}

export function connectionTest(request: ConnectionRuntimeCredentialRequest) {
  return invoke<ConnectionStepResult>("connection_test", { request });
}

export function connectionTestProfile(request: ConnectionProfileInput) {
  return invoke<ConnectionStepResult>("connection_test_profile", { request });
}

export function knownHostTrust(hostKey: HostKeyInfo) {
  return invoke<void>("known_host_trust", {
    request: {
      host_key: hostKey,
    },
  });
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

export function getSupportedWindowMaterialsCommand() {
  return invoke<NativeWindowMaterial[]>("get_supported_window_materials");
}

export function setWindowMaterialCommand(material: number) {
  return invoke<NativeWindowMaterial>("set_window_material", {
    material,
  });
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

export function remoteFileCheckPath(connectionId: string, path: string) {
  return invoke<RemoteFilePathCheckResult>("remote_file_check_path", {
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
  transferId,
}: RemoteFileUploadInput) {
  return invoke<RemoteFileUploadResult>("remote_file_upload_file", {
    request: {
      connection_id: connectionId,
      content: Array.from(content),
      conflict_policy: conflictPolicy,
      path,
      transfer_id: transferId,
    },
  });
}

export function remoteFileUploadLocalFile({
  connectionId,
  conflictPolicy = "rename",
  localPath,
  path,
  transferId,
}: RemoteFileUploadLocalInput) {
  return invoke<RemoteFileUploadResult>("remote_file_upload_local_file", {
    request: {
      connection_id: connectionId,
      conflict_policy: conflictPolicy,
      local_path: localPath,
      path,
      transfer_id: transferId,
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
  transferId,
}: RemoteFileArchiveUploadInput) {
  return invoke<RemoteFileArchiveUploadResult>("remote_file_upload_archive", {
    request: {
      archive_content: Array.from(archiveContent),
      connection_id: connectionId,
      conflict_policy: conflictPolicy,
      keep_archive: keepArchive,
      root_name: rootName,
      target_dir: targetDir,
      transfer_id: transferId,
    },
  });
}

export function remoteFileUploadLocalArchive({
  connectionId,
  conflictPolicy = "rename",
  keepArchive = false,
  localPath,
  rootName,
  targetDir,
  transferId,
}: RemoteFileArchiveUploadLocalInput) {
  return invoke<RemoteFileArchiveUploadResult>("remote_file_upload_local_archive", {
    request: {
      connection_id: connectionId,
      conflict_policy: conflictPolicy,
      keep_archive: keepArchive,
      local_path: localPath,
      root_name: rootName,
      target_dir: targetDir,
      transfer_id: transferId,
    },
  });
}

export function remoteFilePrepareUploadTemp(fileName: string) {
  return invoke<LocalUploadTempResult>("remote_file_prepare_upload_temp", {
    request: {
      file_name: fileName,
    },
  });
}

export function remoteFileAppendUploadTemp(localPath: string, chunk: Uint8Array | number[]) {
  return invoke<void>("remote_file_append_upload_temp", {
    request: {
      chunk,
      local_path: localPath,
    },
  });
}

export function remoteFileDeleteUploadTemp(localPath: string) {
  return invoke<void>("remote_file_delete_upload_temp", {
    request: {
      local_path: localPath,
    },
  });
}

export function localPathMetadata(path: string) {
  return invoke<LocalPathMetadataResult>("local_path_metadata", {
    request: {
      path,
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

export function remoteFileCheckDownloadTarget({
  connectionId,
  directory = false,
  downloadRoot,
  groupBySession = true,
  path,
  sessionName,
  timestampDirectory = true,
  timestampName,
}: RemoteFileDownloadTargetCheckInput) {
  return invoke<RemoteFileDownloadTargetCheckResult>("remote_file_check_download_target", {
    request: {
      connection_id: connectionId,
      directory,
      download_root: downloadRoot,
      group_by_session: groupBySession,
      path,
      session_name: sessionName,
      timestamp_directory: timestampDirectory,
      timestamp_name: timestampName,
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
  transferId,
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
      transfer_id: transferId,
    },
  });
}
