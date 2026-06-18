import { readFileSync } from "node:fs";

const source = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

function assertIncludes(value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  "function appendLocalTerminalWarmupOutput",
  "WorkspaceShell must keep local terminal late handoff output in localTerminalTabs.",
);

assertIncludes(
  "appendLocalTerminalWarmupOutput(tab.id, event.data)",
  "Local terminal warmup capture must append late output to local terminal tabs.",
);

assertIncludes(
  "setLocalTerminalTabs((tabs) =>",
  "Local terminal warmup append must update localTerminalTabs.",
);

console.log("local terminal warmup source check passed");
