import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outRoot = resolve("node_modules", ".mxterm-check-tmp");
mkdirSync(outRoot, { recursive: true });
const outDir = mkdtempSync(join(outRoot, "connection-system-icon-"));

try {
  const logoSource = readFileSync("src/features/connections/ConnectionSystemLogo.tsx", "utf8");
  assert.match(logoSource, /from "simple-icons"/);
  assert.doesNotMatch(logoSource, /M17\.61\.46/);
  assert.doesNotMatch(logoSource, /resolvedKind === "ubuntu" \?/);

  const compile = spawnSync(
    process.execPath,
    [
      resolve("node_modules", "typescript", "bin", "tsc"),
      "src/features/connections/ConnectionSystemLogo.tsx",
      "--outDir",
      outDir,
      "--jsx",
      "react-jsx",
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

  const systemLogo = await import(
    pathToFileURL(join(outDir, "ConnectionSystemLogo.js")).href
  );
  const { getConnectionSystemLabel, inferConnectionSystemKind } = systemLogo;

  const baseConnection = {
    advanced: {
      auth_timeout_ms: 45000,
      connect_timeout_ms: 30000,
      keepalive_interval_ms: 20000,
    },
    created_at: "test",
    credential_mode: "inline",
    group: "云主机",
    host: "203.0.113.16",
    id: "real-linux",
    inline_auth_kind: "password",
    is_favorite: false,
    name: "203.0.113.16[k8s]",
    notes: "k8s",
    port: 22,
    proxy: { kind: "none" },
    updated_at: "test",
    username: "root",
  };

  assert.equal(inferConnectionSystemKind(baseConnection), "linux");
  assert.equal(
    inferConnectionSystemKind({ ...baseConnection, name: "Ubuntu app" }),
    "ubuntu",
  );
  assert.equal(
    inferConnectionSystemKind({ ...baseConnection, notes: "Debian 12" }),
    "debian",
  );
  assert.equal(
    inferConnectionSystemKind({ ...baseConnection, name: "CentOS 7" }),
    "centos",
  );
  assert.equal(
    inferConnectionSystemKind({
      ...baseConnection,
      name: "198.51.100.70",
      notes: "",
      remote_os_id: "ubuntu",
      remote_os_name: "Ubuntu",
      remote_os_version: "22.04",
    }),
    "ubuntu",
  );
  assert.equal(
    inferConnectionSystemKind({
      ...baseConnection,
      name: "203.0.113.73",
      notes: "",
      remote_os_id: "centos",
      remote_os_name: "CentOS Linux",
      remote_os_version: "7",
    }),
    "centos",
  );
  assert.equal(getConnectionSystemLabel("linux"), "Linux");

  const connectionPaneSource = readFileSync("src/features/connections/ConnectionPane.tsx", "utf8");
  assert.match(connectionPaneSource, /ConnectionSystemLogo/);
  assert.doesNotMatch(connectionPaneSource, /<Server className="ui-icon connection-server-icon"/);

  const connectionTypesSource = readFileSync("src/features/connections/connectionTypes.ts", "utf8");
  assert.match(connectionTypesSource, /remote_os_id\?: string/);
  assert.match(connectionTypesSource, /remote_os_name\?: string/);
  assert.match(connectionTypesSource, /remote_os_version\?: string/);

  const frontendCommandsSource = readFileSync("src/shared/tauri/commands.ts", "utf8");
  assert.match(frontendCommandsSource, /connection_probe_system/);

  const workspaceShellSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
  assert.match(workspaceShellSource, /probeSystem\(runtimeCredentialRequest\(step\)\)/);
  assert.match(workspaceShellSource, /refreshConnectedProfile/);

  const rustConnectionsSource = readFileSync("src-tauri/src/connections/mod.rs", "utf8");
  assert.match(rustConnectionsSource, /REMOTE_SYSTEM_PROBE_COMMAND/);
  assert.match(rustConnectionsSource, /parse_remote_system_probe/);

  const rustCommandsSource = readFileSync("src-tauri/src/commands.rs", "utf8");
  assert.match(rustCommandsSource, /pub async fn connection_probe_system/);

  const tauriLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
  assert.match(tauriLibSource, /commands::connection_probe_system/);

  console.log("Connection system icon check passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
