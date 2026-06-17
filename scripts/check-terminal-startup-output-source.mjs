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
    "Last login: Wed Jun 17 11:45:56 2026 from 219.139.229.36",
    "",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "",
    "[root@iZ6wed7x33nsqpktcf5yjZ ~]# [root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
  ].join("\r\n");

  assert.equal(
    normalizeStartupOutput(aliCloudStartup),
    [
      "Last login: Wed Jun 17 11:45:56 2026 from 219.139.229.36",
      "",
      "Welcome to Alibaba Cloud Elastic Compute Service !",
      "",
      "[root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
    ].join("\r\n"),
  );

  const leadingPromptThenBanner = [
    "[root@iZ6wed7x33nsqpktcf5yjZ ~]#",
    "Last login: Wed Jun 17 11:45:56 2026 from 219.139.229.36",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "[root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
  ].join("\n");

  assert.equal(
    normalizeStartupOutput(leadingPromptThenBanner),
    [
      "Last login: Wed Jun 17 11:45:56 2026 from 219.139.229.36",
      "Welcome to Alibaba Cloud Elastic Compute Service !",
      "[root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
    ].join("\n"),
  );

  const leadingPromptJoinedToBanner = [
    "root@lululemon-virtual-machine:~# Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 6.8.0-94-generic x86_64)",
    "",
    "* Documentation:  https://help.ubuntu.com",
    "Last login: Thu Jun 18 00:19:00 2026 from 192.168.0.225",
    "root@lululemon-virtual-machine:~# ",
  ].join("\n");

  assert.equal(
    normalizeStartupOutput(leadingPromptJoinedToBanner),
    [
      "Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 6.8.0-94-generic x86_64)",
      "",
      "* Documentation:  https://help.ubuntu.com",
      "Last login: Thu Jun 18 00:19:00 2026 from 192.168.0.225",
      "root@lululemon-virtual-machine:~# ",
    ].join("\n"),
  );

  const repeatedLoginBanner = [
    "Last login: Thu Jun 18 00:51:59 2026 from 219.139.229.36",
    "",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "",
    "Last login: Thu Jun 18 00:51:59 2026 from 219.139.229.36",
    "",
    "Welcome to Alibaba Cloud Elastic Compute Service !",
    "",
    "[root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
  ].join("\n");

  assert.equal(
    normalizeStartupOutput(repeatedLoginBanner),
    [
      "Last login: Thu Jun 18 00:51:59 2026 from 219.139.229.36",
      "",
      "Welcome to Alibaba Cloud Elastic Compute Service !",
      "",
      "[root@iZ6wed7x33nsqpktcf5yjZ ~]# ",
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
