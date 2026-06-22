# Remote file multi-select and bulk actions

## Goal

Remote file browsing should allow selecting one or more entries and acting on the selection, so users can delete or download several remote files/directories without repeating the same right-click action for each item.

## User Value

- Users can visually tell which remote file entries are selected.
- Users can multi-select files and directories in the remote file tree.
- Users can run bulk delete and bulk download from the file panel.
- Existing single-entry open, rename, properties, upload, drag/drop upload, and directory expansion behavior remains predictable.

## Confirmed Facts

- `src/features/files/RemoteFilePanel.tsx` renders the remote file tree as button rows and currently has no persisted selected-entry state.
- A directory row click currently toggles expansion and sets the active directory; a file row double-click opens the editor.
- Per-entry context menus already expose download and delete for both files and directories.
- `src/features/layout/WorkspaceShell.tsx` already implements single-entry delete confirmation through `ConfirmDialog`, then calls `remoteFileDelete({ recursive: entry.type === "directory" })`.
- `WorkspaceShell` already implements single-entry download by creating a transfer entry and calling `remoteFileDownloadToLocal`, with directory download support.
- Frontend command wrappers already include `remoteFileDelete`, `remoteFileCheckDownloadTarget`, `remoteFileDownloadToLocal`, progress events, and transfer cancellation.
- Backend remote-file specs require saved-connection resolution and safe path handling for remote-file commands; the current bulk task should reuse those command paths rather than accepting raw credentials or shell-building in React.

## Requirements

- Add an explicit selection model for remote file entries in the file tree.
- Support selecting more than one visible entry, including a mix of files and directories.
- Use an Explorer-style multi-select interaction with `Ctrl` to add/remove entries and `Shift` to range-select visible entries.
- Preserve the existing directory behavior: clicking the directory row itself still expands/collapses the directory and sets the active directory.
- File row click may select the file; file double-click continues to open the file.
- Selected rows must use a visual state distinct from hover, active directory, locate highlight, and drop target.
- Expose bulk actions for the current selection:
  - download selected entries
  - delete selected entries
  - clear selection
- Bulk actions should be exposed only from the right-click context menu, not from always-visible toolbar buttons or a selection action bar.
- Bulk delete must show one confirmation describing the selected count and must still warn when selected entries contain open editor tabs, including dirty tabs.
- Bulk delete must refresh affected parent directories and close/delete affected remote editor tabs consistently with existing single-entry delete behavior.
- Bulk download must enqueue one transfer per selected entry using the existing transfer list and existing file/directory download behavior.
- Selection state must reset when the active connection changes.
- Selection should remain bounded to the currently active remote connection.

## Acceptance Criteria

- [ ] A user can select a single remote file or directory and see it highlighted as selected.
- [ ] A user can select multiple visible entries and see all selected entries highlighted.
- [ ] Clicking a directory row still expands/collapses it instead of only selecting it.
- [ ] A user can clear selection without changing the current directory.
- [ ] Bulk download starts download transfers for all selected entries and preserves existing conflict handling / transfer progress behavior.
- [ ] Bulk delete asks for confirmation once, deletes all selected entries when confirmed, refreshes affected parents, and clears the selection.
- [ ] Bulk actions are available from right-click context menus when there is an active selection.
- [ ] No persistent toolbar/action bar is added for selection actions.
- [ ] If a selected deleted file or child of a deleted directory is open in the editor, its tab is closed using the same dirty-tab safety semantics as the single-delete flow.
- [ ] Existing right-click single-entry actions still work when no multi-selection is active.
- [ ] Directory expand/collapse and file double-click open behavior remain usable after adding selection.
- [ ] Relevant frontend and backend checks pass.

## Out of Scope

- Bulk rename, copy, move, chmod, or properties.
- New backend batch delete/download commands unless implementation proves current single-entry commands cannot safely support the requested UX.
- Cross-connection selection.
- Persisting selection after app restart.

## Decisions

- Selection interaction: use Explorer-style selection (`Ctrl` add/remove, `Shift` range), while preserving whole-row directory click as expand/collapse.
- Bulk action entry point: context menu only.

## Open Questions

- None.
