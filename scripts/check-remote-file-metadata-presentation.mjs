import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-remote-file-metadata-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/files/remoteFileMetadataPresentation.ts",
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
    process.exit(compile.status || 1);
  }

  const presentation = await import(
    pathToFileURL(join(outDir, "remoteFileMetadataPresentation.js")).href
  );

  assert.equal(presentation.formatRemoteFileIdentity("deploy", 1001, "UID"), "deploy");
  assert.equal(presentation.formatRemoteFileIdentity(null, 1001, "UID"), "UID 1001");
  assert.equal(presentation.formatRemoteFileIdentity("UNKNOWN", 1001, "UID"), "UID 1001");
  assert.equal(presentation.formatRemoteFileIdentity(null, null, "UID"), "未知");
  assert.equal(presentation.formatRemoteFileTimestamp(null, "系统不支持"), "系统不支持");
  assert.equal(presentation.formatRemoteFileTimestamp(0, "系统不支持"), "系统不支持");
  assert.equal(presentation.formatRemoteFileTimestamp(Number.NaN, "未知"), "未知");
  assert.equal(presentation.remoteFileKindLabel("symlink"), "符号链接");
  assert.equal(presentation.shouldShowRemoteFileSize("directory"), false);
  assert.equal(presentation.shouldShowRemoteFileSize("file"), true);

  console.log("Remote file metadata presentation check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
