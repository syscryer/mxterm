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
- Window material styling is chrome-focused. Keep the material source on the
  root `.app-shell` layer and let `.custom-titlebar` plus every left navigation
  sidebar inherit from shared `--mx-chrome-*` and `--mx-sidebar-*` tokens. Main
  workspace and settings content should use clear `--mx-panel` surfaces so text,
  terminal output, tables, and forms remain readable. When a settings navigation
  rail needs the same behavior as the workspace connection rail, add the shared
  `app-sidebar` class instead of creating a separate settings-only skin.
- For the codem-style Windows material effect, prefer transparent chrome
  surfaces over tinted sidebar panels: Mica should let `.custom-titlebar` and
  `.app-sidebar` reveal the native/root material layer, while the adjacent
  workspace/settings content uses an opaque panel with a subtle left boundary
  and rounded top-left corner. This contrast is what makes the material visible.
- Keep typography calm: default text should use regular or medium weight
  (`400`-`520`); reserve heavier weights (`600`+) for modal titles, critical
  counters, or rare primary emphasis.
- Preserve live workspace components during view switches. Home/session toggles
  should hide terminal and remote-file surfaces with stateful visibility
  classes or layout variables instead of unmounting them, so SSH sessions,
  xterm state, and remote tree state are not recreated.
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
- Terminal surfaces should not add decorative padding by default. If xterm
  spacing is ever needed, it must be accounted for by FitAddon; parent-only
  padding can make FitAddon over-count rows and clip the bottom terminal line at
  some window heights.
- xterm internal layers such as `.xterm-viewport` and `.xterm-screen` must use
  the same background as the terminal host. Their upstream CSS defaults to pure
  black, which creates visible right/bottom bands when FitAddon rounds the
  terminal to whole character cells.
- Scrollable app panes should use the shared light scrollbar treatment in
  `src/styles/app.css`: transparent tracks/corners, no WebKit scrollbar
  buttons/arrows, muted rounded thumbs that become visible on hover, and a
  narrower terminal scrollbar than ordinary side panes. For xterm, hide the
  native `.xterm-viewport` WebKit/Firefox scrollbar completely and style
  xterm's internal `.xterm-scrollable-element > .scrollbar`; keep the Terminal
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
