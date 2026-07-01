import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertContains(path, pattern, message) {
  const content = read(path);
  if (!pattern.test(content)) {
    throw new Error(`${path}: ${message}`);
  }
}

assertContains(
  "src/features/terminal/localTerminalTypes.ts",
  /ctrlVPaste:\s*boolean/,
  "LocalTerminalSettings must expose ctrlVPaste.",
);

assertContains(
  "src/features/settings/settingsTypes.ts",
  /ctrlVPaste:\s*true/,
  "defaultSettings.localTerminal must enable Ctrl+V paste by default.",
);

assertContains(
  "src/features/settings/settingsTypes.ts",
  /ctrlVPaste:\s*normalizeBoolean\(\s*localTerminal\.ctrlVPaste,\s*defaultSettings\.localTerminal\.ctrlVPaste/s,
  "normalizeSettings must preserve stored ctrlVPaste and migrate missing values to the default.",
);

assertContains(
  "src/features/settings/SettingsView.tsx",
  /title="Ctrl\+V 粘贴到终端"/,
  "SettingsView must render the Ctrl+V paste toggle.",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /ctrlVPaste\s*=\s*true/,
  "TerminalPanel must default Ctrl+V paste behavior to enabled.",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /isTerminalPasteShortcut/,
  "TerminalPanel must handle the Ctrl+V paste shortcut.",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /terminalWrite\(activeSessionId,\s*"\\x16"\)/,
  "When Ctrl+V paste is disabled, TerminalPanel must send literal-next to the PTY.",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /addEventListener\("keydown",\s*interceptCtrlVPaste,\s*true\)/,
  "When Ctrl+V paste is enabled, TerminalPanel must intercept Ctrl+V in the capture phase before xterm consumes it.",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /readTextFromClipboard\(\)/,
  "When Ctrl+V paste is enabled, TerminalPanel must read the clipboard via the shared helper (Tauri plugin, no browser prompt).",
);

assertContains(
  "src/features/terminal/TerminalPanel.tsx",
  /terminal\.paste\(text\)/,
  "When Ctrl+V paste is enabled, TerminalPanel must write clipboard text through terminal.paste() so bracketed paste and onData tracking stay intact.",
);

assertContains(
  "src/shared/clipboard.ts",
  /@tauri-apps\/plugin-clipboard-manager/,
  "Clipboard reads must go through the Tauri clipboard-manager plugin to avoid browser permission prompts.",
);

assertContains(
  "src/features/layout/WorkspaceShell.tsx",
  /ctrlVPaste=\{settings\.localTerminal\.ctrlVPaste\}/,
  "WorkspaceShell must pass the persisted Ctrl+V paste setting into terminal panels.",
);

console.log("terminal Ctrl+V paste source contract ok");
