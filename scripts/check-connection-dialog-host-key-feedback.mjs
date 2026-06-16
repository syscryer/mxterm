import { readFileSync } from "node:fs";

const dialogSource = readFileSync("src/features/connections/ConnectionDialog.tsx", "utf8");
const workspaceSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const styleSource = readFileSync("src/styles/app.css", "utf8");

const requiredDialogSnippets = [
  'from "./hostKeyErrors"',
  "onTrustHostKey",
  "信任并继续测试",
  "更新信任并继续测试",
  "fb-host-key",
  "testState === \"host-key\"",
];

for (const snippet of requiredDialogSnippets) {
  if (!dialogSource.includes(snippet)) {
    throw new Error(`ConnectionDialog host-key feedback is missing: ${snippet}`);
  }
}

if (dialogSource.includes("底层：<code>{feedback.rawMessage}</code>")) {
  throw new Error("ConnectionDialog still renders raw host-key JSON in the compact feedback card.");
}

if (!workspaceSource.includes('from "../connections/hostKeyErrors"')) {
  throw new Error("WorkspaceShell should reuse the shared host-key error parser.");
}

if (workspaceSource.includes("function parseHostKeyError(")) {
  throw new Error("WorkspaceShell should not keep a private host-key error parser.");
}

const requiredStyleSnippets = [
  ".conn-feedback.host-key",
  ".conn-feedback .fb-host-key",
  "overflow-wrap: anywhere",
];

for (const snippet of requiredStyleSnippets) {
  if (!styleSource.includes(snippet)) {
    throw new Error(`Host-key feedback style is missing: ${snippet}`);
  }
}

console.log("Connection dialog host-key feedback source check passed.");
