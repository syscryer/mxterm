import { useCallback, useState } from "react";
import {
  terminalClose,
  terminalConnect,
  terminalResize,
  terminalWrite,
} from "../../shared/tauri/commands";
import type { TerminalConnectRequest } from "./terminalTypes";

export function useTerminalSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  const connect = useCallback(async (request: TerminalConnectRequest) => {
    const nextSessionId = await terminalConnect(request);
    setSessionId(nextSessionId);
    return nextSessionId;
  }, []);

  const write = useCallback(
    async (data: string) => {
      if (!sessionId) {
        return;
      }
      await terminalWrite(sessionId, data);
    },
    [sessionId],
  );

  const resize = useCallback(
    async (cols: number, rows: number) => {
      if (!sessionId) {
        return;
      }
      await terminalResize(sessionId, cols, rows);
    },
    [sessionId],
  );

  const close = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    await terminalClose(sessionId);
    setSessionId(null);
  }, [sessionId]);

  return {
    close,
    connect,
    resize,
    sessionId,
    setSessionId,
    write,
  };
}
