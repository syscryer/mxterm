import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
const monitorPrototype = readFileSync(
  new URL("../prototype/light-neutral/mxterm-monitor-panel.html", import.meta.url),
  "utf8",
);
const cpuPrototype = readFileSync(
  new URL("../prototype/light-neutral/mxterm-monitor-cpu-grid.html", import.meta.url),
  "utf8",
);

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  if (!matches.length) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return matches.at(-1)[1];
}

function assertIncludes(selector, expected) {
  const rule = ruleFor(selector);
  if (!rule.includes(expected)) {
    throw new Error(`${selector} should include "${expected}"`);
  }
}

function assertSourceIncludes(expected) {
  if (!css.includes(expected)) {
    throw new Error(`Expected app.css to include "${expected}"`);
  }
}

assertSourceIncludes("--mx-scrollbar-thumb: transparent;");
assertSourceIncludes("--mx-scrollbar-thumb-hover: rgb(100 116 139 / 10%);");
assertSourceIncludes("--mx-scrollbar-thumb-active: rgb(100 116 139 / 18%);");
assertSourceIncludes("--mx-terminal-scrollbar-thumb-hover: rgb(100 116 139 / 14%);");
assertSourceIncludes("--mx-terminal-scrollbar-thumb-active: rgb(100 116 139 / 22%);");

assertIncludes(".app-shell *", "scrollbar-color: transparent transparent");
assertIncludes(".app-shell *::-webkit-scrollbar-track,\n.app-shell *::-webkit-scrollbar-corner", "background: transparent");
assertIncludes(".app-shell *::-webkit-scrollbar-thumb", "background-color: var(--mx-scrollbar-thumb)");
assertIncludes(".app-shell *::-webkit-scrollbar-thumb:active", "background-color: var(--mx-scrollbar-thumb-active)");
assertIncludes(".terminal-host .xterm .xterm-scrollable-element > .scrollbar > .slider.active", "var(--mx-terminal-scrollbar-thumb-active)");

for (const [name, source] of [
  ["monitor panel prototype", monitorPrototype],
  ["CPU grid prototype", cpuPrototype],
]) {
  if (!source.includes("scrollbar-color: transparent transparent;")) {
    throw new Error(`${name} should keep default scrollbars transparent`);
  }
  if (!source.includes("background-color: transparent;")) {
    throw new Error(`${name} should keep WebKit scrollbar thumbs transparent by default`);
  }
  if (!source.includes("rgba(100, 116, 139, 0.10)")) {
    throw new Error(`${name} should use a low-alpha hover scrollbar thumb`);
  }
  if (/rgba\(138,\s*143,\s*150,\s*0\.3/.test(source) || /rgba\(100,\s*116,\s*139,\s*0\.22/.test(source)) {
    throw new Error(`${name} still contains the older heavier scrollbar color`);
  }
}

console.log("Global scrollbar source check passed.");
