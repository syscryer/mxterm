import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

const terminalSubtabsRule = styles.match(/\.terminal-subtabs\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";
const terminalSubtabsAfterRule =
  styles.match(/\.terminal-subtabs::after\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body || "";

if (!terminalSubtabsRule) {
  throw new Error("Expected .terminal-subtabs styles to exist");
}

if (/inset\s+0\s+1px\s+0\s+rgb\(255\s+255\s+255/i.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar should not draw a bright top inset divider");
}

if (/linear-gradient\(180deg,\s*rgb\(255\s+255\s+255/i.test(terminalSubtabsAfterRule)) {
  throw new Error("Terminal subtab bar should not draw a bright top gradient divider");
}

if (!/border-top:\s*0\s*;/.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar should remove the top border at the titlebar boundary");
}

if (/0\s+24px\s+52px|0\s+8px\s+22px/i.test(terminalSubtabsRule)) {
  throw new Error("Terminal subtab bar shadow should stay subtle over terminal content");
}

console.log("Terminal chrome source check passed.");
