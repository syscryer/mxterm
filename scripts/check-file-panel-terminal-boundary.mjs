import { readFileSync } from "node:fs";

const files = [
  "src/features/terminal/TerminalPanel.tsx",
  "src/features/terminal/terminalInputDirectory.ts",
  "src/features/terminal/terminalPromptDirectory.ts",
  "src/features/layout/WorkspaceShell.tsx",
  "src/features/files/RemoteFilePanel.tsx",
];

const forbiddenPatterns = [
  {
    pattern: /\bdirectoryLocateRequest\b/,
    reason: "File manager must not ask TerminalPanel to probe a directory.",
  },
  {
    pattern: /\bcurrentDirectoryProbeCommand\b/,
    reason: "File manager must not inject a current-directory probe into the terminal.",
  },
  {
    pattern: /\bterminalDirectoryRequests\b/,
    reason: "WorkspaceShell should only store passive terminal directory signals.",
  },
  {
    pattern: /\bonRequestTerminalDirectory\b/,
    reason: "RemoteFilePanel should consume a known terminal path, not request terminal input.",
  },
  {
    pattern: /\bterminalLocatePending\b/,
    reason: "Manual locate should be immediate or disabled, never wait on a terminal probe.",
  },
  {
    pattern: /\$PWD/,
    reason: "Do not write shell probes into the interactive terminal.",
  },
  {
    pattern: /\bapplyTerminalPromptDirectoryOutput\b/,
    reason: "Prompt fallback must read an on-demand xterm snapshot, not parse every output chunk.",
  },
];

const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(text)) {
      failures.push(`${file}: ${reason}`);
    }
  }
}

const terminalPanelSource = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");
if (!/PROMPT_DIRECTORY_FAST_SNAPSHOT_LOOKBACK_ROWS\s*=\s*1000\b/.test(terminalPanelSource)) {
  failures.push("TerminalPanel should inspect 1000 recent rows for the fast prompt snapshot.");
}
if (!/PROMPT_DIRECTORY_ANCHOR_SNAPSHOT_LOOKBACK_ROWS\s*=\s*2000\b/.test(terminalPanelSource)) {
  failures.push("TerminalPanel should inspect up to 2000 rows for the prompt anchor fallback.");
}
if (!/readPromptDirectorySnapshotLines/.test(terminalPanelSource)) {
  failures.push("TerminalPanel should keep prompt snapshot row collection isolated to locate-time reads.");
}

if (failures.length > 0) {
  console.error("File-panel terminal boundary check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("File-panel terminal boundary check passed.");
