# VNC Connection Runner v1 Implementation Plan

## Checklist

- [x] Add dependencies:
  - frontend `@novnc/novnc`
  - Rust WebSocket bridge dependencies if needed (`tokio-tungstenite`, `futures-util`)
- [x] Extend shared types:
  - `ConnectionProtocol = "ssh" | "rdp" | "vnc"`
  - `VncConnectionConfig` and nested config types
  - VNC launch/preview/probe/close result types
- [x] Extend backend connection model:
  - Rust `ConnectionProtocol::Vnc`
  - VNC config structs/defaults
  - validation and normalization
  - reject private-key credentials for VNC
  - reject control characters and unsafe raw runner args
- [x] Extend storage:
  - add `vnc_json` migration
  - persist/load VNC JSON
  - sync snapshot includes redacted VNC metadata
  - MCP redacted connection DTO includes protocol metadata without secrets
- [x] Add VNC backend module:
  - resolve saved VNC connection and password
  - probe embedded/external/custom runner capabilities
  - build redacted preview
  - start local WebSocket bridge for embedded noVNC
  - close session and clean bridge state
- [x] Register backend commands in `commands.rs` and `lib.rs`.
- [x] Add typed frontend wrappers in `src/shared/tauri/commands.ts`.
- [x] Add noVNC TypeScript declaration if package has no bundled declarations.
- [x] Extend `ConnectionDialog`:
  - enable VNC chip
  - VNC tab and normalization
  - runner test action
  - password UI uses existing credential mode controls and no private-key auth
- [x] Extend connection list/search/address formatting for VNC.
- [x] Extend `WorkspaceShell`:
  - VNC session runtime state
  - open existing VNC tab for same connection
  - embedded noVNC component
  - close/reconnect/preview controls
  - right-pane VNC tool panel
  - SSH-only guardrails stay intact
- [x] Add CSS using existing RDP/session token patterns.
- [x] Update Trellis frontend/backend Tauri command contracts for VNC.

## Validation

- [x] `npm run check`
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml connections --lib`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml storage_repository --lib`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml vnc --lib`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml mcp --lib`
- [x] `git diff --check`
- [x] `npm run tauri:dev` starts desktop dev mode

## Manual Smoke

- [ ] Create VNC connection with prompt password.
- [ ] Create VNC connection with inline/saved password.
- [ ] Double-click opens embedded VNC tab.
- [ ] Opening same connection again activates existing tab.
- [ ] Disconnect/close cleans bridge.
- [ ] Missing/no runner diagnostics render clearly.
- [ ] SSH/RDP rows still behave as before.
- [ ] VNC rows do not enter terminal/files/monitor/tunnel/Docker/Command Sender paths.

## Risk Points

- WebSocket bridge lifecycle and cleanup.
- Passing a launch-time password to noVNC without persisting or logging it.
- TypeScript declarations for noVNC.
- Large `WorkspaceShell.tsx` changes around runtime workspace modes.
- Storage/sync/MCP cross-layer consistency.

## Rollback

- If WebSocket bridge fails late, keep schema/UI and return a recoverable setup diagnostic or external runner fallback.
- If noVNC import typing is unstable, add a local `.d.ts` shim rather than weakening project TypeScript settings.
