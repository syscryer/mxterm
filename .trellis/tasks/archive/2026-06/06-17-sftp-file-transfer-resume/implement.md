# Implementation Plan

## Backend

- Add and compile the SFTP session wrapper around the current SSH resolution path.
- Add transfer registration, cancellation tokens, part-path helpers, and resume offset helpers.
- Implement SFTP single-file upload and download with bounded chunk buffers.
- Implement local directory scan and remote directory scan plans.
- Implement SFTP directory upload and download by iterating the file plans.
- Switch Tauri upload/download commands to SFTP paths and preserve result contracts.
- Register the cancel command and ensure running tasks observe cancellation quickly.
- Add focused unit tests for part paths, resume offsets, remote path splitting, and plan helpers.

## Frontend

- Add the typed cancel wrapper in `src/shared/tauri/commands.ts`.
- Show cancel for queued and running transfers.
- Stop pulse progress for real Tauri upload/download paths once SFTP events are used.
- Display loaded/total bytes and speed from real progress events.
- Update directory transfer stage copy from archive/extract wording to scan/upload/download wording.
- Keep browser-preview simulated progress separate from Tauri real transfers.

## Verification

- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_files --lib`.
- Run `cargo check --manifest-path src-tauri/Cargo.toml`.
- Run `pnpm check`.
- Run `node scripts/check-remote-file-editor-source.mjs`.
- Inspect `git status --short` and staged diff before reporting final state.
