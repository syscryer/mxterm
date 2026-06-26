# Right File Manager Design

## Scope

This task implements the first lightweight right-side file manager for active
SSH sessions. It intentionally excludes remote search, transfer queues, upload,
download, monitoring, and full SFTP editing flows.

The key product correction is direction: the terminal directory signal can guide
file navigation, but the file panel must not control or write into the
interactive terminal. The user manually locates the file tree to the active tab's
last recorded directory. The file tree should not force the terminal to `cd`,
and the file panel should not ask the terminal to run any command.

## UI Shape

- `WorkspaceShell` keeps ownership of active connection and active terminal tab.
- A new file-panel component owns the right-side file UI instead of embedding
  file-list logic directly in `WorkspaceShell`.
- The right tool tabs are reduced to `文件` only for this task. Search is not
  rendered.
- The panel includes a compact toolbar, current path bar, loading/error states,
  and a tree/list hybrid for the current remote directory.
- The file panel defaults to `/` when no terminal current-directory signal is
  available. The path bar is an editable input; pressing Enter navigates to the
  typed remote path.
- The toolbar uses compact icon-only controls: locate current terminal directory,
  show/hide dotfiles, collapse expanded directories, refresh, and an upload
  dropdown placeholder for file/folder upload. It intentionally does not provide
  a bulk-expand action because remote trees can be large and should only load
  directories the user opens explicitly.
- Terminal directory positioning is manual. The panel receives the active tab's
  current-directory signal when available, but it does not auto-refresh the file
  tree on `cd`. Pressing the locate button moves the panel to the active tab's
  recorded directory. If no directory has been recorded yet, the button stays
  disabled and shows an explanatory tooltip; nothing is sent to the terminal.
- When `OSC 7` is absent, `TerminalPanel` also tracks simple user-entered `cd`
  commands locally. Absolute `cd /path` is recorded immediately; relative
  targets are resolved only after a previous directory is known. This is a
  best-effort UI hint and does not execute or inject anything into the terminal.
- Directory and file rows use compact VS Code-like icons. This task starts with
  a small local filename/extension mapping that points at VS Code icon SVGs and
  falls back to local Lucide folder or small file-type badges. The full
  `vscode-icons-js` package can replace the subset mapping later if dependency
  installation is stable.

## Data Model

Frontend file entries:

```ts
type RemoteFileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
};
```

UI tree state:

- `currentPath`: remote directory shown in the panel.
- `expandedDirectories`: directory paths expanded in the tree.
- `directoryEntries`: map from directory path to loaded entries.
- `loadingPath`: path currently being loaded.
- `error`: last file-listing error.

Directories sort before files, then case-insensitive by name.

## Remote Listing

MVP remote listing uses a lightweight SSH command through the backend rather
than full SFTP. This keeps scope small and matches the Linux-only assumption for
the first file panel.

The backend command shape:

```ts
remoteFileList({ connection_id, path }) -> RemoteFileEntry[]
```

Implementation notes:

- Reuse stored `ConnectionProfile` credentials by `connection_id`.
- Open a short-lived SSH exec channel for the listing command.
- Quote the requested path safely for POSIX shell usage.
- Use a Linux-friendly command such as `find <path> -maxdepth 1 -mindepth 1`
  with structured output.
- If the path is missing or unreadable, return a user-facing error without
  leaking credentials.

Full SFTP can replace this later without changing the frontend entry contract.

## Current Directory Sync

The preferred signal is terminal output carrying the standard `OSC 7` current
working directory sequence. `TerminalPanel` parses terminal output chunks before
writing them to xterm and calls:

```ts
onCurrentDirectoryChange(tabId, path)
```

`WorkspaceShell` stores the last known remote directory per terminal tab. The
right file panel does not automatically follow it; the toolbar locate action
uses the active tab's last known directory only when the user clicks.

If the remote shell does not emit `OSC 7`, the panel still works by showing the
default path and offering refresh/path navigation. The manual locate action is
enabled after either an `OSC 7` signal or a simple user-entered `cd` command has
recorded a path. Stronger shell integration can be added later, but this task
should not turn into a broad terminal integration project or inject commands into
the user's terminal.

## Non-Goals

- No remote content search tab.
- No upload/download/transfer queue.
- No monitor tab.
- No automatic parsing of arbitrary shell prompts.
- No mandatory reverse action from file tree to terminal `cd`.
- No file editing or save conflict handling in this task.
