#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const IRONRDP_REPO_URL = "https://github.com/Devolutions/IronRDP.git";
const DEFAULT_WORKDIR = ".trellis/.runtime/ironrdp-macos-prototype";
const DEFAULT_REV = "master";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const FORBIDDEN_VIEWER_ARGS = new Set([
  "-p",
  "--password",
  "--gw-pass",
  "--gw_pass",
  "--gateway-password",
  "--gateway_password",
]);
const FORBIDDEN_RDP_FIELDS = [/^\s*ClearTextPassword:s:/i, /^\s*GatewayPassword:s:/i];

function printUsage() {
  console.log(`Usage:
  pnpm prototype:ironrdp-viewer status
  pnpm prototype:ironrdp-viewer prepare [--workdir <path>] [--rev <ref>]
  pnpm prototype:ironrdp-viewer build [--workdir <path>] [--release] [--toolchain <name>] [--proxy <url>] [--timeout-ms <ms>]
  pnpm prototype:ironrdp-viewer smoke [--workdir <path>] [--release] [--toolchain <name>] [--rdp-file <path>]
  pnpm prototype:ironrdp-viewer write-rdp --host <host> [--port <port>] [--username <name>] [--domain <domain>] [--width <px>] [--height <px>] [--audio local|remote|disabled] [--no-clipboard] [--output <path>]
  pnpm prototype:ironrdp-viewer write-report [--workdir <path>] [--host <host>] [--username <name>] [--output <path>]
  pnpm prototype:ironrdp-viewer run [--workdir <path>] [--release] [--toolchain <name>] [--proxy <url>] [--timeout-ms <ms>] (--rdp-file <path> | --host <host> [--username <name>]) [-- <viewer args>]

Notes:
  - The IronRDP checkout lives outside production code, defaulting to ${DEFAULT_WORKDIR}.
  - By default, the script respects IronRDP's rust-toolchain.toml. Use --toolchain stable only for local spike troubleshooting.
  - Password arguments are intentionally rejected. Let the viewer prompt for credentials.
  - .rdp files containing ClearTextPassword or GatewayPassword are rejected.`);
}

function parseArgs(argv) {
  const command = argv[0] || "help";
  const options = {
    command,
    audio: "disabled",
    clipboard: true,
    domain: null,
    extraViewerArgs: [],
    height: 900,
    host: null,
    output: null,
    port: 3389,
    proxy: process.env.MXTERM_IRONRDP_PROXY || null,
    rdpFile: null,
    release: false,
    rev: process.env.MXTERM_IRONRDP_REV || DEFAULT_REV,
    timeoutMs: Number(process.env.MXTERM_IRONRDP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    toolchain: process.env.MXTERM_IRONRDP_TOOLCHAIN || null,
    username: null,
    width: 1440,
    workdir: process.env.MXTERM_IRONRDP_WORKDIR || DEFAULT_WORKDIR,
  };

  const rest = argv.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--") {
      options.extraViewerArgs = rest.slice(index + 1);
      break;
    }
    if (value === "--release") {
      options.release = true;
    } else if (value === "--timeout-ms") {
      options.timeoutMs = Number(requireValue(rest, index, value));
      index += 1;
    } else if (value === "--toolchain") {
      options.toolchain = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--proxy") {
      options.proxy = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--workdir") {
      options.workdir = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--rev") {
      options.rev = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--rdp-file") {
      options.rdpFile = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--host") {
      options.host = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--port") {
      options.port = Number(requireValue(rest, index, value));
      index += 1;
    } else if (value === "--username") {
      options.username = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--domain") {
      options.domain = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--width") {
      options.width = Number(requireValue(rest, index, value));
      index += 1;
    } else if (value === "--height") {
      options.height = Number(requireValue(rest, index, value));
      index += 1;
    } else if (value === "--audio") {
      options.audio = requireValue(rest, index, value);
      index += 1;
    } else if (value === "--no-clipboard") {
      options.clipboard = false;
    } else if (value === "--output") {
      options.output = requireValue(rest, index, value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  if (!Number.isInteger(options.width) || options.width <= 0) {
    throw new Error("--width must be a positive integer.");
  }
  if (!Number.isInteger(options.height) || options.height <= 0) {
    throw new Error("--height must be a positive integer.");
  }
  if (!["local", "remote", "disabled"].includes(options.audio)) {
    throw new Error("--audio must be one of: local, remote, disabled.");
  }

  return options;
}

function requireValue(values, index, flag) {
  const value = values[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function resolvePrototypePaths(workdir) {
  const resolvedWorkdir = resolve(process.cwd(), workdir);
  return {
    repoDir: resolve(resolvedWorkdir, "IronRDP"),
    workdir: resolvedWorkdir,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    shell: false,
    stdio: "inherit",
    timeout: options.timeoutMs,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`${command} timed out after ${options.timeoutMs}ms.`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs,
  });
  if (result.error) {
    return null;
  }
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function commandExists(command, args = ["--version"]) {
  return capture(command, args) !== null;
}

function prepare(options) {
  const { repoDir, workdir } = resolvePrototypePaths(options.workdir);
  mkdirSync(workdir, { recursive: true });

  if (!existsSync(repoDir)) {
    run("git", ["clone", "--filter=blob:none", IRONRDP_REPO_URL, repoDir]);
  }

  run("git", ["fetch", "--depth", "1", "origin", options.rev], { cwd: repoDir });
  run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: repoDir });
  const revision = capture("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir });
  console.log(`IronRDP prototype checkout ready: ${repoDir}`);
  console.log(`Revision: ${revision || options.rev}`);
}

function build(options) {
  const { repoDir } = resolvePrototypePaths(options.workdir);
  assertRepoExists(repoDir);
  const args = ["build", "-p", "ironrdp-viewer", "--bin", "ironrdp-viewer"];
  if (options.release) {
    args.push("--release");
  }
  run("cargo", args, {
    cwd: repoDir,
    env: buildCommandEnv(options),
    timeoutMs: options.timeoutMs,
  });
}

function runViewer(options) {
  const { repoDir } = resolvePrototypePaths(options.workdir);
  assertSafeViewerArgs(options.extraViewerArgs);

  const viewerArgs = [];
  if (options.rdpFile) {
    const rdpFile = resolve(process.cwd(), options.rdpFile);
    assertSafeRdpFile(rdpFile);
    viewerArgs.push("--rdp-file", rdpFile);
  } else if (options.host) {
    viewerArgs.push(options.host);
    if (options.username) {
      viewerArgs.push("--username", options.username);
    }
  } else {
    throw new Error("run requires either --rdp-file or --host.");
  }
  viewerArgs.push(...options.extraViewerArgs);

  assertRepoExists(repoDir);
  const cargoArgs = ["run", "-p", "ironrdp-viewer", "--bin", "ironrdp-viewer"];
  if (options.release) {
    cargoArgs.push("--release");
  }
  cargoArgs.push("--", ...viewerArgs);
  run("cargo", cargoArgs, {
    cwd: repoDir,
    env: buildCommandEnv(options),
    timeoutMs: options.timeoutMs,
  });
}

function writeRdpTemplate(options) {
  if (!options.host) {
    throw new Error("write-rdp requires --host.");
  }

  assertSingleLineValue("host", options.host);
  assertSingleLineValue("username", options.username);
  assertSingleLineValue("domain", options.domain);

  const { workdir } = resolvePrototypePaths(options.workdir);
  const outputPath = options.output
    ? resolve(process.cwd(), options.output)
    : resolve(workdir, "rdp", `${sanitizeFileToken(options.host)}.rdp`);
  const lines = [
    `full address:s:${options.host}`,
    `server port:i:${options.port}`,
    options.username ? `username:s:${options.username}` : null,
    options.domain ? `domain:s:${options.domain}` : null,
    "enablecredsspsupport:i:1",
    `desktopwidth:i:${options.width}`,
    `desktopheight:i:${options.height}`,
    `redirectclipboard:i:${options.clipboard ? 1 : 0}`,
    `audiomode:i:${rdpAudioModeValue(options.audio)}`,
    "compression:i:1",
  ].filter((line) => typeof line === "string");

  const content = `${lines.join("\r\n")}\r\n`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  assertSafeRdpFile(outputPath);

  console.log(`Wrote safe IronRDP .rdp template: ${outputPath}`);
  console.log("Credentials are intentionally omitted; let ironrdp-viewer prompt for them.");
}

function smoke(options) {
  const { repoDir } = resolvePrototypePaths(options.workdir);
  assertRepoExists(repoDir);
  if (options.rdpFile) {
    assertSafeRdpFile(resolve(process.cwd(), options.rdpFile));
  }

  const binary = resolveViewerBinary(repoDir, options.release);
  const help = capture(binary, ["--help"], {
    env: buildCommandEnv(options),
    timeoutMs: options.timeoutMs,
  });
  if (!help) {
    throw new Error(`Unable to run ironrdp-viewer --help: ${binary}`);
  }

  for (const snippet of [
    "--rdp-file",
    "--username",
    "CredSSP",
    "NLA",
    "clipboard",
    "desktop",
  ]) {
    assertIncludesCaseInsensitive(help, snippet, `ironrdp-viewer help is missing expected capability: ${snippet}`);
  }

  console.log(`IronRDP viewer smoke passed: ${binary}`);
  console.log("Help confirms .rdp input, username, CredSSP/NLA, clipboard, and desktop sizing options.");
  if (options.rdpFile) {
    console.log(`Safe .rdp file checked: ${resolve(process.cwd(), options.rdpFile)}`);
  }
}

function writeReportTemplate(options) {
  assertSingleLineValue("host", options.host);
  assertSingleLineValue("username", options.username);

  const { workdir } = resolvePrototypePaths(options.workdir);
  const outputPath = options.output
    ? resolve(process.cwd(), options.output)
    : resolve(workdir, "reports", `${defaultReportToken(options.host)}.md`);
  const host = options.host || "<host>";
  const username = options.username || "<username>";
  const content = `# IronRDP macOS 连接实测记录

## 基本信息

- Host: ${host}
- Username: ${username}
- macOS: <version / chip>
- IronRDP revision: <git rev-parse --short HEAD>
- Build: debug / release
- Command: pnpm prototype:ironrdp-viewer run --rdp-file <path>

## 连接链路

- Remote OS: <Windows version>
- Resolution / scale: <width x height / scale>
- NLA / CredSSP: pass / fail / not tested
- Certificate prompt: pass / fail / not shown
- Login time: <seconds>
- Disconnect / reconnect: pass / fail / not tested

## 体验质量

- Visual quality: pass / issue
- Frame smoothness: pass / issue
- Input latency: pass / issue
- Keyboard shortcuts / IME: pass / issue / not tested
- Mouse pointer / drag: pass / issue
- Clipboard: pass / issue / disabled
- CPU / memory: <Activity Monitor observation>

## 问题与日志

- Error category: authentication / certificate / network / protocol / rendering / input / none
- Repro steps:
- Viewer log excerpt:
- Follow-up decision:
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  console.log(`Wrote IronRDP macOS test report template: ${outputPath}`);
}

function status(options) {
  const { repoDir, workdir } = resolvePrototypePaths(options.workdir);
  const revision = existsSync(repoDir)
    ? capture("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir })
    : null;
  const debugBinary = resolve(repoDir, "target/debug/ironrdp-viewer");
  const releaseBinary = resolve(repoDir, "target/release/ironrdp-viewer");

  console.log(`Workdir: ${workdir}`);
  console.log(`Repo: ${existsSync(repoDir) ? repoDir : "missing"}`);
  console.log(`Revision: ${revision || "n/a"}`);
  console.log(`Debug binary: ${existsSync(debugBinary) ? debugBinary : "missing"}`);
  console.log(`Release binary: ${existsSync(releaseBinary) ? releaseBinary : "missing"}`);
  console.log(`git: ${commandExists("git") ? "ok" : "missing"}`);
  console.log(`cargo: ${commandExists("cargo") ? "ok" : "missing"}`);
  console.log(`toolchain override: ${options.toolchain || "repo default"}`);
  console.log(`proxy override: ${options.proxy || "env/default"}`);
  console.log(`timeout: ${options.timeoutMs}ms`);
  if (process.platform === "darwin") {
    console.log(`xcode-select: ${commandExists("xcode-select", ["-p"]) ? "ok" : "missing"}`);
  }
}

function resolveViewerBinary(repoDir, release) {
  const debugBinary = resolve(repoDir, "target/debug/ironrdp-viewer");
  const releaseBinary = resolve(repoDir, "target/release/ironrdp-viewer");
  if (release) {
    if (!existsSync(releaseBinary)) {
      throw new Error(`Release ironrdp-viewer binary is missing. Run build --release first: ${releaseBinary}`);
    }
    return releaseBinary;
  }
  if (existsSync(debugBinary)) {
    return debugBinary;
  }
  if (existsSync(releaseBinary)) {
    return releaseBinary;
  }
  throw new Error(`ironrdp-viewer binary is missing. Run build first: ${debugBinary}`);
}

function buildCommandEnv(options) {
  const env = { ...process.env };
  if (options.toolchain) {
    env.RUSTUP_TOOLCHAIN = options.toolchain;
  }
  if (options.proxy) {
    env.HTTP_PROXY = options.proxy;
    env.HTTPS_PROXY = options.proxy;
    env.ALL_PROXY = options.proxy;
    env.http_proxy = options.proxy;
    env.https_proxy = options.proxy;
    env.all_proxy = options.proxy;
    env.CARGO_NET_GIT_FETCH_WITH_CLI = env.CARGO_NET_GIT_FETCH_WITH_CLI || "true";
    env.CARGO_HTTP_TIMEOUT = env.CARGO_HTTP_TIMEOUT || "120";
  }
  return env;
}

function rdpAudioModeValue(mode) {
  if (mode === "local") return 0;
  if (mode === "remote") return 1;
  return 2;
}

function sanitizeFileToken(value) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "rdp-target";
}

function defaultReportToken(host) {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}-${sanitizeFileToken(host || "manual-test")}`;
}

function assertSingleLineValue(name, value) {
  if (!value) {
    return;
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must not contain newline characters.`);
  }
}

function assertRepoExists(repoDir) {
  if (!existsSync(repoDir)) {
    throw new Error(`IronRDP checkout is missing. Run prepare first: ${repoDir}`);
  }
}

function assertSafeViewerArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const [name] = value.split("=", 1);
    if (FORBIDDEN_VIEWER_ARGS.has(name)) {
      throw new Error(`${name} is rejected. Let the viewer prompt for credentials instead.`);
    }
  }
}

function assertSafeRdpFile(path) {
  const content = readFileSync(path, "utf8");
  const unsafeLine = content
    .split(/\r?\n/)
    .find((line) => FORBIDDEN_RDP_FIELDS.some((pattern) => pattern.test(line)));
  if (unsafeLine) {
    throw new Error(`Refusing .rdp file with plaintext credential field: ${unsafeLine}`);
  }
}

function assertIncludesCaseInsensitive(source, value, message) {
  if (!source.toLowerCase().includes(value.toLowerCase())) {
    throw new Error(message);
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  switch (options.command) {
    case "status":
      status(options);
      return;
    case "prepare":
      prepare(options);
      return;
    case "build":
      build(options);
      return;
    case "smoke":
      smoke(options);
      return;
    case "write-rdp":
      writeRdpTemplate(options);
      return;
    case "write-report":
      writeReportTemplate(options);
      return;
    case "run":
      runViewer(options);
      return;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      throw new Error(`Unknown command: ${options.command}`);
  }
}

function isExecutedAsCli() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsCli()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
