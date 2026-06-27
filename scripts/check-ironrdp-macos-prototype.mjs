import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), "utf8");
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

function commandExists(command, args = ["--version"]) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const prototypeDocPath = "docs/plans/2026-06-27-ironrdp-macos-prototype.md";
if (!existsSync(new URL(prototypeDocPath, root))) {
  throw new Error("IronRDP macOS prototype plan is missing.");
}

const prototypeDoc = read(prototypeDocPath);
const spikeDoc = read("docs/plans/2026-06-27-macos-rdp-embedded-spike.md");
const platformCapabilities = read("src/shared/tauri/platformCapabilities.ts");
const cargoToml = read("src-tauri/Cargo.toml");
const packageJson = read("package.json");
const rdpSource = read("src-tauri/src/rdp.rs");
const viewerScript = read("scripts/prototype-ironrdp-viewer.mjs");
const releaseReadinessScript = read("scripts/check-rdp-release-readiness.mjs");

for (const snippet of [
  "publish = false",
  "RdpOutputEvent",
  "不把未验证的大依赖直接加入 `src-tauri/Cargo.toml`",
  "不修改 Windows `mstsc_activex` / `mstsc.exe` 路径",
  "pnpm prototype:ironrdp-viewer status|prepare|build|smoke|run",
  "write-rdp",
  "write-report",
  "ClearTextPassword",
  "连接实测记录",
  "Phase 0 收口判定",
]) {
  assertIncludes(prototypeDoc, snippet, `Prototype plan should keep the IronRDP boundary: ${snippet}`);
}

assertIncludes(
  spikeDoc,
  "macOS RDP 使用官方客户端外部启动",
  "macOS RDP spike should keep the official external client as the production path.",
);
assertIncludes(
  platformCapabilities,
  'supportsEmbeddedRdp: platform === "windows"',
  "Embedded RDP capability should remain Windows-only until the macOS prototype passes.",
);
assertIncludes(
  platformCapabilities,
  'supportsExternalRdp: platform === "windows" || platform === "macos" || platform === "linux"',
  "External RDP should remain available on macOS.",
);
assertIncludes(
  rdpSource,
  "RdpPlatform::Macos => select_macos_app_runner()",
  "macOS production RDP runner should continue to use the system app path.",
);
assertIncludes(
  rdpSource,
  "当前平台不支持 Windows RDP 嵌入式宿主，已使用外部 runner。",
  "Non-Windows embedded requests should still fall back to an external runner.",
);

for (const dependency of ["ironrdp-client", "ironrdp-viewer", "ironrdp-rdpfile"]) {
  assertExcludes(
    cargoToml,
    dependency,
    `${dependency} should not be added to the production Tauri Cargo.toml during the prototype stage.`,
  );
}

assertIncludes(
  packageJson,
  '"prototype:ironrdp-viewer": "node scripts/prototype-ironrdp-viewer.mjs"',
  "package.json should expose the isolated IronRDP viewer prototype runner.",
);
assertIncludes(
  packageJson,
  '"check:rdp-release-readiness": "node scripts/check-rdp-release-readiness.mjs"',
  "package.json should expose the RDP release readiness check.",
);

for (const snippet of [
  ".trellis/.runtime/ironrdp-macos-prototype",
  "ClearTextPassword:s:",
  "GatewayPassword:s:",
  "-p",
  "--password",
  "--proxy",
  "smoke",
  "--rdp-file",
  "full address:s:",
  "enablecredsspsupport:i:1",
  "writeRdpTemplate",
  "writeReportTemplate",
  "assertIncludesCaseInsensitive",
  "Visual quality",
  "NLA",
  "CARGO_NET_GIT_FETCH_WITH_CLI",
  "Let the viewer prompt for credentials",
]) {
  assertIncludes(viewerScript, snippet, `Viewer prototype runner should keep credential and runtime guard: ${snippet}`);
}

for (const snippet of [
  "checkMacosOfficialClient",
  "checkIronRdpPrototype",
  "Windows App",
  "Microsoft Remote Desktop",
  "supportsEmbeddedRdp",
  "ironrdp-viewer",
  "ClearTextPassword:s:",
]) {
  assertIncludes(
    releaseReadinessScript,
    snippet,
    `RDP release readiness check should keep the local closure guard: ${snippet}`,
  );
}

const requiredTools = [
  ["cargo", ["--version"]],
  ["rustc", ["--version"]],
];
const missingTools = requiredTools
  .filter(([command, args]) => !commandExists(command, args))
  .map(([command]) => command);

if (missingTools.length > 0) {
  throw new Error(`Missing required Rust tools for the IronRDP prototype: ${missingTools.join(", ")}`);
}

if (process.platform === "darwin" && !commandExists("xcode-select", ["-p"])) {
  throw new Error("macOS IronRDP prototype requires Xcode Command Line Tools.");
}

console.log("IronRDP macOS prototype guard passed.");
