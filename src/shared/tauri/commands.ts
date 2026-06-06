import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
} from "../../features/connections/connectionTypes";
import type { RemoteFileEntry } from "../../features/files/remoteFileTypes";
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
