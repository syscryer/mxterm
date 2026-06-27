import type {
  VncRunnerWindowConnectionInfo,
} from "./connectionTypes";

export function connectionInfoFromVncProfile(
  connection:
    | {
        host: string;
        name?: string | null;
        port: number;
        username?: string | null;
      }
    | null,
): VncRunnerWindowConnectionInfo | null {
  if (!connection) {
    return null;
  }
  return {
    host: connection.host,
    name: connection.name || null,
    port: connection.port || 5900,
    username: connection.username || null,
  };
}
