import { readFileSync } from "node:fs";

const workspaceShell = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

for (const needle of [
  "function syncCommandSenderTargetTab(",
  "setCommandSenderTargetTabByConnectionId((tabs) =>",
  "setSelectedCommandTargetKeys((keys) =>",
  "syncCommandSenderTargetTab(tab.connectionId, tab.id);",
  "syncCommandSenderTargetTab(localCommandSenderTargetId, tab.id);",
]) {
  if (!workspaceShell.includes(needle)) {
    throw new Error(`WorkspaceShell should keep Command Sender target tab aligned with active tabs: ${needle}`);
  }
}

if (
  !/function activateTerminalTab\(tab: TerminalTab\) \{[\s\S]*?rememberActiveTab\(tab\);[\s\S]*?syncCommandSenderTargetTab\(tab\.connectionId, tab\.id\);[\s\S]*?\}/.test(
    workspaceShell,
  )
) {
  throw new Error("SSH terminal activation should sync the Command Sender target tab.");
}

if (
  !/function activateLocalTerminalTab\(tab: LocalTerminalTab\) \{[\s\S]*?setActiveLocalTerminalTabId\(tab\.id\);[\s\S]*?syncCommandSenderTargetTab\(localCommandSenderTargetId, tab\.id\);[\s\S]*?\}/.test(
    workspaceShell,
  )
) {
  throw new Error("Local terminal activation should sync the Command Sender target tab.");
}

console.log("Command Sender active-tab source check passed.");
