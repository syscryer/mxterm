import { readFileSync } from "node:fs";

const capability = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
const connectionPane = readFileSync(new URL("../src/features/connections/ConnectionPane.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");

for (const permission of [
  "core:window:allow-outer-position",
  "core:window:allow-inner-size",
  "core:window:allow-set-position",
  "core:window:allow-set-size",
  "core:window:allow-available-monitors",
]) {
  if (!capability.includes(permission)) {
    throw new Error(`Window state persistence needs ${permission}`);
  }
}

if (!workspace.includes("initializeWindowStatePersistence")) {
  throw new Error("WorkspaceShell should initialize window size and position persistence");
}

if (!connectionPane.includes("expandedFolderStorageKey")) {
  throw new Error("ConnectionPane should persist left folder expanded state");
}

if (
  !connectionPane.includes("readStoredExpandedFolders") ||
  !connectionPane.includes("writeStoredExpandedFolders")
) {
  throw new Error("ConnectionPane should read and write expanded folder state");
}

console.log("Workspace persistence source check passed.");
