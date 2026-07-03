import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-prompt-directory-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/terminal/terminalPromptDirectory.ts",
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
    pathToFileURL(join(outDir, "terminalPromptDirectory.js")).href
  );
  const {
    promptLineToDirectory,
    promptSnapshotLinesToDirectory,
  } = tracker;

  assert.equal(promptLineToDirectory("root@orangepi4pro:/opt/ccr#", "/root"), "/opt/ccr");
  assert.equal(promptLineToDirectory("deploy@web:/var/www$", "/home/deploy"), "/var/www");
  assert.equal(promptLineToDirectory("root@orangepi4pro:~#", "/root"), "/root");
  assert.equal(promptLineToDirectory("deploy@web:~/app$", "/home/deploy"), "/home/deploy/app");
  assert.equal(promptLineToDirectory("-bash: cd: /opt/csr: No such file or directory", "/root"), null);
  assert.equal(promptLineToDirectory("root@orangepi4pro:/opt/ccr# ls -la", "/root"), null);
  assert.equal(promptLineToDirectory("build output root@host:/tmp#", "/root"), null);

  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "deploy@web:~/app$",
        "root@orangepi4pro:/opt/old#",
      ],
      "/home/deploy",
    ),
    "/home/deploy/app",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "-bash: cd: /opt/csr: No such file or directory",
        "root@orangepi4pro:/opt/ccr# ls -la",
        "root@orangepi4pro:/opt/ccr#",
      ],
      "/root",
    ),
    "/opt/ccr",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "\u001b[32mdeploy@web:/srv/app$\u001b[0m",
        "Welcome to Ubuntu 22.04.4 LTS",
      ],
      "/home/deploy",
    ),
    "/srv/app",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "build output root@host:/tmp#",
        "tail -f /var/log/app.log",
      ],
      "/root",
    ),
    null,
  );

  console.log("Terminal prompt directory check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
