import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

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
    throw new Error(`${selector} should include "${expected}" so long file trees cannot compress fixed chrome`);
  }
}

assertIncludes(".tool-pane", "display: flex");
assertIncludes(".tool-pane", "flex-direction: column");
assertIncludes(".tool-pane", "overflow: hidden");
assertIncludes(".tool-tabs", "flex: 0 0 34px");
assertIncludes(".tool-tabs", "min-height: 34px");
assertIncludes(".file-panel-toolbar", "flex: 0 0 auto");
assertIncludes(".file-list", "flex: 1 1 0");
assertIncludes(".file-list", "min-height: 0");
assertIncludes(".file-list", "overflow: auto");

console.log("Remote file panel scroll-boundary check passed.");
