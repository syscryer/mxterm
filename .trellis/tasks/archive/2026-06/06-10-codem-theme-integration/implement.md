# Implementation Plan

## Checklist

1. Load frontend specs with `trellis-before-dev`.
2. Update appearance settings model:
   - add `WindowMaterialMode`
   - import codem accent presets and dark accent derivation
   - normalize new field
   - resolve light/dark accent CSS variables
3. Add frontend window material helper / wrappers:
   - platform detection
   - supported material fallback
   - labels
   - `getSupportedWindowMaterials`
   - `setWindowMaterial`
4. Add native Tauri window material commands:
   - command result type
   - platform-safe implementations
   - command registration
   - Cargo dependency/features if needed
5. Update `WorkspaceShell`:
   - compute supported/effective material
   - apply `data-window-material`
   - call native material side effect safely
   - keep existing root style variables and pane sizing variables
6. Update `SettingsView`:
   - remove old "dark theme not global" copy
   - show window material segmented control when relevant
   - keep existing compact settings patterns
7. Update CSS tokens:
   - codem-inspired light/dark/material tokens mapped to `--mx-*`
   - system dark media block
   - common surface hard-code cleanup
   - titlebar/window controls/dialog/settings/file/transfer/home dark fixes
8. Update prototype if practical:
   - use `prototype/light-neutral/mxterm-empty-session.html` as the visual
     reference for the new theme direction if HTML changes are needed.
9. Validate:
   - `npm run check -- --pretty false`
   - `npm run build`
   - browser preview or in-app Browser visual pass if local target is obvious
10. Review dirty state:
    - `git status --short`
    - ensure unrelated existing WIP was not reverted.

## Risky Files

- `src/styles/app.css`: large file with existing uncommitted edits; avoid
  broad rewrites and prefer scoped additions/targeted replacements.
- `src/features/layout/WorkspaceShell.tsx`: already has WIP changes; only add
  theme/material plumbing.
- `src-tauri/src/lib.rs` and `src-tauri/src/commands.rs`: currently dirty; do
  not revert unrelated command work.
- `src-tauri/Cargo.toml`: adding Windows dependency can affect lockfile.

## Validation Notes

- Type-check catches TypeScript settings contract issues.
- Build catches CSS syntax and Rust command wrapper imports only on the frontend
  side; Rust compilation may also be needed if native command changes are broad.
- If Cargo dependency changes are made, run or note Rust build validation if
  time allows.

## Review Gate

Do not run `task.py start` until the planning artifacts are reviewed and the
user confirms implementation should begin.
