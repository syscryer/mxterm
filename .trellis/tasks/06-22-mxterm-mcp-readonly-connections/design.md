# mXterm MCP connection and controlled SSH tools design

## Architecture

Add a new Rust sidecar binary under `src-tauri`, tentatively `mxterm-mcp`, which speaks MCP over stdio and reuses mXterm storage/domain/SSH code.

The desktop app remains unchanged at runtime. The MCP server is a separate executable launched by external MCP clients:

```text
Codex / Claude / MCP client
  -> stdio
mxterm-mcp
  -> mXterm app data directory
  -> SQLite repository + settings gates + redaction projection
  -> saved SSH connection + vault/credential provider, only when SSH operations are enabled
```

## Why Rust sidecar

- Reuses `StorageRepository`, sync settings, and connection contracts.
- Reuses existing SSH, jump, remote monitor, and transfer logic where possible.
- Avoids a second SQLite reader in TypeScript/Python that can drift from migrations.
- Avoids exposing vault logic to a script runtime.
- Can be packaged next to the desktop app and referenced in Settings.

## Crate Shape

`src-tauri/Cargo.toml` can add:

```toml
[[bin]]
name = "mxterm-mcp"
path = "src/bin/mxterm_mcp.rs"
```

The binary should import reusable modules from `m_xterm_lib`. If current visibility blocks reuse, expose narrow read-only helpers from the library instead of duplicating repository logic.

## Data Access

Default path:

- Use the same mXterm app data directory convention as the desktop app.
- Provide `--data-dir <path>` for tests and development.

Repository:

- Open SQLite repository in read-only intent where practical.
- Use an in-memory/no-op secret store for MVP if repository construction requires a secret store.
- Do not call secret reveal APIs.
- Do not unlock vault.

If an older app data directory still needs migration, the MCP server should report a clear setup error instead of silently mutating storage in MVP.

## Enablement Gates

MCP access is controlled by persistent mXterm Settings flags that default to disabled.

The MCP sidecar must check these flags before returning user asset data or performing remote operations. If the master switch is disabled, it may still respond to a status/capability call with a clear disabled state, but list/search/get tools and SSH tools must not return assets or run operations.

Proposed flags:

- `mcp.enabled`: master switch. Default false.
- `mcp.expose_connections`: read-only connection/sync/security metadata. Default false.
- `mcp.ssh_operations_enabled`: SSH test/command/monitor/transfer/script tools. Default false.
- `mcp.allow_dangerous_commands`: optional dangerous-command confirmation behavior. Default false.

The flags should live in the normal settings/repository layer so they are available without the desktop app running. Do not rely on an in-memory Tauri state value.

## MCP Surface

Connection/status tools:

- `list_connections`
- `search_connections`
- `get_connection`
- `get_mxterm_mcp_status`

Controlled SSH tools:

- `test_connection`
- `execute_command`
- `server_monitor`
- `upload_file`
- `download_file`
- `upload_directory`
- `download_directory`
- `execute_script`

Tool arguments should use mXterm saved connection ids:

```json
{
  "connection_id": "saved-connection-id",
  "command": "uptime",
  "timeout_seconds": 30,
  "max_output_bytes": 65536
}
```

Do not support dynamic credential arguments such as `host`, `user`, `password`, `passphrase`, or private key content. The earlier Python `ssh-mcp` accepted those payloads; mXterm MCP must not.

Optional resources:

- `mxterm://connections`
- `mxterm://connections/{id}`

Tools are enough for MVP if adding resources materially increases implementation cost.

## Redaction Projection

Create MCP-specific DTOs rather than serializing internal structs directly.

Connection DTO should include:

- id, name, group/group_id if available
- host, port, username
- auth kind, credential mode
- `has_inline_secret` / `has_saved_credential` booleans
- saved credential id/name if already non-sensitive
- proxy kind and redacted proxy host/port
- jump kind and jump connection id/name when resolvable
- remote OS fields
- notes/tags, favorite/recent metadata if available
- `redacted: true`

Never include:

- password
- private key passphrase
- private key file content
- sync password
- WebDAV password
- vault raw envelope

Private key path policy:

- Default MVP should omit private key paths or return only `private_key_path_saved: true`.
- A future explicit setting may expose paths if the user decides paths are acceptable metadata.

## SSH Operation Design

The old Python `ssh-mcp` is a functional reference for tool shape and safety ideas:

- command validator
- dangerous command detection
- whitelist/blacklist style policy
- audit logger
- connection pooling
- upload/download and script execution
- server monitor snapshots

The mXterm implementation should redesign these around saved connections and existing Rust backend capabilities.

Execution rules:

- Resolve `connection_id` from storage.
- Load credentials through the same credential/vault mechanism the app uses.
- Reuse jump/proxy settings already present on the saved connection.
- Never return credential material.
- Apply command validation before opening or using an SSH session.
- Enforce timeout and output truncation for every command/script/monitor call.
- Audit every SSH operation with operation kind, connection id/name, target host, command/path summary, result status, duration, and error text when applicable.

Dangerous commands:

- Maintain a conservative deny/danger detector for patterns such as destructive filesystem operations, disk formatting, reboot/shutdown, fork bombs, permission recursion at root, and direct writes to device nodes.
- If `mcp.allow_dangerous_commands` is false, reject dangerous commands.
- If it is true, require an explicit `confirm_dangerous: true` argument and include the detector reason in the response/audit.

Transfers and scripts:

- File and directory transfer tools should validate required paths, reject empty paths, and avoid implicit defaults like `/` or the process working directory.
- Script execution should upload to a generated temporary remote path, set executable permissions only for that temp path, run with timeout/output limits, and clean up when requested.
- Local paths are paths on the MCP client's machine because the sidecar is local stdio. Responses should make this explicit in error messages.

## Settings UI

Add a Settings navigation item such as `Integrations` or `MCP`.

MVP content:

- switch to enable mXterm MCP access, default disabled
- switch to expose connection metadata, default disabled
- switch to enable SSH operations, default disabled
- optional switch for dangerous-command confirmation behavior, default disabled
- explain that MCP is local stdio and that SSH operations can change remote systems
- show executable path / copyable command
- show JSON snippet:

```json
{
  "mcpServers": {
    "mxterm": {
      "command": "C:\\Program Files\\mXterm\\mxterm-mcp.exe",
      "args": []
    }
  }
}
```

If development path is not known at runtime, show a template plus a copy button.

## Security Model

- Default to stdio only.
- No network listener.
- Disabled by default through Settings.
- Sidecar must enforce the stored enablement flag even if launched directly by an MCP client.
- SSH operation tools are powerful and require an additional stored enablement flag.
- SSH operation tools use saved connection ids only, never plaintext dynamic credentials.
- No tunnel metadata or tunnel runtime tools.
- No secret reveal tools.
- Explicitly redacted DTOs.
- Command validation, timeout, output truncation, and audit logging for all SSH operations.
- Tests must assert sensitive strings are not serialized.

## Compatibility

- The MCP sidecar should tolerate the desktop app being closed.
- When desktop app is open, connection metadata reads should not write to SQLite or vault.
- SSH operation audit logging may write to the app data directory when operations are enabled.
- Packaging can be added later if desktop distribution scripts are not ready.

## Future Command Library Exposure

Command snippets and command history are intentionally out of scope for MVP because command text can accidentally contain tokens, passwords, secret URLs, or database credentials. If added later, expose them behind a separate opt-in setting and a redaction strategy rather than bundling them into the base MCP connection-info switch.

## Future Tunnel Exposure

Tunnel metadata is intentionally out of scope for MVP because saved tunnel rules can reveal internal network topology. Revisit in a later phase after a separate product decision.
