# Right File Manager Implementation Plan

## 1. Planning Gate

- [x] Capture corrected direction in `prd.md`: terminal current directory drives
  file panel navigation.
- [x] Write design for lightweight file panel and current-directory sync.
- [x] Review scope before starting implementation.
- [x] Run `python ./.trellis/scripts/task.py start 06-07-06-07-right-file-manager`.

## 2. Frontend Utilities First

- [x] Add file-entry types and pure helpers for sorting entries, path joining,
  path normalization, and icon kind resolution.
- [x] Add focused tests for helper behavior where the current test setup allows
  it. If the repository still has no real frontend test runner, document the
  limitation and rely on `npm run check` plus build.
  - Current limitation: `package.json` has only a placeholder `npm test`
    command, so frontend helper coverage is via `npm run check` and
    `npm run build` until a real runner exists.

## 3. Backend Remote Listing

- [x] Add a Tauri command for remote file listing by `connection_id` and path.
- [x] Reuse stored connection credentials instead of sending secrets from the UI.
- [x] Implement safe POSIX path quoting for the remote listing command.
- [x] Parse structured command output into typed file entries.
- [x] Add Rust unit tests for path quoting and listing-output parsing.
- [x] Fix remote read failure on compact Linux images by avoiding GNU-only
  `find -printf` and by reading SSH exec messages past `Eof` until `Close`.

## 4. Terminal Current Directory Signal

- [x] Extend `TerminalPanel` with `onCurrentDirectoryChange`.
- [x] Parse `OSC 7` current-directory sequences from terminal output chunks.
- [x] Store last known current directory per terminal tab in `WorkspaceShell`.
- [x] Let the file panel manually locate to the active tab's current directory
  without auto-refreshing on every terminal `cd`.
- [x] Track simple user-entered `cd` commands as a best-effort fallback when the
  shell does not emit `OSC 7`, without writing anything extra to the terminal.

## 5. Right File Panel UI

- [x] Replace the static right-side placeholder with a reusable file manager
  component.
- [x] Remove the `搜索` tab from the right pane.
- [x] Render path bar, refresh button, loading/error states, and compact rows.
- [x] Make the path bar editable, default it to `/`, and support Enter-based
  manual navigation.
- [x] Add compact icon-only toolbar actions for locate terminal directory, show/hide
  dotfiles, collapse expanded directories, refresh, and upload dropdown layout.
  Terminal directory locate is manual: clicking uses the active tab's recorded
  directory. If no directory is known, the locate action is disabled and must
  not request anything from the interactive terminal.
  The toolbar collapse action must not bulk-expand remote directories; directory
  expansion stays row-level and user-initiated.
- [x] Implement directory expand/collapse with lazy loading.
- [x] Add VS Code-like file/folder icons using a small local mapping inspired by
  the `codem` pattern, plus fallback icons/badges.

## 6. Verification

- [x] Run `npm run check`.
- [x] Run `npm run build`.
- [x] Run Rust tests for backend helpers if added.
- [x] Check `git status --short` and staged diff before reporting completion.
- [x] Stage this task's related files; leave pre-existing staged WIP untouched
  and do not auto-commit or push.
