import { readFileSync } from "node:fs";

const workspaceShell = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

for (const needle of [
  "function returnHomeWhenWorkspaceEmpty(",
  "setActiveWorkspaceMode(\"home\");",
  "setHomeActive(true);",
  "returnHomeWhenWorkspaceEmpty({ rdpCount: nextSessions.length });",
  "returnHomeWhenWorkspaceEmpty({ vncCount: nextSessions.length });",
]) {
  if (!workspaceShell.includes(needle)) {
    throw new Error(`WorkspaceShell should return to Home when the final workspace tab closes: ${needle}`);
  }
}

if (
  !/function returnHomeWhenWorkspaceEmpty\([\s\S]*?setActiveConnectionId\(null\);[\s\S]*?setActiveTabId\(null\);[\s\S]*?setActiveRdpSessionId\(null\);[\s\S]*?setActiveVncSessionId\(null\);[\s\S]*?setActiveLocalTerminalTabId\(null\);[\s\S]*?setActiveWorkspaceMode\("home"\);[\s\S]*?setHomeActive\(true\);[\s\S]*?\}/.test(
    workspaceShell,
  )
) {
  throw new Error("WorkspaceShell should clear active workspace ids before returning Home.");
}

console.log("Workspace empty-home source check passed.");
