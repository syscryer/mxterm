# mXterm MCP connection and controlled SSH tools implementation plan

## Checklist

1. Load implementation specs with `trellis-before-dev`.
2. Confirm current MCP Rust crate choice:
   - preferred: Rust MCP SDK if acceptable
   - fallback: minimal JSON-RPC MCP stdio implementation for the small tool surface
3. Add `mxterm-mcp` sidecar binary.
4. Add app-data path resolver and `--data-dir` override.
5. Add persisted MCP settings, all default disabled:
   - master MCP access
   - connection metadata exposure
   - SSH operations
   - dangerous-command confirmation behavior
6. Add Settings UI section with capability switches, executable path, and copyable MCP config.
7. Enforce gates inside `mxterm-mcp`:
   - master disabled: only status/capability response.
   - connection exposure disabled: no connection/sync/security data.
   - SSH operations disabled: no remote operation runs.
8. Add redacted MCP DTOs and projection helpers.
9. Implement read-only storage queries:
   - connections
   - basic WebDAV/security status if repository helpers are already available
10. Implement MCP stdio tool listing and tool calls.
11. Add controlled SSH operation layer:
   - resolve saved `connection_id`.
   - load credentials through existing mXterm credential/vault path.
   - reuse existing SSH/jump/proxy/session code where possible.
   - reject dynamic plaintext credential arguments.
12. Add command safety and audit components:
   - dangerous command detector.
   - timeout and output truncation helpers.
   - audit log writer for success/failure.
13. Implement SSH tools:
   - `test_connection`
   - `execute_command`
   - `server_monitor`
   - `upload_file`
   - `download_file`
   - `upload_directory`
   - `download_directory`
   - `execute_script`
14. Add tests for:
   - disabled-by-default behavior
   - disabled sidecar does not return assets
   - SSH tools blocked when SSH operations are disabled
   - redaction of sensitive fields
   - loading from a temp test repository
   - search/filter behavior
   - dynamic plaintext credentials rejected
   - dangerous command detection and confirmation behavior
   - command timeout and output truncation
   - audit log success/failure records
   - transfer/script path validation
   - command snippets/history are not exposed in MVP
   - tunnel metadata is not exposed in MVP
   - no secret reveal call path
15. Update specs if MCP/storage/redaction/security conventions need to be preserved.
16. Run validation.

## Validation Commands

- `pnpm.cmd check`
- `pnpm.cmd build`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin mxterm-mcp`
- targeted source guard if added, for example `node scripts/check-mxterm-mcp-source.mjs`

## Rollback Points

- Remove `[[bin]] mxterm-mcp` and sidecar source files.
- Remove Settings MCP section.
- Keep repository helper visibility changes narrow so they can be reverted independently.
- Keep SSH operation helpers behind new settings gates so they can be disabled without removing connection metadata MCP.

## Review Gates

- No MCP tool accepts password/passphrase/private key content.
- No MCP response contains secret fields.
- MCP tools are disabled until the user enables MCP access in Settings.
- Connection metadata tools additionally require the connection exposure switch.
- SSH operation tools additionally require the SSH operations switch.
- SSH operation tools accept saved connection ids only.
- Command execution has validation, timeout, output truncation, and audit logging.
- Transfer/script tools validate paths and audit success/failure.
- No tunnel metadata or tunnel runtime operation is exposed in MVP.
- The desktop app does not need to be running.
- Running MCP without SSH operations enabled cannot mutate production storage.
