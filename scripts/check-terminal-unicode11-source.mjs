import { readFileSync } from "node:fs";

const source = readFileSync("src/features/terminal/TerminalPanel.tsx", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Dependency must be declared. xterm's default Unicode 6 width table disagrees
// with ConPTY (Windows 10+) on CJK/fullwidth/emoji widths, which desyncs the
// IME composition cursor and pushes TUI input to the wrong column.
assert(
  Boolean(pkg.dependencies?.["@xterm/addon-unicode11"]),
  "package.json must depend on @xterm/addon-unicode11.",
);

assert(
  source.includes('from "@xterm/addon-unicode11"'),
  "TerminalPanel must import the Unicode11Addon.",
);

assert(
  source.includes("new Unicode11Addon()"),
  "TerminalPanel must instantiate the Unicode11Addon.",
);

assert(
  source.includes('terminal.loadAddon(unicode11Addon)') ||
    source.includes("terminal.loadAddon(new Unicode11Addon())"),
  "TerminalPanel must load the Unicode11Addon into the terminal.",
);

// activeVersion is a proposed API, so allowProposedApi must stay enabled.
assert(
  source.includes("allowProposedApi: true"),
  "TerminalPanel must keep allowProposedApi enabled for unicode.activeVersion.",
);

assert(
  source.includes('terminal.unicode.activeVersion = "11"'),
  "TerminalPanel must activate Unicode 11 width rules to align with ConPTY.",
);

console.log("terminal unicode11 source check passed");
