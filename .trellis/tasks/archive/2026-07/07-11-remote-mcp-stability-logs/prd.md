# 远程 MCP 稳定性与日志

## Goal

Improve the reliability and diagnosability of the remote HTTP MCP service so it can remain usable from another machine across idle periods, transient network failures, and unexpected sidecar exits.

## Requirements

- Detect unexpected remote MCP sidecar exits and restart automatically after a bounded consecutive-failure threshold.
- Detect a live child process whose HTTP health endpoint is no longer reachable and recover it.
- Keep operator-visible service logs instead of discarding sidecar stdout and stderr.
- Add a compact log viewer to MCP settings with refresh, copy, clear, and open-folder actions.
- Expose useful runtime metadata including PID, start time, restart count, health state, and recent error.
- Preserve existing Streamable HTTP and legacy SSE endpoints and their authentication behavior.
- Keep remote MCP credentials and authorization headers out of logs.
- Avoid restart storms and stop automatic recovery when remote MCP is disabled or MXterm exits.
- Reuse the main remote-file SFTP transfer core for MCP uploads and downloads so large files receive the same chunking, resumable `.mxpart` behavior, completion checks, and timeout semantics.
- Prevent Windows updater installation failures caused by running `mxterm-mcp` executables. Detect blockers, require user confirmation, stop managed and external MCP sidecars before install, and restore the managed remote service if installation fails.

## Acceptance Criteria

- [x] An unexpectedly exited sidecar is restarted without requiring the user to open Settings.
- [x] A sidecar that fails repeated health checks is restarted after three failed 15-second probes.
- [x] Automatic restart attempts are rate-limited and surfaced in status and logs.
- [x] MCP settings shows current health, PID, start time, restart count, and recent error.
- [x] MCP settings can refresh, copy, clear, and reveal the remote MCP log.
- [x] Logs survive Settings navigation and contain lifecycle/HTTP errors without secrets.
- [x] Streamable HTTP `/mcp`, `/health`, and legacy SSE remain compatible.
- [x] Rust and TypeScript checks pass, with focused MCP and transfer tests.
- [x] MCP file and directory transfers no longer use the legacy `tokio::io::copy` implementation.
- [x] Updating with active MCP processes shows an explicit interruption warning and can terminate those processes before installation.

## Notes

- Windows is the primary runtime, but path and process handling must remain cross-platform.
- The service log is diagnostic text, not an audit log and not a storage location for MCP tool payloads.
