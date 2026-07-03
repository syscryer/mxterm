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

## Keyboard Shortcut Infrastructure

- Application-level keyboard shortcuts must use `src/features/shortcuts/`.
  Define action metadata and default bindings in `shortcutRegistry.ts`, parse
  and format bindings through `shortcutKeys.ts`, and validate conflicts /
  reserved terminal keys through `shortcutValidation.ts`.
- Runtime shortcut handling should be wired through `useShortcutManager`.
  Feature components should provide action handlers, while the shortcut module
  owns key matching and terminal/input focus guards. Do not add new scattered
  `window.addEventListener("keydown", ...)` handlers for application commands.
- Persist user shortcut overrides through `settings.shortcuts.bindings`.
  `null` means the user intentionally disabled that action, so UI and runtime
  code must not fall back to the default binding when a binding key exists with
  a `null` value.
- Display shortcut labels with the shared `src/shared/ui/Keybinding.tsx`
  component. Do not hand-roll separate `<kbd>` styling in feature components;
  extend the shared component or global keybinding classes when a new compact
  variant is needed.
- Terminal focus is a special boundary. Shortcuts that run while xterm is
  focused must be explicitly marked `allowInTerminal`; ordinary shell/readline
  combinations such as `Ctrl+C`, `Ctrl+L`, or `Ctrl+A` must remain reserved for
  the terminal and rejected by shortcut validation.
- Terminal `Ctrl+C` / `Cmd+C` must branch on the xterm selection state. When
  `TerminalPanel` has an active selection, copy `terminal.getSelection()` through
  the shared clipboard helper and stop the key event before it reaches the PTY.
  When there is no selection, let xterm continue normally so shells and remote
  processes still receive interrupt.

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
- Light mode is the default development baseline, but every new or changed UI
  component must be checked against explicit dark mode and system-dark mode at
  the same time. Do not ship a light-only surface, hover state, border, shadow,
  form control, list row, toolbar, or action button. If a visual value needs
  theme-specific behavior, define it through global `--mx-*` tokens or scoped
  `.app-shell[data-theme-mode="dark"]` / system-dark rules in `src/styles/app.css`.
- Visual styling must be token-driven. Colors, backgrounds, borders, focus
  rings, state fills, shadows, and material surfaces should use the global
  `--mx-*` tokens from `src/styles/tokens.css` and shared selectors in
  `src/styles/app.css`. Avoid hard-coded colors, isolated gradients, one-off
  shadows, or feature-only state palettes unless the business semantics require
  it and the reason is documented in the review notes.
- The product visual language is an Apple-style frosted glass desktop surface.
  Keep material behavior centralized in the global token system
  (`--mx-material-*`, `--mx-chrome-*`, `--mx-sidebar-*`, panel, line, active,
  and overlay tokens). Feature components must not create their own glass,
  acrylic, blur, shadow, or translucent palette. Chrome and navigation can show
  the frosted material; dense work surfaces should still use readable global
  panel tokens.
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
- Titlebar overflow menus should reuse the existing connection-search dialog
  shell and titlebar tool button styling instead of inventing a separate chrome
  surface. Keep a small fixed set of visible session tabs, pin the active
  session into that set when overflow happens, and move the remaining sessions
  into a compact body-ported `⋯` menu. Do not leave the titlebar as an
  unbounded horizontal scroller once tabs exceed the visible cap.
- Radix portals render outside `.app-shell` by default, so they must receive the
  same theme context through `document.body`. `WorkspaceShell` owns the body
  `data-theme-mode`, `data-window-material`, density/platform attributes, and
  settings-derived CSS variables used by portal surfaces. When adding a new
  portal dialog, menu, popover, or floating picker, verify its dark/system-dark
  styles can match both `.app-shell[data-theme-mode=...]` and
  `body[data-theme-mode=...]`; do not rely on app-shell-only inheritance.
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
- macOS window chrome keeps Tauri decorations disabled and uses custom traffic
  lights inside `AppTitlebar`. Scope traffic-light layout, rounded transparent
  window clipping, and hidden right-side window controls to
  `.app-shell[data-platform="macos"]` so Windows keeps its existing Mica/custom
  control behavior. Do not switch macOS to a native decorated titlebar without a
  design review because it changes the app tabbar and window-layout contract.
- macOS transparent-window glass should prefer the native Tauri window material
  plus token-driven translucent fills. Avoid large-area CSS `backdrop-filter`
  blur on the root chrome, sidebars, or content panels; it can trigger visible
  resampling/shimmer during live window drag on macOS.
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
- Terminal current-directory fallback should only resolve complete user input
  that can be reconstructed locally, such as a simple typed `cd /path` line.
  If the line contains Tab completion, history navigation, cursor editing, or
  other control/escape input, do not guess the final directory from the partial
  bytes sent to the PTY. Keep the last trusted directory and wait for OSC7, a
  later complete `cd` line, or a locate-time snapshot of a high-confidence
  shell prompt line such as `user@host:/path$` instead. Prompt parsing must
  stay locate-on-demand and conservative: it may inspect a few already-rendered
  xterm buffer lines when the user clicks locate, but it must not inject
  probes, add per-output parsing work, hide output, or parse arbitrary command
  output.
- Remote file trees keep two directory concepts separate. The tree root path
  owns the top-level listing currently rendered and should stay on the full
  tree root for the session, while the active directory path owns the path
  input, toolbar actions, blank-area context menu, and blank-area drag/drop
  upload target. Typing a path, locating a folder, or locating the terminal
  directory should expand the tree down to that path and update the active
  directory, not replace the visible tree with only that child directory's
  listing. These explicit reveal actions should also scroll the rendered target
  folder row into view after async ancestor loads complete; ordinary manual tree
  expand/collapse should not auto-scroll or replay an earlier pending reveal.
- Remote file selection should stay compatible with the tree's directory
  navigation model. Plain directory-row clicks expand/collapse and update the
  active directory; selection uses Explorer-style modifiers (`Ctrl` / `Meta` to
  toggle, `Shift` to range-select visible rows). Bulk selection actions belong
  in the selected row context menu, not in a persistent toolbar/action bar,
  unless the product explicitly changes the right-pane interaction model.
- Remote file directory loads may overlap during startup, refresh handoff, and
  locate actions. Keep a current entries ref in sync with state, and do not let
  a stale non-forced auto-load failure display a global error after another
  concurrent request has already populated that same path. Forced refresh
  failures should still surface because they represent the user's latest
  explicit action. Refresh handoff payloads must be scoped by connection id, and
  `RemoteFilePanel` must ignore refresh requests from any connection other than
  the one it is currently rendering.
- Remote file icons must be local UI, not network-loaded assets. Keep file and
  folder type mapping in `src/features/files/remoteFileIcons.ts`, render icons
  as local SVG/component markup in `RemoteFilePanel`, and run
  `node scripts/check-remote-file-local-icons-source.mjs` after changing the
  icon resolver or file tree icon styles.
- Remote file file-name special cases shared by file icons and Monaco language
  detection, such as `Dockerfile` and prefixed `*.Dockerfile` names, must use
  `src/shared/remoteFiles/fileNames.ts` instead of duplicating suffix logic in
  `remoteFileIcons.ts` and `remoteFileLanguages.ts`. After changing these
  matchers, run both `node scripts/check-remote-file-local-icons-source.mjs`
  and `node scripts/check-remote-editor-language-source.mjs`.
- Terminal surfaces should not add decorative padding by default. If xterm
  spacing is ever needed, it must be accounted for by FitAddon; parent-only
  padding can make FitAddon over-count rows and clip the bottom terminal line at
  some window heights.
- When a backend terminal session is created before `TerminalPanel` mounts,
  keep the warmup output listener alive through the handoff and append late
  request-matched output into the tab's `warmupOutput` buffer for a short
  grace period. Stopping the listener immediately after `terminalConnect`
  resolves can drop the remote shell banner or prompt before the mounted xterm
  listener is ready, leaving newly added terminals blank. During the brief
  startup buffer, the mounted `TerminalPanel` must ignore live
  `initialRequestId` output so those bytes have a single owner: the warmup
  `initialOutput` path. Stop warmup capture only after both conditions are true:
  the startup buffer has flushed and the mounted output listener is ready;
  otherwise the same late bytes can be written once through the live listener
  and again through `warmupOutput`.
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
- Terminal content gutters should live on `.terminal-host .xterm`, not on
  `.terminal-host` or `.xterm-screen`. FitAddon subtracts padding on the xterm
  element when proposing cols, so this preserves the left visual inset without
  desynchronizing the canvas, cursor, helper textarea, or IME coordinates.
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
- Connection search, quick-open entries, and connection recency ordering should
  use `src/features/connections/connectionSearch.ts`. Do not add local timestamp
  parsing, recent-sort comparators, or search text builders in `ConnectionPane`,
  `WorkspaceShell`, or future connection pickers; extend the shared utility and
  update `scripts/check-connection-quick-search-source.mjs` instead.
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
- Command Sender snippets and history are assistance around terminal input
  streams. Active sends may record history after at least one `terminalWrite`
  target succeeds. Optional terminal input history must default to disabled and
  may only record successful Enter-submitted printable lines after conservative
  filtering; it must not parse shell history, inject shell hooks, record
  passwords/TUI keystrokes, or store target session ids / connection ids.
- Command history filtering should use persisted scope metadata, not runtime tab
  ids. SSH history scopes are connection ids, local terminal scopes are profile
  ids. The right-pane history view may show a flat scope selector, but the
  terminal-input recording switch belongs in Settings so it remains a global
  behavior rather than a per-pane toggle.
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
- Do not let broad macOS workspace containers such as `.connection-home-body`
  or `.main-workbench` carry a full `--mx-panel` fill. Put the glass/material on
  the shared outer surface, then keep tables, cards, forms, and terminal panes
  readable with the normal panel/terminal tokens.

## Performance Boundaries

- Tauri release startup should keep the native window hidden until the remembered
  size/position and startup theme tokens have been applied. `main.tsx` should
  run lightweight startup work before rendering and before showing the window;
  avoid static `App` imports in the entry file when they would parse the full
  workspace module graph before that startup work. Load the app shell
  dynamically, restore/show the current window through shared Tauri helpers, and
  keep first-visible theme data on `document.body` in sync with
  `WorkspaceShell`. After the window state is restored, `main.tsx` should render
  only the lightweight `App` shell; route/view modules such as `WorkspaceShell`
  and VNC runner should be `React.lazy` components inside `App` so the remembered
  window can appear before the full workspace chunk finishes parsing.
- Heavy feature dependencies and large static datasets must stay out of the
  startup path. Use dynamic imports at the first real feature boundary, or an
  idle-task preload after the initial workspace has settled. Do not import
  rarely used viewers, editors, or catalog-sized settings data at
  `WorkspaceShell` module scope. Keep `TerminalPanel` and xterm addons out of
  `WorkspaceShell` module scope as well; wrap terminal render sites in
  `Suspense` and use the existing terminal status panels as fallback so warmup
  output handoff remains owned by the mounted terminal panel.
- `src/features/settings/terminalColorSchemes.ts` is the lightweight contract for
  terminal themes: it may inline the default fallback and helper functions, but
  the full `terminalColorSchemesData.ts` catalog must only load through
  `loadTerminalColorSchemes()`. Settings sections that need the full catalog
  must render a loading/error state, then incrementally render the list instead
  of mounting hundreds of preview cards in one pass.
- Lists that render 50+ rich rows/cards should use virtualization or incremental
  reveal with a stable observer. Avoid observers that rebuild on every page
  increment, because they can chain-trigger until the whole list mounts.
- Right-pane tab switches must keep the first interactive frame free of heavy
  tree/list restoration. When remote-file state is preserved across SSH tab
  switches, render the panel shell first, gate the file tree and Radix
  `ContextMenu` row subtree behind a render key, release that key with
  `requestAnimationFrame`, and wrap the state update in `startTransition`.
  Derived work such as visible-entry filtering, flattening expanded trees, and
  selection ordering must return empty results until the tree is ready.
- Workspace-level right-pane tool props should only construct the visible tool's
  subtree. Do not pass `MonitorPanel`, `TunnelPanel`, `CommandLibraryPanel`,
  transfer docks, or Docker tools as hidden React children just to preserve
  state; keep state in feature caches or parent state, and mount heavy tool
  panels only when their tab is active.
- Do not let broad chrome/sidebar child selectors override overlay mechanics.
  Rules such as `.app-sidebar > * { position: relative; z-index: 1; }` must
  exclude fixed drag previews, floating overlays, or portal-like layers; otherwise
  previews can become normal in-flow children and get clipped by sidebar
  `overflow: hidden`.
