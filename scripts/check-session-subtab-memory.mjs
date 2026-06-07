import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");
const titlebar = readFileSync(new URL("../src/features/layout/AppTitlebar.tsx", import.meta.url), "utf8");

if (!workspace.includes("activeTabByConnectionId")) {
  throw new Error("WorkspaceShell should remember the active child tab per connection");
}

if (!workspace.includes("preferredTabForConnection")) {
  throw new Error("WorkspaceShell should resolve the preferred child tab when switching sessions");
}

if (!workspace.includes("rememberActiveTab")) {
  throw new Error("WorkspaceShell should update the remembered child tab on activation");
}

if (!workspace.includes("activateTerminalTab(tab)")) {
  throw new Error("Subtab clicks should activate through the shared tab activation path");
}

if (titlebar.includes("session.tabs[0]")) {
  throw new Error("AppTitlebar should not reset a session to its first child tab");
}

console.log("Session subtab memory check passed.");
