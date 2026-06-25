# RDP connection runner v1

## Goal

Add first-class, cross-platform RDP connection management to mXterm with a mature desktop RDP manager workflow. v1 should design the long-term connection model up front, support Windows embedded sessions where available, provide robust platform fallbacks, and avoid a throwaway minimal launcher that would require data/UI rewrites later.

## Confirmed Facts

- The user wants an experience close to a mature desktop RDP manager, not a thin `mstsc.exe` launcher.
- The user prefers a more aggressive first implementation so the data model, UI shape, and runner abstraction do not need major rework later.
- The feature should adapt across platforms instead of becoming Windows-only.
- Local source research shows one established Windows RDP manager uses MSTSC ActiveX for hosted/in-tab sessions and falls back to `.rdp` + `mstsc.exe` for compatibility cases such as mixed-DPI multi-monitor fullscreen and RemoteApp.
- That researched project is GPL-3.0; mXterm may use product/architecture observations but must not copy code.
- mXterm's current connection model is SSH-shaped. RDP needs a protocol discriminator and RDP-specific config instead of overloading SSH-only fields.
- `ConnectionDialog` already has disabled protocol chips for RDP/Telnet/VNC/tunnel, so RDP has a natural UI entry point.
- Existing SSH-only features include terminal/files/monitor/tunnels/Docker/MCP-controlled SSH flows. RDP must be blocked from those paths unless a feature is explicitly made protocol-aware.

## Requirements

- Add RDP as a first-class connection type alongside SSH.
- Preserve a unified connection asset experience across Windows, Linux, and macOS:
  - same connection tree/list behavior,
  - same create/edit/delete lifecycle,
  - same search/favorite/grouping behavior,
  - same sync/export redaction rules,
  - same safe metadata exposure boundaries.
- Use a long-term RDP config model in v1, including:
  - host, port, username, optional domain,
  - display mode, resolution, multi-monitor, dynamic resize capability,
  - clipboard/audio/drive/printer/smart-card/resource redirection switches,
  - gateway host and basic gateway auth behavior,
  - RemoteApp fields where supported,
  - performance/quality presets,
  - runner preference and platform capability metadata,
  - optional raw `.rdp` settings / raw runner arguments for advanced cases.
- Windows v1 should target embedded RDP tabs through MSTSC ActiveX/native hosting where technically feasible.
- Windows v1 must also provide `.rdp` generation + `mstsc.exe` fallback for unsupported/unstable embedded cases.
- Linux v1 should support FreeRDP-compatible external runners such as `xfreerdp` / `wlfreerdp` with runner discovery and setup diagnostics.
- macOS v1 should support external/custom runner configuration and `.rdp` handoff where a compatible app is configured or detected.
- Platform differences should be represented as runner capabilities, not separate connection types.
- RDP credentials should support a safe path:
  - no plaintext password in command-line args,
  - no default plaintext password in `.rdp` files,
  - saved credential integration must go through the existing credential/vault boundary or explicit OS credential integration,
  - prompt-only remains a fallback when a secure saved-credential path is unavailable.
- UI must reuse existing mXterm shared controls, Radix/Lucide patterns, global `--mx-*` tokens, and compact desktop panel/dialog style.
- RDP should not weaken existing SSH behavior, validation, or credential handling.

## Out Of Scope For This Task

- Implementing the RDP protocol from scratch.
- Copying GPL code or shipping GPL-derived implementation.
- Making Linux/macOS embedded rendering mandatory in v1.
- Passing plaintext RDP passwords through process arguments.
- Enabling SSH-only tools against RDP connections.

## Acceptance Criteria

- [ ] PRD captures the aggressive v1 strategy and platform constraints.
- [ ] Design identifies data model changes, runner abstraction, Windows embedded hosting, fallback `.rdp` generation, credentials, sync/MCP boundaries, and UI entry points.
- [ ] Implementation plan is staged enough to build the full model without a later schema/UI rewrite.
- [ ] Windows path includes embedded-session target plus automatic fallback.
- [ ] Linux/macOS paths include usable runner discovery/configuration and clear setup diagnostics.
- [ ] RDP connections cannot accidentally enter SSH-only terminal/files/monitor/tunnel/Docker command paths.
- [ ] User reviews planning artifacts before `task.py start`.

## Notes

- Local research checkout: `D:\ai_proj\_refs\rdp\1Remote`.
- Research artifact: `.trellis/tasks/06-24-rdp-connection-runner-v1/research/windows-rdp-manager-source-notes.md`.
