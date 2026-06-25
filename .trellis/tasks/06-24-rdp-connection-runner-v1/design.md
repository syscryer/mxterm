# RDP Connection Runner v1 Design

## Direction

RDP v1 should be built as the long-term RDP foundation, not a temporary launcher. The saved connection model, frontend forms, open behavior, runner capability contract, and security boundaries should be close to final shape from the first implementation.

The target is platform-adaptive:

- Windows: embedded RDP session tab through MSTSC ActiveX/native hosting when supported, with `.rdp` + `mstsc.exe` fallback.
- Linux: FreeRDP-compatible external runner path with discovery, preview, and diagnostics.
- macOS: external/custom runner and `.rdp` handoff path with explicit configuration and diagnostics.
- Future: IronRDP/FreeRDP embedded experiments can plug into the same runner contract without changing the connection schema.

## Architecture

### Connection Protocol Model

Current `ConnectionProfile` is SSH-shaped. Add a protocol discriminator instead of overloading SSH-only fields:

```text
ConnectionProtocol = "ssh" | "rdp"
```

Shared fields remain `id`, `name`, `group`, `host`, `port`, `username`, `notes`, `is_favorite`, timestamps, and credential references where appropriate.

RDP-specific fields should live under an optional `rdp` object:

```text
RdpConnectionConfig
  domain?: string
  display: RdpDisplayConfig
  resources: RdpResourceConfig
  gateway?: RdpGatewayConfig
  remote_app?: RdpRemoteAppConfig
  performance: RdpPerformanceConfig
  security: RdpSecurityConfig
  runner: RdpRunnerConfig
  raw_rdp_settings?: string
  raw_runner_args?: string
```

Suggested nested contracts:

```text
RdpDisplayConfig
  mode: "embedded" | "windowed" | "fullscreen" | "all_monitors"
  width?: number
  height?: number
  dynamic_resize: boolean
  use_multimon: boolean

RdpResourceConfig
  clipboard: boolean
  audio: "local" | "remote" | "disabled"
  drives: boolean
  printers: boolean
  smart_cards: boolean

RdpGatewayConfig
  mode: "disabled" | "auto" | "explicit"
  host?: string
  credential_source?: "same" | "prompt"

RdpRemoteAppConfig
  enabled: boolean
  program?: string
  working_dir?: string
  args?: string

RdpPerformanceConfig
  preset: "auto" | "lan" | "balanced" | "low_bandwidth"
  desktop_background: boolean
  font_smoothing: boolean
  visual_styles: boolean

RdpSecurityConfig
  credential_mode: "prompt" | "saved" | "os_store"
  nla: "auto" | "enabled" | "disabled"
  certificate_policy: "trust" | "prompt" | "strict"

RdpRunnerConfig
  render_mode: RdpRenderMode
  preferred_runner?: RdpRunnerKind
  custom_executable?: string
  custom_args_template?: string
```

Runner vocabulary:

```text
RdpRenderMode = "embedded" | "external" | "custom"
RdpRunnerKind = "mstsc_activex" | "mstsc" | "freerdp" | "macos_app" | "custom"
```

`mstsc_activex` is Windows-only. Other platforms keep the same config shape but resolve to their supported external/custom runner.

### Storage

SQLite `connections` currently stores SSH-specific columns plus JSON columns for proxy/jump/advanced. Add a minimal forward-compatible migration:

- `protocol TEXT NOT NULL DEFAULT 'ssh'`
- `rdp_json TEXT`

Existing rows default to `ssh`. Repository read/write paths must validate by protocol:

- SSH rows keep existing SSH validation.
- RDP rows validate shared host/port/name fields plus `rdp_json`.
- SSH-only JSON columns remain ignored for RDP unless a future feature explicitly shares them.

Sync export/import and MCP redacted connection output should include `protocol` and non-secret RDP metadata only.

### Backend Commands

Add typed Tauri commands:

```text
rdp_launch_connection(connection_id) -> RdpLaunchResult
rdp_preview_launch(connection_id) -> RdpLaunchPreview
rdp_test_runner(config?) -> RdpRunnerProbeResult
rdp_close_session(session_id) -> RdpSessionCloseResult
rdp_resize_embedded_session(session_id, bounds) -> RdpSessionResizeResult
```

`rdp_launch_connection` resolves the connection, probes runner capabilities, chooses the best runner, launches the session, and returns a result that the UI can render as an embedded tab or external-launch status.

`rdp_preview_launch` returns redacted generated material:

- Windows fallback: `.rdp` content with secret lines omitted.
- Linux/macOS/custom: executable plus redacted args.
- Embedded Windows: resolved capability summary, not raw credential material.

`rdp_test_runner` should return capabilities:

```text
RdpRunnerProbeResult
  platform: "windows" | "linux" | "macos" | "unknown"
  available_runners: RdpRunnerKind[]
  default_runner?: RdpRunnerKind
  supports_embedded: boolean
  supports_remote_app: boolean
  supports_dynamic_resize: boolean
  setup_hint?: string
```

### Runner Selection

Runner selection should be deterministic:

1. If the connection requests `custom`, use custom runner validation.
2. On Windows with `render_mode=embedded`, prefer `mstsc_activex` when the host environment supports it.
3. If embedded is unavailable or the profile requires a fallback-only feature, use `.rdp` + `mstsc.exe`.
4. On Linux, prefer `wlfreerdp` on Wayland when available, otherwise `xfreerdp`.
5. On macOS, use configured app/custom runner; optionally hand off a temporary `.rdp` file to the configured app.
6. If no runner exists, return a setup diagnostic instead of silently failing.

Fallback-only cases on Windows include mixed-DPI multi-monitor fullscreen, RemoteApp when embedded support is incomplete, unsupported COM initialization, and user-selected external mode.

### Windows Embedded Hosting

The Windows embedded path should be implemented behind a native-host abstraction, not mixed into React components.

Conceptual flow:

1. React opens an RDP session tab and creates a stable viewport element.
2. The frontend reports the viewport window handle/bounds or a host descriptor through Tauri.
3. The Rust backend/native Windows module creates or attaches a child native window for the MSTSC ActiveX host.
4. The host applies RDP settings, credentials from the approved in-memory path, resource redirects, gateway, performance, and display options.
5. Resize/focus/tab lifecycle events flow through explicit commands/events.
6. Disconnect/error events return to the frontend as session state.

The implementation must be feature-gated to Windows. If the native host cannot initialize, the same connection should fall back to `.rdp` + `mstsc.exe` with a visible reason.

Key risks:

- Tauri/webview window handle access and child-window parenting.
- Focus handling between webview and native child window.
- DPI and resize behavior.
- COM/ActiveX lifecycle cleanup.
- Preventing hidden native windows after tab close/app exit.

### Windows `.rdp` Fallback

Generate a backend-owned temporary `.rdp` file under app temp space.

Minimum settings:

```text
full address:s:<host>:<port>
username:s:<username>
domain:s:<domain>
screen mode id:i:<1|2>
desktopwidth:i:<width>
desktopheight:i:<height>
use multimon:i:<0|1>
redirectclipboard:i:<0|1>
audiomode:i:<0|1|2>
redirectdrives:i:<0|1>
redirectprinters:i:<0|1>
redirectsmartcards:i:<0|1>
gatewayhostname:s:<gateway>
gatewayusagemethod:i:<0|1|2>
gatewaycredentialssource:i:4
prompt for credentials:i:<0|1>
```

Merge validated `raw_rdp_settings` last so advanced users can override generated values. Reject malformed lines, control characters, and settings that would write plaintext secrets unless explicitly supported through a safe credential design.

Certificate policy maps to mstsc `authentication level` explicitly:

- `trust` -> `authentication level:i:0`, continue without warning when server authentication fails.
- `prompt` -> `authentication level:i:2`, warn and let the user continue; this is the default because self-signed Windows/cloud RDP certificates are common.
- `strict` -> `authentication level:i:1`, fail the connection when server authentication cannot be verified.

Temporary files should be deleted after a short delay. Launch errors must include executable path and platform-level reason without exposing secrets.

### Linux Runner

Prefer FreeRDP-compatible commands:

```text
xfreerdp /v:<host>:<port> /u:<username> /d:<domain> /dynamic-resolution /clipboard
wlfreerdp /v:<host>:<port> /u:<username> /d:<domain> /dynamic-resolution /clipboard
```

Do not pass plaintext passwords in command-line args. Let the client prompt unless a future secure credential bridge is explicitly implemented.

Runner discovery should check common binary names and allow custom path override. Missing runner should produce a setup message and keep the saved connection valid.

### macOS Runner

macOS should use a custom/external runner contract. Do not hard-code assumptions about a specific app's private CLI behavior. The model should support:

- configured executable/app path,
- argument template,
- temporary `.rdp` file handoff,
- preview and validation,
- clear setup diagnostics.

### Credentials

Aggressive v1 should include the data model for saved credentials but keep transport rules strict:

- `credential_mode=prompt` is always supported.
- `credential_mode=saved` uses existing mXterm credential/vault boundaries.
- `credential_mode=os_store` is platform-specific and must require explicit user action before writing OS credentials.
- No plaintext password in command-line args.
- No default plaintext password in `.rdp` files.
- Windows embedded mode may pass credentials in memory to the native control only after credential resolution succeeds.
- External runner fallback may still prompt when secure credential handoff is unavailable.

### UI

Before real React implementation, update the existing prototype surface at `prototype/light-neutral/mxterm-empty-session.html` to validate the RDP flow:

- connection tree RDP entries,
- create/edit dialog protocol switch,
- RDP-specific tabs/sections,
- runner capability status,
- embedded/external mode selector,
- preview launch,
- missing runner/error states,
- external launch status tab,
- embedded Windows tab state.

Real UI should then reuse existing patterns:

- `ConnectionDialog` protocol chips activate RDP.
- RDP form uses shared inputs, `AppSelect`, shared checkboxes/toggles, Radix menus, Lucide icons, and global tokens.
- Connection list shows protocol icon and RDP address formatting.
- Double-click/open chooses RDP launch rather than terminal session.
- RDP session tab shows embedded view when available; external runners show launch status and controls.
- SSH-only context menu actions are hidden/disabled for RDP.

### Compatibility And Boundaries

- SSH terminal/files/monitor/tunnels/Docker commands must reject non-SSH connections at the backend boundary.
- Command Sender remains SSH/local only unless separately made protocol-aware.
- MCP exposes RDP metadata only under existing metadata exposure controls; no secrets.
- Sync includes RDP connections and redacted metadata only.
- Existing SSH rows and behaviors must remain unchanged except for default `protocol='ssh'`.

## Tradeoffs

- Aggressive scope reduces future schema/UI churn but raises first-implementation risk.
- Windows embedded mode gives the closest desktop-manager experience but is Windows-only and native-host heavy.
- External runners keep Linux/macOS viable while preserving one connection model.
- Credential convenience must not override security; prompt fallback is acceptable when secure handoff is unavailable.

## Implementation Feasibility Checks

- Confirm the exact Windows native-host implementation path after inspecting handle access and lifecycle behavior inside the current Tauri app.
- Enable `credential_mode=saved` only through existing mXterm credential/vault boundaries; otherwise keep the model and default affected runners to prompt mode.
- Detect macOS app handoff when safely testable; otherwise keep explicit custom runner configuration as the guaranteed macOS v1 path.
