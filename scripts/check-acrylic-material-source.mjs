import { readFileSync } from "node:fs";

const tokenCss = readFileSync("src/styles/tokens.css", "utf8");
const appCss = readFileSync("src/styles/app.css", "utf8");

function readRule(source, selector) {
  const start = source.indexOf(selector);
  const end = start >= 0 ? source.indexOf("}", start) : -1;
  return start >= 0 && end >= 0 ? source.slice(start, end) : "";
}

for (const [label, selector, fill] of [
  ["light acrylic", '.app-shell[data-window-material="acrylic"] {', "--mx-chrome-fill: rgb(238 242 248 / 62%);"],
  ["dark acrylic", '.app-shell[data-theme-mode="dark"][data-window-material="acrylic"],', "--mx-chrome-fill: rgb(30 31 34 / 64%);"],
  ["system dark acrylic", '.app-shell[data-theme-mode="system"][data-window-material="acrylic"],', "--mx-chrome-fill: rgb(30 31 34 / 64%);"],
]) {
  const rule = readRule(tokenCss, selector);
  if (!rule.includes(fill) || !rule.includes("--mx-chrome-blur: 72px;")) {
    throw new Error(`${label} should match the shared acrylic fill and blur contract`);
  }
  if (!rule.includes("--mx-sidebar-surface: transparent;")) {
    throw new Error(`${label} sidebar should inherit the single root acrylic layer`);
  }
}

const materialLayer = readRule(appCss, ".app-shell::before {");
if (!materialLayer.includes("var(--mx-chrome-fill)")) {
  throw new Error("root material layer should consume the shared chrome fill");
}

const sidebarRule = readRule(appCss, ".app-sidebar {");
if (!sidebarRule.includes("background: var(--mx-sidebar-surface)")) {
  throw new Error("sidebars should consume the shared material surface token");
}

console.log("Acrylic material source check passed.");
