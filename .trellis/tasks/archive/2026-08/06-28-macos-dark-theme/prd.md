# Adapt macOS dark theme

## Goal

Adapt the macOS dark theme so the app keeps the same polished glass desktop
feel as the light macOS experience while staying readable and stable. Windows
dark-mode behavior is already adapted and must not regress.

## Requirements

- Scope theme changes to macOS explicit dark mode and macOS system dark mode,
  using platform/theme selectors such as `body[data-platform="macos"]` and
  `.app-shell[data-platform="macos"]`.
- Prefer global `--mx-*` tokens in `src/styles/tokens.css` and shared
  `src/styles/app.css` selectors over feature-local hard-coded colors.
- Keep the Apple-style frosted material direction: translucent chrome and
  sidebars, readable panel/work surfaces, no large new CSS blur on root
  surfaces that could reintroduce drag shimmer.
- Cover shared UI surfaces that can look wrong in dark mode: window chrome,
  sidebars, workbench/content panels, settings/connection panels, dialogs,
  backdrops, Radix/body portal menus/selects/popovers, and terminal tab chrome.
- Preserve existing Windows light/dark and material behavior.

## Acceptance Criteria

- [ ] macOS explicit dark mode uses dark glass/chrome/sidebar/panel tokens with
      sufficient text, border, hover, and active-state contrast.
- [ ] macOS system-dark selectors mirror the explicit macOS dark adaptation.
- [ ] Dialogs, menus, selects, popovers, and body-rendered portal surfaces follow
      macOS dark tokens instead of staying light or opaque white.
- [ ] Terminal workbench tab chrome and dark terminal surroundings no longer show
      mismatched light strips in macOS dark mode.
- [ ] Windows scoped selectors and existing Windows dark-mode behavior are not
      changed except through shared token usage that already applies safely.
- [ ] `git diff --check`, `pnpm check`, and `pnpm build` pass.

## Notes

- UI/UX review: keep compact desktop-tool density, neutral chrome active states,
  token-driven surfaces, and accessible contrast. Avoid a separate visual system
  or feature-local glass palette.
