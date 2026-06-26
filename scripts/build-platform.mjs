#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SUPPORTED_TARGETS = new Map([
  [
    "win-x64",
    {
      label: "Windows x64",
      command: ["pnpm", ["tauri", "build", "--bundles", "nsis"]],
    },
  ],
  [
    "mac-arm64",
    {
      label: "macOS Apple Silicon",
      command: [
        "pnpm",
        ["tauri", "build", "--target", "aarch64-apple-darwin", "--bundles", "app,dmg"],
      ],
    },
  ],
  [
    "linux-x64",
    {
      label: "Linux x64",
      command: [
        "pnpm",
        [
          "tauri",
          "build",
          "--target",
          "x86_64-unknown-linux-gnu",
          "--bundles",
          "deb,rpm,appimage",
        ],
      ],
    },
  ],
]);

const createUpdaterArtifactsEnv = "MXTERM_CREATE_UPDATER_ARTIFACTS";
const createUpdaterArtifactsConfig = JSON.stringify({
  bundle: {
    createUpdaterArtifacts: true,
  },
});

export function expandPlatformSelection(selection, runtime = process) {
  if (selection !== "all") {
    return [selection];
  }

  if (runtime.platform === "win32") {
    return ["win-x64"];
  }
  if (runtime.platform === "darwin") {
    return ["mac-arm64"];
  }
  if (runtime.platform === "linux") {
    return ["linux-x64"];
  }

  throw new Error(`Unsupported host platform: ${runtime.platform}`);
}

export function getBuildPlan(target) {
  const plan = SUPPORTED_TARGETS.get(target);
  if (!plan) {
    throw new Error(`Unsupported platform target: ${target}`);
  }
  return plan;
}

export function updaterArtifactsArgs(runtime = process) {
  return runtime.env?.[createUpdaterArtifactsEnv] === "1"
    ? ["--config", createUpdaterArtifactsConfig]
    : [];
}

export function resolveSpawnInvocation(command, args, runtime = process) {
  const npmExecPath = runtime.env?.npm_execpath;
  const usesPnpmExecPath =
    typeof npmExecPath === "string" &&
    /(^|[\\/])pnpm(?:\.c?js|\.cmd)?$/i.test(npmExecPath);

  if (runtime.platform === "win32" && command === "pnpm" && usesPnpmExecPath) {
    return {
      command: runtime.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: runtime.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command,
    args,
  };
}

export function runPlan(target, { runtime = process, spawn = spawnSync } = {}) {
  const plan = getBuildPlan(target);
  const [command, args] = plan.command;
  const buildArgs = [...args, ...updaterArtifactsArgs(runtime)];
  const invocation = resolveSpawnInvocation(command, buildArgs, runtime);

  console.log(`\nBuilding ${plan.label}...`);
  console.log(`> ${invocation.command} ${invocation.args.join(" ")}`);

  const result = spawn(invocation.command, invocation.args, {
    cwd: runtime.cwd(),
    env: runtime.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    runtime.exit(result.status ?? 1);
  }
}

function main(argv = process.argv.slice(2)) {
  const selection = argv[0] ?? "all";
  for (const target of expandPlatformSelection(selection)) {
    runPlan(target);
  }
}

function isExecutedAsCli() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsCli()) {
  main();
}
