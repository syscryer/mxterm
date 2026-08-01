import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function includes(source, value, message) {
  assert(source.includes(value), message);
}

const rustCommands = read("src-tauri/src/commands.rs");
const rustLib = read("src-tauri/src/lib.rs");
const typedCommands = read("src/shared/tauri/commands.ts");
const shell = read("src/features/layout/WorkspaceShell.tsx");
const dialog = read("src/features/connections/ConnectionTransferDialog.tsx");

for (const command of [
  "connection_transfer_export",
  "connection_transfer_preview",
  "connection_transfer_import",
]) {
  includes(rustCommands, `fn ${command}`, `Rust command ${command} is missing.`);
  includes(rustLib, `commands::${command}`, `Tauri handler ${command} is not registered.`);
  includes(typedCommands, `\"${command}\"`, `Typed wrapper ${command} is missing.`);
}

includes(
  shell,
  'import("../connections/ConnectionTransferDialog")',
  "Connection transfer dialog must remain dynamically imported.",
);
assert(
  !shell.includes('import { ConnectionTransferDialog } from "../connections/ConnectionTransferDialog"'),
  "WorkspaceShell must not statically import ConnectionTransferDialog.",
);
includes(shell, 'onClick={onImportConnections}', "Import quick link must call the import workflow.");
includes(shell, 'onClick={onExportConnections}', "Export quick link must call the export workflow.");
includes(dialog, "connectionTransferPreview", "Import must run backend preflight.");
includes(dialog, "preview.fingerprint", "Import must send the preflight fingerprint.");
includes(dialog, 'role="alert"', "Transfer errors must be announced accessibly.");

console.log("connection transfer source check passed");
