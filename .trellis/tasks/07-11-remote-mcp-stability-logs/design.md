# Remote MCP Stability and Logs Design

## Current Failure Shape

The Tauri process owns an `mxterm-mcp serve` child. stdout and stderr are discarded, child state is refreshed only when a settings/status command runs, and an exited child is not automatically restarted. SSE sends heartbeats, but lifecycle failures are invisible until the user manually checks the service.

## Runtime Model

`McpRemoteServiceManager` remains the sole owner of the sidecar child and gains a background supervisor started during application setup.

The supervisor periodically:

1. Loads current MCP settings.
2. Stops recovery when remote MCP is disabled.
3. Checks child exit state.
4. Probes `127.0.0.1:<port>/health` when the configured listener is non-loopback.
5. Records success/failure metadata.
6. Restarts after three consecutive failed probes, limiting retries to at most once per 45-second failure window.

Only the manager mutates child state. Status commands read the same runtime state and never create a second supervisor.

## Restart Policy

- Health interval: 15 seconds.
- Failure threshold: 3 consecutive failed health probes.
- A healthy probe resets consecutive failures.
- Disabling the remote service or exiting MXterm cancels recovery and terminates the child.
- Manual restart resets failure counters and starts immediately.

## Logging

The sidecar writes lifecycle and transport diagnostics to `<app-data>/logs/mcp-remote.log`. The parent also appends supervisor events to the same file through a synchronized helper. Log lines contain timestamp, level, component, and message.

The service must not log request authorization headers, tokens, passwords, private key material, or full MCP tool arguments. HTTP logs use method, normalized route, status, and safe error summaries only.

The log is bounded by rotating the current file when it exceeds 2 MiB, keeping one previous file. UI reads only the latest bounded tail.

## Tauri Contracts

Extend `McpRemoteServiceStatus` with:

- `healthy: boolean`
- `started_at: string | null`
- `last_health_at: string | null`
- `restart_count: number`
- `consecutive_failures: number`
- `log_path: string | null`

Add commands:

- `mcp_remote_log_read() -> McpRemoteLogOutput`
- `mcp_remote_log_clear() -> McpRemoteLogOutput`
- `mcp_remote_log_reveal() -> Result<(), AppError>`

`McpRemoteLogOutput` contains `content`, `path`, `truncated`, and `updated_at`.

## Settings UI

The existing remote HTTP service block gains a compact status summary and an unframed diagnostic log section. Actions use Lucide icons, shared tooltips, existing compact buttons, and global tokens. The log uses a fixed-height scroll area with monospace text and does not continuously poll while the MCP settings section is hidden.

## Compatibility

The existing token, endpoint, Streamable HTTP, and legacy SSE configuration remain unchanged. New status fields are additive. Existing clients do not need configuration changes.

## MCP File Transfer Reuse

MCP transfer entry points keep their existing tool schemas and result payloads, but delegate each file to the same `remote_files` SFTP upload/download primitives used by the desktop file panel. MCP supplies a no-op progress callback and a non-cancelled token. This gives MCP stable `.mxpart` targets, 256 KB chunking, resume offsets, exact download-length validation, and the established upload completion error mapping without duplicating transfer logic.

## Update Installation Handoff

Windows cannot replace the bundled `mxterm-mcp.exe` while a managed HTTP service or an external stdio MCP client still holds the executable open. Before installation, the update hook queries a typed Tauri blocker command. When one or more MCP processes are present, the UI uses the shared confirmation dialog and explains that active Agent calls will be interrupted.

On confirmation, the backend suspends supervisor recovery, stops the managed child, and terminates remaining product-owned `mxterm-mcp.exe` processes. Cancellation performs no process action. If updater installation fails after preparation, the frontend restarts the managed remote service through the existing start command. A successful install relaunches the application and naturally rebuilds normal MCP state.
