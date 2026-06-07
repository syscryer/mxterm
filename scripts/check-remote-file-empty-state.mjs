import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-file-empty-state-"));

try {
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

  const { shouldShowRemoteDirectoryEmptyRow } = await import(
    pathToFileURL(join(outDir, "remoteFilePaths.js")).href
  );

  assert.equal(
    shouldShowRemoteDirectoryEmptyRow({ childCount: 0, loaded: false, loading: true }),
    false,
  );
  assert.equal(
    shouldShowRemoteDirectoryEmptyRow({ childCount: 0, loaded: false, loading: false }),
    false,
  );
  assert.equal(
    shouldShowRemoteDirectoryEmptyRow({ childCount: 0, loaded: true, loading: true }),
    false,
  );
  assert.equal(
    shouldShowRemoteDirectoryEmptyRow({ childCount: 0, loaded: true, loading: false }),
    true,
  );
  assert.equal(
    shouldShowRemoteDirectoryEmptyRow({ childCount: 2, loaded: true, loading: false }),
    false,
  );

  console.log("Remote file empty-state check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
