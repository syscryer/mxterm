# Component Guidelines

> How components are built in this project.

---

## Overview

mXterm is a desktop-style Tauri application. Frontend UI should feel quiet,
compact, and operational rather than decorative. Prefer consistent surfaces,
small controls, clear labels, and predictable keyboard behavior.

Current UI primitives:
- Radix is the headless UI foundation already used for dialogs, context menus,
  and tooltips.
- Lucide is the icon set. Do not introduce a second icon family for ordinary UI.
- Project-specific reusable components belong in `src/shared/ui/`.

Do not add a new UI framework unless the project explicitly decides to replace
the current Radix-based approach. For example, avoid introducing shadcn/ui,
Ant Design, Mantine, or similar libraries just to fix one modal or button.

---

## Component Structure

- Feature components live under `src/features/<feature>/`.
- Cross-feature UI primitives live under `src/shared/ui/`.
- If two feature components need the same UI behavior or styling, create or
  extend a shared component first instead of copying markup and CSS.
- If the same UI component, control, or interaction appears two or more times in
  the product, it must be promoted to `src/shared/ui/` or a shared global style
  before additional feature code consumes it. Search for existing primitives
  before adding a new feature-local implementation.
- Keep business state in feature components, but keep reusable UI mechanics
  (dialog shell, confirm dialog, button variants, tooltip wrappers) in
  `src/shared/ui/`.

---

## Props Conventions

- Define explicit TypeScript interfaces for component props.
- Use controlled props for reusable UI state when practical, especially
  `open` / `onOpenChange` for dialogs.
- Reusable components should expose semantic props such as `title`,
  `description`, `confirmLabel`, and `variant` instead of leaking feature copy
  or feature state into the shared component.

---

## Styling Patterns

- Global component styling currently lives in `src/styles/app.css`, using design
  tokens from `src/styles/tokens.css`.
- Visual styling must be token-driven. Colors, backgrounds, borders, focus
  rings, state fills, shadows, and material surfaces should use the global
  `--mx-*` tokens from `src/styles/tokens.css` and shared selectors in
  `src/styles/app.css`. Avoid hard-coded colors, isolated gradients, one-off
  shadows, or feature-only state palettes unless the business semantics require
  it and the reason is documented in the review notes.
- Reuse existing dialog, action, field, icon, and tree styles before adding new
  selectors.
- Avoid one-off feature selectors for common UI patterns such as dialogs,
  buttons, confirmation prompts, empty states, and form fields.
- Modal/dialog styling should be shared: backdrop blur, border radius, shadow,
  header/footer spacing, and action buttons must stay visually consistent.
- Keep desktop tool UI compact. Use restrained shadows, 6-8px radii for controls
  and modal surfaces, and avoid heavy gradients or oversized buttons.
- Overlay surfaces should share the global glass treatment instead of carrying
  one-off feature styles. Keep glass tokens in `src/styles/tokens.css`, apply
  them through `src/styles/app.css`, and prefer reusable class pairs such as
  `context-menu-content` / `context-menu-item`, `dropdown-menu-content` /
  `dropdown-menu-item`, `select-menu-content` / `select-menu-item`, and
  `popover-content` / `popover-menu-item` for Radix portals, custom dropdowns,
  right-click menus, upload menus, and tooltips. The mXterm version should stay
  tighter and calmer than codem's large popovers: light blur, fine borders,
  modest shadow, and 7-10px radii.
- Custom select/dropdown menus that portal to `document.body` and may appear
  inside a Radix modal dialog must be wrapped with
  `DismissableLayerBranch asChild` and the menu surface must explicitly set
  `pointer-events: auto`. Without both, Radix can treat the portal as outside
  the dialog, so the menu may render but option clicks do not select.
- Business dropdowns must use shared select/menu primitives such as
  `src/shared/ui/AppSelect.tsx`, Radix menu primitives, and the global
  `select-menu-content` / `select-menu-item` style pair. Do not use native
  `<select>` for application dropdowns, and do not hand-roll feature-local menu
  popovers when a shared primitive exists.
- Compact `AppSelect` triggers that intentionally show shortened labels should
  pass `menuMinWidth` when option labels need more room. Keep the trigger sized
  for the toolbar/list row, but let the shared menu surface provide readable
  option width instead of adding feature-local menu CSS.
- Floating menu height calculations must include the menu chrome, especially
  padding and border. Do not size a menu only from option row heights; otherwise
  Windows/WebKit can show a fake scrollbar for one- or two-item menus.
- Floating menus rendered through `document.body` portals must carry their own
  light scrollbar treatment, including hidden WebKit scrollbar buttons. They do
  not inherit `.app-shell *` scrollbar rules because they sit outside the app
  shell subtree.
- Floating menus rendered through `document.body` portals and used inside modal
  scroll locks must also own wheel scrolling in the shared component. Do not
  rely on `overflow-y: auto` alone when Radix or body scroll-lock layers can
  prevent the browser's default scroll behavior.
- UI structure, visual style, color, layout, state, modal, menu, or form changes
  must be checked with the `ui-ux-pro-max` skill before implementation or final
  review. Apply its guidance through the existing mXterm desktop-tool style and
  global token system; do not introduce a separate visual system for one feature.
- Window material styling is chrome-focused. Keep the material source on the
  root `.app-shell` layer and let `.custom-titlebar` plus every left navigation
  sidebar inherit from shared `--mx-chrome-*` and `--mx-sidebar-*` tokens. Main
  workspace and settings content should use clear `--mx-panel` surfaces so text,
  terminal output, tables, and forms remain readable. When a settings navigation
  rail needs the same behavior as the workspace connection rail, add the shared
  `app-sidebar` class instead of creating a separate settings-only skin.
- For the codem-style Windows material effect, prefer transparent chrome
  surfaces over tinted sidebar panels: Mica, Acrylic, and Mica Alt should let
  `.custom-titlebar` and `.app-sidebar` reveal the native/root material layer,
  while the adjacent workspace/settings content uses an opaque panel with a
  rounded top-left corner. Do not draw internal divider lines between the
  titlebar's left chrome and the left sidebar chrome; they should read as one
  continuous material surface. This contrast is what makes the material visible.
- Chrome selection surfaces must stay neutral. Titlebar session tabs, terminal
  subtabs, right-pane tool tabs, settings segmented controls, and shared
  sidebar/settings navigation active rows should use `--mx-chrome-active` or
  `--mx-sidebar-active`; do not mix `--mx-primary` into these backgrounds.
  Reserve accent color for semantic controls such as toggles, accent swatches,
  focus rings, status badges, and destructive/primary actions.
  In Mica/Acrylic/Mica Alt material modes, `--mx-chrome-active` should stay in
  the same low-alpha neutral family as `--mx-sidebar-active` so titlebar tabs
  read as overlays on the material layer instead of opaque pills.
- Keep typography calm: default text should use regular or medium weight
  (`400`-`520`); reserve heavier weights (`600`+) for modal titles, critical
  counters, or rare primary emphasis.
- Preserve live workspace components during view switches. Home/session toggles
  should hide terminal and remote-file surfaces with stateful visibility
  classes or layout variables instead of unmounting them, so SSH sessions,
  xterm state, and remote tree state are not recreated.
- When a workspace switch should suppress visual selection in another surface,
  derive the active styling from the current workspace mode as well as the
  stored selection id. Do not let persistent "last selected" state paint
  inactive chrome as active in home/local-terminal views.
- Side panes with expandable trees must keep their own scroll container inside
  a `min-height: 0` flex/grid boundary. Expanded file trees must not grow the
  workspace grid row or change the terminal panel's measured height. Keep pane
  chrome such as tabs, path inputs, and toolbars as non-shrinking flex items;
  the tree/list body should be the only area that absorbs remaining height and
  scrolls.
- Remote file locate actions are one-way UI reveals: use the active terminal
  tab's recorded directory only to expand/highlight the folder in the file tree.
  Do not navigate into the located folder's child listing, auto-follow every
  `cd`, execute probe commands, or write `cd` back into the interactive
  terminal.
- Remote file trees keep two directory concepts separate. The tree root path
  owns the top-level listing currently rendered, while the active directory path
  owns the path input, toolbar actions, blank-area context menu, and blank-area
  drag/drop upload target. Expanding or locating a directory should update the
  active directory without forcing the tree root to navigate into that child.
- Remote file icons must be local UI, not network-loaded assets. Keep file and
  folder type mapping in `src/features/files/remoteFileIcons.ts`, render icons
  as local SVG/component markup in `RemoteFilePanel`, and run
  `node scripts/check-remote-file-local-icons-source.mjs` after changing the
  icon resolver or file tree icon styles.
- Terminal surfaces should not add decorative padding by default. If xterm
  spacing is ever needed, it must be accounted for by FitAddon; parent-only
  padding can make FitAddon over-count rows and clip the bottom terminal line at
  some window heights.
- When a backend terminal session is created before `TerminalPanel` mounts,
  keep the warmup output listener alive through the handoff and append late
  request-matched output into the tab's `warmupOutput` buffer for a short
  grace period. Stopping the listener immediately after `terminalConnect`
  resolves can drop the remote shell banner or prompt before the mounted xterm
  listener is ready, leaving newly added terminals blank. Stop the warmup
  capture as soon as the mounted `TerminalPanel` reports that its output
  listener is ready; otherwise the same late bytes can be written once through
  the live listener and again through `warmupOutput`.
- SSH and local terminals may share `terminal:output` events, but their runtime
  tab stores are separate. Late handoff output for a local terminal must append
  to `localTerminalTabs`, not the SSH `terminalTabs` store; otherwise the shell
  prompt or first echoed input can be dropped before `TerminalPanel` is ready,
  making the local terminal appear blank even though the PTY session exists.
- When `TerminalPanel` receives a pre-created `initialSessionId`, call FitAddon
  and immediately send the fitted `cols` / `rows` through `terminalResize`.
  Local ConPTY sessions are especially sensitive to this: if the backend stays
  at the open-time fallback size such as `80x24`, PowerShell can wrap or scroll
  output as a 24-row terminal while xterm renders a much taller viewport, making
  the cursor appear in the middle after commands such as `ls`.
- Window/container resize events should fit only the active xterm panel and
  debounce the backend `terminalResize` call. Dragging a desktop window can
  produce many intermediate sizes; forwarding every size to a ConPTY-backed
  full-screen or TUI command can make the child redraw repeatedly and pollute
  scrollback with duplicate screens. Hidden terminal panels must ignore
  ResizeObserver / xterm `onResize` callbacks and clear pending resize timers
  when deactivated. Initial session handoff, tab activation, and font changes
  may still use immediate sync because they are discrete events.
- `TerminalPanel` should briefly buffer startup handoff output before first
  paint so `initialOutput` and early live events are written to xterm in one
  ordered batch. If the batch contains a duplicated leading shell prompt before
  a login banner / motd and the same prompt appears again at the end, strip only
  that leading duplicate prompt line. If the duplicated prompt is joined to the
  first banner line, such as `root@host:~# Welcome to ...`, strip only the prompt
  prefix and keep the banner text. If the warmup and live listeners capture the
  same leading login banner block before the first prompt, keep one copy of that
  startup banner. If they capture the same final prompt as adjacent text on one
  line, collapse the adjacent duplicate prompt before writing to xterm.
- Terminal tab chrome spacing should live outside the xterm host, for example
  as a grid row gap between `.terminal-subtabs` and `.terminal-stack`. Do not
  add decorative padding directly to `.terminal-host` or `.terminal-panel`
  unless the FitAddon measurement is explicitly adjusted for it.
- Local terminal creation controls in the subtab strip should use a compact
  split control: `+` opens the configured default profile, and the adjacent
  icon-only chevron opens a profile menu. Do not put a wide profile select or
  "default profile" text in the terminal subtab strip; default profile changes
  belong in Settings.
- Built-in Windows PowerShell local terminal profiles should default to
  `-NoLogo -NoProfile` so the first prompt is not delayed by user profile
  scripts, prompt themes, module discovery, or network-backed initialization.
  Users who need their profile scripts can create a custom local terminal
  profile without `-NoProfile`. Keep backend discovery, workspace preview data,
  and Settings preview data aligned; `scripts/check-local-terminal-launcher-source.mjs`
  guards this contract.
- Mutually exclusive terminal workbench panes, such as SSH and local terminal
  panes, must not keep layout height while hidden. Use a pane-level hidden class
  that removes the inactive pane from layout, while keeping the actual terminal
  panels mounted inside the active/inactive pane model so xterm state is not
  recreated during workspace switches.
- SSH terminal activation must set the workspace mode to `ssh` at the same time
  it activates the connection id and terminal tab. Creating a connection step
  from the local terminal workspace cannot rely on `homeActive=false`; otherwise
  the SSH tab exists but the main workbench keeps rendering the local terminal
  pane.
- Connection flow step indicators should be driven by explicit connection
  phase state, not by the length of diagnostic logs. Retry actions must clear
  transient error details, host-key prompts, stale session IDs, and old
  progress logs before re-entering the running state so a network retry cannot
  visually jump to later steps such as opening the terminal.
- Connection failure detail cards should keep their own inner spacing. Error
  headings, cause/suggestion/code rows, and retry actions must not sit flush
  against the card edge, even when the surrounding step shell is compact.
- Connection repository system icons must go through the shared connection
  system icon component, which renders distribution logos from `simple-icons`.
  Do not hard-code generic server icons separately in the tree, table, or drag
  preview. `ConnectionProfile.remote_os_id`, `remote_os_name`, and
  `remote_os_version` are the authoritative detected distro fields and should
  be preferred before local name/notes/group inference. Connection-test and
  terminal-success flows may trigger `connectionProbeSystem` in the background;
  probe failures should not block the already successful SSH flow.
- xterm internal layers such as `.xterm-viewport` and `.xterm-screen` must use
  the same background as the terminal host. Their upstream CSS defaults to pure
  black, which creates visible right/bottom bands when FitAddon rounds the
  terminal to whole character cells.
- xterm internals must be isolated from broad app resets. Keep `.xterm` and
  descendants on `box-sizing: content-box`, and explicitly clear global
  input/textarea focus styling from `.xterm-helper-textarea`. Global
  `border-box`, focus rings, transitions, or parent-only xterm screen padding
  can desynchronize xterm's canvas, cursor, helper textarea, and IME
  composition coordinates.
- xterm must load `@xterm/addon-unicode11` and set `terminal.unicode.activeVersion`
  to `"11"` (with `allowProposedApi` enabled). xterm's default Unicode 6 width
  table disagrees with modern ConPTY (Windows 10+) on CJK/fullwidth/emoji
  widths; the mismatch desyncs the IME composition cursor and pushes TUI input
  (e.g. Claude Code, vim) to the wrong column. This is guarded by
  `scripts/check-terminal-unicode11-source.mjs`.
- Interactive PTY sessions should let the shell own carriage return / line feed
  behavior. Do not enable xterm `convertEol` for SSH or local terminals; it is
  intended for plain text streams and can cause transient cursor jumps in real
  shells such as Git Bash. For local Windows terminals backed by ConPTY, pass
  xterm's `windowsPty` compatibility option explicitly from the workspace layer,
  including the Windows build number from Tauri when available, instead of
  applying Windows heuristics to SSH terminals blindly.
- Batch terminal input tools such as Command Sender must write through the
  typed `terminalWrite(sessionId, data)` wrapper using runtime terminal tab
  session ids. Delivery status may only mean that data was written into the
  target terminal input stream; it must not claim remote command execution
  success, inspect remote output as proof, store session ids on
  `ConnectionProfile`, or log full command payloads.
- Command Sender's terminal-subtab toolbar entry should live in the far-right
  terminal action group alongside the right-pane open/close button. Keep future
  terminal-level utility buttons in the same action group instead of using
  one-off floating overlays.
- Terminal semantic highlighting should use xterm's parsed-write and decoration
  APIs (`onWriteParsed`, `registerDecoration`) against the normal buffer after
  output is written. Do not inject ANSI color sequences into `terminal.write`
  for client-only highlights: that would pollute scrollback/copy behavior and
  can break OSC parsing. Keep WebLinksAddon and OSC7/current-directory handling
  independent, and skip cells that already have ANSI foreground, inverse, or
  invisible attributes so remote output colors remain authoritative.
- Terminal output search should use xterm's official `@xterm/addon-search`
  `SearchAddon`, loaded inside `TerminalPanel`. Keep search state scoped by
  runtime tab id in the workspace layer, clear `SearchAddon` decorations when
  the search bar closes, and avoid parsing xterm DOM or scrollback manually.
  Search decoration options must satisfy xterm's `#RRGGBB` contract while being
  derived from global `--mx-*` tokens; use a local token-to-hex adapter rather
  than hard-coded feature colors.
- Scrollable app panes should use the shared light scrollbar treatment in
  `src/styles/app.css`: transparent tracks/corners, no WebKit scrollbar
  buttons/arrows, transparent thumbs by default, and only a low-alpha neutral
  thumb on hover or active drag. Keep hover thumbs subtle (around
  `rgb(100 116 139 / 10%)`) so the scrollbar does not compete with dense
  operational content. Use a narrower terminal scrollbar than ordinary side
  panes. For xterm, hide the native `.xterm-viewport` WebKit/Firefox scrollbar
  completely and style xterm's internal `.xterm-scrollable-element > .scrollbar`; keep the Terminal
  `overviewRuler` width aligned with the CSS size so FitAddon does not reserve
  a wider gutter, but hide `.xterm-decoration-overview-ruler` when the ruler is
  only used for scrollbar sizing so it cannot draw a bright edge line.
- Fixed sidebar footers should be explicit non-growing flex items. Keep the
  scrollable tree/list region as the only area that absorbs height changes.
- Native window minimum sizes belong in Tauri window configuration, not root
  CSS `min-height`. Root CSS min-height plus `overflow: hidden` can clip fixed
  footers when the embedded browser viewport is temporarily smaller than the
  intended window minimum.
- Resizable workspace panes should keep user widths in React state and expose
  them through custom CSS variables, while collapsed/home states override the
  final layout width in CSS. Use narrow transparent separator handles with a
  subtle hover line, `col-resize`, keyboard arrow support, and double-click
  reset to the default width.
- Stacked editor/terminal workspaces should treat the split handle as a drag
  target, not as a visible divider. Keep the default handle visually quiet
  (transparent or near-transparent), show only a subtle line on hover/focus or
  during dragging, and expose the split size through a CSS variable so terminal
  and editor instances remain mounted while resizing.
- Remote editor chrome should stay close to icon height. If the file name is
  already present in a tab, do not repeat it as a large title inside the editor;
  keep path, save state, and toolbar actions in a single compact row and let long
  paths truncate before controls are squeezed.
- Remote editor path chrome should show the remote absolute path only, not
  `<connectionName>:<path>`. Connection ownership belongs in tab/session state;
  the compact editor bar should prioritize the actionable path. Keep language
  mapping in `src/features/editor/remoteFileLanguages.ts`, register lightweight
  Monaco tokenizers there for common config formats, and run
  `node scripts/check-remote-editor-language-source.mjs` after changing editor
  path display or remote language detection.

---

## Accessibility

- Use Radix primitives for dialogs, menus, and tooltips so keyboard behavior and
  ARIA wiring remain reliable.
- Icon-only buttons must have `aria-label` and, when helpful, a tooltip.
- Do not remove visible focus states. If browser defaults look wrong, replace
  them with a project-consistent focus ring.
- Dialogs that contain user input should not close when clicking the backdrop
  unless the flow explicitly supports safe dismissal.

---

## Common Mistakes

- Do not hand-roll a modal in a feature file when Radix Dialog is already in use.
- Do not use `window.confirm`; use the shared confirmation dialog.
- Do not style each feature's buttons independently. Add or reuse a shared
  button/action style so primary, secondary, and danger actions stay consistent.
- Do not fix visual issues by scattering small CSS patches across unrelated
  selectors. First decide whether the issue belongs in a shared component,
  shared style block, or feature-specific rule.
- Do not spread window material backgrounds across every card, table, dialog, or
  settings panel. The material mode should be visible in the app chrome, while
  dense work surfaces stay opaque enough to read.
- Do not let broad chrome/sidebar child selectors override overlay mechanics.
  Rules such as `.app-sidebar > * { position: relative; z-index: 1; }` must
  exclude fixed drag previews, floating overlays, or portal-like layers; otherwise
  previews can become normal in-flow children and get clipped by sidebar
  `overflow: hidden`.
