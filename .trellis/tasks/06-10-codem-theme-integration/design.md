# Design

## Architecture

Use an adapter strategy:

- Keep mXterm's root class `.app-shell` and its `--mx-*` token vocabulary.
- Import codem appearance concepts into mXterm TypeScript settings helpers:
  accent light/dark pairs, custom dark accent derivation, and window material
  modes.
- Add CSS theme layers under `.app-shell[data-theme-mode="..."]` and
  `@media (prefers-color-scheme: dark)` for system mode.
- Add native window material commands through the existing Tauri command module
  and frontend wrapper layer.

This avoids a brittle direct copy of codem's `.codex-desktop` CSS while still
bringing over the full theme capability.

## Boundaries

### Frontend

- `settingsTypes.ts` owns appearance setting types, defaults, normalization, and
  style variable resolution.
- A new or existing frontend helper owns platform/material detection and
  frontend command calls.
- `WorkspaceShell.tsx` owns applying root data attributes and applying native
  material changes as a side effect.
- `SettingsView.tsx` owns user controls for theme mode, accent, fonts, and
  window material.
- `tokens.css` and `app.css` own theme variable values and selector fixes.

### Backend

- `commands.rs` exposes window material query/set commands.
- `lib.rs` registers the commands and any required managed state.
- Platform-specific native material code should be isolated and fail safely.
- Windows native support mirrors codem's DWM backdrop approach when available.
- Non-Windows platforms return safe fallbacks unless support already exists or
  can be added without destabilizing the app.

## Data Flow

1. `useSettings` loads and normalizes appearance settings from localStorage.
2. `WorkspaceShell` computes:
   - resolved accent light/dark values
   - effective material from supported platform materials
   - root CSS variables via `resolveSettingsStyle`
3. `.app-shell` receives:
   - `data-theme-mode`
   - `data-density`
   - `data-window-material`
   - inline CSS custom properties
4. CSS maps those attributes to `--mx-*` tokens.
5. A Tauri side effect calls `setWindowMaterial(effectiveWindowMaterial)`.

## Settings Contract

New field:

```ts
type WindowMaterialMode = "auto" | "mica" | "acrylic" | "micaAlt";
appearance.windowMaterial: WindowMaterialMode
```

`auto` is the fallback and the only available material for non-supporting
platforms. Existing settings without this field normalize to codem's preferred
visual default when supported by UI flow, but the app must remain safe in
browser preview and unsupported platforms.

## Styling Strategy

- Define light defaults in `:root` / `.app-shell`.
- Define dark overrides in `.app-shell[data-theme-mode="dark"]`.
- Define system dark overrides in
  `@media (prefers-color-scheme: dark) { .app-shell[data-theme-mode="system"] }`.
- Keep hard-coded white/gray fixes scoped to existing mXterm selectors.
- Prefer replacing hard-coded backgrounds with semantic tokens:
  `--mx-panel`, `--mx-panel-soft`, `--mx-bg`, `--mx-line`, `--mx-text`,
  `--mx-muted`, `--mx-active`, `--mx-danger`, and theme-aware glass tokens.

## Native Window Material

Use codem's concept and adapt it to mXterm:

- Frontend material ids:
  - `auto = 0`
  - `mica = 2`
  - `acrylic = 3`
  - `micaAlt = 4`
- Windows: use DWM system backdrop type when the dependency/features are
  available.
- Other platforms: return `auto` only unless adding support is straightforward
  and low risk.
- CSS should still define material tokens so browser preview and unsupported
  platforms have a visually coherent fallback.

## Compatibility

- Existing localStorage settings remain valid via `normalizeSettings`.
- Existing `themeMode` values continue to work.
- Existing `AccentColor` values map to an expanded codem-compatible palette.
- Terminal scheme ids remain unchanged.
- Browser preview must not throw when Tauri material commands are unavailable.

## Trade-Offs

- Directly copying codem CSS would be faster but unsafe because selectors are
  application-specific. Adapter mapping is safer and keeps mXterm maintainable.
- Full dark theme requires touching broad CSS. To reduce risk, centralize token
  overrides first, then patch only obvious hard-coded light surfaces.
- Native window material adds Rust/platform dependencies. The implementation
  must fail closed and keep CSS fallback behavior.

## Rollback

- Revert the new appearance setting field and material wrappers.
- Remove `.app-shell[data-theme-mode]` / `[data-window-material]` theme blocks.
- Remove native material commands from Tauri registration if needed.
- Existing saved settings with extra fields are ignored safely by older
  normalization if the field is removed.
