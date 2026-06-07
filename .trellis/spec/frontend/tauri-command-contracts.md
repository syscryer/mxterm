# Tauri Command Contracts

## Scenario: React Wrappers for Rust Commands

### 1. Scope / Trigger

- Trigger: a React feature calls, changes, or adds a Tauri command.
- Source files: `src/shared/tauri/commands.ts`, `src/features/connections/connectionTypes.ts`, and `src/features/terminal/terminalTypes.ts`.
- Frontend code must call Rust through typed wrapper functions instead of scattering `invoke(...)` calls through UI components.

### 2. Signatures

```ts
connectionList(): Promise<ConnectionProfile[]>
connectionUpsert(request: ConnectionProfileInput): Promise<ConnectionProfile>
connectionDelete(id: string): Promise<void>
connectionProbeLatency(connectionId: string): Promise<{ latency_ms: number | null; reachable: boolean }>
terminalConnect(request: TerminalConnectRequest): Promise<string>
terminalWrite(sessionId: string, data: string): Promise<void>
terminalResize(sessionId: string, cols: number, rows: number): Promise<void>
terminalClose(sessionId: string): Promise<void>
```

`ConnectionProfileInput` mirrors the Rust payload:

```ts
auth_kind: "password" | "private_key"
host: string
port: number
username: string
password?: string
private_key_path?: string
private_key_passphrase?: string
```

### 3. Contracts

- Keep Tauri command names centralized in `src/shared/tauri/commands.ts`.
- Keep Tauri event names centralized in `src/shared/tauri/events.ts`. Event names must use allowed characters only; use `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`, not dot-separated names.
- Wrapper argument objects must match Rust command parameter names exactly, for example `{ request }`, `{ id }`, and `{ sessionId }`.
- UI state may use empty strings while editing, but `useConnections` must trim optional fields and convert blanks to `undefined` before calling `connectionUpsert`.
- When opening a saved connection, `TerminalPanel` should pass `connection_id` plus the current profile fields; Rust treats the saved profile as authoritative.
- Connection latency probing must go through `connectionProbeLatency(connection.id)`. The UI sends only a saved connection id; Rust reloads the saved host/port and never needs credential fields for this probe.
- `TerminalPanel` must register output/state/progress listeners before calling `terminalConnect`.
- During connection startup, match terminal output/state events by `request_id` as well as by `session_id`; shell prompts can arrive before the frontend receives the returned session id.
- Do not store terminal session runtime state inside a `ConnectionProfile`. Connection profiles are persistent data; terminal tabs and session ids are runtime state.
- Do not log passwords, private-key passphrases, or full command payloads.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| `connectionList` fails in a browser preview without Tauri | Show the static fallback profile from `useConnections` so the layout remains inspectable. |
| `connectionUpsert` rejects validation | Surface the Rust `AppError.message` as user-facing form feedback. |
| Delete is requested | Confirm with `window.confirm` before calling `connectionDelete`. |
| Latency probe runs in browser preview without Tauri | Use a stable preview latency so the home table remains inspectable. |
| Latency probe returns `reachable: false` | Show a timeout/unreachable state in the latency cell without replacing the connection list error. |
| Auth kind changes to `password` | Clear private-key fields in form state. |
| Auth kind changes to `private_key` | Clear password in form state. |
| Terminal connect fails | Keep the tab open and show the failure in terminal output/status. |
| Shell output arrives before `terminalConnect` resolves | Display it when `request_id` matches the tab id. |

### 5. Good / Base / Bad Cases

- Good: `ConnectionDialog` holds editable strings, clears fields when auth mode changes, and delegates normalization to `useConnections` before saving.
- Base: `ConnectionPane` displays `username@host:port`, calls `onOpen(connection)`, and does not know about Tauri details.
- Bad: A component calls `invoke("connection_upsert", ...)` directly and duplicates field normalization.

### 6. Tests Required

- Run `pnpm check` after changing command wrappers, connection types, terminal request types, or component props that carry command payloads.
- Add focused tests once the frontend test runner exists for auth-mode field clearing, delete confirmation, fallback behavior, and error display.
- Cross-check changed TypeScript payload fields against `src-tauri/src/commands.rs` and `src-tauri/src/connections/mod.rs` in the same task.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("connection_upsert", { profile });
```

#### Correct

```tsx
await connectionUpsert({
  ...input,
  password: input.password?.trim() || undefined,
});
```

#### Wrong

```tsx
// Persistent profile and runtime tab state are mixed together.
setConnections([...connections, { ...connection, sessionId }]);
```

#### Correct

```tsx
setTabs((items) => [...items, createTerminalTab(connection.id)]);
```

## Scenario: Remote File List Wrapper

### 1. Scope / Trigger

- Trigger: a React feature lists remote files, records or manually locates to the active terminal directory, or changes the `remote_file_list` Tauri command payload.
- Source files: `src/shared/tauri/commands.ts`, `src/features/files/remoteFileTypes.ts`, `src/features/files/RemoteFilePanel.tsx`, and `src/features/terminal/TerminalPanel.tsx`.
- This is a cross-layer command contract: the UI sends only a saved connection id plus an optional path; Rust reloads credentials from the saved profile.

### 2. Signatures

```ts
remoteFileList(connectionId: string, path?: string): Promise<RemoteFileEntry[]>

type RemoteFileEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "other";
};
```

The wrapper must invoke Rust with the exact payload key names:

```ts
invoke<RemoteFileEntry[]>("remote_file_list", {
  request: {
    connection_id: connectionId,
    path,
  },
});
```

### 3. Contracts

- `RemoteFilePanel` must call `remoteFileList(...)`; components must not call `invoke("remote_file_list", ...)` directly.
- `connectionId` is the persistent `ConnectionProfile.id`; do not send passwords, private-key passphrases, or raw SSH credential fields with file-list requests.
- `path` is optional. Empty or missing path is allowed and is interpreted by Rust as the remote shell's default `.` path.
- Response entries use the serialized `type` field, not Rust's internal `kind` field name.
- Directories render before symlinks, files, and other entries. The frontend may sort defensively, but should not rely on receiving unsorted output.
- `TerminalPanel` may report current directory via `onCurrentDirectoryChange(tabId, path)` when terminal output contains `OSC 7` or when the user enters a simple `cd` command that can be resolved locally. `WorkspaceShell` stores the last path per terminal tab and passes the active tab path into `RemoteFilePanel`.
- The file panel must not automatically reload remote files on every terminal directory change. The toolbar locate action is manual: clicking it uses the active tab's stored path only. If no path has been recorded, the locate action must stay disabled or show an explanatory tooltip; it must not ask `TerminalPanel` to write any command.
- When no Tauri runtime exists, preview-only fallback entries are acceptable so browser layout checks remain inspectable.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No active SSH connection | Render an empty file-panel message instead of calling `remoteFileList`. |
| `connectionId` is blank or unknown | Surface Rust `AppError.message`; do not retry with credential fields from React. |
| `path` is blank | Let Rust default the path to `.` or pass the normalized UI path if available. |
| Remote list command fails | Show the user-facing error in the panel and keep the previous tree state when possible. |
| Directory row is expanded and not cached | Lazily call `remoteFileList(connection.id, entry.path)`. |
| Refresh is requested | Force reload the currently displayed path even if cached. |
| `OSC 7` is absent | Track simple user-entered `cd` commands as a best-effort fallback. Keep showing the default/manual path until a path is recorded. Do not parse arbitrary shell prompts and do not write current-directory probes into the interactive terminal. |
| File icon image fails to load | Render a local fallback icon or compact type badge. |

### 5. Good / Base / Bad Cases

- Good: `TerminalPanel` extracts `OSC 7` paths or resolves a user-entered `cd /path`, `WorkspaceShell` records the path per tab, and `RemoteFilePanel` reloads that directory only after the user clicks the locate action.
- Base: A user expands `/var/log`; the panel loads only that directory's immediate children and caches them until refresh.
- Bad: A component sends `{ host, username, password, path }` to a file-list command or stores remote tree state directly inside `WorkspaceShell`.

### 6. Tests Required

- Run `npm run check` after changing `remoteFileList`, `RemoteFileEntry`, `RemoteFilePanel`, `TerminalPanel`, or `WorkspaceShell` path handoff props.
- Run `npm run build` after visible right-pane changes to catch bundling and CSS regressions.
- Run `node scripts/check-terminal-cd-tracker.mjs` after changing terminal input directory tracking.
- Add frontend unit tests once a test runner exists for path normalization, entry sorting, `OSC 7` parsing, and direct-wrapper payload shape.
- Cross-check frontend `RemoteFileEntry.type` values against Rust `RemoteFileKind` serde names in `src-tauri/src/remote_files.rs`.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("remote_file_list", {
  request: {
    host: connection.host,
    password: connection.password,
    path,
  },
});
```

#### Correct

```tsx
await remoteFileList(connection.id, path);
```

#### Wrong

```tsx
// Guesses prompt text and forces the terminal to follow file-tree clicks.
terminalWrite(sessionId, `cd ${entry.path}\n`);
```

#### Correct

```tsx
// Terminal directory signals are recorded; the file panel uses them only on manual locate.
onCurrentDirectoryChange?.(tabId, decodedPath);
```

## Scenario: Remote File Editor Commands

### 1. Scope / Trigger

- Trigger: a React feature opens, edits, saves, creates, renames, deletes, uploads, or downloads remote files through Tauri.
- Source files: `src/shared/tauri/commands.ts`, `src/features/files/remoteFileTypes.ts`, `src/features/files/RemoteFilePanel.tsx`, `src/features/editor/RemoteFileEditor.tsx`, and `src/features/layout/WorkspaceShell.tsx`.
- This is a cross-layer command contract because React owns editor/tab state while Rust owns saved SSH credentials, remote metadata, conflict checks, and file content transfer.

### 2. Signatures

```ts
remoteFileRead(connectionId: string, path: string): Promise<RemoteFileReadResult>
remoteFileWrite(input: RemoteFileWriteInput): Promise<RemoteFileWriteResult>
remoteFileCreateFile(connectionId: string, path: string): Promise<RemoteFileMetadata>
remoteFileCreateDirectory(connectionId: string, path: string): Promise<void>
remoteFileRename(input: RemoteFileRenameInput): Promise<void>
remoteFileDelete(input: RemoteFileDeleteInput): Promise<void>
remoteFileUploadFile(input: RemoteFileUploadInput): Promise<RemoteFileMetadata>
remoteFileDownload(connectionId: string, path: string): Promise<RemoteFileDownloadResult>
```

Payload and result fields:

```ts
type RemoteFileMetadata = {
  name: string;
  path: string;
  size: number;
  mtime: number;
  mode?: string | null;
};

type RemoteFileReadResult = {
  content: string;
  editable: boolean;
  encoding: "utf-8";
  is_binary: boolean;
  metadata: RemoteFileMetadata;
  mode?: string | null;
  mtime: number;
  name: string;
  path: string;
  size: number;
};

type RemoteFileWriteInput = {
  connectionId: string;
  path: string;
  content: string;
  expectedMtime: number;
  expectedSize: number;
  overwrite?: boolean;
};

type RemoteFileWriteResult = {
  conflict: boolean;
  metadata: RemoteFileMetadata;
};
```

### 3. Contracts

- UI components must call the typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("remote_file_*", ...)` directly from feature components.
- Wrapper request keys must match Rust exactly: `connection_id`, `path`, `content`, `expected_mtime`, `expected_size`, `overwrite`, `new_path`, and `recursive`.
- `connectionId` is always the saved `ConnectionProfile.id`. Do not send host, username, password, private-key path, or passphrase from React for file editor commands.
- `WorkspaceShell` owns open file tabs and must de-duplicate by `connectionId + path`; opening the same file again activates the existing tab.
- `RemoteFileEditor` owns Monaco lifecycle only. Command calls, dirty close confirmation, save conflict dialogs, and tree refresh orchestration stay in `WorkspaceShell` / file panel integration.
- Save must send the last opened/saved `metadata.mtime` and `metadata.size` as `expectedMtime` and `expectedSize`. Use `overwrite: true` only after the user chooses to overwrite a conflict.
- Dirty file close must use the project dialog pattern, not `window.confirm`, so unsaved edits are not silently lost and styling stays consistent.
- Binary or too-large read failures must not create an editable Monaco model. Keep the tab content safe and show retry/close or download-oriented UI.
- Browser preview must not fire real upload/download or SSH commands when Tauri is unavailable; preview-only mock behavior is acceptable for layout checks.
- Upload file content is sent as bytes. The wrapper converts `Uint8Array | number[]` to a plain number array before invoking Rust.
- Upload-folder is not part of this command set. If visible in UI, keep it disabled or clearly marked as not implemented.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| `connectionId` is blank or unknown | Show the command error and keep the tab/tree state intact. Do not retry with credential fields from React. |
| `path` is blank for read/write/create/rename/delete/upload/download | Surface the Rust `remote_file_path_missing` message near the initiating UI. |
| Read returns or errors as binary / not UTF-8 / too large | Do not mount Monaco for editable content; show a non-editable state and preserve the file path context. |
| File is opened twice | Activate the existing tab instead of creating duplicate Monaco models. |
| Monaco content changes | Mark the tab dirty and keep `savedContent` plus last metadata unchanged until save succeeds. |
| Save succeeds | Clear dirty state, update metadata, update saved content, and refresh the affected remote directory. |
| Save returns `remote_file_conflict` | Keep local edits, show conflict UI, and offer reload, overwrite, or cancel. |
| Save fails for another reason | Keep local edits dirty and show the error without closing the tab. |
| Dirty tab close is requested | Show a confirmation dialog with save/discard/cancel semantics or an equivalent safe flow. |
| Delete succeeds for an opened file | Close or mark the matching tab unavailable, then choose a deterministic fallback active tab. |
| Upload is requested in browser preview | Do not call the Tauri wrapper; show preview-only feedback or a disabled state. |

### 5. Good / Base / Bad Cases

- Good: a file row double-click calls `openRemoteFile(connection.id, entry.path)`, `WorkspaceShell` reuses an existing tab when present, `remoteFileRead` loads content, Monaco edits the model, and `remoteFileWrite` saves with expected metadata.
- Base: a user creates `/tmp/app.conf`; React calls `remoteFileCreateFile(connection.id, path)`, refreshes the parent directory, then opens the new file tab.
- Bad: a component stores passwords in file action state, calls `invoke("remote_file_write", ...)` directly, or closes a dirty Monaco tab without confirmation.

### 6. Tests Required

- Run `node scripts/check-remote-file-editor-source.mjs` after changing remote editor wrappers, Monaco integration, file tab state, or file panel actions.
- Run `npm run check -- --pretty false` after changing TypeScript command payloads, editor types, or workspace/file panel props.
- Run `npm run build` after visible Monaco/workspace/CSS changes.
- Add frontend tests once the test runner exists for duplicate tab activation, dirty close confirmation, conflict branching, browser-preview upload blocking, and wrapper payload shape.
- Cross-check frontend result fields against `RemoteFileMetadata`, `RemoteFileReadResult`, and `RemoteFileWriteResult` in `src-tauri/src/remote_files.rs`.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("remote_file_write", {
  request: {
    connection_id: connection.id,
    path,
    content,
  },
});
```

#### Correct

```tsx
await remoteFileWrite({
  connectionId: connection.id,
  path,
  content,
  expectedMtime: tab.metadata.mtime,
  expectedSize: tab.metadata.size,
});
```

#### Wrong

```tsx
// Reopens the same remote path as another tab and another Monaco model.
setRemoteFileTabs((tabs) => [...tabs, createRemoteFileTab(connectionId, path)]);
```

#### Correct

```tsx
const existing = remoteFileTabs.find(
  (tab) => tab.connectionId === connectionId && tab.path === path,
);
if (existing) {
  setActiveWorkspaceTabId(existing.id);
  return;
}
```
