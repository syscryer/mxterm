import { invoke } from "@tauri-apps/api/core";
import type { TerminalConnectRequest } from "../../features/terminal/terminalTypes";

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
