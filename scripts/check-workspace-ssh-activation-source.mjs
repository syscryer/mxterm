import { readFileSync } from "node:fs";

const workspaceShell = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

function extractFunctionBody(name) {
  const start = workspaceShell.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(`WorkspaceShell should define ${name}`);
  }

  const bodyStart = workspaceShell.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < workspaceShell.length; index += 1) {
    const char = workspaceShell[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return workspaceShell.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`Could not parse ${name} body`);
}

const startConnectionStepBody = extractFunctionBody("startConnectionStep");

if (!startConnectionStepBody.includes('setActiveWorkspaceMode("ssh")')) {
  throw new Error(
    "Opening an SSH connection from the local terminal workspace must switch the main workspace back to SSH.",
  );
}

const modeIndex = startConnectionStepBody.indexOf('setActiveWorkspaceMode("ssh")');
const activeTabIndex = startConnectionStepBody.indexOf("setActiveTabId(tab.id)");
if (activeTabIndex !== -1 && modeIndex > activeTabIndex) {
  throw new Error("SSH workspace mode should be set before activating the new SSH terminal tab.");
}

console.log("workspace SSH activation source check passed");
