# Integrate codem Theme System

## Goal

Bring the usable theme experience from `D:\ai_proj\codem` into mXterm so the
application supports real light / dark / system themes, codem-style accent
colors, font defaults, and window material controls while preserving mXterm's
compact SSH/SFTP desktop layout.

## User Value

- Users can switch mXterm between light, dark, and system theme modes and see
  the whole application update consistently.
- Users get the richer codem appearance model without losing existing mXterm
  terminal color scheme settings.
- Windows users can choose codem-style Mica / Acrylic / Mica Alt window
  materials when supported, with safe fallbacks elsewhere.

## Confirmed Facts

- mXterm already stores `themeMode`, accent color, density, icon size, UI font,
  terminal font, and terminal color scheme settings in
  `src/features/settings/settingsTypes.ts`.
- `WorkspaceShell` already writes `data-theme-mode` and `data-density` on the
  `.app-shell` root and injects style variables through `resolveSettingsStyle`.
- mXterm styles use `--mx-*` tokens from `src/styles/tokens.css` and
  `src/styles/app.css`; many surfaces still contain light-only hard-coded
  backgrounds.
- codem's theme source is not a package. Its relevant pieces are CSS variables
  in `src/styles.css`, appearance defaults/helpers in `src/constants.ts` and
  `src/lib/settings-api.ts`, and window material helpers / native commands.
- codem's raw CSS targets `.codex-desktop` and many codem-specific components,
  so direct copy-paste would conflict with mXterm selectors and layout.
- mXterm already depends on Tauri 2 and has a custom titlebar with
  `decorations: false`.
- mXterm does not currently expose native window material commands.
- Existing uncommitted user/WIP changes are present. This task must avoid
  reverting unrelated changes.

## Requirements

- Add a theme adapter that maps codem's appearance concepts into mXterm's
  existing `--mx-*` token system instead of replacing mXterm UI classes.
- Make `themeMode: "light" | "dark" | "system"` affect global app chrome,
  sidebars, settings pages, dialogs, popovers, terminal surrounding chrome,
  remote file panels, connection home, transfer panels, scrollbars, and common
  shared controls.
- Preserve the selected terminal ANSI color scheme as a separate terminal-only
  setting. App theme must not overwrite the terminal palette, except for
  surrounding chrome and preview surfaces.
- Import codem's accent color model where practical: light/dark accent pairs,
  custom accent normalization, and dark accent derivation for custom colors.
- Add codem-style window material setting support:
  `auto`, `mica`, `acrylic`, `micaAlt`, with fallback to `auto` on unsupported
  platforms.
- Apply native window material through Tauri commands where supported, and
  keep CSS material tokens as a visual fallback.
- Update the appearance settings UI so the old copy saying dark theme is not
  global is removed, and users can select window material when available.
- Keep mXterm's compact operational visual language. Do not introduce shadcn,
  another icon family, or codem's chat/workspace-specific layout styles.
- Keep existing saved settings compatible. Missing new fields must normalize to
  sensible defaults.

## Acceptance Criteria

- [ ] Selecting light, dark, or system changes mXterm's application-level color
      tokens globally, including settings, dialogs, sidebars, home, file panes,
      and transfer UI.
- [ ] In dark mode, no major workspace or settings surface remains obviously
      light-only due to hard-coded white / near-white backgrounds.
- [ ] Accent presets include codem-style light/dark values, and custom accent
      colors derive a usable dark-mode accent.
- [ ] Window material is stored in appearance settings, normalized, reflected on
      the `.app-shell` root as `data-window-material`, and exposed in settings.
- [ ] Native `get_supported_window_materials` and `set_window_material`
      commands are available from frontend wrappers and fail safely when not
      supported.
- [ ] mXterm still builds and type-checks after the theme integration.
- [ ] Existing terminal color scheme selection still controls xterm colors.
- [ ] Existing user/WIP changes are not reverted.

## Out Of Scope

- Replacing mXterm's component system with codem's component tree.
- Importing codem chat, agent, project, or workbench-specific CSS selectors.
- Redesigning SSH connection, remote file, or terminal behavior beyond theme
  compatibility.
- Persisting settings through a backend settings API; mXterm continues to use
  its current localStorage settings hook unless a future task changes that.

## Open Questions

- None blocking. The user asked to fully integrate codem themes, and repository
  inspection clarifies that the safe interpretation is an adapter-based
  migration into mXterm tokens rather than direct CSS replacement.
