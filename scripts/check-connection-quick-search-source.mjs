import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outRoot = resolve("node_modules", ".mxterm-check-tmp");
mkdirSync(outRoot, { recursive: true });
const outDir = mkdtempSync(join(outRoot, "connection-quick-search-"));

try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/connections/connectionSearch.ts",
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

  const { buildConnectionSearchEntries } = await import(
    pathToFileURL(join(outDir, "connectionSearch.js")).href
  );

  const connections = [
    {
      advanced: {
        auth_timeout_ms: 45000,
        connect_timeout_ms: 30000,
        keepalive_interval_ms: 20000,
        terminal_encoding: "utf-8",
      },
      created_at: "2026-06-01T00:00:00Z",
      credential_mode: "inline",
      group: "生产",
      host: "10.10.10.8",
      id: "prod-db",
      inline_auth_kind: "password",
      is_favorite: false,
      last_connected_at: "2026-06-18T12:00:00Z",
      name: "生产数据库",
      notes: "mysql 主库",
      port: 22,
      proxy: { kind: "none" },
      jump: { kind: "none" },
      remote_os_name: "Ubuntu",
      remote_os_version: "22.04",
      updated_at: "2026-06-18T12:00:00Z",
      username: "root",
    },
    {
      advanced: {
        auth_timeout_ms: 45000,
        connect_timeout_ms: 30000,
        keepalive_interval_ms: 20000,
        terminal_encoding: "utf-8",
      },
      created_at: "2026-06-02T00:00:00Z",
      credential_mode: "inline",
      group: "测试",
      host: "172.16.0.21",
      id: "test-api",
      inline_auth_kind: "password",
      is_favorite: true,
      last_connected_at: "2026-06-19T09:00:00Z",
      name: "测试 API",
      notes: "灰度入口",
      port: 2202,
      proxy: { kind: "none" },
      jump: { kind: "none" },
      remote_os_name: "Debian",
      remote_os_version: "12",
      updated_at: "2026-06-19T09:00:00Z",
      username: "deploy",
    },
    {
      advanced: {
        auth_timeout_ms: 45000,
        connect_timeout_ms: 30000,
        keepalive_interval_ms: 20000,
        terminal_encoding: "utf-8",
      },
      created_at: "2026-06-03T00:00:00Z",
      credential_mode: "inline",
      group: "生产",
      host: "10.10.10.9",
      id: "prod-api",
      inline_auth_kind: "password",
      is_favorite: false,
      last_connected_at: null,
      name: "生产 API",
      notes: "后端服务",
      port: 22,
      proxy: { kind: "none" },
      jump: { kind: "none" },
      remote_os_name: "CentOS",
      remote_os_version: "7",
      updated_at: "2026-06-03T00:00:00Z",
      username: "app",
    },
  ];

  assert.deepEqual(
    buildConnectionSearchEntries(connections, "").map((entry) => entry.connection.id),
    ["test-api", "prod-db", "prod-api"],
  );

  assert.deepEqual(
    buildConnectionSearchEntries(connections, "生产 api").map((entry) => entry.connection.id),
    ["prod-api"],
  );

  const portMatch = buildConnectionSearchEntries(connections, "deploy 2202");
  assert.equal(portMatch.length, 1);
  assert.equal(portMatch[0].connection.id, "test-api");

  const osMatch = buildConnectionSearchEntries(connections, "ubuntu 22.04");
  assert.equal(osMatch.length, 1);
  assert.equal(osMatch[0].connection.id, "prod-db");

  const connectionPaneSource = readFileSync("src/features/connections/ConnectionPane.tsx", "utf8");
  assert.match(connectionPaneSource, /onOpenSearch/);
  assert.match(connectionPaneSource, /aria-label="搜索连接"/);

  const searchDialogSource = readFileSync("src/features/connections/ConnectionSearchDialog.tsx", "utf8");
  assert.match(searchDialogSource, /ConnectionSearchDialog/);
  assert.match(searchDialogSource, /Keybinding/);
  assert.match(searchDialogSource, /value=\{`Ctrl\+\$\{\(index \+ 1\)\.toString\(\)\}`\}/);
  assert.match(searchDialogSource, /handleOpenChange\(false\)/);
  assert.match(searchDialogSource, /onQueryChange\(""\)/);

  const workspaceShellSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
  assert.match(workspaceShellSource, /ConnectionSearchDialog/);
  assert.match(workspaceShellSource, /onSelectConnection=\{openConnectionSession\}/);

  const styleSource = readFileSync("src/styles/app.css", "utf8");
  assert.match(styleSource, /\.connection-search-dialog/);
  assert.match(styleSource, /var\(--mx-/);

  console.log("Connection quick search check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
