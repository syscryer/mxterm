import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildReleaseDownloadUrl,
  findUpdaterArtifact,
  generateLatestJson,
} from "./generate-latest-json.mjs";

test("latest.json selects only signed Apple Silicon updater target", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "mxterm-latest-json-"));

  try {
    await writeFile(path.join(assetsDir, "mXterm-0.1.0-windows-x64-portable.zip"), "portable");
    await writeSignedAsset(assetsDir, "mXterm-macos-arm64.app.tar.gz", "mac-signature");
    await writeSignedAsset(assetsDir, "mXterm_0.1.0_amd64-linux-x64.deb", "deb-signature");
    await writeSignedAsset(assetsDir, "mXterm_0.1.0_x86_64-linux-x64.rpm", "rpm-signature");

    const latestPath = await generateLatestJson({
      assetsDir,
      repository: "syscryer/mxterm",
      tag: "v0.1.0",
      version: "0.1.0",
      now: new Date("2026-06-24T00:00:00.000Z"),
    });
    const latest = JSON.parse(await readFile(latestPath, "utf8"));

    assert.equal(latest.version, "0.1.0");
    assert.equal(latest.notes, "https://github.com/syscryer/mxterm/releases/tag/v0.1.0");
    assert.equal(latest.pub_date, "2026-06-24T00:00:00.000Z");
    assert.deepEqual(Object.keys(latest.platforms).sort(), ["darwin-aarch64"]);
    assert.equal(latest.platforms["darwin-aarch64"].signature, "mac-signature");
    assert.equal(
      latest.platforms["darwin-aarch64"].url,
      "https://github.com/syscryer/mxterm/releases/download/v0.1.0/mXterm-macos-arm64.app.tar.gz",
    );
    assert.doesNotMatch(JSON.stringify(latest), /portable|\.deb|\.rpm|windows-x86_64|linux-x86_64|darwin-x86_64|example\.com/i);
  } finally {
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("findUpdaterArtifact fails when target is missing or ambiguous", () => {
  assert.throws(
    () =>
      findUpdaterArtifact(["mXterm-0.1.0-windows-x64-portable.zip"], {
        platform: "darwin-aarch64",
        match: (fileName) => fileName.endsWith("-macos-arm64.app.tar.gz"),
      }),
    /Expected exactly one updater artifact/,
  );
  assert.throws(
    () =>
      findUpdaterArtifact(["a-macos-arm64.app.tar.gz", "b-macos-arm64.app.tar.gz"], {
        platform: "darwin-aarch64",
        match: (fileName) => fileName.endsWith("-macos-arm64.app.tar.gz"),
      }),
    /Expected exactly one updater artifact/,
  );
});

test("latest.json generation requires non-empty signatures", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "mxterm-empty-signature-"));

  try {
    await writeFile(path.join(assetsDir, "mXterm-macos-arm64.app.tar.gz"), "installer");
    await writeFile(path.join(assetsDir, "mXterm-macos-arm64.app.tar.gz.sig"), "  \n");

    await assert.rejects(
      () =>
        generateLatestJson({
          assetsDir,
          repository: "syscryer/mxterm",
          tag: "v0.1.0",
          version: "0.1.0",
        }),
      /Empty updater signature/,
    );
  } finally {
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("release download URLs are GitHub-only owner/repo URLs", () => {
  assert.equal(
    buildReleaseDownloadUrl("syscryer/mxterm", "v0.1.0", "mXterm 0.1.0.exe"),
    "https://github.com/syscryer/mxterm/releases/download/v0.1.0/mXterm%200.1.0.exe",
  );
  assert.throws(
    () => buildReleaseDownloadUrl("https://example.com/syscryer/mxterm", "v0.1.0", "mXterm.exe"),
    /owner\/repo/,
  );
});

async function writeSignedAsset(assetsDir, assetName, signature) {
  await writeFile(path.join(assetsDir, assetName), assetName, "utf8");
  await writeFile(path.join(assetsDir, `${assetName}.sig`), `${signature}\n`, "utf8");
}
