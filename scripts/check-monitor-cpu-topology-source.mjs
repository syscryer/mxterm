import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outRoot = resolve("node_modules", ".mxterm-check-tmp");
mkdirSync(outRoot, { recursive: true });
const outDir = mkdtempSync(join(outRoot, "monitor-cpu-topology-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/monitor/monitorFormatters.ts",
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

  const formatters = await import(pathToFileURL(join(outDir, "monitorFormatters.js")).href);
  const { formatCoreShape, formatCpuTopologyBadge, formatLogicalCpuCount } = formatters;

  const abnormalGuestTopology = {
    cores: [],
    is_virtualized: false,
    logical_cores: 8,
    physical_cores: 1,
    sockets: 1,
  };

  assert.equal(formatCpuTopologyBadge(abnormalGuestTopology), "8 线程");
  assert.equal(formatCoreShape(abnormalGuestTopology), "8 线程");
  assert.equal(formatLogicalCpuCount(abnormalGuestTopology), "8 线程");

  const ordinarySmtTopology = {
    cores: [],
    is_virtualized: false,
    logical_cores: 8,
    physical_cores: 4,
    sockets: 1,
  };
  assert.equal(formatCpuTopologyBadge(ordinarySmtTopology), "4 核 / 8 线程");
  assert.equal(formatCoreShape(ordinarySmtTopology), "1 路 · 4 核 · 8 线程");

  const virtualizedTopology = {
    cores: [],
    is_virtualized: true,
    logical_cores: 8,
    physical_cores: null,
    sockets: 1,
  };
  assert.equal(formatCpuTopologyBadge(virtualizedTopology), "8 vCPU");
  assert.equal(formatCoreShape(virtualizedTopology), "虚拟化 · 8 vCPU");

  console.log("Monitor CPU topology check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
