# Fix VNC unreachable target timeout

## Goal

Fix the VNC embedded runner so an unreachable VNC target does not leave the workspace stuck in a perpetual connecting state.

## Requirements

- When a VNC target such as `192.168.31.49:5900` is unreachable, the local bridge must fail within a short, deterministic timeout instead of waiting for the operating system TCP timeout.
- The frontend VNC tab must transition from connecting to a visible failure state when noVNC disconnects before a successful connection.
- The failure message should tell the user the likely target/port problem without exposing bridge tokens, passwords, or other sensitive runtime data.
- Existing successful VNC connections must keep using the same embedded noVNC bridge path.
- External/custom VNC runner behavior is out of scope for this bug fix.
- Embedded VNC input should remain usable against macOS Screen Sharing hosts; local viewport behavior must not steal mouse drags or desynchronize pointer coordinates.
- VNC should offer a runner-host display mode that reuses the RDP-style child-window experience while keeping the built-in noVNC bridge and saved-password memory handoff.
- noVNC should remain usable when the remote cursor is transparent or unavailable by showing a local dot cursor.
- noVNC wheel input should feel usable on macOS Screen Sharing by normalizing high-resolution wheel deltas into bounded VNC wheel pulses instead of relying on noVNC's single-step-per-event behavior.
- The built-in noVNC path should prefer low-latency LAN defaults: avoid high compression by default, keep quality high enough for local networks, and make the local WebSocket/TCP bridge minimize packet latency.
- VNC runner-host top-right close control must close the runner host window itself while notifying the main workspace exactly once, so the main VNC tab and child-window tab cannot get stuck half-closed.

## Acceptance Criteria

- [x] Unreachable VNC target fails visibly instead of staying in connecting.
- [x] Backend bridge uses an explicit TCP connect timeout.
- [x] Frontend treats a pre-connect noVNC disconnect as an error state.
- [x] VNC tests cover timeout/error path where practical.
- [x] `npm run check`, Rust format/check, and targeted VNC tests pass.
- [x] macOS Screen Sharing VNC sessions keep mouse drags mapped to the remote desktop and avoid app-side canvas scaling that can make the pointer feel off.
- [x] VNC render mode can open/reuse an RDP-style runner host window without putting bridge URLs, tokens, or passwords in the URL or persisted config.
- [x] noVNC enables a dot cursor so the pointer remains visible over macOS Screen Sharing sessions with hidden/transparent remote cursors.
- [x] VNC wheel handling accelerates high-resolution wheel/trackpad deltas with a bounded pulse count so scrolling is less sluggish without flooding the server.
- [x] VNC bridge and noVNC defaults are tuned for LAN use before considering a native/external hosted viewer path.
- [x] VNC runner-host tab close and top-right window close actions clean up both the child-window session and the parent workspace tab without leaving an unclosable runner window.

## Notes

- Observed local diagnosis: mXterm opened local bridge ports, but direct TCP probing of `192.168.31.49:5900` timed out and no established remote TCP connection was present for the mXterm process.
- Later testing against `192.168.31.152:5900` showed the port reachable, but ICMP over Wi-Fi had visible jitter; if the noVNC path remains less responsive than expected after low-latency bridge tuning, the next product step should be a native or externally hosted VNC viewer mode rather than continuing to tune wheel multipliers.
- A RealVNC Viewer comparison showed similar scroll/drag sluggishness against the same macOS target, so the remaining "jelly" feel is likely outside the noVNC bridge alone. Avoid further aggressive wheel amplification unless a noVNC-only regression is isolated.
