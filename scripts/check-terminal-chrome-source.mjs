import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

const terminalWorkbenchPaneRule =
  [...styles.matchAll(/\.terminal-workbench-pane\s*\{(?<body>[\s\S]*?)\n\}/g)]
    .map((match) => match.groups?.body || "")
    .find((body) => body.includes("row-gap")) || "";
const terminalSubtabsRule = styles.match(/\.terminal-subtabs\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";
const terminalSubtabsAfterRule =
  styles.match(/\.terminal-subtabs::after\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";
const terminalSubtabsOverlayRule =
  styles.match(/\.remote-editor-tabs::before,\s*\n\.remote-editor-tabs::after,\s*\n\.terminal-subtabs::before,\s*\n\.terminal-subtabs::after\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";

if (!terminalSubtabsRule) {
  throw new Error("Expected .terminal-subtabs styles to exist");
}

if (!terminalWorkbenchPaneRule.includes("var(--mx-panel) 0 var(--terminal-glassbar-height)")) {
  throw new Error("Terminal workbench should paint a panel-colored backing behind the chrome bar.");
}

if (/inset\s+0\s+1px\s+0\s+rgb\(255\s+255\s+255/i.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar should not draw a bright top inset divider");
}

if (/linear-gradient\(180deg,\s*rgb\(255\s+255\s+255/i.test(terminalSubtabsAfterRule)) {
  throw new Error("Terminal subtab bar should not draw a bright top gradient divider");
}

if (!/border-top:\s*0\s*;/.test(terminalSubtabsRule) && !/border:\s*0\s*;/.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar should remove the top border at the titlebar boundary");
}

if (!/border-top-left-radius:\s*12px\s*;/.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar should align its top-left radius with the workbench chrome.");
}

if (/0\s+24px\s+52px|0\s+8px\s+22px/i.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar shadow should stay subtle over terminal content");
}

if (!/border-top-left-radius:\s*inherit\s*;/.test(terminalSubtabsOverlayRule)) {
  throw new Error("Terminal subtab bar overlay should inherit the chrome corner radius.");
}

console.log("Terminal chrome source check passed.");
