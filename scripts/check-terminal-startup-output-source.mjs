import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outRoot = resolve("node_modules", ".mxterm-check-tmp");
mkdirSync(outRoot, { recursive: true });
const outDir = mkdtempSync(join(outRoot, "terminal-startup-output-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/terminal/terminalStartupOutput.ts",
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

  const { normalizeStartupOutput } = await import(
    pathToFileURL(join(outDir, "terminalStartupOutput.js")).href
  );

  const aliCloudStartup = [
    "Last login: Wed Jun 17 11:45:56 2026 from 203.0.113.36",
    "",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "",
    "[root@demo-ecs-host ~]# [root@demo-ecs-host ~]# ",
  ].join("\r\n");

  assert.equal(
    normalizeStartupOutput(aliCloudStartup),
    [
      "Last login: Wed Jun 17 11:45:56 2026 from 203.0.113.36",
      "",
      "Welcome to Alibaba Cloud Elastic Compute Service !",
      "",
      "[root@demo-ecs-host ~]# ",
    ].join("\r\n"),
  );

  const leadingPromptThenBanner = [
    "[root@demo-ecs-host ~]#",
    "Last login: Wed Jun 17 11:45:56 2026 from 203.0.113.36",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "[root@demo-ecs-host ~]# ",
  ].join("\n");

  assert.equal(
    normalizeStartupOutput(leadingPromptThenBanner),
    [
      "Last login: Wed Jun 17 11:45:56 2026 from 203.0.113.36",
      "Welcome to Alibaba Cloud Elastic Compute Service !",
      "[root@demo-ecs-host ~]# ",
    ].join("\n"),
  );

  const terminalPanelSource = readFileSync(
    "src/features/terminal/TerminalPanel.tsx",
    "utf8",
  );
  assert.match(terminalPanelSource, /normalizeStartupOutput/);
  assert.doesNotMatch(terminalPanelSource, /function stripLeadingDuplicateStartupPrompt/);

  console.log("Terminal startup output check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
