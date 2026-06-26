# VNC connection runner v1

## Goal

Add first-class VNC connection management to mXterm with an embedded, tabbed desktop-viewer workflow that matches the RDP connection runner direction: saved connections in the same repository, double-click to open, one active tab per saved connection, right-side runner/session tools, safe credential handling, and platform fallback diagnostics.

## Confirmed Facts

- The user wants the same aggressive, once-and-done direction used for RDP: plan and implement without stopping for additional approval.
- The existing connection repository now supports protocol-aware rows for SSH and RDP. VNC should extend this model rather than create a separate asset store.
- `ConnectionDialog` still exposes a disabled VNC protocol chip, so the UI entry point already exists.
- Existing SSH-only tools include terminal, remote files, monitor, tunnels, Docker, Command Sender, and SSH command history. VNC must be blocked from those paths unless a future task makes a tool protocol-aware.
- Source review locations:
  - `D:\ai_proj\_refs\vnc\noVNC`
  - `D:\ai_proj\_refs\vnc\guacamole-client`
  - `D:\ai_proj\_refs\vnc\tigervnc`
- noVNC is MPL-2.0 and publishes `@novnc/novnc` with a single `RFB` API over WebSocket.
- Apache Guacamole client is Apache-2.0 and validates a browser-display plus server tunnel architecture, but its VNC handling is designed around the Guacamole server protocol.
- TigerVNC is GPL-2.0; mXterm must not copy its code. It is useful only for behavior, CLI, and compatibility observations.

## Requirements

- Add VNC as a first-class connection protocol alongside SSH and RDP.
- Preserve the unified connection asset experience:
  - create/edit/delete/search/favorite/grouping work like SSH/RDP,
  - sync/export/MCP redaction includes non-secret VNC metadata only,
  - browser preview and desktop runtime both keep valid VNC rows.
- Use an embedded-first VNC runner:
  - frontend uses noVNC `RFB` as the embedded browser viewer,
  - backend opens a local WebSocket-to-TCP bridge to the target VNC host,
  - workspace renders the live VNC surface inside the normal session area,
  - same saved VNC connection opens at most one workspace tab and reactivates the existing tab.
- Include fallback runner support:
  - detect common external viewers such as `vncviewer`, `tigervnc-viewer`, `xtigervncviewer`, `TigerVNC Viewer`, or custom executable,
  - show setup diagnostics when no embedded bridge or external viewer can be used,
  - never pass plaintext VNC passwords in command-line arguments.
- Define a forward-compatible VNC config model:
  - display mode, scale mode, resize behavior, shared-session mode,
  - view-only and clipboard toggles,
  - compression/quality presets,
  - security mode and credential behavior,
  - runner preference and custom runner args,
  - optional raw viewer arguments for advanced external runner use after validation.
- Credential handling:
  - password and prompt modes only in v1,
  - saved/inline passwords resolve through the existing vault boundary,
  - embedded noVNC may receive the password only as a launch-time in-memory field,
  - external runner fallback must prompt unless a future platform-secure handoff is added.
- UI must reuse existing mXterm shared controls, Radix/Lucide patterns, `AppSelect`, and global `--mx-*` tokens. Do not add a second visual system.
- VNC must not weaken existing SSH or RDP behavior.

## Out Of Scope

- Implementing the VNC/RFB protocol from scratch.
- Copying GPL code from TigerVNC or other strong-copyleft projects.
- Building a full Guacamole-compatible server gateway.
- SSH tunnel chaining for VNC in v1 unless it can reuse existing SSH tunnel infrastructure safely without broad extra scope.
- File transfer, audio, or RDP-like device redirection for VNC.
- Sending VNC passwords through process args, logs, generated files, sync data, or MCP output.

## Acceptance Criteria

- [ ] PRD, design, implementation plan, and source review notes are persisted under the VNC Trellis task.
- [ ] VNC protocol is persisted in `ConnectionProfile` / SQLite / sync snapshots without breaking existing SSH/RDP rows.
- [ ] VNC connection dialog can create and edit VNC profiles with compact token-based UI.
- [ ] Double-clicking a VNC profile opens an embedded VNC workspace session; opening the same saved connection again activates the existing tab.
- [ ] Embedded VNC launches through a backend local WebSocket bridge and noVNC frontend surface.
- [ ] Prompt/inline/saved VNC password handling works without CLI plaintext exposure.
- [ ] VNC sessions can disconnect/close and clean up backend bridge state.
- [ ] External runner preview/probe exists as fallback diagnostics.
- [ ] SSH-only commands and right-pane tools reject or hide VNC rows.
- [ ] `npm run check`, `cargo fmt --check`, `cargo check`, and targeted Rust tests pass.

## Notes

- User explicitly approved planning plus implementation without an additional review pause for this task.
