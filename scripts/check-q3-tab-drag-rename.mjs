import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  "src/features/layout/WorkspaceShell.tsx",
  "utf8",
);
const stylesSource = readFileSync("src/styles/app.css", "utf8");

const requiredWorkspace = [
  '"subtab-before-terminal"',
  '"subtab-after-terminal"',
  '"subtab-before-local"',
  '"subtab-after-local"',
  "function reorderTerminalTabsInConnection",
  "function reorderLocalTerminalTabs",
  "function commitRenamingSshTab",
  "function commitRenamingLocalTab",
  "function startRenamingSshTab",
  "function startRenamingLocalTab",
  'className="subtab-rename-input"',
  "maxLength={50}",
  "renameInputRef",
  "renameLocalInputRef",
  "renamingTabId",
  "renamingLocalTabId",
  "data-workbench-tab-after-zone",
  "data-workbench-tab-id=",
  "data-workbench-tab-kind=",
  "onDoubleClick=",
  "getWorkbenchTabDropTargetId",
  "applyWorkbenchTabMouseDrop(currentDrag.payload, dropZone, targetTabId)",
  // updateConnectingTabStep 与 replaceConnectingTabWithTerminal 都用 isDefaultTerminalTitle 保护用户重命名。
  "function isDefaultTerminalTitle",
  "isDefaultTerminalTitle(tab.title, tab.index)",
];

for (const needle of requiredWorkspace) {
  if (!workspaceSource.includes(needle)) {
    throw new Error(`WorkspaceShell is missing expected Q3 token: ${needle}`);
  }
}

// 反向断言:旧的硬编码 title 覆盖不能回归。replaceConnectingTabWithTerminal 必须用 isDefaultTerminalTitle。
const legacyOverwriteNeedle = /title:\s*terminalTabTitle\(tab\.index\)(?![^]*\?)/;
if (legacyOverwriteNeedle.test(workspaceSource)) {
  throw new Error(
    "WorkspaceShell regressed: replaceConnectingTabWithTerminal must guard title with isDefaultTerminalTitle",
  );
}

for (const needle of requiredWorkspace) {
  if (!workspaceSource.includes(needle)) {
    throw new Error(`WorkspaceShell is missing expected Q3 token: ${needle}`);
  }
}

const preservedWorkspace = [
  "function applyWorkbenchTabMouseDrop",
  "function handleWorkbenchTabMouseDown",
  "workbenchTabMouseDrag",
  'data-workbench-tab-drop-zone="file"',
  'data-workbench-tab-drop-zone="terminal"',
  'data-workbench-tab-drop-zone="split-file"',
  'data-workbench-tab-drop-zone="split-terminal"',
];

for (const needle of preservedWorkspace) {
  if (!workspaceSource.includes(needle)) {
    throw new Error(`WorkspaceShell is missing preserved Q1/Q2 token: ${needle}`);
  }
}

if (!stylesSource.includes(".subtab-rename-input")) {
  throw new Error("app.css is missing .subtab-rename-input styles");
}
if (
  !stylesSource.includes(
    '.subtab-shell[data-workbench-tab-drop-active="before"]::before',
  )
) {
  throw new Error("app.css is missing subtab drop indicator styles");
}

console.log("Q3 tab drag-reorder + rename check passed.");