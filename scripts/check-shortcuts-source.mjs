import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const outRoot = resolve("node_modules", ".mxterm-check-tmp");
mkdirSync(outRoot, { recursive: true });
const outDir = mkdtempSync(join(outRoot, "shortcuts-"));
writeFileSync(join(outDir, "package.json"), '{"type":"commonjs"}\n');

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/shortcuts/shortcutKeys.ts",
      "src/features/shortcuts/shortcutRegistry.ts",
      "src/features/shortcuts/shortcutValidation.ts",
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

  const require = createRequire(import.meta.url);
  const keys = require(join(outDir, "shortcutKeys.js"));
  const registry = require(join(outDir, "shortcutRegistry.js"));
  const validation = require(join(outDir, "shortcutValidation.js"));

  assert.equal(keys.normalizeShortcutBinding("ctrl + shift + f"), "Ctrl+Shift+F");
  assert.equal(keys.normalizeShortcutBinding("Control+,"), "Ctrl+,");
  assert.equal(keys.normalizeShortcutBinding("Shift+F3"), "Shift+F3");
  assert.equal(keys.formatShortcutBinding("Ctrl+Shift+F"), "Ctrl + Shift + F");
  assert.equal(keys.formatShortcutBinding(null), "未设置");

  assert.equal(registry.defaultShortcutBindings["connection.quickOpen"], "Ctrl+Shift+O");
  assert.equal(registry.defaultShortcutBindings["terminal.search.toggle"], "Ctrl+Shift+F");
  assert.equal(registry.defaultShortcutBindings["commandSender.toggle"], "Ctrl+Shift+K");
  assert.equal(registry.shortcutActions.length >= 8, true);

  assert.equal(validation.validateShortcutBinding("A").valid, false);
  assert.equal(validation.validateShortcutBinding("Ctrl+C").valid, false);
  assert.equal(validation.validateShortcutBinding("Ctrl+Shift+F").valid, true);

  const conflicts = validation.findShortcutConflicts({
    ...registry.defaultShortcutBindings,
    "settings.open": "Ctrl+Shift+F",
  });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    conflicts[0].actionIds.sort(),
    ["settings.open", "terminal.search.toggle"].sort(),
  );

  console.log("shortcuts source check passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
