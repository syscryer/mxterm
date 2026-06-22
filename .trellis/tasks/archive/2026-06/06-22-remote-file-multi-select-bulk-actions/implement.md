# Remote file multi-select and bulk actions implementation plan

## Checklist

1. Load implementation specs with `trellis-before-dev`.
2. Read task artifacts and relevant remote-file specs.
3. Update `RemoteFilePanel`:
   - Add selected-entry state and last selection anchor.
   - Compute visible flattened rows for Shift range selection.
   - Add row selected styling / ARIA selected state.
   - Preserve plain directory row click as expand/collapse.
   - Support file click selection, Ctrl/Meta toggle, and Shift range.
   - Preserve file double-click open and drag/drop behavior.
   - Add selected-entry context menu items for download/delete/clear.
   - Add `onDeleteEntries` and `onDownloadEntries` props.
4. Update `WorkspaceShell`:
   - Add bulk delete pending target state or generalize current delete target.
   - Add bulk download handler that enqueues existing per-entry downloads.
   - Add bulk delete request/confirm flow that deletes collapsed selected entries sequentially.
   - Refresh affected parent directories once after delete.
   - Close affected editor tabs consistently with existing single delete behavior.
5. Update CSS in `src/styles/app.css` for selected remote-file rows, distinct from active directory, locate highlight, hover, and drop target.
6. Add or update source checks if an existing script covers remote file source expectations.
7. Run validation.

## Validation Commands

- `pnpm typecheck`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml remote_files --lib`
- `node scripts/check-remote-file-local-icons-source.mjs` only if icon resolver or icon styles are touched.

## Rollback Points

- `src/features/files/RemoteFilePanel.tsx`: selection state and context menu changes can be reverted independently if interaction regressions appear.
- `src/features/layout/WorkspaceShell.tsx`: bulk delete/download integration can fall back to single-entry callbacks.
- `src/styles/app.css`: selected-row styling can be removed without affecting backend behavior.

## Review Gates

- Confirm no backend command accepts raw credentials or newly interpolates remote shell paths from React.
- Confirm no persistent toolbar/action bar was added.
- Confirm plain directory click still expands/collapses.
- Confirm bulk delete de-duplicates nested selections before destructive calls.
