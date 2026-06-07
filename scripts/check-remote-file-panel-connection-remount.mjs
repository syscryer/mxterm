import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");

if (!source.includes("remoteFilePanelKey")) {
  throw new Error("WorkspaceShell should derive a connection-scoped key for RemoteFilePanel");
}

if (!source.includes("key={remoteFilePanelKey}")) {
  throw new Error("RemoteFilePanel should remount when the active connection changes");
}

console.log("Remote file panel connection-remount check passed.");
