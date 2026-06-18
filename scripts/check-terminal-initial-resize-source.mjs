import { readFileSync } from "node:fs";

const source = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");

function assertIncludes(value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  "function fitAndSyncTerminalSize",
  "TerminalPanel must centralize fit plus backend resize synchronization.",
);

assertIncludes(
  "function syncTerminalSize",
  "TerminalPanel must de-duplicate backend resize synchronization.",
);

assertIncludes(
  "void terminalResize(activeSessionId, cols, rows)",
  "TerminalPanel must send the fitted cols/rows to the backend session.",
);

assertIncludes(
  "fitAndSyncTerminalSize(terminal, fitAddon, sessionIdRef.current, lastSyncedSizeRef)",
  "TerminalPanel must sync the initial pre-created session size after fit.",
);

console.log("terminal initial resize source check passed");
