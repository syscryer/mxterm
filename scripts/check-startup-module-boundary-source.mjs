import { readFileSync } from "node:fs";

const appSource = readFileSync("src/App.tsx", "utf8");
const mainSource = readFileSync("src/main.tsx", "utf8");
const shellSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExcludes(source, value, message) {
  assert(!source.includes(value), message);
}

function assertIncludes(source, value, message) {
  assert(source.includes(value), message);
}

function listRuntimeStaticImports(source) {
  const importStatements = source.match(/import\s+[\s\S]*?from\s+["'][^"']+["'];?/g) || [];
  return importStatements.filter((statement) => !/^import\s+type\b/.test(statement.trim()));
}

function assertNoRuntimeStaticImport(source, path, name) {
  const blockedImport = listRuntimeStaticImports(source).find(
    (statement) => statement.includes(`from "${path}"`) || statement.includes(`from '${path}'`),
  );
  assert(
    !blockedImport,
    `WorkspaceShell must not statically import ${name}; load it at the first feature boundary.`,
  );
}

assertExcludes(
  appSource,
  'import { WorkspaceShell } from "./features/layout/WorkspaceShell"',
  "App must not statically import WorkspaceShell; route-load it so VNC runner windows avoid the workspace graph.",
);
assertExcludes(
  appSource,
  'import { VncRunnerWindowApp } from "./features/layout/VncRunnerWindowApp"',
  "App must not statically import VncRunnerWindowApp; main windows should avoid runner-only code.",
);
assertIncludes(
  appSource,
  'import("./features/layout/WorkspaceShell")',
  "App must dynamically import the main workspace shell.",
);
assertIncludes(
  appSource,
  'import("./features/layout/VncRunnerWindowApp")',
  "App must dynamically import the VNC runner window app.",
);
assertExcludes(
  mainSource,
  "loadAppComponent",
  "main.tsx should render the lightweight App shell after window restore and let App lazy-load the selected view.",
);
assertIncludes(
  appSource,
  "lazy(async () =>",
  "App should expose lazy view components so main.tsx does not wait for the full workspace module before showing the window.",
);

const startupHeavyImports = [
  ["../connections/ConnectionDialog", "ConnectionDialog"],
  ["../connections/ConnectionSearchDialog", "ConnectionSearchDialog"],
  ["../files/RemoteFilePanel", "RemoteFilePanel"],
  ["../monitor/MonitorPanel", "MonitorPanel"],
  ["../settings/SettingsView", "SettingsView"],
  ["../tunnels/TunnelPanel", "TunnelPanel"],
  ["../tools/DockerToolPanel", "DockerToolPanel"],
  ["../commands/CommandLibraryPanel", "CommandLibraryPanel"],
  ["../terminal/TerminalPanel", "TerminalPanel"],
  ["./VncViewerSurface", "VncViewerSurface"],
];

for (const [path, name] of startupHeavyImports) {
  assertNoRuntimeStaticImport(shellSource, path, name);
}

assertIncludes(
  shellSource,
  "const ConnectionDialog = lazy(",
  "ConnectionDialog must be lazy-loaded from WorkspaceShell.",
);
assertIncludes(
  shellSource,
  "const ConnectionSearchDialog = lazy(",
  "ConnectionSearchDialog must be lazy-loaded from WorkspaceShell.",
);
assertIncludes(
  shellSource,
  "const SettingsView = lazy(",
  "SettingsView must be lazy-loaded from WorkspaceShell.",
);
assertIncludes(
  shellSource,
  "const RemoteFilePanel = lazy(",
  "RemoteFilePanel must be lazy-loaded from WorkspaceShell.",
);
assertIncludes(
  shellSource,
  "const TerminalPanel = lazy(",
  "TerminalPanel must be lazy-loaded from WorkspaceShell.",
);

console.log("startup module boundary source check passed");
