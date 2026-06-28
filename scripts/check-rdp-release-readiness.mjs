#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ironRdpWorkdir = ".trellis/.runtime/ironrdp-macos-prototype";
const ironRdpRepoDir = resolve(root, ironRdpWorkdir, "IronRDP");
const safeRdpPath = resolve(root, ".trellis/.runtime/rdp-release-readiness/safe-smoke.rdp");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assertIncludes(source, value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(source, value, message) {
  if (source.includes(value)) {
    throw new Error(message);
  }
}

function assertIncludesCaseInsensitive(source, value, message) {
  if (!source.toLowerCase().includes(value.toLowerCase())) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    shell: false,
    stdio: options.stdio || "inherit",
    timeout: options.timeoutMs || 60_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown status"}.`);
  }
  return result.stdout || "";
}

function capture(command, args, options = {}) {
  return run(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runSourceGuards() {
  run(process.execPath, [resolve(root, "scripts/check-ironrdp-macos-prototype.mjs")]);
}

function checkSourceBoundary() {
  const packageJson = JSON.parse(read("package.json"));
  const platformCapabilities = read("src/shared/tauri/platformCapabilities.ts");
  const cargoToml = read("src-tauri/Cargo.toml");
  const rdpSource = read("src-tauri/src/rdp.rs");
  const tauriBase = read("src-tauri/tauri.conf.json");
  const tauriMacos = read("src-tauri/tauri.macos.conf.json");
  const tauriWindows = read("src-tauri/tauri.windows.conf.json");
  const spikeDoc = read("docs/plans/2026-06-27-macos-rdp-embedded-spike.md");
  const prototypeDoc = read("docs/plans/2026-06-27-ironrdp-macos-prototype.md");

  if (packageJson.scripts?.["check:rdp-release-readiness"] !== "node scripts/check-rdp-release-readiness.mjs") {
    throw new Error("package.json should expose check:rdp-release-readiness.");
  }

  assertIncludes(
    platformCapabilities,
    'supportsEmbeddedRdp: platform === "windows"',
    "Embedded RDP must remain Windows-only for production.",
  );
  assertIncludes(
    platformCapabilities,
    'supportsExternalRdp: platform === "windows" || platform === "macos" || platform === "linux"',
    "External RDP should remain available on macOS.",
  );
  assertIncludes(rdpSource, "RdpPlatform::Macos => select_macos_app_runner()", "macOS must use the app runner.");
  assertIncludes(rdpSource, '["Windows App", "Microsoft Remote Desktop"]', "macOS official app priority changed.");
  assertIncludes(rdpSource, "RdpRunnerKind::MstscActiveX", "Windows embedded ActiveX runner should stay present.");
  assertIncludes(rdpSource, "fn find_windows_mstscax()", "Windows mstscax detection should stay present.");
  assertIncludes(rdpSource, "fn select_windows_mstsc_runner()", "Windows mstsc runner should stay present.");
  assertIncludes(tauriBase, '"visible": true', "Base Tauri window should stay visible for macOS/Linux startup.");
  assertIncludes(tauriBase, '"transparent": true', "Base Tauri window should allow transparent macOS material.");
  assertIncludes(tauriBase, '"macOSPrivateApi": true', "macOS transparent material requires macOSPrivateApi.");
  assertIncludes(tauriMacos, '"visible": true', "macOS override should keep visible startup window behavior.");
  assertIncludes(tauriMacos, '"transparent": true', "macOS override should keep transparent window material behavior.");
  assertIncludes(tauriWindows, '"visible": false', "Windows override should keep hidden startup window behavior.");
  assertIncludes(tauriWindows, '"transparent": true', "Windows override should keep transparent startup window behavior.");
  assertIncludes(tauriWindows, '"mica"', "Windows override should keep mica effect.");
  assertIncludes(spikeDoc, "## 7. RDP 收口状态", "Spike doc should record RDP closure status.");
  assertIncludes(prototypeDoc, "## 9. Phase 0 收口判定", "Prototype doc should record Phase 0 closure status.");

  for (const dependency of ["ironrdp-client", "ironrdp-viewer", "ironrdp-rdpfile"]) {
    assertExcludes(cargoToml, dependency, `${dependency} must not enter production Cargo.toml.`);
  }
}

function checkMacosOfficialClient() {
  if (process.platform !== "darwin") {
    console.log("macOS official RDP client check skipped on non-macOS host.");
    return;
  }
  if (!existsSync("/usr/bin/open")) {
    throw new Error("/usr/bin/open is missing.");
  }

  const app = findMacosRdpApp();
  if (!app) {
    throw new Error("Windows App / Microsoft Remote Desktop is not installed in a standard Applications directory.");
  }

  console.log(`macOS official RDP client found: ${app.name} (${app.path})`);
}

function findMacosRdpApp() {
  const dirs = ["/Applications", "/System/Applications"];
  if (process.env.HOME) {
    dirs.push(join(process.env.HOME, "Applications"));
  }

  for (const name of ["Windows App", "Microsoft Remote Desktop"]) {
    for (const dir of dirs) {
      const path = join(dir, `${name}.app`);
      if (existsSync(path)) {
        return { name, path };
      }
    }
  }
  return null;
}

function checkIronRdpPrototype() {
  if (!existsSync(ironRdpRepoDir)) {
    throw new Error(`IronRDP prototype checkout is missing: ${ironRdpRepoDir}`);
  }

  const revision = capture("git", ["rev-parse", "--short", "HEAD"], { cwd: ironRdpRepoDir });
  const binary = resolveViewerBinary();
  const help = capture(binary, ["--help"], { timeoutMs: 60_000 });

  for (const snippet of ["--rdp-file", "--username", "CredSSP", "NLA", "clipboard", "desktop"]) {
    assertIncludesCaseInsensitive(help, snippet, `ironrdp-viewer help is missing: ${snippet}`);
  }

  writeSafeRdpFile();
  assertSafeRdpFile(safeRdpPath);

  console.log(`IronRDP prototype ready: ${revision} (${binary})`);
  console.log(`Safe .rdp smoke file: ${safeRdpPath}`);
}

function resolveViewerBinary() {
  const debugBinary = resolve(ironRdpRepoDir, "target/debug/ironrdp-viewer");
  const releaseBinary = resolve(ironRdpRepoDir, "target/release/ironrdp-viewer");
  if (existsSync(debugBinary)) {
    return debugBinary;
  }
  if (existsSync(releaseBinary)) {
    return releaseBinary;
  }
  throw new Error(`ironrdp-viewer binary is missing. Run: pnpm prototype:ironrdp-viewer build`);
}

function writeSafeRdpFile() {
  const content = [
    "full address:s:192.0.2.10",
    "server port:i:3389",
    "username:s:administrator",
    "enablecredsspsupport:i:1",
    "desktopwidth:i:1440",
    "desktopheight:i:900",
    "redirectclipboard:i:1",
    "audiomode:i:2",
    "compression:i:1",
    "",
  ].join("\r\n");

  mkdirSync(dirname(safeRdpPath), { recursive: true });
  writeFileSync(safeRdpPath, content, "utf8");
}

function assertSafeRdpFile(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*ClearTextPassword:s:/i.test(line) || /^\s*GatewayPassword:s:/i.test(line)) {
      throw new Error(`Unsafe .rdp credential field found: ${line}`);
    }
  }
}

function main() {
  runSourceGuards();
  checkSourceBoundary();
  checkMacosOfficialClient();
  checkIronRdpPrototype();
  console.log("RDP release readiness checks passed.");
}

main();
