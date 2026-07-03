import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      "src/features/terminal/terminalInputDirectory.ts",
      "--outDir",
      outDir,
      "--module",
      "CommonJS",
      "--target",
      "ES2020",
      "--moduleResolution",
      "node",
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

  writeFileSync(join(outDir, "package.json"), "{\"type\":\"commonjs\"}\n", "utf8");

  const trackerModule = await import(
    pathToFileURL(join(outDir, "terminalPromptDirectory.js")).href
  );
  const tracker = trackerModule.default || trackerModule;
  const {
    promptLineToDirectory,
    promptSnapshotLinesToDirectory,
  } = tracker;

  assert.equal(promptLineToDirectory("root@orangepi4pro:/opt/ccr#", "/root"), "/opt/ccr");
  assert.equal(promptLineToDirectory("deploy@web:/var/www$", "/home/deploy"), "/var/www");
  assert.equal(promptLineToDirectory("root@orangepi4pro:~#", "/root"), "/root");
  assert.equal(promptLineToDirectory("deploy@web:~/app$", "/home/deploy"), "/home/deploy/app");
  assert.equal(promptLineToDirectory("[root@192 /opt/app]#", "/root"), "/opt/app");
  assert.equal(promptLineToDirectory("[root@192 ~]#", "/root"), "/root");
  assert.equal(promptLineToDirectory("[root@192 app]#", "/root"), null);
  assert.equal(promptLineToDirectory("-bash: cd: /opt/csr: No such file or directory", "/root"), null);
  assert.equal(promptLineToDirectory("root@orangepi4pro:/opt/ccr# ls -la", "/root"), null);
  assert.equal(promptLineToDirectory("[root@192 app]# ls -la", "/root"), null);
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
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@192 app]#",
        "[root@192 app]# ls",
        "bin  config  data  driver",
        "[root@192 app]#",
        "[root@192 ~]# cd /opt/app",
      ],
      "/root",
    ),
    "/opt/app",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@192 app]#",
        "[root@192 app]# ls",
      ],
      "/root",
      "/opt/app",
    ),
    "/opt/app",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@node2 softwares]#",
        "[root@node2 jar]# cd ../softwares/",
        "[root@node2 jar]#",
        "[root@node2 app]# cd jar",
        "[root@node2 app]#",
        "[root@node2 opt]# cd app",
        "[root@node2 opt]#",
        "[root@node2 ~]# cd /opt/",
        "[root@node2 ~]#",
      ],
      "/root",
    ),
    "/opt/app/softwares",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@node2 softwares]#",
        "[root@node2 ~]#",
      ],
      "/root",
    ),
    null,
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@node2 jar]#",
        "-bash: cd: jar/xxx: No such file or directory",
        "[root@node2 jar]# cd jar/xxx",
        "[root@node2 jar]#",
        "[root@node2 app]# cd jar",
        "[root@node2 app]#",
        "[root@node2 ~]# cd /opt/app",
      ],
      "/root",
    ),
    "/opt/app/jar",
  );
  assert.equal(
    promptSnapshotLinesToDirectory(
      [
        "[root@192 other]#",
        "cd: /opt/app: No such file or directory",
        "[root@192 app]# cd /opt/app",
      ],
      "/root",
    ),
    null,
  );

  console.log("Terminal prompt directory check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
