# 监控页原型

## Goal

Create and preserve a clickable light-neutral HTML prototype for a narrow right-side server monitoring panel, then start migrating the confirmed contract into the real React/Radix + Rust/Tauri application without changing the approved UI style.

The prototype is the source of truth for visual hierarchy, spacing, tabs, icon treatment, and interaction behavior during the real implementation.

## Requirements

- Use the existing `prototype/light-neutral/` prototype family and preserve the current mXterm light-neutral visual language.
- Fit the monitoring experience into the existing right-side panel pattern used by `prototype/light-neutral/mxterm-empty-session.html`.
- Reflect the reference image's information architecture in a compact panel form:
  - overview with host status, CPU, per-core CPU, GPU when available, memory, disk, network, and recent activity
  - network detail with traffic values, mini chart, and active connections
  - process detail with search/filter controls and process list
- Include clickable prototype interactions for switching between the monitoring views, and keep those views aligned with the later React implementation.
- Use fake but plausible monitoring data for Orange Pi / local SSH host scenarios.
- After prototype approval, implement the real frontend/backend contract incrementally while strictly preserving the prototype UI.
- Do not touch unrelated existing dirty files.

## Acceptance Criteria

- [ ] The prototype opens directly in a browser without a build step.
- [ ] The first screen clearly communicates monitoring inside the right-side mXterm panel.
- [ ] Users can click between Status, Hardware, Network, and Processes states within the narrow panel.
- [ ] Layout, spacing, typography, colors, icon treatment, and controls feel consistent with the existing light-neutral mXterm prototype.
- [ ] Text does not overlap or overflow at the prototype's target viewport sizes.
- [ ] Existing unrelated working tree changes remain untouched.

## Notes

- Existing untracked file found: `prototype/light-neutral/mxterm-monitor-panel.html`; use it as the implementation target and refine it rather than creating a separate full-page/mobile-style prototype.
- User decision: keep this as a right-side narrow monitoring panel.
- User refinement: merge the separate Resources view into Overview, and show GPU metrics when a GPU is detected.
- User refinement: when many disks/mount points exist, keep Overview compact by showing a disk summary plus the first few mount points, with a clickable expand/collapse control for the remaining disks.
- User refinement: create a separate CPU-only reference page that uses the Windows Task Manager style per-core mini chart grid layout, but keeps the mXterm light-neutral prototype visual style.
- User refinement: CPU-only reference should look like an actual mXterm right-panel component, not a standalone Windows-style card.
- User refinement: try CPU mini charts without internal grid lines, and show how the component adapts when there are only two cores.
- User refinement: CPU-only reference should default to a total CPU utilization line chart, with a switch to inspect each core; replace the `20 cores / 2 cores` demo switch with `overview / per-core`.
- User refinement: rename the main overview tab to status, and add a hardware information tab with a compact hardware-profile layout similar to Lu Master, while preserving the mXterm light-neutral panel style.
- User refinement: disk monitoring should include real-time read/write throughput, and network monitoring should show the physical primary interface name and IP while excluding virtual interfaces from the main network identity.
- User refinement: CPU monitoring should show the CPU model, GPU monitoring should support multiple cards with model names such as NVIDIA H200, and missing CPU temperature should not reserve an N/A card.
- User refinement: memory monitoring should use a donut chart to create visual differentiation from CPU/GPU bar and list layouts.
- User refinement: key metric labels, including disk capacity and mounted filesystem rows, should use subtle line icons to improve scanning without making the narrow panel visually noisy.
- User refinement: prototype icons should use the project's Lucide-style icon language instead of rough hand-drawn inline SVG paths.
- User refinement: CPU and GPU should use distinct icons so compute metrics and accelerator metrics are visually separable.
- User refinement: disk icons should avoid the cramped hard-drive glyph at small sizes; use storage-stack and volume/folder style icons that read clearly in the narrow panel.
- User refinement: when no GPU is detected, do not show GPU placeholder or empty cards; hide GPU-specific cards, rows, and sensor metrics entirely.
- User refinement: CPU should show all cores in the status card; when core count is high, keep the list inside a light internal scroll region rather than hiding cores.
- User refinement: process monitoring should support actions, with destructive operations such as ending a process requiring an explicit confirmation step.
- User decision: use the recommended defaults for refresh cadence, temperature fallbacks, disk/network selection, alert thresholds, hardware privacy, chart history range, and partial collection failure states.
- User refinement: add CPU frequency to monitoring and hardware information when it can be collected.
- User decision: do not add memory frequency for now because reliable DIMM speed collection often needs privileged or optional tools.
- User refinement: when a temperature value cannot be collected, hide that temperature card/metric instead of showing an unavailable placeholder.
- User decision: when migrating from prototype to real implementation, strictly follow the current prototype UI design, spacing, visual hierarchy, compact right-panel layout, icon treatment, and interaction model. Do not redesign or introduce a different visual style during implementation.
- User approval: begin real implementation from the confirmed prototype, with the prototype remaining the source of truth.
