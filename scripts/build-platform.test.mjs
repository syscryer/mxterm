import test from "node:test";
import assert from "node:assert/strict";

import {
  expandPlatformSelection,
  getBuildPlan,
  resolveSpawnInvocation,
  updaterArtifactsArgs,
} from "./build-platform.mjs";

test("build plans cover release targets without runtime flavor variants", () => {
  assert.deepEqual(getBuildPlan("win-x64").command, [
    "pnpm",
    ["tauri", "build", "--bundles", "nsis"],
  ]);
  assert.deepEqual(getBuildPlan("mac-arm64").command, [
    "pnpm",
    ["tauri", "build", "--target", "aarch64-apple-darwin", "--bundles", "app,dmg"],
  ]);
  assert.deepEqual(getBuildPlan("linux-x64").command, [
    "pnpm",
    ["tauri", "build", "--target", "x86_64-unknown-linux-gnu", "--bundles", "deb,rpm,appimage"],
  ]);

  assert.throws(() => getBuildPlan("mac-x64"), /Unsupported platform target/);
  assert.throws(() => getBuildPlan("win-arm64"), /Unsupported platform target/);
});

test("all target expands to the current host platform only", () => {
  assert.deepEqual(expandPlatformSelection("all", { platform: "win32", arch: "x64" }), ["win-x64"]);
  assert.deepEqual(expandPlatformSelection("all", { platform: "darwin", arch: "arm64" }), ["mac-arm64"]);
  assert.deepEqual(expandPlatformSelection("all", { platform: "linux", arch: "x64" }), ["linux-x64"]);
});

test("updater artifact config is opt-in through MXTERM_CREATE_UPDATER_ARTIFACTS", () => {
  assert.deepEqual(updaterArtifactsArgs({ env: {} }), []);
  assert.deepEqual(updaterArtifactsArgs({ env: { MXTERM_CREATE_UPDATER_ARTIFACTS: "1" } }), [
    "--config",
    JSON.stringify({ bundle: { createUpdaterArtifacts: true } }),
  ]);
});

test("Windows pnpm invocation uses the package manager entry point when available", () => {
  assert.deepEqual(
    resolveSpawnInvocation("pnpm", ["tauri", "build"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      platform: "win32",
      env: { npm_execpath: "C:\\Users\\csm\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" },
    }),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "C:\\Users\\csm\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs",
        "tauri",
        "build",
      ],
    },
  );
});
