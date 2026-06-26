# Research: codem Theme Integration

## mXterm Current State

- Root app: `src/features/layout/WorkspaceShell.tsx`
  - Applies `.app-shell`
  - Applies `data-theme-mode`
  - Applies `data-density`
  - Injects variables from `resolveSettingsStyle`
- Settings model: `src/features/settings/settingsTypes.ts`
  - Has `ThemeMode`, accent presets, density, icon size, fonts, terminal theme.
  - Does not yet have window material.
  - `resolveSettingsStyle` currently injects primary color, font variables,
    terminal background, terminal font size, UI font size, and icon size.
- CSS tokens:
  - `src/styles/tokens.css` defines light-only `--mx-*` defaults.
  - `src/styles/app.css` uses many `--mx-*` tokens but also has hard-coded
    light backgrounds that require cleanup for dark theme.

## codem Theme Source

- `D:\ai_proj\codem\src\styles.css`
  - Core `.codex-desktop` variables include `--app-*`, `--sidebar-*`, material
    variables, light/dark overrides, and system dark media blocks.
  - CSS is app-specific and should not be pasted into mXterm wholesale.
- `D:\ai_proj\codem\src\constants.ts`
  - Accent presets contain light/dark pairs.
  - Custom accent derives a dark variant by mixing the light color toward white.
  - Font stacks include codem/system UI options and code font presets.
- `D:\ai_proj\codem\src\lib\settings-api.ts`
  - Default appearance includes `windowMaterial: "mica"`.
  - Normalizes window material values from `auto`, `none`, `mica`, `acrylic`,
    `micaAlt`.
- `D:\ai_proj\codem\src\lib\window-material.ts`
  - Maps material ids to names and wraps Tauri commands.
  - Limits visible choices by platform.
- `D:\ai_proj\codem\src-tauri\src\main.rs`
  - Windows implementation uses `DwmSetWindowAttribute` with
    `DWMWA_SYSTEMBACKDROP_TYPE`.
  - macOS implementation uses `window-vibrancy`.
  - Linux falls back to auto only.

## Recommended Integration

Use a translation layer from codem concepts into mXterm tokens:

- `--app-surface` -> `--mx-panel`
- `--app-surface-muted` -> `--mx-panel-soft`
- `--app-bg` -> `--mx-bg`
- `--app-text` -> `--mx-text`
- `--app-muted` -> `--mx-muted`
- `--app-border` -> `--mx-line`
- `--accent` -> `--mx-primary`
- codem material variables -> mXterm glass/material variables

This preserves mXterm's class names and compact UI while bringing codem's
theme behavior over.
