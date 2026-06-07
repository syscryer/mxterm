import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-file-locate-tree-"));

try {
  const panelSource = readFileSync(
    new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url),
    "utf8",
  );

  if (panelSource.includes("navigateToPath(terminalDirectory)")) {
    throw new Error("Locate should reveal the terminal directory in the tree, not navigate into it");
  }

  if (panelSource.includes("path === terminalPath || locatedDirectoryPath === terminalPath")) {
    throw new Error("Locate action should not look active just because the panel navigated into the terminal directory");
  }

  if (!panelSource.includes("revealTerminalDirectory")) {
    throw new Error("RemoteFilePanel should have a dedicated terminal-directory reveal path");
  }

  if (!panelSource.includes("locatedDirectoryPath")) {
    throw new Error("RemoteFilePanel should keep a highlighted directory after locate");
  }

  if (!panelSource.includes("isRemotePathStrictDescendant")) {
    throw new Error("Locate should keep an existing ancestor view instead of always entering a child directory");
  }

  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/files/remoteFilePaths.ts",
      "--outDir",
      outDir,
      "--module",
      "ES2020",
      "--target",
      "ES2020",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      "--strict",
    ],
    { encoding: "utf8" },
  );

  if (compile.status !== 0) {
    process.stderr.write(compile.stdout || "");
    process.stderr.write(compile.stderr || "");
    if (compile.error) {
      process.stderr.write(`${compile.error.message}\n`);
    }
    process.exit(compile.status || 1);
  }

  const { isRemotePathStrictDescendant, remotePathAncestors, remotePathParent } = await import(
    pathToFileURL(join(outDir, "remoteFilePaths.js")).href
  );

  assert.equal(remotePathParent("/"), "/");
  assert.equal(remotePathParent("/opt"), "/");
  assert.equal(remotePathParent("/opt/app"), "/opt");
  assert.deepEqual(remotePathAncestors("/"), []);
  assert.deepEqual(remotePathAncestors("/opt"), ["/"]);
  assert.deepEqual(remotePathAncestors("/opt/app/logs"), ["/", "/opt", "/opt/app"]);
  assert.equal(isRemotePathStrictDescendant("/opt/app", "/opt"), true);
  assert.equal(isRemotePathStrictDescendant("/opt/app", "/"), true);
  assert.equal(isRemotePathStrictDescendant("/opt", "/opt"), false);
  assert.equal(isRemotePathStrictDescendant("/opt", "/var"), false);

  console.log("Remote file locate reveal-tree check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
