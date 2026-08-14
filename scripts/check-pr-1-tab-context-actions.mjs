import { readFileSync } from "node:fs";

const actionsSource = readFileSync("src/features/terminal/tabContextMenuActions.ts", "utf8");
const workspaceSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

for (const needle of [
  "hideClose?: boolean",
  "hideCloseOthers?: boolean",
  "hideCloseRight?: boolean",
  "hideSplit?: boolean",
  "const splitDisabled = !canSplit;",
  'label: "四分屏"',
  "disabled: false",
]) {
  if (!actionsSource.includes(needle)) {
    throw new Error(`Shared terminal menu is missing expected behavior: ${needle}`);
  }
}

const groupStart = workspaceSource.indexOf("function renderTerminalSplitGroupSubtab()");
const groupEnd = workspaceSource.indexOf("function renderSshTerminalSubtab", groupStart);
if (groupStart < 0 || groupEnd < 0) {
  throw new Error("Terminal split group renderer is missing.");
}
const groupSource = workspaceSource.slice(groupStart, groupEnd);
for (const needle of [
  "hideClose: true",
  "hideCloseOthers: true",
  "hideCloseRight: true",
  "hideCloseAll: true",
  "hideSplit: true",
  'label: "关闭分屏组"',
]) {
  if (!groupSource.includes(needle)) {
    throw new Error(`Split group menu is missing expected override: ${needle}`);
  }
}

console.log("PR #1 terminal context action check passed.");
