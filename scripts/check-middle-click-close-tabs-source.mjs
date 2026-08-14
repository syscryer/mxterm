import { readFileSync } from "node:fs";

const helperSource = readFileSync("src/shared/ui/tabEvents.ts", "utf8");
const titlebarSource = readFileSync("src/features/layout/AppTitlebar.tsx", "utf8");
const workspaceSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const vncRunnerSource = readFileSync("src/features/layout/VncRunnerWindowApp.tsx", "utf8");

for (const snippet of [
  "event.button !== 1",
  "event.preventDefault()",
  "event.stopPropagation()",
  "onClose()",
]) {
  if (!helperSource.includes(snippet)) {
    throw new Error(`Shared middle-click handler is missing: ${snippet}`);
  }
}

for (const [label, source, binding] of [
  [
    "titlebar connection",
    titlebarSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(\(\) =>\s*onCloseConnectionSession\(session\.connectionId\),?\s*\)\}/,
  ],
  [
    "terminal split group",
    workspaceSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(requestCloseTerminalSplitGroup\)\}/,
  ],
  [
    "SSH terminal",
    workspaceSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(\(\) => closeTerminal\(tab\.id\)\)\}/,
  ],
  [
    "local terminal",
    workspaceSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(\(\) => closeLocalTerminalSession\(tab\)\)\}/,
  ],
  [
    "remote file",
    workspaceSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(\(\) => closeRemoteFileTab\(tab\.id\)\)\}/,
  ],
  [
    "VNC runner",
    vncRunnerSource,
    /onAuxClick=\{createMiddleClickCloseHandler\(\(\) => closeSession\(workspaceSessionId\)\)\}/,
  ],
]) {
  if (!binding.test(source)) {
    throw new Error(`${label} tab must reuse its existing close entry point.`);
  }
}

for (const [label, source, expectedCount] of [
  ["titlebar connection", titlebarSource, 1],
  ["workspace terminal/file", workspaceSource, 4],
  ["VNC runner", vncRunnerSource, 1],
]) {
  const count = source.match(/onAuxClick=\{createMiddleClickCloseHandler/g)?.length || 0;
  if (count !== expectedCount) {
    throw new Error(`${label} tabs expected ${expectedCount} middle-click handlers, found ${count}.`);
  }
}

console.log("Middle-click close tab source check passed.");
