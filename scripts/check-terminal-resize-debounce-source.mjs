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
  "TerminalPanel must debounce terminal resize handling.",
);

// fit() must be coalesced inside the debounce timer together with the backend
// sync, NOT called synchronously on every ResizeObserver frame. Synchronous
// per-frame fit() desyncs xterm's canvas from its logical buffer and causes the
// ghosting / duplicated-glyph artifacts seen while dragging the window.
assertIncludes(
  "function scheduleFitAndSyncTerminalSize",
  "ResizeObserver must debounce fit() and backend resize through one shared timer.",
);

assertIncludes(
  "fitAddon.fit();",
  "Debounced resize must still call fit() to recompute xterm cols/rows.",
);

assertExcludes(
  "function fitAndScheduleTerminalSize",
  "The old half-debounced helper (synchronous fit + deferred sync) must be removed.",
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

// onResize fires from fit(). The drag path already syncs the backend inside the
// same debounce tick, so onResize must call syncTerminalSize directly only for
// imperative fits (font/active/init) to keep xterm and the PTY on one size.
assertIncludes(
  "syncTerminalSize(terminal, activeSessionId, cols, rows, lastSyncedSizeRef);",
  "onResize must synchronously sync imperative fits to the backend PTY.",
);

console.log("terminal resize debounce source check passed");
