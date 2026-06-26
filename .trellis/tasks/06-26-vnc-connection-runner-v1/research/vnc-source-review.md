# VNC Source Review

## Local Source Checkouts

- `D:\ai_proj\_refs\vnc\noVNC`
  - Revision: cloned from `https://github.com/novnc/noVNC.git`
  - License: MPL-2.0 for core library, with permissive licenses for bundled non-core assets.
  - Relevant API: package `@novnc/novnc` exports `core/rfb.js`.
- `D:\ai_proj\_refs\vnc\guacamole-client`
  - Revision: `83826a6`
  - License: Apache-2.0.
  - Relevant areas: `guacamole-common-js` display/tunnel/client layering.
- `D:\ai_proj\_refs\vnc\tigervnc`
  - Revision: `99d31f0`
  - License: GPL-2.0.
  - Use only for behavioral/compatibility observations; do not copy source.

## noVNC

noVNC provides a browser-side `RFB` object. It connects to a WebSocket that carries a standard RFB stream, so mXterm needs a local TCP-to-WebSocket bridge when the target VNC server exposes normal TCP port `5900+`.

Important API observations:

- Constructor: `new RFB(targetElement, websocketUrlOrChannel, options)`.
- Credentials are passed as `options.credentials` or later through `sendCredentials(...)` after `credentialsrequired`.
- Useful session properties:
  - `viewOnly`
  - `scaleViewport`
  - `resizeSession`
  - `clipViewport`
  - `qualityLevel`
  - `compressionLevel`
- Useful events:
  - `connect`
  - `disconnect`
  - `credentialsrequired`
  - `securityfailure`
  - `clipboard`
  - `desktopname`
- Useful commands:
  - `disconnect()`
  - `focus()`
  - `sendCtrlAltDel()`
  - `clipboardPasteFrom(...)`

Fit for mXterm:

- Good fit for the embedded-first experience because it renders directly in the WebView.
- It keeps protocol complexity out of mXterm while still allowing native desktop tab integration.
- The bridge can be owned by Rust, so browser code never opens arbitrary raw TCP.
- MPL-2.0 is acceptable as a dependency with license notices preserved.

## Apache Guacamole

Guacamole's browser client validates a display/tunnel split: the web client renders and handles input, while a server-side component brokers protocol traffic. Its JavaScript display model tracks canvas layers, cursor, scaling, and resize events.

Fit for mXterm:

- Useful architecture confirmation for keeping protocol transport behind a backend-controlled tunnel.
- Not a direct drop-in because Guacamole's browser client speaks the Guacamole protocol, not raw RFB over WebSocket.
- Apache-2.0 is friendly, but no direct source reuse is needed for v1.

## TigerVNC

TigerVNC documents mature viewer behavior:

- External viewer accepts host/display or host/port.
- Supports `.tigervnc` config files.
- Has automatic encoding/pixel-format selection.
- Supports fullscreen, all-monitor fullscreen, clipboard toggles, compression, quality, and `DesktopSize` remote resize when the server supports it.
- Can read `VNC_USERNAME` / `VNC_PASSWORD` environment variables, but mXterm should not rely on environment plaintext in v1.

Fit for mXterm:

- Use only for external runner vocabulary and compatibility expectations.
- GPL-2.0 source must not be copied into mXterm.
- External runner fallback should generate redacted command previews and avoid plaintext password args/env.

## Recommended Direction

1. Primary path: noVNC embedded viewer plus Rust local WebSocket bridge.
2. Fallback path: external viewer detection and redacted launch preview.
3. Credentials: prompt, inline vault, or saved password; pass secrets only in memory to embedded noVNC.
4. Security: bridge binds only to `127.0.0.1`, uses a per-session token/path, and tears down on close.
5. UI: reuse RDP session shell concepts, but render an actual WebView/DOM VNC surface instead of a native-child window.
