import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "mxterm-semantic-highlight-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/terminal/terminalSemanticHighlight.ts",
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

  const semanticHighlight = await import(
    pathToFileURL(join(outDir, "terminalSemanticHighlight.js")).href
  );
  const { findTerminalSemanticTokens, trimTerminalSemanticTokenText } = semanticHighlight;

  const banner = [
    "Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 6.8.0-94-generic x86_64)",
    "* Documentation: https://help.ubuntu.com",
    "158 updates can be applied immediately.",
    "Last login: Mon Jun 15 14:51:38 2026 from 192.168.10.225",
  ].join("\n");
  const tokens = findTerminalSemanticTokens(banner);

  assert.deepEqual(
    tokens.map((token) => [token.kind, token.text]),
    [
      ["version", "22.04.4"],
      ["version", "6.8.0-94"],
      ["url", "https://help.ubuntu.com"],
      ["number", "158"],
      ["date", "Mon Jun 15 14:51:38 2026"],
      ["ip", "192.168.10.225"],
    ],
  );

  assert.deepEqual(
    findTerminalSemanticTokens("download https://example.com/app.tar.gz, now").map(
      (token) => [token.kind, token.text],
    ),
    [["url", "https://example.com/app.tar.gz"]],
  );

  assert.deepEqual(
    findTerminalSemanticTokens("proxy 10.1.2.3:8080 kernel 1.2.3").map(
      (token) => [token.kind, token.text],
    ),
    [
      ["ip", "10.1.2.3:8080"],
      ["version", "1.2.3"],
    ],
  );

  assert.equal(
    trimTerminalSemanticTokenText("https://example.com/docs).").text,
    "https://example.com/docs",
  );

  console.log("Terminal semantic highlight check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
