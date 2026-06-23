# mXterm MCP connection and controlled SSH tools

## Goal

Provide an independent local MCP server for mXterm so external AI agents can query mXterm connection assets and, when explicitly enabled, perform controlled SSH operations without launching the mXterm desktop app and without receiving secrets.

## User Value

- Users can let Codex, Claude, and other MCP clients discover mXterm connection metadata.
- Agents can answer questions such as "which host is the production database jump target?" or "find recent Linux servers tagged test" without manually copying connection details.
- Strong agents can use saved SSH connections to help with operations tasks such as connectivity checks, read-only diagnostics, and controlled command/file workflows.
- mXterm remains the source of truth for saved connections and basic sync/security status.
- Secrets remain protected: passwords, passphrases, private key contents, sync passwords, and vault plaintext are never returned through MCP.

## Confirmed Facts

- `D:\McpServer\ssh-mcp` is an earlier Python stdio MCP server with SSH execution, transfer, monitoring, command validation, and audit logging.
- The old `ssh-mcp` is useful as a reference for MCP tool shape and future controlled SSH execution, but it accepts dynamic host/user/password payloads that should not be copied into mXterm MCP.
- mXterm already stores connection data through `src-tauri/src/storage_repository.rs` and exposes desktop commands such as `connection_list`, `command_snippet_list`, `command_history_list`, and `tunnel_list`.
- mXterm already has SQLite storage, encrypted vault support, WebDAV sync settings, command snippets/history, tunnels, remote monitor, SFTP transfer, and real SSH jump support.
- `src-tauri` is a Rust package with a reusable `rlib` plus the Tauri desktop binary, so an additional `mxterm-mcp` binary can reuse Rust modules instead of reimplementing storage parsing in Node or Python.
- The current working tree has an unrelated untracked backup file: `pnpm-workspace.yaml.local-before-pull-20260608011116`.

## Requirements

- Add an independent stdio MCP server binary, tentatively named `mxterm-mcp`.
- The MCP server must run without the mXterm desktop app being open.
- First release includes connection metadata plus controlled SSH tools behind separate settings switches.
- First release must not expose secrets to MCP clients, even when SSH execution is enabled.
- MCP access must be gated by persistent mXterm Settings switches.
- All MCP switches default to disabled.
- When disabled, `mxterm-mcp` may start but must return only a disabled/status response and must not return connection or sync/security status data.
- Settings must split permissions:
  - MCP server access: master switch, default disabled.
  - Connection asset exposure: read-only connection/sync/security metadata, default disabled.
  - SSH operations: test connection, command execution, monitoring, and transfer/script tools, default disabled.
- Connection asset exposure should support both bulk enable/disable and per-connection enable/disable, so users can decide exactly which saved connections are visible to MCP clients.
- SSH operation tools must use saved mXterm connection ids and mXterm credential/vault plumbing only.
- SSH operation tools must not accept password, passphrase, private key content, or arbitrary host/user/password payloads.
- The server must read mXterm's normal app data storage path by default, with an optional explicit data-dir override for development/testing.
- Expose connection metadata:
  - id, name, group, host, port, username, auth kind/mode, proxy/jump summary, notes/tags where available, favorite/recent fields, detected remote OS fields.
  - secret state only as metadata such as `has_secret`, `credential_mode`, `credential_id`, or `redacted: true`.
- Do not expose command snippets or command history in MVP.
  - Command text may accidentally contain tokens, passwords, secret URLs, or database credentials.
  - Future exposure requires a separate opt-in decision and redaction strategy.
- Do not expose tunnel metadata in MVP.
  - Tunnel rules can reveal internal network topology.
- Expose WebDAV/security summary:
  - enabled/saved-state style metadata only.
  - No WebDAV password, sync password, or vault secret material.
- Provide MCP tools/resources that are easy for agents to use:
  - list/search connections
  - get one connection
  - get server/storage capability summary
- Provide controlled SSH tools, modeled after the earlier Python `ssh-mcp` but redesigned around saved connection ids:
  - test connection
  - execute command with timeout, output limit, validation, and audit logging
  - fetch server monitor snapshot
  - upload file
  - download file
  - upload directory
  - download directory
  - execute script with timeout, cleanup, validation, and audit logging
- SSH operation tools must be separately disabled unless the SSH operations switch is enabled.
- Command execution must enforce a safety policy:
  - reject known dangerous commands by default.
  - require an explicit `confirm_dangerous: true` style argument for dangerous commands if the user has enabled dangerous-command confirmation in Settings.
  - cap execution timeout and output size.
  - record audit logs for success and failure.
- File transfer and script tools must validate local/remote paths well enough to prevent obvious path traversal or accidental system-wide writes from unchecked defaults.
- Add a Settings page entry under an integration/MCP area with:
  - enable/disabled guidance for the external server and each capability group
  - the resolved server executable path or install location
  - copyable MCP client configuration JSON
  - clear explanation that secrets are not exposed and SSH operations are powerful
- Default transport is stdio only. No network listener in MVP.
- Output must be stable JSON-like structured content, not only human prose.

## Acceptance Criteria

- [ ] `mxterm-mcp` can start as a stdio MCP server while the mXterm desktop app is not running.
- [ ] MCP access and every capability group are disabled by default until the user enables them in mXterm Settings.
- [ ] When MCP access is disabled, MCP tools do not return connection or sync/security status data.
- [ ] MCP clients can list/search saved connections from the mXterm app data store.
- [ ] MCP clients can fetch one connection's redacted context by id.
- [ ] Settings can bulk enable/disable MCP exposure for saved connections and can enable/disable individual connection exposure.
- [ ] MCP connection list/search/get only returns connections selected for MCP exposure.
- [ ] SSH tools do not run unless the SSH operations switch is enabled.
- [ ] SSH tools operate by `connection_id` and never by dynamic plaintext credentials.
- [ ] MCP clients can test a saved SSH connection when SSH operations are enabled.
- [ ] MCP clients can execute a controlled command with timeout, output truncation, command validation, and audit logging when SSH operations are enabled.
- [ ] MCP clients can fetch a server monitor snapshot when SSH operations are enabled.
- [ ] MCP clients can upload/download files and directories when SSH operations are enabled.
- [ ] MCP clients can execute a local script remotely when SSH operations are enabled.
- [ ] Dangerous command behavior is blocked by default or requires an explicit confirmation argument according to Settings.
- [ ] MCP output never contains password, passphrase, private key content, WebDAV password, sync password, or vault plaintext.
- [ ] Saved credential and inline credential presence is represented only as redacted metadata.
- [ ] Settings shows an MCP/integration section with a copyable stdio config snippet.
- [ ] The server can be run against a test data directory for automated tests.
- [ ] Unit or integration tests prove redaction, storage loading, disabled gates, command validation, output truncation, and audit behavior.
- [ ] Existing app checks still pass.

## Out of Scope

- Starting/stopping tunnels through MCP.
- Exposing tunnel rules or tunnel runtime state through MCP.
- Exposing command snippets or command history through MCP.
- Unlocking or revealing vault secrets through MCP.
- Network MCP server mode.
- Automatic registration into every MCP client config file.

## Future Work

- Optional command snippets/history MCP exposure behind a separate opt-in setting and redaction strategy.
- Optional tunnel metadata exposure in a later phase after a separate product decision.
- mXterm foreground confirmation for highly destructive operations.
- MCP audit log viewer in Settings.
- Optional inclusion of command snippets/history in WebDAV sync, if product scope expands.

## Open Questions

- Decide the default per-connection exposure policy after the global connection metadata switch is enabled.
