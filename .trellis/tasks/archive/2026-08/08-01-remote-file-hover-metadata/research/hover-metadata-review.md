# Remote file hover metadata review

## Repository findings

- `RemoteFilePanel` currently puts `title={entry.path}` on every file-tree row, so the browser only exposes the absolute path through its native tooltip.
- `RemoteFileEntry` contains only `name`, `path`, and `type`. The existing `remote_file_metadata` command returns size, mtime, mode, and entry type for the right-click properties dialog.
- Remote entry metadata is collected by a quoted POSIX shell command with GNU `stat -c` and BSD/macOS `stat -f` fallbacks, then parsed from NUL-delimited output in Rust.
- The shared `Tooltip` is optimized for short string labels. `AnchoredSurfacePortal` already provides one body-ported, token-compatible anchored surface using Radix `DismissableLayerBranch`.
- A prior Docker performance task records that mounting Tooltip/Portal wrappers for every item in a large list increases React and Radix cost. The remote file tree should therefore use one active information surface rather than one permanent portal per row.

## UI review

- The UI/UX rules require hover feedback, visible keyboard focus, and keyboard access. Hover must not be the only route to important information, so the existing right-click properties action remains available.
- The information surface should be a compact definition list, not a nested card: file name header followed by type, size when meaningful, owner, group, permissions, modified time, creation time, and path.
- The surface should open beside the right-hand file panel, prefer the left side when space permits, and use the existing global glass/token treatment in light, explicit dark, and system-dark modes.
- Native `title` must be removed from the row so the browser tooltip cannot overlap the custom surface.

## Metadata semantics

- Creation time means filesystem birth time. GNU `stat -c %W` returns seconds since epoch or `0` when unavailable; BSD/macOS `stat -f %B` supplies the equivalent when supported.
- POSIX `ctime` is inode change time and must not be shown as creation time.
- Owner and group names should be accompanied by numeric UID/GID in the command result. When name resolution is empty or reports an unknown marker, the UI falls back to UID/GID.
