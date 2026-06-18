import { readFileSync } from "node:fs";

const source = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");

function assertIncludes(value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(value, message) {
  if (source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  "const TERMINAL_RESIZE_SYNC_DEBOUNCE_MS",
  "TerminalPanel must debounce backend PTY resize synchronization.",
);

assertIncludes(
  "function scheduleTerminalSizeSync",
  "TerminalPanel must centralize debounced backend resize synchronization.",
);

assertIncludes(
  "function fitAndScheduleTerminalSize",
  "ResizeObserver should fit xterm immediately but debounce backend resize.",
);

assertIncludes(
  "const activeRef = useRef(active)",
  "TerminalPanel must track active state for resize synchronization.",
);

assertIncludes(
  "if (!activeRef.current)",
  "ResizeObserver/onResize paths must ignore inactive hidden terminal panels.",
);

assertIncludes(
  "clearPendingTerminalResizeSync",
  "TerminalPanel must clear pending resize timers during cleanup.",
);

assertExcludes(
  "const resizeObserver = new ResizeObserver(() => {\n      fitAndSyncTerminalSize(terminal, fitAddon, sessionIdRef.current, lastSyncedSizeRef);\n    });",
  "ResizeObserver must not synchronously send every intermediate window size to the PTY.",
);

console.log("terminal resize debounce source check passed");
