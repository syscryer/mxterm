import { readFileSync } from "node:fs";

const terminalPanel = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");
const clipboard = readFileSync("src/shared/clipboard.ts", "utf8");

function assertIncludes(source, value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  terminalPanel,
  "attachCustomKeyEventHandler",
  "TerminalPanel must install a custom key handler so Ctrl+C can copy xterm selections before reaching the PTY.",
);

assertIncludes(
  terminalPanel,
  "isTerminalCopyShortcut",
  "TerminalPanel must centralize Ctrl+C/Cmd+C detection for terminal copy behavior.",
);

assertIncludes(
  terminalPanel,
  "terminal.hasSelection()",
  "Ctrl+C must only copy when xterm has an active selection.",
);

assertIncludes(
  terminalPanel,
  "terminal.getSelection()",
  "TerminalPanel must copy the actual xterm selection text.",
);

assertIncludes(
  terminalPanel,
  "copyTextToClipboard",
  "TerminalPanel must use the shared clipboard helper instead of duplicating clipboard fallback logic.",
);

assertIncludes(
  clipboard,
  "export async function copyTextToClipboard",
  "Clipboard writes must be centralized in src/shared/clipboard.ts.",
);

console.log("terminal copy shortcut source check passed");
