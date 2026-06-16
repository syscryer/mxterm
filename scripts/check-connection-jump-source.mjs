import { readFileSync } from "node:fs";

const typeSource = readFileSync("src/features/connections/connectionTypes.ts", "utf8");
const dialogSource = readFileSync("src/features/connections/ConnectionDialog.tsx", "utf8");
const useConnectionsSource = readFileSync("src/features/connections/useConnections.ts", "utf8");
const backendConnectionSource = readFileSync("src-tauri/src/connections/mod.rs", "utf8");
const backendConfigSource = readFileSync("src-tauri/src/ssh_config.rs", "utf8");

const requiredFrontendTypeSnippets = [
  'export type ConnectionJumpKind = "none" | "ssh_jump";',
  "export interface ConnectionJumpConfig",
  "jump: ConnectionJumpConfig;",
  "defaultJumpConfig",
];

for (const snippet of requiredFrontendTypeSnippets) {
  if (!typeSource.includes(snippet)) {
    throw new Error(`connectionTypes.ts is missing jump contract: ${snippet}`);
  }
}

const requiredDialogSnippets = [
  "网络路径",
  "SSH 跳板机",
  "jump_connection_id",
  "选择跳板机",
  "validateNetworkPath",
];

for (const snippet of requiredDialogSnippets) {
  if (!dialogSource.includes(snippet)) {
    throw new Error(`ConnectionDialog is missing jump entry UI: ${snippet}`);
  }
}

if (!useConnectionsSource.includes("jump: normalizeJumpConfig(input.jump)")) {
  throw new Error("useConnections should normalize jump config before persistence.");
}

if (!useConnectionsSource.includes('kind: "ssh_jump" as const')) {
  throw new Error("useConnections should preserve ssh_jump kind so Rust validation can reject missing jump ids.");
}

const requiredBackendSnippets = [
  "pub enum ConnectionJumpKind",
  "pub struct ConnectionJumpConfig",
  "pub jump: ConnectionJumpConfig",
  "validate_jump_config",
];

for (const snippet of requiredBackendSnippets) {
  if (!backendConnectionSource.includes(snippet)) {
    throw new Error(`connections/mod.rs is missing jump persistence: ${snippet}`);
  }
}

if (!backendConfigSource.includes("pub jump: crate::connections::ConnectionJumpConfig")) {
  throw new Error("ResolvedSshConfig should carry jump config for future SSH jump implementation.");
}

console.log("Connection jump source check passed.");
