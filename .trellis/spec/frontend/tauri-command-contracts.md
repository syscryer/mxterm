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
