import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-cd-tracker-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/terminal/terminalInputDirectory.ts",
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

  const tracker = await import(
    pathToFileURL(join(outDir, "terminalInputDirectory.js")).href
  );
  const { applyTerminalInputDirectoryData, createTerminalInputDirectoryState } = tracker;

  let state = createTerminalInputDirectoryState({
    currentDirectory: null,
    homeDirectory: "/home/deploy",
  });

  let result = applyTerminalInputDirectoryData(state, "cd /var/log\r");
  assert.equal(result.directory, "/var/log");

  result = applyTerminalInputDirectoryData(result.state, "cd nginx\r");
  assert.equal(result.directory, "/var/log/nginx");

  result = applyTerminalInputDirectoryData(result.state, "cd ../tmp\r");
  assert.equal(result.directory, "/var/log/tmp");

  result = applyTerminalInputDirectoryData(state, "cd ~/app\r");
  assert.equal(result.directory, "/home/deploy/app");

  result = applyTerminalInputDirectoryData(state, "cd logs\r");
  assert.equal(result.directory, null);

  result = applyTerminalInputDirectoryData(state, "ls -la\r");
  assert.equal(result.directory, null);

  result = applyTerminalInputDirectoryData(state, "cd /var/tmpx\u007f\r");
  assert.equal(result.directory, "/var/tmp");

  result = applyTerminalInputDirectoryData(state, "\u001b[A\r");
  assert.equal(result.directory, null);

  result = applyTerminalInputDirectoryData(state, "\u001b[200~cd /opt/app\r\u001b[201~");
  assert.equal(result.directory, "/opt/app");

  result = applyTerminalInputDirectoryData(state, "cd /opt/ap\t\r");
  assert.equal(result.directory, null);

  console.log("Terminal cd tracker check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
