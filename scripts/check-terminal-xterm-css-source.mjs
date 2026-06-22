import { readFileSync } from "node:fs";

const styleSource = readFileSync("src/styles/app.css", "utf8");

function assertIncludes(value, message) {
  if (!styleSource.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(value, message) {
  if (styleSource.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  ".terminal-host .xterm *",
  "xterm internals must be isolated from the app-wide box-sizing reset.",
);

assertIncludes(
  "box-sizing: content-box;",
  "xterm internals must keep xterm's expected content-box sizing.",
);

assertIncludes(
  ".terminal-host .xterm-helper-textarea",
  "xterm helper textarea must be protected from global input/textarea styles.",
);

assertIncludes(
  ".terminal-host .xterm {\n  height: 100%;\n  padding-left: var(--mx-terminal-gutter-x);",
  "terminal left gutter must live on the xterm element so FitAddon subtracts it from measured columns.",
);

assertExcludes(
  "padding-left: var(--mx-terminal-content-inset-x)",
  "xterm screen must not use parent-only padding because it desynchronizes cursor and IME coordinates.",
);

assertExcludes(
  ".terminal-host .xterm-screen {\n  box-sizing: border-box;",
  "xterm screen must not override the content-box isolation.",
);

console.log("terminal xterm css source check passed");
