import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotIncludes(source, needle, message) {
  if (source.includes(needle)) {
    throw new Error(message);
  }
}

const packageJson = read("package.json");
const terminalPanel = read("src/features/terminal/TerminalPanel.tsx");
const workspaceShell = read("src/features/layout/WorkspaceShell.tsx");
const appCss = read("src/styles/app.css");

assertIncludes(
  packageJson,
  '"@xterm/addon-search"',
  "package.json must depend on @xterm/addon-search.",
);
assertIncludes(
  terminalPanel,
  'import { SearchAddon } from "@xterm/addon-search";',
  "TerminalPanel must import xterm SearchAddon.",
);
assertIncludes(
  terminalPanel,
  "terminal.loadAddon(searchAddon)",
  "TerminalPanel must load SearchAddon into xterm.",
);
assertIncludes(
  terminalPanel,
  "searchAddon.findNext",
  "TerminalPanel must support next-match search.",
);
assertIncludes(
  terminalPanel,
  "searchAddon.findPrevious",
  "TerminalPanel must support previous-match search.",
);
assertIncludes(
  terminalPanel,
  "searchAddon.clearDecorations",
  "TerminalPanel must clear search decorations when search closes.",
);
assertIncludes(
  terminalPanel,
  'readHexToken("--mx-primary"',
  "TerminalPanel search decorations must derive colors from global mx tokens.",
);
assertNotIncludes(
  terminalPanel,
  'activeMatchBackground: "#fde68a"',
  "TerminalPanel search decorations must not use ad-hoc hard-coded highlight colors.",
);
assertNotIncludes(
  terminalPanel,
  "输入关键字",
  "TerminalPanel must not render a redundant empty-search prompt next to the search box.",
);
assertIncludes(
  terminalPanel,
  "selectionBackground",
  "TerminalPanel must tune xterm selection colors so the active search match is not rendered as a heavy black block.",
);
assertIncludes(
  terminalPanel,
  "CaseSensitive",
  "TerminalPanel must expose a compact case-sensitive search toggle button.",
);
assertIncludes(
  terminalPanel,
  "caseSensitive",
  "TerminalPanel must pass case-sensitive mode into xterm search options.",
);
assertIncludes(
  workspaceShell,
  "terminal-search-toggle",
  "WorkspaceShell must expose a terminal search toolbar button.",
);
assertIncludes(
  workspaceShell,
  "searchOpen={",
  "WorkspaceShell must pass tab-scoped search state into TerminalPanel.",
);
assertIncludes(
  workspaceShell,
  "toggleTerminalSearchCaseSensitive",
  "WorkspaceShell must keep case-sensitive search state scoped by terminal tab.",
);
assertIncludes(
  appCss,
  ".terminal-search-bar",
  "app.css must style the terminal search bar.",
);
assertIncludes(
  appCss,
  "width: min(360px, calc(100% - 20px))",
  "Terminal search floating bar should stay compact.",
);
assertIncludes(
  appCss,
  "position: absolute",
  "Terminal search bar must float over the terminal instead of adding a full-width layout row.",
);
assertIncludes(
  appCss,
  "right: 10px",
  "Terminal search bar must be aligned to the right side of the terminal panel.",
);
assertNotIncludes(
  appCss,
  ".terminal-panel.terminal-search-open",
  "Terminal search bar must not add a separate row that exposes dark theme background bands.",
);

console.log("terminal search source checks passed");
