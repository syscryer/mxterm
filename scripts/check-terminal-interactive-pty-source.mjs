import { readFileSync } from "node:fs";

const terminalPanel = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");
const workspaceShell = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const commands = readFileSync("src/shared/tauri/commands.ts", "utf8");
const tauriCommands = readFileSync("src-tauri/src/commands.rs", "utf8");
const tauriLib = readFileSync("src-tauri/src/lib.rs", "utf8");

function assertIncludes(source, value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(source, value, message) {
  if (source.includes(value)) {
    throw new Error(message);
  }
}

assertExcludes(
  terminalPanel,
  "convertEol: true",
  "Interactive PTY sessions must let the shell control CR/LF behavior.",
);

assertIncludes(
  terminalPanel,
  "windowsPty?: IWindowsPty",
  "TerminalPanel must receive concrete Windows PTY compatibility details.",
);

assertIncludes(
  terminalPanel,
  "function resolveWindowsPtyOption",
  "TerminalPanel must centralize xterm Windows PTY compatibility options.",
);

assertExcludes(
  terminalPanel,
  "}, [initialRequestId, initialSessionId, tabId, windowsPty]);",
  "Updating Windows PTY metadata must not dispose TerminalPanel and close a running session.",
);

assertIncludes(
  workspaceShell,
  "getWindowsPtyInfo",
  "WorkspaceShell must load the Windows build number before creating local ConPTY terminals.",
);

assertIncludes(
  workspaceShell,
  "windowsPty={windowsPtyInfo}",
  "Local Windows terminals must pass concrete ConPTY compatibility details to xterm.",
);

assertIncludes(
  commands,
  'invoke<WindowsPtyInfo | null>("get_windows_pty_info")',
  "Frontend must expose a typed get_windows_pty_info wrapper.",
);

assertIncludes(
  tauriCommands,
  "pub struct WindowsPtyInfo",
  "Backend must serialize Windows PTY compatibility details.",
);

assertIncludes(
  tauriCommands,
  "windows_version::OsVersion::current().build",
  "Backend must source the Windows build number from the OS.",
);

assertIncludes(
  tauriLib,
  "commands::get_windows_pty_info",
  "get_windows_pty_info must be registered as a Tauri command.",
);

console.log("terminal interactive PTY source check passed");
