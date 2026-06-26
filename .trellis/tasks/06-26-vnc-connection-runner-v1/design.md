# VNC Connection Runner v1 Design

## Direction

VNC should ship as an embedded-first protocol, not as an external launcher. The main implementation uses noVNC in the React surface and a Rust-owned local WebSocket bridge to the target VNC TCP server. External VNC viewers remain fallback/diagnostic runners for environments where embedded viewing is not possible.

## Connection Model

Extend the existing protocol discriminator:

```text
ConnectionProtocol = "ssh" | "rdp" | "vnc"
```

Add optional VNC config beside `rdp`:

```text
VncConnectionConfig
  display: VncDisplayConfig
  input: VncInputConfig
  performance: VncPerformanceConfig
  security: VncSecurityConfig
  runner: VncRunnerConfig
  raw_runner_args?: string
```

Suggested fields:

```text
VncDisplayConfig
  scale_mode: "fit" | "stretch" | "actual"
  resize_session: boolean
  show_clip_viewport: boolean

VncInputConfig
  view_only: boolean
  clipboard: boolean
  shared: boolean

VncPerformanceConfig
  preset: "auto" | "quality" | "balanced" | "low_bandwidth"
  quality_level?: number
  compression_level?: number

VncSecurityConfig
  credential_mode: "prompt" | "saved"

VncRunnerConfig
  render_mode: "embedded" | "external" | "custom"
  preferred_runner?: "novnc" | "vncviewer" | "tigervnc" | "realvnc" | "custom"
  custom_executable?: string
  custom_args_template?: string
```

The shared connection credential fields remain the actual vault boundary:

- `credential_mode=prompt`: frontend prompts at session launch when no saved/inline password is available.
- `credential_mode=inline`: existing inline password storage in vault.
- `credential_mode=saved`: existing saved password credential.
- Private-key credentials are invalid for VNC.

## Storage

SQLite `connections` already has `protocol` and `rdp_json`. Add:

- `vnc_json TEXT`

Existing rows default to SSH when protocol is missing. New VNC rows store `protocol='vnc'`, clear SSH proxy/jump assumptions for v1, and persist VNC JSON.

Storage/sync/MCP redaction rules:

- Include protocol and non-secret VNC config.
- Never export inline/saved password material.
- Do not expose bridge tokens or WebSocket URLs through sync/MCP.

## Backend Commands

Add typed Tauri commands:

```text
vnc_launch_connection(connection_id) -> VncLaunchResult
vnc_preview_launch(connection_id) -> VncLaunchPreview
vnc_test_runner(config?) -> VncRunnerProbeResult
vnc_close_session(session_id) -> VncSessionCloseResult
```

The launch command resolves the saved connection, starts an embedded bridge or selects fallback runner, and returns frontend-renderable session data.

## Embedded Bridge

Rust owns bridge lifetime:

1. Resolve saved VNC profile and optional password through `StorageRepository`.
2. Bind a TCP listener on `127.0.0.1:0`.
3. Generate a per-session random token and WebSocket path.
4. On one authorized WebSocket upgrade, connect to target `{host}:{port}` over TCP.
5. Relay binary WebSocket frames to TCP and TCP bytes back to WebSocket binary frames.
6. Close bridge on frontend close, disconnect, or process shutdown.

The bridge should not:

- bind to external interfaces,
- accept arbitrary paths,
- log passwords or target secrets,
- persist WebSocket URLs or tokens.

## Frontend Embedded Viewer

Add a VNC session component that:

- imports `RFB` from `@novnc/novnc`,
- creates the `RFB` instance when launch returns `runner="novnc"` and `embedded=true`,
- applies `scaleViewport`, `resizeSession`, `clipViewport`, `viewOnly`, `qualityLevel`, and `compressionLevel`,
- sends credentials through constructor options or `sendCredentials(...)`,
- handles `connect`, `disconnect`, `credentialsrequired`, `securityfailure`, `desktopname`, and `clipboard` events,
- exposes toolbar actions such as reconnect, disconnect, send Ctrl+Alt+Del, and copy preview/diagnostic info.

Workspace behavior:

- Same saved VNC connection activates the existing VNC tab instead of creating duplicates.
- VNC tab state lives in runtime React state only.
- VNC workspace mode can share the current RDP session shell styling where appropriate, but VNC-specific rendering should be a real embedded surface.

## External Runner Fallback

Probe common viewers:

- Windows: `vncviewer.exe`, TigerVNC installed locations when discoverable, custom path.
- Linux: `vncviewer`, `xtigervncviewer`, `tigervnc-viewer`, custom path.
- macOS: configured custom executable/app path in v1.

External launch should pass only host/port and non-secret viewer flags. Passwords must be prompted by the external viewer until a future secure handoff contract is designed.

## UI

Connection dialog:

- Enable VNC protocol chip.
- Basic tab keeps host, port, username/password credential fields.
- VNC tab contains:
  - embedded/external/custom runner selector,
  - scale mode,
  - resize remote session,
  - view-only,
  - shared session,
  - clipboard,
  - performance preset and explicit quality/compression controls,
  - custom runner fields when selected.

Workspace:

- VNC session tabs appear in the same workbench family as terminal/RDP.
- The right pane shows VNC runner facts, bridge state, connection address, display mode, and non-secret preview material.
- SSH-only tools are hidden/disabled for VNC.

Style:

- Use existing compact desktop panel style.
- Use Lucide icons.
- Use `AppSelect` and shared form row/button classes.
- Use global `--mx-*` tokens and avoid one-off color systems.

## Security

- noVNC password is launch-time memory only.
- External runner preview and commands are redacted.
- WebSocket bridge URL is local and tokenized.
- Bridge is session-scoped and stops on close.
- VNC does not run SSH-only terminal/file/monitor/tunnel/Docker/Command Sender commands.

## Rollback

If embedded noVNC bridge is unstable, keep VNC rows and UI but default runtime to external runner diagnostics. The schema and dialog should remain because they are valid long-term model pieces.
