# RDP Connection Runner v1 Implementation Plan

## Strategy

Build the long-term RDP foundation in one pass: protocol-aware connection model, full RDP config shape, platform runner abstraction, Windows embedded target, fallback launchers, UI flow, redaction boundaries, and SSH-only guardrails. The implementation should be staged internally, but the delivered v1 should not require a later schema or UI rewrite to support embedded Windows RDP.

## Checklist

- [ ] Refresh frontend design/prototype before real UI work:
  - update `prototype/light-neutral/mxterm-empty-session.html`
  - model RDP connection creation/editing
  - model embedded vs external runner states
  - model missing-runner/error/preview states
  - ensure the flow matches existing mXterm desktop density and token style
- [ ] Add frontend/backend RDP types:
  - `ConnectionProtocol`
  - `RdpConnectionConfig`
  - `RdpDisplayConfig`
  - `RdpResourceConfig`
  - `RdpGatewayConfig`
  - `RdpRemoteAppConfig`
  - `RdpPerformanceConfig`
  - `RdpSecurityConfig`
  - `RdpRenderMode`
  - `RdpRunnerKind`
  - launch/preview/probe/session result types
- [ ] Extend SQLite schema initialization and migration helpers:
  - add `protocol` column when missing
  - add `rdp_json` column when missing
  - default legacy rows to `ssh`
  - keep existing SSH rows behavior-compatible
- [ ] Extend storage repository connection read/write paths:
  - persist protocol and `rdp_json`
  - validate RDP host/port/config shape
  - validate raw `.rdp` settings conservatively
  - keep SSH validation unchanged for SSH connections
  - update sync export/import record shape
  - update MCP redaction shape if connection metadata includes RDP
- [ ] Add protocol guardrails:
  - SSH terminal open rejects RDP
  - files/monitor/tunnels/Docker/SSH command paths reject RDP
  - frontend hides or disables SSH-only actions for RDP rows
- [ ] Add RDP backend module:
  - platform detection
  - runner capability probing
  - runner selection
  - redacted preview generation
  - launch lifecycle result mapping
- [ ] Implement Windows fallback runner:
  - `.rdp` serialization
  - temporary file creation/deletion
  - `mstsc.exe` launch
  - mixed-DPI/multi-monitor fallback logic
  - RemoteApp fallback where needed
- [ ] Implement Windows embedded runner target:
  - inspect Tauri window-handle/native-host feasibility
  - create Windows-only native host abstraction
  - host MSTSC ActiveX/native control inside session tab area
  - resize/focus/lifecycle commands
  - connect/disconnect/error events
  - fallback to `.rdp` + `mstsc.exe` when unsupported
- [ ] Implement Linux runner:
  - discover `wlfreerdp` / `xfreerdp`
  - generate redacted args
  - launch without plaintext password args
  - show setup diagnostics when missing
- [ ] Implement macOS runner:
  - custom executable/app config
  - argument template validation
  - optional `.rdp` file handoff
  - preview and setup diagnostics
- [ ] Implement credential behavior:
  - prompt mode baseline
  - saved credential references in model
  - no plaintext CLI args
  - no default plaintext `.rdp` password
  - Windows embedded in-memory credential handoff only if approved by existing credential boundary
- [ ] Expose typed Tauri wrappers:
  - `rdpLaunchConnection`
  - `rdpPreviewLaunch`
  - `rdpTestRunner`
  - `rdpCloseSession`
  - `rdpResizeEmbeddedSession`
- [ ] Update frontend connection types and dialog:
  - activate RDP protocol chip
  - render SSH form for SSH and RDP form for RDP
  - normalize submit payload per protocol
  - use shared controls and tokens
  - keep existing SSH behavior intact
- [ ] Update connection tree/list/open behavior:
  - RDP icon/address formatting
  - double-click opens RDP launch flow
  - embedded Windows creates session tab
  - external runner creates status/launch feedback
  - SSH-only context labels remain terminal-focused
- [ ] Add user feedback:
  - runner missing
  - embedded unsupported/fallback reason
  - launch failed
  - generated preview redacted
  - credential prompt/saved mode status
  - unsupported platform custom-runner guidance

## Validation

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml connections --lib`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run check`
- [ ] Prototype visual/interaction review:
  - connection dialog protocol switch
  - RDP settings density and token usage
  - embedded/external state clarity
  - missing runner/error state clarity
- [ ] Manual Windows smoke test:
  - create RDP connection
  - preview generated `.rdp`
  - launch fallback `mstsc.exe`
  - launch embedded session where supported
  - resize/focus/close embedded session
  - verify fallback triggers on unsupported cases
  - verify no password is written to `.rdp` by default
  - verify SSH connections still open terminal tabs
- [ ] Manual Linux smoke test when available:
  - detect `xfreerdp` or `wlfreerdp`
  - preview generated args without plaintext password
  - launch external runner
  - verify missing-runner setup message
- [ ] Manual macOS smoke test when available:
  - verify custom runner configuration validation
  - preview generated command without plaintext password
  - verify `.rdp` handoff/custom runner behavior
  - verify missing-runner setup message

## Risk Points

- Connection schema is shared by SSH, sync, MCP, tunnels, Docker, monitor, files, and command tools.
- RDP must not be accepted by SSH-only commands.
- Windows embedded MSTSC hosting may require native window/COM work that is sensitive to focus, DPI, resize, and app lifecycle.
- Password handling can accidentally weaken the vault model if shortcuts are taken.
- Temporary `.rdp` files must not persist sensitive content.
- Cross-platform runner behavior will be uneven; the UI should present capability differences honestly.

## Rollback

- If Windows embedded hosting is unstable, keep the full RDP model and temporarily default Windows to `.rdp` + `mstsc.exe` while leaving embedded mode behind a disabled capability flag.
- If a platform runner is unstable, hide only that runner behind setup diagnostics; do not remove RDP connections or schema fields.
- Do not alter existing SSH connection rows beyond adding default `protocol='ssh'`.
