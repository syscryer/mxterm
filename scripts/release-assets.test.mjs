import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildReleaseAssetName,
  collectAndCopyReleaseAssets,
  isSupportedAssetFile,
  splitAssetName,
} from "./release-assets.mjs";

test("asset name splitting preserves compound extensions", () => {
  assert.deepEqual(splitAssetName("mXterm.app.tar.gz"), {
    stem: "mXterm",
    extension: ".app.tar.gz",
  });
  assert.deepEqual(splitAssetName("mXterm_0.1.0_amd64.AppImage"), {
    stem: "mXterm_0.1.0_amd64",
    extension: ".AppImage",
  });
});

test("release asset names append platform suffix only", () => {
  assert.equal(buildReleaseAssetName("mXterm_0.1.0_x64-setup.exe", "windows-x64"), "mXterm_0.1.0_x64-setup-windows-x64.exe");
  assert.equal(buildReleaseAssetName("mXterm.app.tar.gz", "macos-arm64"), "mXterm-macos-arm64.app.tar.gz");
  assert.equal(buildReleaseAssetName("mXterm_0.1.0_amd64.AppImage", "linux-x64"), "mXterm_0.1.0_amd64-linux-x64.AppImage");
});

test("supported asset list includes release formats and excludes updater signatures", () => {
  assert.equal(isSupportedAssetFile("mXterm_0.1.0_x64-setup.exe"), true);
  assert.equal(isSupportedAssetFile("mXterm.app.tar.gz"), true);
  assert.equal(isSupportedAssetFile("mXterm_0.1.0_amd64.deb"), true);
  assert.equal(isSupportedAssetFile("mXterm_0.1.0_x86_64.rpm"), true);
  assert.equal(isSupportedAssetFile("mXterm_0.1.0_amd64.AppImage"), true);
  assert.equal(isSupportedAssetFile("mXterm_0.1.0_amd64.AppImage.sig"), false);
});

test("collectAndCopyReleaseAssets copies assets recursively and keeps matching signatures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mxterm-release-assets-"));
  const bundleRoot = path.join(root, "bundle");
  const nested = path.join(bundleRoot, "nsis");
  const outDir = path.join(root, "out");

  try {
    await writeFile(path.join(nested, "placeholder"), "", "utf8").catch(async () => {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(nested, { recursive: true }));
      await writeFile(path.join(nested, "placeholder"), "", "utf8");
    });
    await writeFile(path.join(nested, "mXterm_0.1.0_x64-setup.exe"), "installer");
    await writeFile(path.join(nested, "mXterm_0.1.0_x64-setup.exe.sig"), "signature\n");
    await writeFile(path.join(nested, "ignored.sig"), "orphan");

    const copied = await collectAndCopyReleaseAssets({
      bundleRoot,
      outDir,
      artifact: "windows-x64",
    });

    assert.equal(copied.length, 1);
    const destination = path.join(outDir, "mXterm_0.1.0_x64-setup-windows-x64.exe");
    assert.equal(await readFile(destination, "utf8"), "installer");
    assert.equal(await readFile(`${destination}.sig`, "utf8"), "signature\n");
    assert.equal(existsSync(path.join(outDir, "ignored-windows-x64.sig")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
