import { existsSync, readFileSync } from "node:fs";

const tabContextMenuPath = "src/shared/ui/TabContextMenu.tsx";
const titlebarSource = readFileSync("src/features/layout/AppTitlebar.tsx", "utf8");
const workspaceSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const styles = readFileSync("src/styles/app.css", "utf8");

if (!existsSync(tabContextMenuPath)) {
  throw new Error("TabContextMenu shared component should exist.");
}

const tabContextMenuSource = readFileSync(tabContextMenuPath, "utf8");

for (const [sourceName, source, needles] of [
  [
    "TabContextMenu.tsx",
    tabContextMenuSource,
    [
      "@radix-ui/react-context-menu",
      "export interface TabContextMenuAction",
      "hint?: string",
      "separatorBefore?: boolean",
      "ContextMenu.Trigger asChild",
      "tab-context-menu-hint",
    ],
  ],
  [
    "AppTitlebar.tsx",
    titlebarSource,
    [
      "TabContextMenu",
      "onCloseAllConnectionSessions",
      "onCloseConnectionSessionsToRight",
      "onCloseOtherConnectionSessions",
      "Ctrl+K W",
    ],
  ],
  [
    "WorkspaceShell.tsx",
    workspaceSource,
    [
      "closeOtherRemoteFileTabs",
      "closeRemoteFileTabsToRight",
      "closeSavedRemoteFileTabsForConnection",
      "closeOtherTerminalTabs",
      "closeTerminalTabsToRight",
      "closeOtherLocalTerminalTabs",
      "closeLocalTerminalTabsToRight",
      "closeOtherConnectionSessions",
      "closeConnectionSessionsToRight",
      "copyRemotePath(tab.path)",
      "isClosableSavedRemoteFileTab",
    ],
  ],
  [
    "app.css",
    styles,
    [
      ".tab-context-menu-content",
      ".context-menu-item.tab-context-menu-item",
      ".tab-context-menu-label",
      ".tab-context-menu-hint",
      ".context-menu-item.tab-context-menu-item.danger",
    ],
  ],
]) {
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`${sourceName} is missing expected tab context menu source: ${needle}`);
    }
  }
}

for (const functionName of [
  "closeRemoteFileTabsToRight",
  "closeTerminalTabsToRight",
  "closeLocalTerminalTabsToRight",
  "closeConnectionSessionsToRight",
]) {
  const match = workspaceSource.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  if (!match || !match[0].includes("if (index < 0)")) {
    throw new Error(`${functionName} should guard missing tab indexes before slicing.`);
  }
}

console.log("Tab context menu source check passed.");
