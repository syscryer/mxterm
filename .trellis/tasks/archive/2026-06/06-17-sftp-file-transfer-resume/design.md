# SFTP Transfer Design

## Boundaries

- Rust owns SSH/SFTP connection resolution, filesystem traversal, conflict resolution, streaming IO, cancellation, and progress emission.
- React owns transfer queue state, conflict prompts, progress display, cancel action, and browser-preview fallbacks.
- `src/shared/tauri/commands.ts` remains the only frontend command boundary. UI components do not call `invoke(...)` directly.

## Backend Flow

1. Commands resolve saved connections through the existing SSH config path.
2. Each real transfer registers a `transfer_id` in `RemoteFileManager`.
3. SFTP opens a subsystem over the existing russh connection code.
4. File transfer writes to a sibling `.mxpart` file:
   - upload: remote final path -> remote `{path}.mxpart`
   - download: local final path -> local `{path}.mxpart`
5. Before writing, metadata on the part file determines the resume offset. Offsets are accepted only when `0 <= part_size < total_size`.
6. The stream seeks both source and target to the resume offset and copies chunks with bounded memory.
7. Completion renames the part file to the final path after applying the conflict policy.
8. Cancellation uses an atomic token checked before traversal, between files, and during chunk loops.

## Directory Strategy

- Directory upload scans local files into a plan containing relative paths, directories, and total bytes.
- Directory download scans remote SFTP entries into the same shape.
- The root target conflict policy is resolved once, then child files are copied under the resolved root.
- Directories are created before files. Existing directories are tolerated when merging under overwrite/rename-resolved roots.
- Per-file `.mxpart` files live beside their final targets, so retry behavior is stable even for nested directories.

## Progress Contract

- Event name remains `remote_file:transfer_progress`.
- Each event includes `transfer_id`, `loaded_bytes`, and `total_bytes`.
- Directory progress is global: `completed_previous_files + current_file_loaded`.
- Backend throttles progress events but always emits completion.
- Frontend sets indeterminate only before the first total-bearing event.

## Error And Cancellation

- User cancellation returns `remote_file_transfer_canceled`.
- Cancelled transfers are not shown as failures in the panel.
- Unexpected IO/SFTP errors use remote-file transfer error codes and keep recoverability true.
- Failed or cancelled part files are intentionally retained for resume.

## Compatibility

- Small editor read/write commands can keep their existing exec path.
- Browser preview keeps simulated transfer behavior because SFTP is only available in Tauri.
- Existing result shapes are preserved where possible so file panel refresh logic does not need a wider rewrite.
