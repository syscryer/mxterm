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
connectionSetFavorite(connectionId: string, isFavorite: boolean): Promise<ConnectionProfile>
connectionMarkConnected(connectionId: string): Promise<ConnectionProfile>
connectionDelete(id: string): Promise<void>
credentialList(): Promise<CredentialProfile[]>
credentialUpsert(request: CredentialProfileInput): Promise<CredentialProfile>
credentialDelete(id: string): Promise<void>
connectionTest(request: ConnectionRuntimeCredentialRequest): Promise<ConnectionStepResult>
connectionTestProfile(request: ConnectionProfileInput): Promise<ConnectionStepResult>
connectionProbeSystem(request: ConnectionRuntimeCredentialRequest): Promise<ConnectionProfile>
knownHostTrust(hostKey: HostKeyInfo): Promise<void>
connectionProbeLatency(connectionId: string): Promise<{ latency_ms: number | null; reachable: boolean }>
terminalConnect(request: TerminalConnectRequest): Promise<string>
terminalWrite(sessionId: string, data: string): Promise<void>
terminalResize(sessionId: string, cols: number, rows: number): Promise<void>
terminalClose(sessionId: string): Promise<void>
getWindowsPtyInfo(): Promise<WindowsPtyInfo | null>
```

`ConnectionProfileInput` mirrors the Rust payload:

```ts
group?: string
host: string
port: number
username: string
credential_mode: "saved" | "inline" | "prompt"
credential_id?: string
inline_auth_kind?: "password" | "private_key"
inline_password?: string
inline_private_key_path?: string
inline_private_key_passphrase?: string
prompt_auth_kind?: "password" | "private_key"
proxy: {
  kind: "none" | "http_connect" | "socks5"
  host?: string | null
  port?: number | null
  username?: string | null
  password?: string | null
}
jump: {
  kind: "none" | "ssh_jump"
  jump_connection_id?: string | null
}
advanced: {
  connect_timeout_ms: number
  auth_timeout_ms: number
  keepalive_interval_ms: number
  terminal_encoding: "utf-8" | "gbk" | "gb18030" | "big5" | "euc-jp" | "iso-2022-jp" | "shift-jis" | "euc-kr"
}
notes?: string
is_favorite?: boolean
last_connected_at?: string
remote_os_id?: string
remote_os_name?: string
remote_os_version?: string
// Legacy migration only:
auth_kind?: "password" | "private_key"
password?: string
private_key_path?: string
private_key_passphrase?: string
```

`CredentialProfileInput` mirrors the saved login account Rust payload:

```ts
id?: string
name?: string
username?: string
kind: "password" | "private_key"
password?: string
private_key_path?: string
private_key_passphrase?: string
notes?: string
```

Runtime credential and host-key requests:

```ts
type ConnectionRuntimeCredentialRequest = {
  connection_id: string
  auth_kind?: "password" | "private_key"
  password?: string
  private_key_path?: string
  private_key_passphrase?: string
}

type HostKeyInfo = {
  host: string
  port: number
  key_algorithm: string
  fingerprint_sha256: string
  public_key: string
}
```

### 3. Contracts

- Keep Tauri command names centralized in `src/shared/tauri/commands.ts`.
- Keep Tauri event names centralized in `src/shared/tauri/events.ts`. Event names must use allowed characters only; use `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`, not dot-separated names.
- Wrapper argument objects must match Rust command parameter names exactly, for example `{ request }`, `{ id }`, and `{ sessionId }`.
- UI state may use empty strings while editing, but `useConnections` and `useCredentials` must trim optional fields and convert blanks to `undefined` before calling `connectionUpsert` or `credentialUpsert`.
- Connection profiles own target and behavior fields: group, host, port, username, credential mode, proxy, SSH jump reference, advanced settings, and notes.
- Connection profiles also own repository UI metadata: `is_favorite` is the explicit favorite flag and `last_connected_at` is the last successful terminal connection timestamp. Do not infer favorites from notes or recent activity from `updated_at`.
- Connection profiles also persist detected remote system metadata: `remote_os_id`, `remote_os_name`, and `remote_os_version`. UI system icons must prefer these fields before falling back to local name/notes/group text inference.
- Credential profiles own reusable login account material: username plus password or private key path/passphrase plus local notes. They must not store host or port.
- When opening a saved connection, the connection-preparation flow should pass `connection_id` plus prompt credentials only when `credential_mode === "prompt"`; Rust treats the saved profile as authoritative.
- After a terminal connection succeeds, trigger `connectionProbeSystem(...)` in the background with the same runtime prompt credential payload when needed, then call `connectionMarkConnected(connection.id)` so the repository's recent views sort by real connection activity. Probe failures must not close or fail an already connected terminal. Favorite toggles must call `connectionSetFavorite(...)` and preserve repository metadata when editing or moving a connection.
- `ConnectionDialog` must test the current form with `connectionTestProfile(input)`. It must not call `connectionUpsert`, `saveConnection`, or `connectionTest({ connection_id })` for unsaved dialog tests, because testing must not persist a profile or create a connection id. It must show validation and connection errors as dialog feedback instead of writing them into a terminal.
- `ConnectionDialog` exposes network path settings under the `网络路径` tab. The connection method selector maps to exactly one persisted path: direct saves `proxy.kind = "none"` and `jump.kind = "none"`; network proxy saves HTTP CONNECT or SOCKS5 under `proxy` and clears `jump`; SSH jump saves `jump.kind = "ssh_jump"` plus `jump_connection_id` and clears `proxy`.
- SSH jump represents a real bastion path. The frontend may describe it as "先登录跳板机，再访问目标主机", but it must still send only the saved `jump_connection_id`; Rust remains responsible for loading the jump profile, opening `direct-tcpip`, and surfacing runtime jump errors.
- When `jump.kind === "ssh_jump"`, `ConnectionDialog` must require a saved connection id before save or test. Missing selection is shown as dialog feedback on the `网络路径` tab instead of silently downgrading the connection to direct.
- `ConnectionDialog` exposes terminal display encoding under the `高级` tab only because Rust terminal sessions perform both SSH output decoding and terminal input encoding. The frontend sends `advanced.terminal_encoding`; it must not attempt to recode terminal bytes in `TerminalPanel`.
- `ConnectionDialog` must treat `host_key_unknown` and `host_key_changed` from `connectionTestProfile(input)` as recoverable confirmation states, not ordinary errors. Parse the backend `raw_message` through the shared host-key parser, render host, port, algorithm, and SHA256 fingerprints in the compact feedback card, and never show the raw JSON payload to users.
- Host-key confirmation UI must call `knownHostTrust(hostKey)` with the `HostKeyInfo` returned by a recoverable host-key error; do not synthesize fingerprints on the frontend.
- Connection latency probing must go through `connectionProbeLatency(connection.id)`. The UI sends only a saved connection id; Rust reloads the saved host/port and never needs credential fields for this probe.
- Remote system probing must go through `connectionProbeSystem(request)`. The UI sends a saved connection id and only the same prompt credentials already supplied by the user for the current connection attempt; Rust reloads all saved target and credential fields, probes `/etc/os-release`, and returns the updated `ConnectionProfile`.
- The connection preparation page owns startup, host-key confirmation, prompt credentials, retry, edit, and failure UI. A terminal tab is created only after `terminalConnect` returns a session id.
- The same-connection "new terminal" action must only be visible after the active terminal has a connected `sessionId`. When used inside an already active session, it must create a terminal tab directly and call `terminalConnect` with the saved `connection_id`; it must not call `startConnectionStep(...)` or show the connection-preparation page. If this direct connect fails, keep the lightweight terminal tab in a failed state instead of routing the user back into the preparation flow.
- `TerminalPanel` receives an already-created `initialSessionId`; it must not start a second SSH connection for that tab.
- During terminal handoff, match terminal output/state events by `request_id` as well as by `session_id`; shell prompts can arrive before the frontend receives the returned session id.
- Keep the terminal handoff warmup listener alive briefly after replacing the connecting tab, and make `TerminalPanel` consume appended `initialOutput` bytes. Otherwise the remote prompt can land between `terminalConnect` resolving and the xterm listener mounting, leaving a connected but visually blank terminal while remote file browsing works.
- `TerminalPanel` should buffer startup handoff output briefly and write it as one ordered batch with early live events. If the combined startup batch contains a duplicated leading shell prompt before a login banner / motd and the same prompt appears again at the end, remove only that leading duplicate before writing to xterm. If the prompt is joined to the first banner line, such as `root@host:~# Welcome to ...`, strip only the prompt prefix and keep the banner text. If warmup and live capture the same leading login banner block before the first prompt, keep one copy of that startup banner. If warmup and live capture produce adjacent duplicate prompts such as `[root@host ~]# [root@host ~]#`, collapse them to a single prompt before writing.
- Local Windows terminals must call `getWindowsPtyInfo()` and pass the mapped `{ backend, buildNumber }` object to `TerminalPanel`. xterm uses the build number to decide ConPTY reflow behavior; a bare `{ backend: "conpty" }` can keep older wrapping heuristics enabled on modern Windows builds.
- Do not store terminal session runtime state inside a `ConnectionProfile`. Connection profiles are persistent data; terminal tabs and session ids are runtime state.
- Do not log passwords, private-key passphrases, or full command payloads.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| `connectionList` fails in a browser preview without Tauri | Show the static fallback profile from `useConnections` so the layout remains inspectable. |
| `connectionUpsert` rejects validation | Surface the Rust `AppError.message` as user-facing form feedback. |
| `connectionTestProfile` rejects validation or connection setup | Keep the dialog open, show the Rust `AppError.message`, and do not add or update the connection list. |
| `connectionTestProfile` returns `host_key_unknown` | Keep the dialog open, show an inline host-key confirmation card with the returned host, port, algorithm, and SHA256 fingerprint, then call `knownHostTrust(hostKey)` and rerun `connectionTestProfile(input)` only after the user clicks trust. |
| `connectionTestProfile` returns `host_key_changed` | Keep the dialog open, show a high-risk inline confirmation card with old and current SHA256 fingerprints, then call `knownHostTrust(hostKey)` and rerun `connectionTestProfile(input)` only after the user explicitly updates trust. |
| `credentialList` fails in a browser preview without Tauri | Show preview credentials from `useCredentials` so the credential management layout remains inspectable. |
| `credentialUpsert` rejects validation | Surface the Rust `AppError.message` near the credential form. |
| `credentialDelete` returns `credential_in_use` | Keep the credential, show that existing connections must be edited before deletion, and do not remove local UI state. |
| Delete is requested | Confirm with `window.confirm` before calling `connectionDelete`. |
| Latency probe runs in browser preview without Tauri | Use a stable preview latency so the home table remains inspectable. |
| Latency probe returns `reachable: false` | Show a timeout/unreachable state in the latency cell without replacing the connection list error. |
| Credential mode changes to `saved` | Clear inline secret fields before submit and require `credential_id`. |
| Credential mode changes to `inline` | Clear `credential_id` and use inline auth kind fields. |
| Credential mode changes to `prompt` | Clear saved/inline secrets and collect runtime credentials only on the connection step. |
| Auth kind changes to `password` | Clear private-key fields in form state. |
| Auth kind changes to `private_key` | Clear password in form state. |
| Network path changes to SSH jump but no jump connection is selected | Keep the dialog open, switch to the `网络路径` tab, show inline dialog feedback, and do not save, test, or normalize the payload to direct. |
| `connection_terminal_encoding_invalid` | Keep the dialog open, switch to the `高级` tab, and show the Rust validation message. |
| `terminalConnect` fails before session id exists | Keep the connection-preparation tab open and show structured failure, retry, edit, and close actions. |
| Same-connection new terminal direct connect fails | Keep the direct terminal tab visible with a compact failed state; do not replace it with the connection-preparation page. |
| Shell output arrives before or immediately after `terminalConnect` resolves | Capture warmup output by `request_id`, pass it into `TerminalPanel` as initial output, and append any late handoff bytes until the xterm listener is ready. |

### 5. Good / Base / Bad Cases

- Good: `ConnectionDialog` holds editable strings, clears fields when credential or auth mode changes, and delegates normalization to `useConnections` before saving.
- Good: `ConnectionDialog` tests the current unsaved form through `connectionTestProfile(input)`, leaving the connection repository unchanged until the user clicks save.
- Good: `SettingsView` edits saved login-account records through `useCredentials`; it asks for username plus password or private key material, and never asks for host or port in account management.
- Base: `ConnectionPane` displays `username@host:port`, calls `onOpen(connection)`, and does not know about Tauri details.
- Bad: A component calls `invoke("connection_upsert", ...)` directly, tests an unsaved dialog form by saving/upserting it first, stores runtime session ids inside `ConnectionProfile`, or sends raw passwords to remote-file commands.

### 6. Tests Required

- Run `pnpm check` after changing command wrappers, connection types, credential types, terminal request types, or component props that carry command payloads.
- Run `node scripts/check-connection-jump-source.mjs` after changing SSH jump profile fields, network path UI, connection normalization, or backend jump persistence.
- Run `node scripts/check-connection-terminal-encoding-source.mjs` after changing terminal encoding profile fields, advanced-tab UI, connection normalization, or backend terminal encoding behavior.
- Run `node scripts/check-connection-dialog-host-key-feedback.mjs` after changing `ConnectionDialog`, host-key error parsing, or connection-test feedback styles.
- Run `node scripts/check-terminal-startup-output-source.mjs` after changing `TerminalPanel` startup output buffering or prompt deduplication.
- Run `node scripts/check-terminal-interactive-pty-source.mjs` after changing `TerminalPanel` xterm options or local Windows terminal creation props.
- Run `node scripts/check-terminal-resize-debounce-source.mjs` after changing `TerminalPanel` fit / resize observer / backend resize synchronization.
- Run `node scripts/check-remote-file-editor-source.mjs` after changing `ConnectionDialog`, `WorkspaceShell` dialog test handlers, or connection command wrappers so the no-save dialog-test guard is checked.
- Run `node scripts/check-remote-file-editor-source.mjs` after changing workspace terminal tab creation, so the same-connection new terminal path stays separate from the connection-preparation page.
- Run `node scripts/check-workspace-ssh-activation-source.mjs` after changing workspace terminal tab creation or top-level workspace switching, so opening SSH from the local terminal workspace still reveals the SSH session.
- Add focused tests once the frontend test runner exists for credential-mode field clearing, credential delete handling, host-key recoverable states, fallback behavior, and error display.
- Cross-check changed TypeScript payload fields against `src-tauri/src/commands.rs` and `src-tauri/src/connections/mod.rs` in the same task.
- Run `node scripts/check-connection-system-icon.mjs` after changing connection system icon inference, remote OS profile fields, or the system probe wrapper.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("connection_upsert", { profile });
```

#### Correct

```tsx
await connectionUpsert({
  ...input,
  inline_password: input.inline_password?.trim() || undefined,
  inline_private_key_path: input.inline_private_key_path?.trim() || undefined,
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

- Run `pnpm check` after changing `remoteFileList`, `RemoteFileEntry`, `RemoteFilePanel`, `TerminalPanel`, or `WorkspaceShell` path handoff props.
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
remoteFileMetadata(connectionId: string, path: string): Promise<RemoteFileEntryMetadata>
remoteFileCheckPath(connectionId: string, path: string): Promise<RemoteFilePathCheckResult>
remoteFileUploadFile(input: RemoteFileUploadInput): Promise<RemoteFileUploadResult>
remoteFileUploadLocalFile(input: RemoteFileUploadLocalInput): Promise<RemoteFileUploadResult>
remoteFileUploadArchive(input: RemoteFileArchiveUploadInput): Promise<RemoteFileArchiveUploadResult>
remoteFileUploadLocalArchive(input: RemoteFileArchiveUploadLocalInput): Promise<RemoteFileArchiveUploadResult>
remoteFilePrepareUploadTemp(fileName: string): Promise<LocalUploadTempResult>
remoteFileAppendUploadTemp(localPath: string, chunk: Uint8Array | number[]): Promise<void>
remoteFileDeleteUploadTemp(localPath: string): Promise<void>
localPathMetadata(path: string): Promise<LocalPathMetadataResult>
remoteFileDownload(connectionId: string, path: string): Promise<RemoteFileDownloadResult>
remoteFileCheckDownloadTarget(input: RemoteFileDownloadTargetCheckInput): Promise<RemoteFileDownloadTargetCheckResult>
remoteFileDownloadToLocal(input: RemoteFileDownloadToLocalInput): Promise<RemoteFileDownloadToLocalResult>
remoteFileCancelTransfer(transferId: string): Promise<boolean>
listenRemoteFileTransferProgress(handler: (event: RemoteFileTransferProgressEvent) => Promise<UnlistenFn>
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

type RemoteFileEntryMetadata = RemoteFileMetadata & {
  type: "directory" | "file" | "symlink" | "other";
};

type RemoteFilePathCheckResult = {
  exists: boolean;
  path: string;
  type?: "directory" | "file" | "symlink" | "other" | null;
};

type RemoteFileTransferConflictPolicy = "ask" | "overwrite" | "skip" | "rename";

type RemoteFileUploadInput = {
  connectionId: string;
  path: string;
  content: Uint8Array | number[];
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  transferId?: string;
};

type RemoteFileUploadResult = {
  metadata?: RemoteFileMetadata | null;
  name: string;
  path: string;
  skipped: boolean;
};

type RemoteFileUploadLocalInput = {
  connectionId: string;
  path: string;
  localPath: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  transferId?: string;
};

type RemoteFileArchiveUploadInput = {
  archiveContent: Uint8Array | number[];
  connectionId: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  keepArchive?: boolean;
  rootName: string;
  targetDir: string;
  transferId?: string;
};

type RemoteFileArchiveUploadLocalInput = {
  connectionId: string;
  localPath: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  keepArchive?: boolean;
  rootName: string;
  targetDir: string;
  transferId?: string;
};

type LocalUploadTempResult = {
  local_path: string;
};

type LocalPathMetadataResult = {
  kind: "directory" | "file" | "other";
  name: string;
  path: string;
};

type RemoteFileDownloadTargetCheckInput = {
  connectionId: string;
  path: string;
  directory?: boolean;
  downloadRoot?: string;
  groupBySession?: boolean;
  sessionName?: string;
  timestampDirectory?: boolean;
  timestampName?: string;
};

type RemoteFileDownloadTargetCheckResult = {
  directory: boolean;
  exists: boolean;
  local_directory: string;
  local_path: string;
  name: string;
  remote_path: string;
};

type RemoteFileDownloadToLocalInput = {
  connectionId: string;
  path: string;
  directory?: boolean;
  downloadRoot?: string;
  groupBySession?: boolean;
  keepArchives?: boolean;
  sessionName?: string;
  timestampDirectory?: boolean;
  timestampName?: string;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  transferId?: string;
};

type RemoteFileDownloadToLocalResult = {
  archive_path?: string | null;
  directory: boolean;
  local_directory: string;
  local_path: string;
  name: string;
  remote_path: string;
  skipped: boolean;
};

type RemoteFileTransferProgressEvent = {
  transfer_id: string;
  direction: "upload" | "download";
  loaded_bytes: number;
  total_bytes?: number | null;
};
```

### 3. Contracts

- UI components must call the typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("remote_file_*", ...)` directly from feature components.
- Wrapper request keys must match Rust exactly: `connection_id`, `path`, `content`, `expected_mtime`, `expected_size`, `overwrite`, `new_path`, `recursive`, `conflict_policy`, `target_dir`, `root_name`, `archive_content`, `local_path`, `file_name`, `chunk`, `keep_archive`, `directory`, `download_root`, `group_by_session`, `keep_archives`, `session_name`, `timestamp_directory`, `timestamp_name`, and `transfer_id`.
- `connectionId` is always the saved `ConnectionProfile.id`. Do not send host, username, password, private-key path, or passphrase from React for file editor commands.
- `WorkspaceShell` owns open file tabs and must de-duplicate by `connectionId + path`; opening the same file again activates the existing tab.
- `RemoteFileEditor` owns Monaco lifecycle only. Command calls, dirty close confirmation, save conflict dialogs, and tree refresh orchestration stay in `WorkspaceShell` / file panel integration.
- Save must send the last opened/saved `metadata.mtime` and `metadata.size` as `expectedMtime` and `expectedSize`. Use `overwrite: true` only after the user chooses to overwrite a conflict.
- Dirty file close must use the project dialog pattern, not `window.confirm`, so unsaved edits are not silently lost and styling stays consistent.
- Binary or too-large read failures must not create an editable Monaco model. Keep the tab content safe and show retry/close or download-oriented UI.
- Browser preview must not fire real upload/download or SSH commands when Tauri is unavailable; preview-only mock behavior is acceptable for layout checks.
- Legacy byte upload wrappers convert `Uint8Array | number[]` to a plain number array before invoking Rust, but WorkspaceShell must not use them for real desktop uploads. Toolbar and context-menu uploads must use the Tauri dialog wrapper to get real local paths, then call `remoteFileUploadLocalFile(...)` or `remoteFileUploadLocalArchive(...)` with that original `localPath` so there is no pre-upload cache copy. Browser `File` uploads from drag/drop are the fallback path: they may write small chunks into a backend-owned local upload temp file before calling the same local upload wrappers because the browser does not expose a trusted original file path.
- Windows/Tauri native file drops must use `getCurrentWebview().onDragDropEvent(...)` to receive absolute local paths, resolve the remote target from `data-remote-file-drop-target`, call `localPathMetadata(...)`, then dispatch files to `remoteFileUploadLocalFile(...)` and directories to `remoteFileUploadLocalArchive(...)`.
- File upload, directory upload, and download-to-local calls may pass `transferId`. The value must be the matching `RemoteFileTransferItem.id`, and `WorkspaceShell` must listen for `remote_file:transfer_progress` events to update bytes, progress, and transfer speed for that item only.
- Queued and running transfer rows must expose cancellation. Queued cancellation is local UI state; running cancellation calls `remoteFileCancelTransfer(transferId)` and treats `remote_file_transfer_canceled` as a canceled state, not a failed transfer.
- Remote transfer progress events are advisory UI events. The command result remains the source of truth for success, skipped state, final remote path, and final local path.
- Folder upload from the Tauri dialog or native file drop must pass the selected directory path to `remoteFileUploadLocalArchive(...)` and let Rust scan/upload it over SFTP. Do not pulse fake progress or show archive/extract copy for this real desktop path.
- Browser preview or browser-only `File` fallback may still stream tar entries into `CompressionStream("gzip")` and persist gzip output chunks with `remoteFileAppendUploadTemp(...)` because the browser does not expose trusted original directory paths. Keep this path visually separate from the Tauri desktop SFTP path.
- Folder download and file download from the desktop app should call `remoteFileCheckDownloadTarget(...)` when the default conflict policy is `ask`, then `remoteFileDownloadToLocal(...)` so Rust resolves the system/custom download directory and writes to disk. Browser Blob download is only acceptable as a preview fallback.
- `conflictPolicyDefault: "ask"` must be resolved in UI before invoking Rust. Upload flows must call `remoteFileCheckPath(...)` for the exact target path and prompt only when `exists === true`; missing targets should continue with `rename` as the non-destructive default. Rust receives only `overwrite`, `skip`, or `rename`; if an old caller sends `ask`, the wrapper/backend must keep non-destructive behavior.
- Upload preflight must be lightweight: check only the target file path or directory root (`targetDir/rootName`) before local scanning or SFTP transfer. Do not list large parent directories or scan folder contents just to decide whether to show the conflict prompt.
- Download preflight must reuse the exact same download-root, connection grouping name (`sessionName`), timestamp, and grouping options as the subsequent download command. Prompt only when `remoteFileCheckDownloadTarget(...)` reports the resolved local target already exists; otherwise continue with `rename` as the non-destructive default.
- The download `sessionName` segment is the connection grouping name: derive it from `ConnectionProfile.name`, fall back to `ConnectionProfile.host`, then `mxterm-session`. Do not use the active terminal tab title such as the default `终端`, because terminal tabs are runtime UI state and should not change the local download directory.
- File transfer settings live under `settings.fileTransfer` and include `downloadRoot`, `groupBySession`, `timestampDirectory`, `timestampFormat`, `keepArchives`, and `conflictPolicyDefault`.
- `settings.fileTransfer.downloadRoot` is optional. Blank means Rust resolves the system Downloads directory; the settings UI should make that clear through the row copy and placeholder, allow manual path entry, and offer a Tauri directory picker for choosing a custom root.
- Copy path actions copy the remote absolute path only. Create-file, create-directory, and rename dialogs edit the entry basename only, show the parent directory as read-only context, and submit `joinRemotePath(parentPath, name)` / `joinRemotePath(remotePathParent(entry.path), newName)`. Do not prefill or accept a full remote path in these dialogs; slash-containing input should show a name-only validation message.

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
| Upload target exists and default policy is `ask` | Prompt for rename / skip / overwrite after `remoteFileCheckPath(...)` confirms the exact remote target exists, before local archive creation or upload. |
| Upload target does not exist and default policy is `ask` | Do not prompt; continue with `rename` so backend behavior stays non-destructive if a race creates the target later. |
| Upload preflight fails | Mark the transfer as failed at the preflight stage and do not build archives or start SSH upload. |
| Download target exists and default policy is `ask` | Prompt for rename / skip / overwrite after `remoteFileCheckDownloadTarget(...)` confirms the resolved local target exists. |
| Download target does not exist and default policy is `ask` | Do not prompt; continue with `rename` so backend behavior stays non-destructive if a race creates the target later. |
| Transfer progress event arrives for another `transfer_id` | Ignore it; never update unrelated transfer rows. |
| SFTP progress has `total_bytes` | Show `loaded / total`, speed, and a determinate bar based directly on `loaded_bytes / total_bytes`; do not map real bytes into an old staged range such as 38%-92%. |
| Legacy or preview progress has no `total_bytes` | Show bytes received and speed, keep an indeterminate progress bar until the command resolves. |
| Single file upload succeeds with rename | Update the transfer item to the returned `path` and refresh the returned parent directory. |
| Folder upload succeeds | Show directory upload completion, then refresh the returned parent directory. |
| Download to local succeeds | Show `local_path` in the transfer panel. File downloads offer copy/open/reveal actions; directory downloads offer copy/reveal only, because revealing the folder is clearer than opening it as a generic shell target. |
| Download returns `skipped: true` | Keep a skipped transfer item instead of treating it as an error. |
| Running transfer is canceled | Mark the row canceled, clear fake progress/pulse state, and do not show a failure toast for `remote_file_transfer_canceled`. |

### 5. Good / Base / Bad Cases

- Good: a file row double-click calls `openRemoteFile(connection.id, entry.path)`, `WorkspaceShell` reuses an existing tab when present, `remoteFileRead` loads content, Monaco edits the model, and `remoteFileWrite` saves with expected metadata.
- Good: a toolbar upload-file action opens the Tauri dialog, receives one or more local paths, preflights the exact remote target with `remoteFileCheckPath`, calls `remoteFileUploadLocalFile` directly for each path, and does not show a "write upload cache" stage.
- Good: a file download action computes one timestamp/options object, checks `remoteFileCheckDownloadTarget(...)`, prompts only when the local target exists, then passes the same options into `remoteFileDownloadToLocal(...)`.
- Good: a local directory drop resolves to an absolute native path, calls `remoteFileUploadLocalArchive` once with the matching `transferId`, lets Rust scan/upload over SFTP, and reports real loaded/total progress in the transfer panel.
- Good: `WorkspaceShell` listens to `remote_file:transfer_progress`, matches by `transfer_id`, and displays `loaded / total` plus `MB/s` while the command is still running.
- Good: the user clicks cancel on a running transfer, `WorkspaceShell` calls `remoteFileCancelTransfer`, and a later `remote_file_transfer_canceled` command error leaves the row canceled rather than failed.
- Base: a user creates `/tmp/app.conf`; React calls `remoteFileCreateFile(connection.id, path)`, refreshes the parent directory, then opens the new file tab.
- Bad: a component stores passwords in file action state, calls `invoke("remote_file_write", ...)` directly, uploads every folder child through separate commands from React, shows fake pulse progress over real SFTP events, or closes a dirty Monaco tab without confirmation.

### 6. Tests Required

- Run `node scripts/check-remote-file-editor-source.mjs` after changing remote editor wrappers, Monaco integration, file tab state, or file panel actions.
- The source check must cover `remoteFileMetadata`, `remoteFileCheckPath`, upload conflict preflight, `remoteFileCheckDownloadTarget`, download conflict preflight, `remoteFileUploadLocalFile`, `remoteFileUploadLocalArchive`, Tauri dialog upload helpers, drag/drop upload temp helpers, `remoteFileDownloadToLocal`, drag upload/download handlers, `CompressionStream("gzip")`, `webkitdirectory`, `fileTransfer` settings, and basename-only rename.
- The source check must cover `transfer_id`, `remote_file:transfer_progress`, `remoteFileCancelTransfer`, speed text, streamed tar/gzip preview helpers, and progressbar markup whenever transfer UI or command wrappers change.
- Run `pnpm check` after changing TypeScript command payloads, editor types, or workspace/file panel props.
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

#### Wrong

```tsx
// Uploads a folder with one frontend command per child and loses directory-level conflict handling.
for (const file of files) {
  const { local_path: localPath } = await remoteFilePrepareUploadTemp(file.name);
await writeFileToUploadTemp(localPath, file);
await remoteFileUploadLocalFile({ connectionId, path: `${targetDir}/${file.name}`, localPath });
}
```

#### Correct

```tsx
await remoteFileUploadLocalArchive({
  connectionId,
  localPath: selectedDirectoryPath,
  targetDir,
  rootName,
  conflictPolicy,
  transferId,
});
```

#### Wrong

```tsx
// Progress events are applied globally, so one download can update another row.
listenRemoteFileTransferProgress((event) => {
  setTransfers((items) => items.map((item) => ({ ...item, progressDetail: event.loaded_bytes })));
});
```

#### Correct

```tsx
listenRemoteFileTransferProgress((event) => {
  setTransfers((items) =>
    items.map((item) =>
      item.id === event.transfer_id ? updateTransferProgress(item, event) : item,
    ),
  );
});
```

## Scenario: Remote Monitor Wrappers

### 1. Scope / Trigger

- Trigger: a React feature calls, changes, or adds remote monitor snapshot or process signaling commands.
- Source files: `src/shared/tauri/commands.ts`, `src/features/monitor/monitorTypes.ts`, `src-tauri/src/commands.rs`, and `src-tauri/src/remote_monitor.rs`.
- This is a cross-layer command contract because the UI renders a narrow monitoring panel from Rust-owned Linux SSH collection data.

### 2. Signatures

```ts
remoteMonitorSnapshot(
  connectionId: string,
  options?: { includeProcesses?: boolean; processLimit?: number },
): Promise<RemoteMonitorSnapshot>

remoteMonitorProcessSignal(input: {
  connectionId: string;
  pid: number;
  signal: "term" | "kill" | "hup";
}): Promise<RemoteProcessActionResult>
```

Wrapper payloads must match Rust:

```ts
invoke<RemoteMonitorSnapshot>("remote_monitor_snapshot", {
  request: {
    connection_id: connectionId,
    include_processes: options.includeProcesses ?? false,
    process_limit: options.processLimit,
  },
});
```

### 3. Contracts

- Components must call `remoteMonitorSnapshot(...)` and `remoteMonitorProcessSignal(...)`; do not call `invoke("remote_monitor_*")` directly.
- UI sends only the saved `connectionId`, process `pid`, and enum `signal`. Do not send host, port, credentials, raw shell commands, proxy, or jump data from React.
- Frontend monitor types live in `src/features/monitor/monitorTypes.ts` and mirror Rust `snake_case` serialized fields.
- `gpus: []` means no GPU card should render. Do not show placeholder GPU rows.
- `cpu.temperature_celsius == null` or `gpu.temperature_celsius == null` means hide the temperature metric for that device.
- CPU topology labels must distinguish physical cores from logical threads. Do not label `logical_cores` or `cpu.cores.length` as physical cores when `physical_cores` is unavailable.
- When `cpu.is_virtualized` is true, monitor cards should present logical CPUs as `vCPU` and avoid showing guest socket/core values as real physical cores.
- When an old or partially detected payload reports an implausible topology such as `physical_cores: 1` and `logical_cores: 8`, the UI should treat the physical count as unreliable and display only the logical thread count, for example `8 线程`, instead of `1 核 / 8 线程`.
- The memory card should label `memory.used_bytes` as occupied/unavailable memory, not as the `free` command's `used` column. Show total memory and Swap as text rows outside the donut; render Swap even when the total is `0`.
- Disk device counts and hardware storage totals must use backend-normalized `disks.devices`; React should label them as storage devices and must not count raw partitions, loop devices, ROMs, LVM child volumes, or zram nodes in the UI.
- First-sample CPU, disk, and network rate fields may be `null`. The UI should keep the card stable and wait for the next snapshot rather than inventing a value.
- Polling must not overlap monitor snapshot requests. Schedule the next poll only after the previous snapshot request finishes, or explicitly skip while one is in flight, so a slow SSH collector cannot build a backend request queue.
- Hardware view is mostly static and should use a longer refresh interval such as 30 seconds or manual refresh, while status/network/process views can keep their shorter real-time intervals.
- Process destructive actions must require explicit confirmation before calling `remoteMonitorProcessSignal(...)`.
- Process rows must remain visible or show inline failure when signaling returns an error; do not remove a process row until a follow-up snapshot confirms it disappeared.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No active SSH connection | Render monitor empty state and do not call the wrapper. |
| Snapshot command returns `remote_monitor_connection_missing` or `connection_missing` | Show connection-level error and stop polling. |
| Snapshot command returns recoverable SSH/collector error | Show retry affordance and keep previous snapshot if available. |
| Section data contains source errors | Show a light card-level warning while rendering other sections. |
| `gpus` is empty | Hide all GPU cards/rows. |
| Temperature is `null` | Hide temperature metric; do not render `N/A`. |
| Process signal fails | Show row-level failure and keep the row. |
| Browser preview has no Tauri runtime | Use mock data only for visual inspection; do not fire real SSH commands. |

### 5. Good / Base / Bad Cases

- Good: `MonitorPanel` asks for `remoteMonitorSnapshot(activeConnection.id, { includeProcesses: activeTab === "processes" })` and renders the typed response.
- Good: `useRemoteMonitor` waits for the current snapshot request to finish before scheduling the next poll and uses a longer hardware-view interval so mostly static hardware data does not drive high-frequency SSH collection.
- Good: process termination opens the shared confirmation dialog, then calls `remoteMonitorProcessSignal({ connectionId, pid, signal: "term" })`.
- Base: a no-GPU host returns `gpus: []`, so the status and hardware tabs omit GPU sections.
- Base: the first snapshot has `disk.io[].read_bytes_per_sec: null`; the UI keeps the disk card visible with pending/neutral speed copy.
- Bad: a component calls `invoke` directly, sends raw command text, shows fake GPU placeholders, or renders `N/A` temperature cards after Rust returns `null`.

### 6. Tests Required

- Run `pnpm check` after changing `monitorTypes.ts`, command wrappers, hook props, or monitor components.
- Run `node scripts/check-monitor-cpu-topology-source.mjs` after changing monitor CPU topology formatter behavior.
- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_monitor --lib` and `cargo check --manifest-path src-tauri/Cargo.toml` when frontend type changes require Rust payload changes.
- Add focused frontend tests once the test runner exists for no-GPU hiding, null-temperature hiding, process confirmation, non-overlapping polling, hardware-view refresh cadence, and polling pause behavior.
- Browser/desktop visual checks must compare monitor UI against `prototype/light-neutral/mxterm-monitor-panel.html` before accepting UI migration.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("remote_monitor_snapshot", { command: "cat /proc/stat" });
```

#### Correct

```tsx
await remoteMonitorSnapshot(connection.id, { includeProcesses: activeTab === "processes" });
```

#### Wrong

```tsx
await remoteMonitorProcessSignal({ connectionId, pid, signal: userTypedSignal as any });
```

#### Correct

```tsx
await remoteMonitorProcessSignal({ connectionId, pid, signal: "term" });
```

## Scenario: SSH Tunnel Wrappers and Panel

### 1. Scope / Trigger

- Trigger: frontend code adds or changes SSH tunnel commands, tunnel types, the right-pane tunnel tool, prompt credential UI, host-key retry UI, or tunnel autostart wiring.
- Source files: `src/shared/tauri/commands.ts`, `src/features/tunnels/tunnelTypes.ts`, `src/features/tunnels/TunnelPanel.tsx`, `src/features/files/RemoteFilePanel.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src-tauri/src/commands.rs`, and `src-tauri/src/tunnels.rs`.
- This is a cross-layer command contract because React edits typed tunnel rules and Rust owns persistence, saved SSH resolution, local listener lifecycle, and runtime state.

### 2. Signatures

```ts
tunnelList(): Promise<TunnelRuleWithState[]>
tunnelUpsert(request: TunnelRuleInput): Promise<TunnelRuleWithState>
tunnelDelete(ruleId: string): Promise<void>
tunnelStart(ruleId: string, runtimeCredential?: TunnelRuntimeCredentialInput): Promise<TunnelRuleWithState>
tunnelStop(ruleId: string): Promise<TunnelRuleWithState>
tunnelAutostart(): Promise<TunnelRuleWithState[]>
```

Frontend types mirror Rust snake_case fields:

```ts
type TunnelKind = "local" | "remote" | "dynamic";
type TunnelStatus = "stopped" | "starting" | "running" | "failed" | "credential_required";

interface TunnelRuleInput {
  id?: string;
  name?: string;
  kind: TunnelKind;
  connection_id: string;
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
}

interface TunnelRuntimeCredentialInput {
  auth_kind?: "password" | "private_key";
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}
```

### 3. Contracts

- Components must call the typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("tunnel_*")` directly from feature components.
- Wrapper payload keys must match Rust command parameters exactly: `tunnel_upsert` uses `{ request }`; `tunnel_delete`, `tunnel_start`, and `tunnel_stop` wrap `rule_id` under `request`.
- The UI may use editable strings for ports while the dialog is open, but it must convert to integer `1..=65535` before calling `tunnelUpsert`.
- The UI sends only a saved `connection_id` and tunnel rule fields. It must not send saved connection host, port, proxy, jump, password, private-key passphrase, or command strings.
- Prompt credentials are collected only after backend returns `credential_prompt_required` from a manual start. They are passed to `tunnelStart` once and are not stored in React rule state after the start succeeds.
- Host-key errors from tunnel start must be parsed with the shared host-key parser, trusted through `knownHostTrust(...)`, and then retried with the same optional runtime credential.
- Delete actions must remove a tunnel row only after `tunnelDelete(...)` succeeds. If delete fails, keep the row, show the `AppError.message`, close the confirmation dialog, and refresh the list so React does not drift from Rust runtime state.
- `TunnelPanel` may refresh and list rules, but app-level autostart belongs in `WorkspaceShell` mount so auto-start rules run even if the user never opens the tunnel tab.
- The right-pane entry is `RemoteFileTool = "files" | "transfers" | "monitor" | "tunnels"`; the tunnel panel should be passed through the existing `RemoteFilePanel` tool slot.
- Tunnel UI must use Radix Dialog, Lucide icons, `AppSelect`, shared confirmation dialog, and global `--mx-*` tokens. Do not use native `<select>` or feature-local dropdown popovers.
- A visible `running` state means data was written to the local forwarding machinery, not that the remote target command or service succeeded.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No saved SSH connections | Disable new-rule action and show the tunnel empty state. |
| Dialog has blank connection/local host/remote host | Keep the dialog open and show inline validation. |
| Port text is not an integer in `1..=65535` | Keep the dialog open and show inline validation. |
| `credential_prompt_required` from manual start | Open the one-time credential dialog; do not persist the credential. |
| `host_key_unknown` or `host_key_changed` from manual start | Open host-key confirmation, call `knownHostTrust`, then retry the same tunnel start. |
| Start/stop/delete/upsert returns `AppError` | Show `AppError.message` in the panel or dialog and refresh list state when useful. |
| `tunnelList` returns `Command tunnel_list not found` in a live Tauri session after frontend hot update | Treat it as a backend-restart/version mismatch state: show a neutral unavailable empty state that asks the user to restart the app, and do not show the red inline error. |
| Browser preview has no Tauri runtime | Use deterministic preview tunnel data only for visual inspection. |

### 5. Good / Base / Bad Cases

- Good: `TunnelPanel` submits `kind: "local"`, `connection_id`, local bind host/port, remote target host/port, and `auto_start`, then renders the returned `TunnelRuleWithState`.
- Good: Workspace startup calls `tunnelAutostart()` once in the shell; opening the tunnel tab later calls `tunnelList()` to render current runtime state.
- Good: a prompt-credential tunnel start opens a one-time password/private-key dialog and retries with `runtime_credential` only for that request.
- Base: browser preview shows a fake stopped tunnel so CSS/layout can be inspected without a Tauri runtime.
- Bad: a component calls `invoke("tunnel_start")` directly, stores runtime credentials in `TunnelRule`, uses native `<select>`, or reports command execution success from tunnel delivery state.

### 6. Tests Required

- Run `npm run check` after changing tunnel types, wrappers, `TunnelPanel`, `RemoteFilePanel` tool props, or `WorkspaceShell` autostart wiring.
- Cross-check frontend tunnel types and wrapper payloads against Rust structs in `src-tauri/src/tunnels.rs` and command signatures in `src-tauri/src/commands.rs`.
- Browser/desktop visual checks should cover empty state, list state, failed state, prompt credential dialog, host-key dialog, and dark theme token contrast when UI work is visible.
- Run Rust tunnel tests/checks when backend payload changes require them and compile/test runs are approved for the session.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("tunnel_start", {
  rule_id: rule.id,
  password: prompt.password,
});
```

#### Correct

```tsx
await tunnelStart(rule.id, {
  auth_kind: "password",
  password: prompt.password,
});
```

## Scenario: Window Material Commands

### 1. Scope / Trigger

- Trigger: a React feature changes native window backdrop/material behavior, appearance settings normalization, or the `get_supported_window_materials` / `set_window_material` Tauri commands.
- Source files: `src/shared/tauri/commands.ts`, `src/shared/tauri/windowMaterial.ts`, `src/features/settings/settingsTypes.ts`, `src/features/layout/WorkspaceShell.tsx`, `src/features/settings/SettingsView.tsx`, `src/styles/tokens.css`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, and `src-tauri/src/commands.rs`.
- This is a cross-layer command contract because React owns persisted appearance settings while Rust owns platform support and native DWM application.

### 2. Signatures

```ts
type WindowMaterialMode = "auto" | "mica" | "acrylic" | "micaAlt";

type NativeWindowMaterial = {
  id: number;
  name: string;
};

getSupportedWindowMaterialsCommand(): Promise<NativeWindowMaterial[]>
setWindowMaterialCommand(material: number): Promise<NativeWindowMaterial>

getSupportedWindowMaterials(): Promise<WindowMaterialMode[]>
setWindowMaterial(material: WindowMaterialMode): Promise<boolean>
normalizeWindowMaterial(
  material: WindowMaterialMode,
  supportedMaterials: readonly WindowMaterialMode[],
): WindowMaterialMode
```

Material ids:

```ts
auto = 0
mica = 2
acrylic = 3
micaAlt = 4
```

### 3. Contracts

- Frontend components must not call `invoke("get_supported_window_materials")` or `invoke("set_window_material")` directly. Use `src/shared/tauri/commands.ts` wrappers or the higher-level `src/shared/tauri/windowMaterial.ts` helpers.
- `appearance.windowMaterial` is persisted as the string union `WindowMaterialMode`, never as the numeric native id.
- `WorkspaceShell` must normalize the persisted setting against the supported-material list before writing `data-window-material` or calling the native setter.
- `.app-shell` must expose the effective material through `data-window-material` so CSS fallback tokens work in browser preview and unsupported platforms.
- `.app-shell` must expose `data-platform` from `resolveDesktopPlatform()` so platform-specific chrome CSS can match the native material behavior.
- Browser preview must not throw when Tauri is absent. `getSupportedWindowMaterials()` returns a platform-derived fallback and `setWindowMaterial()` returns `false`.
- Unsupported platform or command failure must be fail-safe. The UI should keep a coherent CSS fallback and eventually normalize the setting to `auto` when the supported list contains only `auto`.
- CSS material visuals belong in token/style files. Native material commands should not be required for the app to look coherent in preview.
- The desktop window must allow the WebView to reveal native material. Keep the main window `transparent: true` in `src-tauri/tauri.conf.json` and provide an initial `windowEffects.effects` entry such as `mica`; runtime material changes still flow through `setWindowMaterial(...)`.
- Tauri startup may apply the initial Windows backdrop in `src-tauri/src/lib.rs` setup (for example Mica id `2`) so the native material is visible before React settings finish loading. `WorkspaceShell` remains the owner of persisted runtime material changes after the frontend mounts.
- CSS fallback material should be chrome-focused: root `.app-shell` material layer, `.custom-titlebar`, and shared `.app-sidebar` rails use the material tokens, while main workspace/settings content remains on clear panel surfaces.
- `auto` is the non-material fallback mode, not a transparent material reveal mode. CSS must keep the chrome backed by an opaque fallback layer such as root `.app-shell::before` using `--mx-chrome-fill` across the titlebar and sidebars; reserve native transparent reveal for `mica`, `acrylic`, and `micaAlt`.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Use `getPlatformWindowMaterials(resolveDesktopPlatform())`; do not call native commands. |
| Native supported-material query fails | Fall back to the platform-derived material list. |
| Native query returns an unknown id | Drop that id during normalization. |
| Native query returns an empty list | Fall back to the platform-derived material list. |
| Persisted material is not supported | Normalize to the first supported value, usually `auto`, and persist the normalized value. |
| `set_window_material` rejects | Swallow the error in the helper and keep CSS fallback active. |
| User selects a material in Settings | Update `appearance.windowMaterial`; `WorkspaceShell` owns native application as a side effect. |

### 5. Good / Base / Bad Cases

- Good: `SettingsView` renders material options from `supportedWindowMaterials`, writes a `WindowMaterialMode`, and lets `WorkspaceShell` normalize and apply the native side effect.
- Good: browser preview on Windows shows codem-style material choices as CSS fallback, while a Tauri desktop build replaces that with the Rust-reported support list.
- Base: non-Windows platforms expose only `auto`; the setting row remains stable and the app uses CSS material tokens.
- Bad: a component persists `2` for Mica, calls `invoke("set_window_material", ...)` directly, or assumes every Windows version supports Acrylic.

### 6. Tests Required

- Run `pnpm check` after changing `WindowMaterialMode`, material wrappers, `WorkspaceShell`, or settings props.
- Run `npm run build` after changing material CSS tokens, appearance settings UI, or `src-tauri/tauri.conf.json` window material settings.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing `src-tauri/src/lib.rs`, command names, numeric ids, or backend response shape.
- Browser-preview check: switch theme to dark, switch material, and verify `.app-shell` has `data-theme-mode` and `data-window-material` plus dark `--mx-*` tokens.
- Cross-check frontend material ids against backend `window_material_info(...)` in the same task.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("set_window_material", { material: "mica" });
```

#### Correct

```tsx
await setWindowMaterial(normalizeWindowMaterial(settings.appearance.windowMaterial, supported));
```

#### Wrong

```tsx
<SegmentedControl value={settings.appearance.windowMaterial} options={allMaterials} />
```

#### Correct

```tsx
<SegmentedControl
  value={effectiveWindowMaterial}
  options={supportedWindowMaterials.map((material) => ({
    value: material,
    label: getWindowMaterialLabel(material),
  }))}
  onChange={(windowMaterial) => onUpdate({ windowMaterial })}
/>
```
