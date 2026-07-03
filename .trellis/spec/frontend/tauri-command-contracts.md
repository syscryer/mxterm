# Tauri Command Contracts

## Scenario: React Wrappers for Rust Commands

### 1. Scope / Trigger

- Trigger: a React feature calls, changes, or adds a Tauri command.
- Source files: `src/shared/tauri/commands.ts`, `src/features/connections/connectionTypes.ts`, and `src/features/terminal/terminalTypes.ts`.
- Frontend code must call Rust through typed wrapper functions instead of scattering `invoke(...)` calls through UI components.
- Secret vault startup is settings-driven: if `settings.security.masterPasswordEnabled` is false, `useSecretVault` calls `secretVaultUnlockLocal()` once and should not show the unlock gate after success; if true, the gate calls `secretVaultUnlock(masterPassword)`. A failed local auto-unlock must stop retrying automatically and surface a stable unlock/error state instead of toggling storage hooks indefinitely.
- The Settings security page owns the master-password protection switch. Turning it on must call `secretVaultEnableMasterPassword(masterPassword)` before persisting `masterPasswordEnabled: true`; turning it off must call `secretVaultDisableMasterPassword()` before persisting false.

### 2. Signatures

```ts
secretVaultStatus(): Promise<SecretVaultStatus>
secretVaultUnlock(masterPassword: string): Promise<SecretVaultStatus>
secretVaultUnlockLocal(): Promise<SecretVaultStatus>
secretVaultLock(): Promise<SecretVaultStatus>
secretVaultEnableMasterPassword(masterPassword: string): Promise<SecretVaultStatus>
secretVaultDisableMasterPassword(): Promise<SecretVaultStatus>
connectionList(): Promise<ConnectionProfile[]>
connectionUpsert(request: ConnectionProfileInput): Promise<ConnectionProfile>
connectionSetFavorite(connectionId: string, isFavorite: boolean): Promise<ConnectionProfile>
connectionMarkConnected(connectionId: string): Promise<ConnectionProfile>
connectionDelete(id: string): Promise<void>
connectionRevealInlineSecret(id: string): Promise<RevealedConnectionSecret>
credentialList(): Promise<CredentialProfile[]>
credentialUpsert(request: CredentialProfileInput): Promise<CredentialProfile>
credentialDelete(id: string): Promise<void>
credentialRevealSecret(id: string): Promise<RevealedCredentialSecret>
connectionTest(request: ConnectionRuntimeCredentialRequest): Promise<ConnectionStepResult>
connectionTestProfile(request: ConnectionProfileInput): Promise<ConnectionStepResult>
connectionProbeSystem(request: ConnectionRuntimeCredentialRequest): Promise<ConnectionProfile>
knownHostTrust(hostKey: HostKeyInfo): Promise<void>
connectionProbeLatency(connectionId: string): Promise<{ latency_ms: number | null; reachable: boolean }>
terminalConnect(request: TerminalConnectRequest): Promise<string>
terminalWrite(sessionId: string, data: string): Promise<void>
terminalResize(sessionId: string, cols: number, rows: number): Promise<void>
terminalClose(sessionId: string): Promise<void>
telnetTerminalOpen(request: TelnetTerminalOpenRequest): Promise<string>
serialListPorts(): Promise<SerialPortEntry[]>
serialTerminalOpen(request: SerialTerminalOpenRequest): Promise<string>
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
inline_password_touched?: boolean
inline_private_key_path?: string
inline_private_key_passphrase?: string
inline_private_key_passphrase_touched?: boolean
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
telnet?: {
  enter_mode: "cr" | "lf" | "crlf"
  backspace_mode: "del" | "ctrl_h"
}
serial?: {
  port_name: string
  baud_rate: number
  data_bits: "five" | "six" | "seven" | "eight"
  parity: "none" | "odd" | "even"
  stop_bits: "one" | "two"
  flow_control: "none" | "software" | "hardware"
  backspace_mode: "del" | "ctrl_h"
}
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
password_touched?: boolean
private_key_path?: string
private_key_passphrase?: string
private_key_passphrase_touched?: boolean
notes?: string
```

Reveal responses:

```ts
type RevealedConnectionSecret = {
  auth_kind: "password" | "private_key"
  password?: string | null
  private_key_passphrase?: string | null
}

type RevealedCredentialSecret = {
  kind: "password" | "private_key"
  password?: string | null
  private_key_passphrase?: string | null
}
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

type TelnetTerminalOpenRequest = {
  request_id?: string
  host: string
  port: number
  enter_mode?: "cr" | "lf" | "crlf"
  backspace_mode?: "del" | "ctrl_h"
}

type SerialTerminalOpenRequest = {
  request_id?: string
  port_name: string
  baud_rate?: number
  data_bits?: "five" | "six" | "seven" | "eight"
  parity?: "none" | "odd" | "even"
  stop_bits?: "one" | "two"
  flow_control?: "none" | "software" | "hardware"
  backspace_mode?: "del" | "ctrl_h"
}
```

### 3. Contracts

- Keep Tauri command names centralized in `src/shared/tauri/commands.ts`.
- Keep Tauri event names centralized in `src/shared/tauri/events.ts`. Event names must use allowed characters only; use `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`, not dot-separated names.
- Wrapper argument objects must match Rust command parameter names exactly, for example `{ request }`, `{ id }`, and `{ sessionId }`.
- UI state may use empty strings while editing, but `useConnections` and `useCredentials` must trim optional fields and convert blanks to `undefined` before calling `connectionUpsert` or `credentialUpsert`.
- Connection profiles own target and behavior fields: group, host, port, username, credential mode, proxy, SSH jump reference, advanced settings, and notes.
- `ConnectionProfileInput.group` is the persisted group display name. Frontend-only tree ids from `ConnectionPane` / localStorage are UI identifiers only and must never be passed to `connectionUpsert`, `ConnectionDialog`, or move/create handlers as the saved group value. When reading legacy data that still stores a local tree id, resolve it to the matching group name before displaying or saving.
- Connection profiles also own repository UI metadata: `is_favorite` is the explicit favorite flag and `last_connected_at` is the last successful terminal connection timestamp. Do not infer favorites from notes or recent activity from `updated_at`.
- Connection profiles also persist detected remote system metadata: `remote_os_id`, `remote_os_name`, and `remote_os_version`. UI system icons must prefer these fields before falling back to local name/notes/group text inference.
- Credential profiles own reusable login account material: username plus password or private key path/passphrase plus local notes. They must not store host or port.
- When opening a saved connection, the connection-preparation flow should pass `connection_id` plus prompt credentials only when `credential_mode === "prompt"`; Rust treats the saved profile as authoritative.
- After a terminal connection succeeds, trigger `connectionProbeSystem(...)` in the background with the same runtime prompt credential payload when needed, then call `connectionMarkConnected(connection.id)` so the repository's recent views sort by real connection activity. Probe failures must not close or fail an already connected terminal. Favorite toggles must call `connectionSetFavorite(...)` and preserve repository metadata when editing or moving a connection.
- `ConnectionDialog` must test the current form with `connectionTestProfile(input)`. It must not call `connectionUpsert`, `saveConnection`, or `connectionTest({ connection_id })` for unsaved dialog tests, because testing must not persist a profile or create a connection id. It must show validation and connection errors as dialog feedback instead of writing them into a terminal.
- Editing an existing inline-secret connection must not prefill plaintext. The dialog shows a saved/blank placeholder, sends `inline_password_touched=false` or `inline_private_key_passphrase_touched=false` when unchanged, and calls `connectionRevealInlineSecret(id)` only when the eye button is visible and clicked.
- `connectionRevealInlineSecret` is for connection-owned inline secrets only. When the connection uses saved account credentials, `ConnectionDialog` must show the credential picker and must not reveal the reusable credential secret across that boundary.
- Editing saved account credentials in Settings must not prefill plaintext. Account management is the only UI surface that may call `credentialRevealSecret(id)`.
- If a secret was revealed only for viewing, normalization must omit the secret value and preserve `*_touched=false` until the user actually types. Saving immediately after reveal must preserve the existing vault reference instead of rewriting or clearing the secret.
- When advanced security is disabled, password reveal is effectively allowed even if an old saved `allowPasswordReveal=false` value exists. When advanced security is enabled and `allowPasswordReveal=false`, hide eye buttons but still allow users to replace secrets by typing new values.
- Idle auto-lock calls `secretVaultLock()` and clears in-memory vault availability. It must not close SSH tabs or mark terminal sessions failed.
- `ConnectionDialog` exposes network path settings under the `网络路径` tab. The connection method selector maps to exactly one persisted path: direct saves `proxy.kind = "none"` and `jump.kind = "none"`; network proxy saves HTTP CONNECT or SOCKS5 under `proxy` and clears `jump`; SSH jump saves `jump.kind = "ssh_jump"` plus `jump_connection_id` and clears `proxy`.
- SSH jump represents a real bastion path. The frontend may describe it as "先登录跳板机，再访问目标主机", but it must still send only the saved `jump_connection_id`; Rust remains responsible for loading the jump profile, opening `direct-tcpip`, and surfacing runtime jump errors.
- When `jump.kind === "ssh_jump"`, `ConnectionDialog` must require a saved connection id before save or test. Missing selection is shown as dialog feedback on the `网络路径` tab instead of silently downgrading the connection to direct.
- `ConnectionDialog` exposes terminal display encoding under the `高级` tab only because Rust terminal sessions perform both SSH output decoding and terminal input encoding. The frontend sends `advanced.terminal_encoding`; it must not attempt to recode terminal bytes in `TerminalPanel`.
- `ConnectionDialog` must treat `host_key_unknown` and `host_key_changed` from `connectionTestProfile(input)` as recoverable confirmation states, not ordinary errors. Parse the backend `raw_message` through the shared host-key parser, render host, port, algorithm, and SHA256 fingerprints in the compact feedback card, and never show the raw JSON payload to users.
- Host-key confirmation UI must call `knownHostTrust(hostKey)` with the `HostKeyInfo` returned by a recoverable host-key error; do not synthesize fingerprints on the frontend.
- Connection latency probing must go through `connectionProbeLatency(connection.id)`. The UI sends only a saved connection id; Rust reloads the saved host/port and never needs credential fields for this probe.
- Remote system probing must go through `connectionProbeSystem(request)`. The UI sends a saved connection id and only the same prompt credentials already supplied by the user for the current connection attempt; Rust reloads all saved target and credential fields, probes `/etc/os-release`, and returns the updated `ConnectionProfile`.
- The connection preparation page owns startup, host-key confirmation, prompt credentials, retry, edit, and failure UI. A terminal tab is created only after `terminalConnect` returns a session id.
- Telnet and serial are saved connection protocols with their own profile config fields. UI must persist them through `connectionUpsert`, then open them through `telnetTerminalOpen` / `serialTerminalOpen` and reuse `TerminalPanel` with `initialSessionId`.
- Telnet and serial profiles must not use SSH credentials, proxy, jump, remote-file, monitor, Docker, or tunnel fields. Serial profiles use `serial.port_name` as the runtime target; `host` may mirror the port name only for repository compatibility.
- Serial port selection must call `serialListPorts()` through the typed wrapper. Business UI must use `AppSelect` and global token styles, not native `<select>`.
- The same-connection "new terminal" action must only be visible after the active terminal has a connected `sessionId`. When used inside an already active session, it must create a terminal tab directly and call `terminalConnect` with the saved `connection_id`; it must not call `startConnectionStep(...)` or show the connection-preparation page. If this direct connect fails, keep the lightweight terminal tab in a failed state instead of routing the user back into the preparation flow.
- `TerminalPanel` receives an already-created `initialSessionId`; it must not start a second SSH connection for that tab.
- A terminal reconnect action must stay inside the current tab. It should call
  `terminalConnect(...)` with a fresh `request_id`, update the owning terminal
  tab's runtime `sessionId` and `requestId` after success, and keep event
  matching scoped to the active session/request so stale close/output events
  from the old PTY cannot mark the reconnected tab disconnected.
- During terminal handoff, match terminal output/state events by `request_id` as well as by `session_id`; shell prompts can arrive before the frontend receives the returned session id.
- Keep the terminal handoff warmup listener alive briefly after replacing the connecting tab, and make `TerminalPanel` consume appended `initialOutput` bytes. Otherwise the remote prompt can land between `terminalConnect` resolving and the xterm listener mounting, leaving a connected but visually blank terminal while remote file browsing works. While the startup buffer is active, `TerminalPanel` must ignore live output events whose `request_id` equals `initialRequestId`; stop warmup capture only after the startup buffer has flushed and the mounted output listener is ready, so one startup byte stream cannot be rendered through both paths.
- `TerminalPanel` should buffer startup handoff output briefly and write it as one ordered batch with early live events. If the combined startup batch contains a duplicated leading shell prompt before a login banner / motd and the same prompt appears again at the end, remove only that leading duplicate before writing to xterm. If the prompt is joined to the first banner line, such as `root@host:~# Welcome to ...`, strip only the prompt prefix and keep the banner text. If warmup and live capture the same leading login banner block before the first prompt, keep one copy of that startup banner. If warmup and live capture produce adjacent duplicate prompts such as `[root@host ~]# [root@host ~]#`, collapse them to a single prompt before writing.
- Local Windows terminals must call `getWindowsPtyInfo()` and pass the mapped `{ backend, buildNumber }` object to `TerminalPanel`. xterm uses the build number to decide ConPTY reflow behavior; a bare `{ backend: "conpty" }` can keep older wrapping heuristics enabled on modern Windows builds.
- Do not store terminal session runtime state inside a `ConnectionProfile`. Connection profiles are persistent data; terminal tabs and session ids are runtime state.
- Do not log passwords, private-key passphrases, or full command payloads.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| Vault protection disabled | Auto-unlock once with `secretVaultUnlockLocal()` and enable connection/credential hooks only after `status.unlocked`; if local unlock fails, keep the error stable and avoid an automatic retry loop. |
| Vault protection enabled and locked | Show `SecretVaultGate` and keep storage hooks disabled until unlock succeeds. |
| Enabling master password from Settings | Require non-empty matching password fields, call `secretVaultEnableMasterPassword`, then persist the setting only on success. |
| Disabling master password from Settings | Call `secretVaultDisableMasterPassword` and persist the setting only on success. |
| Advanced protection is disabled | Security settings show only the advanced-protection switch; password reveal remains allowed for normal users. |
| Advanced protection is enabled and Settings security is locked | Hide idle-lock, allow-reveal, change-password, and disable-protection controls until the security password unlock succeeds. |
| Idle auto-lock timeout expires | Call `secretVaultLock()`, make storage hooks unavailable again, and keep already-open terminal sessions mounted. |
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
| Existing inline secret is unchanged | Submit no plaintext and `inline_*_touched=false`; do not treat a reveal-only value as a replacement. |
| Existing account credential secret is unchanged | Submit no plaintext and `*_touched=false`; do not clear or rewrite the vault entry. |
| Reveal is disallowed by advanced security | Hide the eye button; keep secret replacement fields usable. |
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
- Good: `ConnectionDialog` reveals only inline connection secrets; saved credential secrets remain behind account management.
- Good: account management reveal sets the local form value for viewing, but leaves `*_touched=false` until the user types, so saving immediately preserves the old secret.
- Good: `ConnectionDialog` tests the current unsaved form through `connectionTestProfile(input)`, leaving the connection repository unchanged until the user clicks save.
- Good: `SettingsView` edits saved login-account records through `useCredentials`; it asks for username plus password or private key material, and never asks for host or port in account management.
- Good: `SettingsView` security section enables master-password protection only after vault rekey succeeds; when enabled, the section is locked until the security password is entered, then shows idle lock, allow reveal, change password, and disable protection.
- Base: `ConnectionPane` displays `username@host:port`, calls `onOpen(connection)`, and does not know about Tauri details.
- Bad: A component calls `invoke("connection_upsert", ...)` directly, tests an unsaved dialog form by saving/upserting it first, stores runtime session ids inside `ConnectionProfile`, or sends raw passwords to remote-file commands.

### 6. Tests Required

- Run `pnpm check` after changing command wrappers, connection types, credential types, terminal request types, or component props that carry command payloads.
- Run focused Rust repository/vault tests after changing reveal, touched-preserve, or vault lock wrappers because TypeScript cannot prove secret persistence semantics.
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
- `TerminalPanel` may report current directory via `onCurrentDirectoryChange(tabId, path)` when terminal output contains `OSC 7` or when the user enters a simple `cd` command that can be resolved locally. When the file-panel locate action needs a fallback and `OSC 7` is absent, `WorkspaceShell` may ask the active tab for a locate-time xterm snapshot and inspect a few already-rendered lines for a high-confidence shell prompt path such as `user@host:/path$`.
- The file panel must not automatically reload remote files on every terminal directory change. The toolbar locate action is manual: clicking it uses the active tab's stored path first and may fall back to a locate-time prompt snapshot only for that click. If no path can be resolved, the locate action must stay disabled or show an explanatory tooltip; it must not ask `TerminalPanel` to write any command.
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
| `OSC 7` is absent | Track simple user-entered `cd` commands as the eager fallback. On manual locate, the active tab may inspect already-rendered prompt lines as a best-effort snapshot fallback. Basename-only prompts such as `[root@host edgs]#` are usable only when matched to a known current directory or a nearby explicit `cd /absolute/path` command. Keep showing the default/manual path until a path is recorded. Do not parse arbitrary command output and do not write current-directory probes into the interactive terminal. |
| File icon image fails to load | Render a local fallback icon or compact type badge. |

### 5. Good / Base / Bad Cases

- Good: `TerminalPanel` extracts `OSC 7` paths or resolves a user-entered `cd /path`; if those are absent, `WorkspaceShell` may inspect a few already-rendered xterm rows for a prompt like `root@host:/opt/app#` only when the user clicks locate, and `RemoteFilePanel` reloads that directory only after that manual action.
- Base: A user expands `/var/log`; the panel loads only that directory's immediate children and caches them until refresh.
- Bad: A component sends `{ host, username, password, path }` to a file-list command or stores remote tree state directly inside `WorkspaceShell`.

### 6. Tests Required

- Run `pnpm check` after changing `remoteFileList`, `RemoteFileEntry`, `RemoteFilePanel`, `TerminalPanel`, or `WorkspaceShell` path handoff props.
- Run `npm run build` after visible right-pane changes to catch bundling and CSS regressions.
- Run `node scripts/check-terminal-cd-tracker.mjs` after changing terminal input directory tracking.
- Add frontend unit tests once a test runner exists for path normalization, entry sorting, `OSC 7` parsing, prompt-directory parsing, and direct-wrapper payload shape.
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

- Trigger: frontend code adds or changes SSH tunnel commands, tunnel types, the toolbox tunnel view, prompt credential UI, host-key retry UI, or tunnel autostart wiring.
- Source files: `src/shared/tauri/commands.ts`, `src/features/tunnels/tunnelTypes.ts`, `src/features/tunnels/TunnelPanel.tsx`, `src/features/tools/DockerToolPanel.tsx`, `src/features/files/RemoteFilePanel.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src-tauri/src/commands.rs`, and `src-tauri/src/tunnels.rs`.
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
- `TunnelPanel` may refresh and list rules, but app-level autostart belongs in `WorkspaceShell` mount so auto-start rules run even if the user never opens the toolbox tunnel view.
- The right-pane entry is `RemoteFileTool = "files" | "monitor" | "commands" | "tools" | "ai"`. File transfers are rendered as the file pane's bottom transfer dock, not as a first-level right-pane tool tab. SSH tunnels are low-frequency global tools hosted by the `tools` entry's internal toolbox view, not by a first-level right-pane tab.
- Tunnel UI must use Radix Dialog, Lucide icons, `AppSelect`, shared confirmation dialog, and global `--mx-*` tokens. Do not use native `<select>` or feature-local dropdown popovers.
- A visible `running` state means data was written to the local forwarding machinery, not that the remote target command or service succeeded.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No saved SSH connections | Disable new-rule action and show the tunnel empty state. |
| Dialog has blank connection, required local field, or required remote field for the selected kind | Keep the dialog open and show inline validation. |
| Port text is not an integer in `1..=65535` | Keep the dialog open and show inline validation. |
| `credential_prompt_required` from manual start | Open the one-time credential dialog; do not persist the credential. |
| `host_key_unknown` or `host_key_changed` from manual start | Open host-key confirmation, call `knownHostTrust`, then retry the same tunnel start. |
| Start/stop/delete/upsert returns `AppError` | Show `AppError.message` in the panel or dialog and refresh list state when useful. |
| `tunnelList` returns `Command tunnel_list not found` in a live Tauri session after frontend hot update | Treat it as a backend-restart/version mismatch state: show a neutral unavailable empty state that asks the user to restart the app, and do not show the red inline error. |
| Browser preview has no Tauri runtime | Use deterministic preview tunnel data only for visual inspection. |

### 5. Good / Base / Bad Cases

- Good: `TunnelPanel` submits the selected `kind`, `connection_id`, kind-specific local/remote host and port fields, and `auto_start`, then renders the returned `TunnelRuleWithState`.
- Good: dynamic SOCKS hides remote target fields, sends `remote_host=""` and `remote_port=1`, and renders the route as local SOCKS listener to SOCKS5 over SSH.
- Good: remote forwarding labels remote fields as the SSH-server listener and local fields as the local target, then renders the route as remote listener to local target.
- Good: Workspace startup calls `tunnelAutostart()` once in the shell; opening Tools -> Tunnels later calls `tunnelList()` to render current runtime state.
- Good: a prompt-credential tunnel start opens a one-time password/private-key dialog and retries with `runtime_credential` only for that request.
- Base: browser preview shows a fake stopped tunnel so CSS/layout can be inspected without a Tauri runtime.
- Bad: a component calls `invoke("tunnel_start")` directly, stores runtime credentials in `TunnelRule`, uses native `<select>`, or reports command execution success from tunnel delivery state.

### 6. Tests Required

- Run `npm run check` after changing tunnel types, wrappers, `TunnelPanel`, toolbox view wiring, `RemoteFilePanel` tool props, or `WorkspaceShell` autostart wiring.
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

## Scenario: Command Library Wrappers and Command Sender UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes command snippets, Command Sender history, typed command-library wrappers, or the right-pane command library UI.
- Source files: `src/shared/tauri/commands.ts`, `src/features/commands/commandLibraryTypes.ts`, `src/features/commands/CommandLibraryPanel.tsx`, `src/features/files/RemoteFilePanel.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src/styles/app.css`, `src-tauri/src/command_library.rs`, and `src-tauri/src/commands.rs`.
- This is a cross-layer command contract because React edits typed snippet/history payloads while Rust owns validation, persistence, duplicate history merging, and usage counts.

### 2. Signatures

```ts
commandSnippetList(): Promise<CommandSnippet[]>
commandSnippetUpsert(request: CommandSnippetInput): Promise<CommandSnippet>
commandSnippetDelete(id: string): Promise<void>
commandSnippetMarkUsed(id: string): Promise<CommandSnippet>
commandHistoryList(limit?: number, scope?: CommandHistoryScope | null): Promise<CommandHistoryEntry[]>
commandHistoryRecord(request: CommandHistoryRecordRequest): Promise<CommandHistoryEntry>
commandHistoryDelete(id: string): Promise<void>
commandHistoryClear(): Promise<void>
```

Frontend types mirror Rust snake_case fields. `CommandSnippet.group` is a display folder name and blanks are normalized by Rust to the root folder value `""`. Legacy `"未分组"` values are treated as root. `CommandHistorySource` is currently `"command_sender" | "terminal_input"`. `CommandHistoryScope.scope_kind` is `"ssh_connection" | "local_profile"`; scope ids are persisted connection ids or local terminal profile ids, never runtime tab/session ids.

### 3. Contracts

- Components must call typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("command_*")` directly from UI components.
- Command Sender history is recorded after at least one selected target returns from `terminalWrite(...)` successfully.
- Terminal input history is optional and must default to disabled. When `settings.command.recordTerminalInputHistory` is enabled, `TerminalPanel` may record only successful Enter-submitted printable command lines as `terminal_input`.
- Terminal input history must drop control sequences, function keys, cursor navigation, Tab completion, Ctrl/Alt input, TUI-like input, password-like commands, and sensitive variable assignments. It must not parse shell history files or inject shell hooks.
- History records may include command text, `source`, successful `target_count`, `append_enter`, usage count, and timestamps. Scope records may include `ssh_connection + connection_id` or `local_profile + profile_id` for filtering. They must not include target session ids, tab ids, connection names, or command output.
- Selecting a snippet fills the textarea and tracks the selected snippet id. Any manual textarea change clears that selected snippet id so edited commands are treated as ordinary sends.
- Sending an unchanged selected snippet should call `commandSnippetMarkUsed(id)` after at least one target write succeeds.
- Selecting a history row fills the textarea. Saving a history command as a snippet uses the normal snippet upsert flow; history itself is not promoted automatically.
- The right-side tool pane owns the command library entry. `RemoteFilePanel` exposes a `commands` tab that renders `CommandLibraryPanel`; the bottom Command Sender remains the only target-selection and terminal-write surface.
- Snippets should be grouped by `group` as a one-level tree: root snippets render directly at the top, folder headers render only for explicit non-root groups, and folder children are indented. Do not use left/right split panes, nested folders, or horizontal group chips in the narrow right pane.
- Snippet rows should keep only high-frequency direct actions visible: copy, insert, and send. Edit/delete live in the snippet row context menu; group rename/delete actions live in the folder context menu. Deleting a group deletes the snippets inside that group.
- Direct send from the right-pane command library must write to the resolved target list without expanding the bottom Command Sender and without clearing any existing Command Sender draft input.
- Command Sender target lists may include SSH terminals and local terminals. Local terminal workspaces expose only the right-pane command tool; SSH-only tools such as files, monitor, and tunnels stay hidden there.
- History should render as compact command rows, not large cards. It may offer copy, insert, run, save-as-snippet, delete, and clear actions.
- History scope filtering should default to the current SSH connection in SSH workspaces and the current local terminal profile in local workspaces. The filter list is flat: current context, other SSH connections, local profiles, and all history.
- Terminal input recording is controlled from Settings through `settings.command.recordTerminalInputHistory`; the right-pane history view shows only the current state and a Settings entry, not a local checkbox.
- Browser preview may show empty snippet/history states, but real save/delete/record actions must go through the typed Tauri wrappers.
- UI must use Radix Dialog, `ConfirmDialog`, Lucide icons, shared button/menu styles, and global `--mx-*` tokens. Do not use native `<select>`, `window.confirm`, or feature-local dropdown implementations.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No snippet rows | Keep the right-pane command tab available and show a neutral empty state plus create action. |
| No history rows | Keep history visible as an empty state and disable history delete/clear actions. |
| Save snippet returns validation error | Keep the snippet dialog open and show `AppError.message` near the form. |
| Delete snippet/history fails | Keep local UI coherent, surface `AppError.message`, and allow refresh/retry instead of silently removing rows. |
| All target writes fail | Do not call `commandHistoryRecord` or `commandSnippetMarkUsed`. |
| Any `command_snippet_*` or `command_history_*` wrapper returns `Command ... not found` after a frontend hot update | Treat it as a backend-restart/version mismatch state: show a neutral notice that asks the user to restart the app, disable snippet/history persistence actions, and do not show a red inline error. |
| Browser preview has no Tauri runtime | Show the UI shell, disable or reject real persistence actions with a clear message. |

### 5. Good / Base / Bad Cases

- Good: user selects a snippet, sends it to three targets, two writes succeed, history records `target_count=2` and the snippet use count increments once.
- Good: user selects a snippet then edits the command before sending; history records the edited command, but the original snippet use count does not increment.
- Good: deleting a history row requires an explicit user action and updates the right-pane list state only after the wrapper succeeds.
- Base: history command text may contain newlines; row labels are truncated visually while the stored command remains intact.
- Bad: React keeps an extra localStorage history, records history before writes complete, stores `sessionId`, or hides backend errors by only mutating local arrays.

### 6. Tests Required

- Run `npm run check` after changing command-library frontend types, wrappers, `CommandLibraryPanel`, `RemoteFilePanel` tool tabs, `WorkspaceShell` Command Sender UI, or related CSS when type-check runs are approved for the session.
- Cross-check frontend payload field names against Rust structs in `src-tauri/src/command_library.rs`.
- Browser/desktop visual checks should cover empty snippet/history states, snippet management dialog, delete confirmations, long command labels, and dark theme token contrast.
- Run `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib` when frontend payload changes require Rust command-library changes and Rust test runs are approved for the session.

## Scenario: Window Material Commands

### 1. Scope / Trigger

- Trigger: a React feature changes native window backdrop/material behavior, appearance settings normalization, or the `get_supported_window_materials` / `set_window_material` Tauri commands.
- Source files: `src/shared/tauri/commands.ts`, `src/shared/tauri/windowMaterial.ts`, `src/features/settings/settingsTypes.ts`, `src/features/layout/WorkspaceShell.tsx`, `src/features/settings/SettingsView.tsx`, `src/styles/tokens.css`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, and `src-tauri/src/commands.rs`.
- This is a cross-layer command contract because React owns persisted appearance settings while Rust owns platform support and native DWM application.

### 2. Signatures

```ts
type WindowMaterialMode = "auto" | "mica" | "acrylic" | "micaAlt" | "macosGlass";

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
macosGlass = 10
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
- macOS transparent material requires both `src-tauri/tauri.conf.json` `app.macOSPrivateApi = true` and the Rust `tauri` dependency `macos-private-api` feature; missing either can leave a transparent window unsupported or fail `cargo check`.
- CSS fallback material should be chrome-focused: root `.app-shell` material layer, `.custom-titlebar`, and shared `.app-sidebar` rails use material tokens. macOS may also use low-alpha material tokens on broad workspace shells such as `.connection-home` and `.settings-content`, while dense cards, tables, forms, and terminal surfaces stay on readable `--mx-panel` / `--mx-terminal` surfaces.
- On Windows, `auto` is the non-material fallback mode, not a transparent material reveal mode. Keep Windows auto backed by a coherent chrome layer. On macOS, `auto` is allowed to map to the native default glass-backed window effect, with `macosGlass` as the stronger visual option.

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
- Good: macOS exposes `auto` and `macosGlass`; broad workspace shells can reveal glass, but `.connection-board`, settings panels, forms, and terminal panes remain readable.
- Base: Linux/unknown platforms expose only `auto`; the setting row remains stable and the app uses CSS material tokens.
- Bad: a component persists `2` for Mica, calls `invoke("set_window_material", ...)` directly, or assumes every Windows version supports Acrylic.

### 6. Tests Required

- Run `pnpm check` after changing `WindowMaterialMode`, material wrappers, `WorkspaceShell`, or settings props.
- Run `npm run build` after changing material CSS tokens, appearance settings UI, or `src-tauri/tauri.conf.json` window material settings.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing `src-tauri/src/lib.rs`, command names, numeric ids, or backend response shape.
- Run the platform release-readiness guard after changing `src-tauri/tauri*.conf.json` or platform material availability.
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

## Scenario: Application Update Settings UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes application update checks, updater plugin calls, runtime distribution detection, titlebar update notices, or the Basic Settings update panel.
- Source files: `src/shared/tauri/commands.ts`, `src/shared/tauri/appUpdate.ts`, `src/features/settings/useAppUpdate.ts`, `src/features/settings/settingsTypes.ts`, `src/features/settings/SettingsView.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src/features/layout/AppTitlebar.tsx`, and `src/styles/app.css`.
- This is a cross-layer and infra contract because React owns user-visible update state while Rust owns runtime distribution metadata and Tauri updater verifies GitHub-hosted signed artifacts.

### 2. Signatures

```ts
type AppDistributionMode =
  | "desktop-installer"
  | "desktop-portable"
  | "desktop-appimage"
  | "desktop-package"
  | "web"

type AppRuntimeInfo = {
  version: string
  repositoryUrl: string
  distributionMode: AppDistributionMode
  isTauri: boolean
}

getAppRuntimeInfoCommand(): Promise<AppRuntimeInfo>
getAppRuntimeInfo(): Promise<AppRuntimeInfo>
checkForAppUpdate(options?: { silent?: boolean }): Promise<AppUpdateCheckResult | null>
installAppUpdate(update: Update, onProgress?: (message: string) => void): Promise<void>
useAppUpdate({ autoCheckEnabled }: { autoCheckEnabled: boolean }): UseAppUpdateResult
```

### 3. Contracts

- Components must call `getAppRuntimeInfoCommand()` or the higher-level helpers in `src/shared/tauri/appUpdate.ts`; do not call `invoke("get_app_runtime_info")` directly from UI components.
- Update checks are GitHub Release only. Frontend repository links and fallback URLs must point to `https://github.com/syscryer/mxterm`.
- `settings.basic.autoCheckAppUpdate` defaults to `true`, is normalized through `normalizeSettings`, and controls only startup/background checks. Manual `立即检查` must remain available when the environment supports updater checks.
- Automatic checks must never download, install, relaunch, or interrupt terminal/file operations. They may only set an available-update state and show a dismissible titlebar notice.
- `desktop-portable` and `desktop-package` are unsupported for automatic install. Windows portable zip and Linux deb/rpm users must be sent to GitHub Release manually.
- `desktop-appimage` and `desktop-installer` are the only automatic install modes in v1.
- `installAppUpdate(...)` must call Tauri updater `downloadAndInstall(...)` and then `@tauri-apps/plugin-process` `relaunch()`. It must close the updater handle in a `finally` block.
- The titlebar update notice is session-local. Dismissing a version hides only that version for the current app run; it must not clear the available update or persist a "skip version" setting.
- Update UI must use SettingsView rows, existing action button styles, Lucide icons, and global `--mx-*` tokens. Do not introduce a separate update dashboard or native `<select>` controls.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Return `web` runtime info, disable updater install, and explain that desktop mode is required. |
| Development mode | Show that development mode does not check updates. |
| Windows portable zip | Show that the user should download a new portable build from GitHub Release. |
| Linux deb/rpm package | Show that AppImage supports automatic updates and the current package must be updated manually. |
| Updater check returns `null` | Set status to `latest` with a clear "already latest" message. |
| Updater check throws during manual check | Set status to `failed` and surface the error or a retry message. |
| Silent auto-check throws | Do not show a failure notice; keep the workspace usable. |
| Install requested without an update object | Set status to `failed` and ask the user to check updates first. |
| Install fails | Keep the update UI usable and tell the user to download from GitHub Release. |

### 5. Good / Base / Bad Cases

- Good: `WorkspaceShell` owns one `useAppUpdate(...)` instance, passes state into `SettingsView`, and passes only a compact dismissible notice into `AppTitlebar`.
- Good: Basic Settings shows current version, distribution mode, status, check/install actions, GitHub link, and the automatic-check toggle without creating a new visual system.
- Base: browser preview renders the update panel with deterministic web runtime info and disabled automatic install behavior.
- Bad: a component calls `invoke("get_app_runtime_info")` directly, auto-installs an update after a background check, hides Windows portable/Linux package limitations, or links to a non-GitHub release channel.

### 6. Tests Required

- Run `pnpm check` after changing update wrapper types, settings normalization, `useAppUpdate`, `SettingsView`, `WorkspaceShell`, `AppTitlebar`, or update CSS.
- Run release script tests after changing repository URLs, updater target selection, or supported distribution modes: `pnpm test:release`.
- Cross-check frontend `AppDistributionMode` values against Rust `detect_distribution_mode(...)` in the same task.
- Browser/desktop visual checks should cover web preview, development mode, latest, available, installing, failed, Windows portable, and Linux package messages when visible update UI changes.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("get_app_runtime_info")
toast("发现新版本，正在自动安装")
```

#### Correct

```tsx
const appUpdate = useAppUpdate({
  autoCheckEnabled: settings.basic.autoCheckAppUpdate,
})

if (appUpdate.workspaceNoticeVisible) {
  openSettingsSection("basic")
}
```

## Scenario: RDP Connection Runner UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes RDP connection fields, RDP workspace tabs, RDP runner preview/launch controls, typed wrappers for `rdp_*` commands, or typed RDP event listeners.
- Source files: `src/features/connections/connectionTypes.ts`, `src/features/connections/ConnectionDialog.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src/shared/tauri/commands.ts`, `src/shared/tauri/events.ts`, and `src/styles/app.css`.
- This is a cross-layer contract because React edits protocol-specific connection payloads while Rust owns validation, persistence, runner probing, redaction, and launch behavior.

### 2. Signatures

```ts
type ConnectionProtocol = "ssh" | "rdp"
type RdpRenderMode = "embedded" | "external" | "custom"
type RdpRunnerKind = "mstsc_activex" | "mstsc" | "freerdp" | "macos_app" | "custom"

type RdpEmbeddedBounds = { x: number; y: number; width: number; height: number }

rdpLaunchConnection(connectionId: string, bounds?: RdpEmbeddedBounds | null): Promise<RdpLaunchResult>
rdpPreviewLaunch(connectionId: string): Promise<RdpLaunchPreview>
rdpTestRunner(config?: RdpRunnerConfig | null): Promise<RdpRunnerProbeResult>
rdpCloseSession(sessionId: string): Promise<RdpSessionCloseResult>
rdpRevealSession(sessionId: string): Promise<RdpSessionRevealResult>
rdpResizeEmbeddedSession(sessionId: string, bounds: RdpEmbeddedBounds): Promise<RdpSessionResizeResult>
listenRdpSessionClosed(handler: (event: RdpSessionClosedEvent) => void): Promise<UnlistenFn>
```

`ConnectionProfileInput` includes `protocol?: "ssh" | "rdp"` and `rdp?: RdpConnectionConfig | null`. SSH rows keep SSH fields; RDP rows persist RDP-specific display, resources, gateway, RemoteApp, performance, security, runner, and raw advanced settings.

### 3. Contracts

- Components must call typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("rdp_*")` directly.
- Components must listen for RDP native-host lifecycle events through `src/shared/tauri/events.ts`; do not call `listen("rdp:session_closed", ...)` directly from feature components.
- `ConnectionDialog` owns protocol switching. When `protocol = "rdp"`, it must normalize RDP config and clear SSH-only proxy/jump assumptions that do not apply.
- `useConnections.normalizeConnectionInput` must preserve RDP credential fields from the dialog: `credential_mode`, saved `credential_id`, and inline password plus `inline_password_touched`. Do not force RDP rows back to `credential_mode = "prompt"` during frontend normalization, or the UI will appear to save a password while `rdp_launch_connection` still has no vault secret and the native client prompts again.
- `RdpCertificatePolicy` is `trust | prompt | strict`. The default `prompt` means Windows `.rdp` preview should show `authentication level:i:2` so mstsc warns and lets users continue when self-signed server certificates are common.
- RDP workspace sessions are runtime UI state. Do not persist runner session ids on `ConnectionProfile`.
- When an RDP profile requests `render_mode = "embedded"`, `WorkspaceShell` may call `rdpLaunchConnection(connection.id)` without a DOM viewport. The current Windows ActiveX implementation opens a manager-owned native RDP host window instead of painting inside the WebView.
- On Windows, `runner = "mstsc_activex"` with `embedded = false` means the backend opened or reused a manager-owned native ActiveX host window. Multiple RDP sessions should appear as native tabs inside that same host window. Show a native-window status, keep preview/retry/close controls available, and do not display a DOM embedded placeholder. `runner = "mstsc"` remains the external `.rdp` fallback path.
- When `WorkspaceShell` reopens an existing runtime RDP session whose backend result is `runner = "mstsc_activex"`, it should call `rdpRevealSession(result.session_id)` after activating the workspace tab so the independent native host window is restored and focused instead of silently staying minimized.
- `rdp:session_closed` carries the backend `session_id`. `WorkspaceShell` must map it back to `RdpSessionTab.result.session_id`, remove only those runtime tabs locally, and avoid inferring closure from connection id or title. This keeps native-host tab close and whole-window close in sync with React without deleting unrelated sessions on the same connection.
- Embedded launch may still return `embedded=true` in a future true DOM-embedded implementation. Treat the returned result as authoritative and only run viewport resize synchronization when `result.embedded === true`.
- For `embedded=true` sessions, `WorkspaceShell` must observe the viewport size and call `rdpResizeEmbeddedSession(result.session_id, bounds)` on resize/activation changes. For `runner = "mstsc_activex"` and `embedded = false`, do not call resize on app window movement or React tab activation; the native host window owns its own tabs, size, position, remote-resolution sync, and host DPI scaling.
- The Windows ActiveX native-window path is outside normal DOM composition. App overlays cannot cover it with CSS, so the UI should describe it as a separate native RDP host window with native tabs rather than pretending it lives inside the RDP workbench pane.
- `ConnectionDialog` exposes RDP credentials in the basic tab through the normal connection credential fields: inline password, saved password credential, or prompt. RDP must not expose private-key auth. The UI may show that saved passwords improve embedded Windows direct-connect, but external runners still prompt because frontend/backend contracts forbid plaintext passwords in command-line args or generated `.rdp` files.
- RDP mode must hide or disable SSH-only tools: terminal creation, remote files, monitor, tunnels, Docker, Command Sender, and SSH command history targets.
- Preview surfaces may show redacted args and `.rdp` content only. They must not show passwords, private-key passphrases, or credential payloads.
- Browser preview may synthesize deterministic RDP preview data, but desktop launch and runner probing must stay behind Tauri wrappers.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Show static runner preview and do not launch a desktop client. |
| `rdpLaunchConnection` succeeds with `embedded=true` | Keep an RDP session tab active and render embedded-session status. |
| `rdpLaunchConnection` succeeds with `embedded=false` and `runner="mstsc_activex"` | Render native-window status, runner, fallback/status reason, preview/retry/close controls, and no DOM embedded placeholder; later RDP launches may reuse the same native host window as another native tab. |
| User reopens an existing `runner="mstsc_activex"` RDP runtime session | Activate the workspace tab and call `rdpRevealSession(result.session_id)` so the native host window is restored/focused. |
| `rdp:session_closed` arrives for a known backend session id | Remove the matching RDP runtime tab locally and let normal workspace fallback choose the next tab/home state. |
| `rdp:session_closed` arrives for an unknown backend session id | Ignore it; do not close sessions by connection id or active state. |
| `rdpLaunchConnection` succeeds with `embedded=false` and an external runner | Render external-launch status, runner, fallback reason, and copyable redacted command/material. |
| `rdpLaunchConnection` fails | Keep the RDP tab visible with retry, preview, and close actions. |
| `rdpPreviewLaunch` fails | Keep the session open and show preview failure text without clearing the launch result. |
| Embedded viewport is not measurable before launch | Call `rdpLaunchConnection(connection.id)`; the current native-window path does not require DOM bounds. |
| Active session returns `embedded=true` and is resized, hidden, or the app window moves | Call `rdpResizeEmbeddedSession`; ignore resize failures in the UI because close/fallback races are recoverable. |
| Active connection is RDP | SSH-only right pane tools and terminal shortcut actions must not run against it. |

### 5. Good / Base / Bad Cases

- Good: double-clicking an embedded-preferred RDP connection opens an RDP session tab and calls `rdpLaunchConnection(connection.id)`; if the result is `runner="mstsc_activex"` and `embedded=false`, the tab shows that a native RDP host window is open and additional RDP sessions may appear as tabs inside that host window.
- Good: a future true embedded session keeps the native hosted window aligned when the app moves, resizes, scales, or the active RDP tab changes; the current native-window path does not run DOM-bound resize synchronization.
- Good: the right pane shows only RDP runner tools while an RDP workspace is active.
- Base: unsupported platforms keep saved RDP profiles valid and show setup diagnostics.
- Bad: `WorkspaceShell` sends an RDP connection to `terminalConnect`, `remoteFileList`, Docker tools, Command Sender targets, or SSH command history scopes.
- Bad: the UI displays an embedded placeholder for `runner="mstsc_activex"` when the backend returned `embedded=false`, making users wait for a DOM picture that cannot appear.

### 6. Tests Required

- Run `npm run check` after changing RDP frontend types, wrappers, dialog, workspace routing, or CSS.
- Cross-check TypeScript `RdpConnectionConfig`, `RdpLaunchPreview`, `RdpLaunchResult`, and wrapper parameter names against Rust structs and command signatures.
- Desktop smoke review should cover native-window ActiveX launch, multiple RDP sessions sharing one native tabbed host window, native-window resize/DPI behavior, close, external fallback, missing runner, redacted preview, SSH-only tool hiding, and true embedded resize behavior only when `embedded=true` is reintroduced.

### 7. Wrong vs Correct

#### Wrong

```tsx
await terminalConnect({ connection_id: connection.id })
```

for a row whose `connection.protocol === "rdp"`.

#### Correct

```tsx
if ((connection.protocol || "ssh") === "rdp") {
  await rdpLaunchConnection(connection.id)
}
```

The workspace branches by protocol before invoking any SSH-only command.

#### Wrong

```tsx
showEmbeddedPlaceholder(result.runner)
```

when `result.runner === "mstsc_activex"` but `result.embedded === false`.

#### Correct

```tsx
const result = await rdpLaunchConnection(connection.id)
const status = result.embedded ? "embedded" : result.runner === "mstsc_activex" ? "native" : "external"
```

## Scenario: VNC Connection Runner UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes VNC connection fields, VNC workspace tabs, noVNC embedded surfaces, VNC runner preview/launch controls, or typed wrappers for `vnc_*` commands.
- Source files: `src/features/connections/connectionTypes.ts`, `src/features/connections/ConnectionDialog.tsx`, `src/features/layout/WorkspaceShell.tsx`, `src/shared/tauri/commands.ts`, and `src/styles/app.css`.
- This is a cross-layer contract because React edits protocol-specific VNC payloads while Rust owns validation, storage, local bridge lifecycle, runner probing, redaction, and launch behavior.

### 2. Signatures

```ts
type ConnectionProtocol = "ssh" | "rdp" | "vnc"
type VncRenderMode = "embedded" | "external" | "custom"
type VncRunnerKind = "novnc" | "vncviewer" | "tigervnc" | "realvnc" | "custom"

vncLaunchConnection(connectionId: string): Promise<VncLaunchResult>
vncPreviewLaunch(connectionId: string): Promise<VncLaunchPreview>
vncTestRunner(config?: VncRunnerConfig | null): Promise<VncRunnerProbeResult>
vncCloseSession(sessionId: string): Promise<VncSessionCloseResult>
```

`ConnectionProfileInput` includes `protocol?: "ssh" | "rdp" | "vnc"` and `vnc?: VncConnectionConfig | null`. VNC rows persist display, input, performance, security, runner, and raw runner settings.

### 3. Contracts

- Components must call typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("vnc_*")` directly.
- `ConnectionDialog` owns protocol switching. When `protocol = "vnc"`, it must normalize VNC config, clear SSH-only proxy/jump assumptions, and allow only password-style credentials.
- `useConnections.normalizeConnectionInput` must preserve VNC credential fields from the dialog: `credential_mode`, saved `credential_id`, and inline password plus `inline_password_touched`. Do not force VNC rows back to prompt mode during frontend normalization.
- VNC workspace sessions are runtime UI state. Do not persist bridge session ids, WebSocket URLs, passwords, or noVNC state on `ConnectionProfile`.
- The same saved VNC connection opens at most one workspace tab. Re-opening the connection must activate the existing VNC tab instead of launching another bridge.
- Embedded and windowed VNC use noVNC `RFB` against the backend local WebSocket bridge. Apply `scaleViewport`, `resizeSession`, `clipViewport`, `viewOnly`, `qualityLevel`, `compressionLevel`, `showDotCursor`, and shared-session settings from `VncConnectionConfig`.
- VNC performance preset defaults must be centralized in `connectionTypes.ts` and consumed by both the connection dialog and the noVNC surface. The `auto` preset is LAN-oriented (`qualityLevel=7`, `compressionLevel=0`) so local macOS Screen Sharing sessions do not pay unnecessary compression latency. Changing the preset in `ConnectionDialog` must update the visible numeric quality/compression fields to that preset's defaults.
- Embedded noVNC must own the canvas CSS sizing. App CSS must not constrain the noVNC canvas with `max-width`, `max-height`, transforms, or other independent scaling because that desynchronizes pointer coordinates on high-DPI / macOS Screen Sharing sessions. Keep `dragViewport` disabled for interactive VNC so mouse drags are delivered to the remote desktop instead of panning the local viewport.
- noVNC wheel input should be normalized in the VNC viewer surface before it reaches `RFB`. noVNC emits at most one VNC wheel step per native `wheel` event after a 50px threshold, so high-resolution trackpad or macOS Screen Sharing sessions can feel sluggish. Consume original wheel events at the VNC mount, accumulate pixel/line/page deltas, then dispatch bounded synthetic pixel-mode wheel pulses to the noVNC canvas; do not modify `node_modules`.
- `vnc.runner.render_mode = "windowed"` means the workspace keeps a VNC status tab but sends the active noVNC bridge payload to the VNC runner host window. The host window uses the RDP-style single-layer tab chrome and may contain multiple VNC tabs for different saved connections.
- Creating or reusing a VNC runner host with Tauri `WebviewWindow` must be matched by `src-tauri/capabilities/default.json`: the main window needs `core:webview:allow-create-webview-window`, the runner host label must be included in the capability `windows` list, and runner-host window controls need the same close/destroy/minimize/drag permissions.
- The VNC runner host receives `websocket_url` and launch password only through Tauri runtime events after the host window reports ready. Do not put bridge URLs, tokens, passwords, or full connection profiles in the window URL, localStorage, settings, diagnostics, or persisted connection data.
- Closing a windowed VNC workspace tab must notify the runner host to remove the matching tab. Closing the runner host tab/window must notify the workspace so `vncCloseSession(result.session_id)` can stop the backend bridge.
- Runner-host window controls must act on the current `WebviewWindow`, not the parent main window. A runner-host tab close should remove the local child-window tab, notify the main workspace once, and close the child window when the last VNC tab is gone. The runner-host top-right close button should notify the main workspace once and then destroy the child window directly; it must not close only the parent workspace tab and leave an unclosable child window behind. A main-workspace close request should remove the child-window tab without echoing another close event back to the main workspace.
- noVNC is a heavy, VNC-only runtime dependency. `WorkspaceShell` may import its
  type declarations, but the runtime `@novnc/novnc` value must be loaded with a
  dynamic import inside the VNC viewer when `embedded=true`. Do not
  statically import noVNC at module scope, because ordinary startup, SSH, and
  settings views must not parse the VNC client.
- Prompt credentials are handled inside the VNC surface through noVNC `credentialsrequired`. Saved/inline passwords may appear only in the launch result as in-memory data for the active embedded session.
- External/custom runner preview and launch surfaces may show executable path and arguments only. They must not show or pass plaintext passwords.
- VNC mode must hide or disable SSH-only tools: terminal creation, remote files, monitor, tunnels, Docker, Command Sender, and SSH command history targets.
- Browser preview may synthesize deterministic VNC preview data, but desktop launch and runner probing must stay behind Tauri wrappers.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Show static VNC preview and do not create a bridge or launch a desktop client. |
| `vncLaunchConnection` succeeds with `embedded=true` | Keep a VNC session tab active and mount noVNC against the returned local WebSocket URL. |
| `vncLaunchConnection` succeeds with `embedded=true` and render mode is `windowed` | Keep a VNC session tab active, open/reuse the VNC runner host window, and deliver the noVNC bridge payload by runtime event. |
| noVNC emits `credentialsrequired` without a launch password | Show an inline password prompt and call `sendCredentials(...)` without persisting the value. |
| noVNC emits `securityfailure` or disconnects unexpectedly | Keep the VNC tab visible with retry, preview, and close actions. |
| `vncLaunchConnection` succeeds with `embedded=false` | Render external-launch status, runner, fallback reason, and copyable redacted command material. |
| `vncLaunchConnection` fails | Keep the VNC tab visible with retry, preview, and close actions. |
| Active connection is VNC | SSH-only right pane tools and terminal shortcut actions must not run against it. |

### 5. Good / Base / Bad Cases

- Good: double-clicking an embedded-preferred VNC connection opens one VNC tab, calls `vncLaunchConnection(connection.id)`, and mounts noVNC only when the result says `embedded=true`.
- Good: double-clicking a windowed-preferred VNC connection opens one workspace tab and one tab inside the VNC runner host; re-opening the same saved connection activates the existing workspace tab.
- Good: closing a VNC tab calls `vncCloseSession(result.session_id)` so the backend bridge can stop.
- Good: the right pane shows only VNC runner/bridge tools while a VNC workspace is active.
- Base: unsupported external viewers keep saved VNC profiles valid and show setup diagnostics.
- Bad: `WorkspaceShell` sends a VNC connection to `terminalConnect`, remote-file commands, Docker tools, Command Sender targets, or SSH command history scopes.
- Bad: the UI copies `websocket_url` or plaintext passwords into preview/diagnostic text.

### 6. Tests Required

- Run `npm run check` after changing VNC frontend types, wrappers, dialog, workspace routing, noVNC surface code, or CSS.
- Cross-check TypeScript `VncConnectionConfig`, `VncLaunchPreview`, `VncLaunchResult`, and wrapper parameter names against Rust structs and command signatures.
- Desktop smoke review should cover embedded noVNC launch, prompt password entry, saved/inline password direct connect, windowed runner host creation, duplicate-tab activation, close cleanup, wheel scrolling over a macOS Screen Sharing session, external fallback diagnostics, and SSH-only tool hiding.

## Scenario: WebDAV Sync Settings UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes WebDAV sync settings, manual upload/download controls, typed wrappers for `webdav_*` commands, or sync confirmation UI.
- Source files: `src/shared/tauri/commands.ts`, `src/features/settings/webdavSyncTypes.ts`, `src/features/settings/WebDavSyncSettingsSection.tsx`, `src/features/settings/SettingsView.tsx`, `src/features/settings/settingsTypes.ts`, and `src/styles/app.css`.
- This is a cross-layer command contract because React edits transient form state while Rust owns persistence, vault secrets, remote transport, snapshot validation, and import/export side effects.

### 2. Signatures

```ts
webdavSettingsGet(): Promise<WebDavSettings>
webdavSettingsSave(request: WebDavSettingsInput): Promise<WebDavSettings>
webdavTestConnection(request?: WebDavSettingsInput): Promise<WebDavTestResult>
webdavFetchRemoteInfo(): Promise<WebDavRemoteInfo>
webdavUploadSnapshot(request: WebDavUploadRequest): Promise<WebDavSyncResult>
webdavDownloadSnapshot(request: WebDavDownloadRequest): Promise<WebDavSyncResult>
```

Frontend payloads mirror Rust snake_case fields. `WebDavSettings.password_saved` is metadata only; there is no password field in the settings response.

### 3. Contracts

- Components must call typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("webdav_*")` directly from UI code.
- The Settings navigation owns the entry as `SettingsSectionId = "sync"`; WebDAV v1 is manual-only and default disabled.
- WebDAV password fields stay in component state only. The UI must send `password` only when `password_touched=true`; untouched blank fields preserve the saved vault password.
- A touched blank WebDAV password is intentional deletion and must be sent as `password_touched=true` with a blank value.
- The sync master password stays in component state only and is sent only to upload/download commands. It must not be persisted into `MxtermSettings`, localStorage, or the WebDAV settings save request.
- Upload and download require `ConfirmDialog` because upload overwrites remote latest and download overwrites the local sync scope after snapshot backup.
- Remote info should render empty, compatible, incompatible, and error states without inventing success. Delivery success means the command completed, not that another device has already consumed the snapshot.
- UI must use SettingsView layout, shared `SettingsRow`, `SettingsToggle`, `ConfirmDialog`, Lucide icons, and global `--mx-*` tokens. Do not use native `<select>` or feature-local dropdowns for WebDAV business controls.
- Browser preview may show a static disabled layout, but real WebDAV operations must be disabled or explained when no Tauri runtime is present.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Show the WebDAV layout, disable real operations, and explain that desktop mode is required. |
| Save/test returns validation error | Keep the form open and show the Rust `AppError.message` near the WebDAV section. |
| `webdav_password_missing` | Keep the password field visible and show the recoverable message; do not clear saved metadata locally. |
| `webdav_sync_locked` | Show that another sync task is running and keep buttons disabled only for the active request lifecycle. |
| Remote info `exists=false` | Show an empty remote state, not an error. |
| Remote info `compatible=false` | Show an incompatible state and do not present it as safe to download. |
| Upload/download succeeds | Show a short success summary with snapshot id/device and clear no persisted password fields. |

### 5. Good / Base / Bad Cases

- Good: the user saves URL/user/root/profile while leaving the password untouched; the payload omits `password` and sends `password_touched=false`.
- Good: the user intentionally clears the WebDAV password; the payload sends `password_touched=true` and a blank `password`.
- Good: upload/download confirmation uses the shared dialog and then calls typed wrappers with only `sync_password` plus optional device metadata.
- Base: browser preview renders the sync section with deterministic defaults and disabled operations.
- Bad: a component stores WebDAV or sync passwords in `MxtermSettings`, localStorage, logs, or a shared global store; calls `invoke` directly; or uses `window.confirm` / native `<select>`.

### 6. Tests Required

- Run `npm run check` after changing WebDAV sync types, command wrappers, settings navigation, or the sync settings component.
- Cross-check TypeScript payload fields against Rust structs in `src-tauri/src/webdav_sync.rs` and command signatures in `src-tauri/src/commands.rs`.
- Browser/desktop visual checks should cover disabled/off state, saved-password state, remote empty state, incompatible remote state, busy buttons, and dark theme token contrast.

## Scenario: MCP Settings UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes the MCP settings section, MCP typed wrappers, or connection-exposure selection behavior.
- Source files: `src/shared/tauri/commands.ts`, `src/features/settings/mcpSettingsTypes.ts`, `src/features/settings/SettingsView.tsx`, `src/features/layout/WorkspaceShell.tsx`, and `src/styles/app.css`.
- This is a cross-layer command contract because React persists MCP capability gates and per-connection exposure state while Rust owns sidecar enforcement and redacted storage reads.

### 2. Signatures

```ts
type McpConnectionExposureMode = "all" | "custom"

type McpSettings = {
  enabled: boolean
  expose_connections: boolean
  ssh_operations_enabled: boolean
  allow_dangerous_commands: boolean
  connection_exposure_mode: McpConnectionExposureMode
  exposed_connection_ids: string[]
}

mcpSettingsGet(): Promise<McpSettings>
mcpSettingsSave(request: McpSettings): Promise<McpSettings>
mcpExecutablePath(): Promise<string>
```

### 3. Contracts

- Components must call the typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("mcp_settings_*")` or `invoke("mcp_executable_path")` directly from `SettingsView`.
- `WorkspaceShell` must pass the saved `ConnectionProfile[]` list into `SettingsView` so the MCP page can render connection exposure toggles without reloading connection state through a second feature-local hook.
- `McpSettings.connection_exposure_mode = "all"` means every saved connection is exposed and `exposed_connection_ids` may be empty.
- `McpSettings.connection_exposure_mode = "custom"` means only `exposed_connection_ids` are exposed. The frontend must preserve id order from the current connection list when saving derived custom selections.
- The MCP settings page owns three distinct surfaces:
  - master capability switches
  - copyable stdio config block
  - a separate `MCP 可用连接` settings panel for per-connection exposure
- The connection exposure panel must not collapse exposure state into local filtered state. Search only affects visible rows; checked state must still derive from the full persisted `McpSettings`.
- When no search query is active:
  - `全部打开` saves `{ connection_exposure_mode: "all", exposed_connection_ids: [] }`
  - `全部关闭` saves `{ connection_exposure_mode: "custom", exposed_connection_ids: [] }`
- When a search query is active:
  - bulk buttons act only on the filtered result set
  - button labels must make that scope explicit, for example `打开匹配` / `关闭匹配`
  - non-matching connection exposure state must remain unchanged
- Browser preview without Tauri must render the MCP layout with deterministic defaults, but saving and executable-path lookup must stay disabled and explain that desktop mode is required.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Show the MCP layout, disable save/copy actions that require runtime values, and explain that desktop mode is required for persistence. |
| `mcpSettingsGet` fails | Keep the MCP page visible and show the Rust error message in the section error area. |
| `mcpSettingsSave` fails | Revert optimistic local state to the previous `McpSettings` value and show the Rust error message. |
| `mcpExecutablePath` fails | Keep the page usable and fall back to `mxterm-mcp.exe` in the generated stdio snippet. |
| MCP master switch is off | Disable subordinate switches and connection exposure controls. |
| Connection exposure switch is off | Disable connection exposure search, row toggles, and bulk buttons. |
| Search returns no matches | Keep the exposure panel visible and show a neutral `没有匹配的连接。` message. |

### 5. Good / Base / Bad Cases

- Good: `SettingsView` receives `connections` from `WorkspaceShell`, derives row checked state from the persisted `McpSettings`, and keeps that state stable while filtering the list by search text.
- Good: search-mode bulk actions convert the setting to `custom` and only add or remove ids from the currently filtered rows.
- Base: browser preview shows the MCP section and connection exposure panel with disabled persistence actions.
- Bad: the page stores exposure selection only in local filtered state, drops hidden selections during search, calls Tauri commands directly from JSX handlers, or embeds the connection exposure rows inside the main capability panel instead of a separate settings group.

### 6. Tests Required

- Run `pnpm check` after changing `McpSettings`, MCP wrappers, `SettingsView`, `WorkspaceShell`, or MCP settings CSS.
- Cross-check `McpSettings` field names against Rust `McpSettings` / `McpSettingsInput` in `src-tauri/src/mcp.rs`.
- Verify that search-mode bulk toggles preserve non-matching ids in the saved request payload.
- Browser/desktop visual checks should cover:
  - disabled-by-default state
  - separate `MCP 可用连接` panel rendering
  - search with checked rows preserved
  - search-mode bulk button labels and disabled states

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("mcp_settings_save", {
  request: {
    enabled,
    exposed_connection_ids: filteredIds,
  },
});
```

This bypasses the typed wrapper and can silently drop required fields such as `connection_exposure_mode`.

#### Correct

```tsx
void saveUpdate({
  connection_exposure_mode: "custom",
  exposed_connection_ids: connectionIds.filter((id) => nextIds.has(id)),
});
```

The UI updates the full persisted contract and preserves non-filtered ids unless the user explicitly changes them.

## Scenario: Network Diagnostics Toolbox UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes the right-pane network diagnostics tab, network diagnostic typed wrapper, or result rendering.
- Source files: `src/shared/tauri/commands.ts`, `src/features/tools/dockerTypes.ts`, `src/features/tools/DockerToolPanel.tsx`, and `src/styles/app.css`.
- Network diagnostics run from the active saved SSH connection. Frontend components must pass only `connection_id` plus structured diagnostic parameters; they must not pass SSH passwords, private keys, usernames, or raw host fields.

### 2. Signatures

```ts
type NetworkDiagnosticKind = "ping" | "tcp" | "dns" | "trace" | "http"

type NetworkDiagnosticRequest = {
  kind: NetworkDiagnosticKind
  target: string
  port?: number | null
}

type NetworkDiagnosticResult = {
  kind: NetworkDiagnosticKind
  target: string
  command_label: string
  ok: boolean
  exit_status?: number | null
  duration_ms: number
  summary: string
  stdout: string
  stderr: string
}

networkDiagnosticRun(
  connectionId: string,
  request: NetworkDiagnosticRequest,
): Promise<NetworkDiagnosticResult>
```

### 3. Contracts

- Components must call `networkDiagnosticRun(...)` from `src/shared/tauri/commands.ts`; do not call `invoke("network_diagnostic_run")` directly from UI code.
- The network tab lives inside the existing right-pane toolbox beside Docker and scheduled tasks. It must reuse toolbox layout, Lucide icons, shared button/input behavior, and global `--mx-*` token styles.
- Supported diagnostics are Ping, TCP port probe, DNS lookup, route trace, and HTTP header check.
- TCP is the only kind that sends `port`; non-TCP calls should send `null` or omit it.
- Browser preview without Tauri may render deterministic sample results for layout inspection, but real desktop execution must go through the typed wrapper.
- Result rendering must show status, target, duration, exit status, command label, summary, stdout, and stderr. Failed remote commands should keep stdout/stderr visible instead of replacing them with a generic error.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No active SSH connection | Show a neutral unavailable state and do not call `networkDiagnosticRun`. |
| Blank target | Show inline validation feedback before calling Rust. |
| TCP port is blank or outside `1..=65535` | Show inline validation feedback before calling Rust. |
| No Tauri runtime | Render deterministic preview output and keep SSH credentials out of the browser path. |
| Rust returns `network_diagnostic_target_missing` or `network_diagnostic_port_invalid` | Keep the form visible and show the Rust message inline. |
| Remote command exits non-zero | Render `ok=false`, summary, exit status, stdout, and stderr from the returned result. |

### 5. Good / Base / Bad Cases

- Good: the network tab receives the active saved connection id, validates visible form fields, calls `networkDiagnosticRun(connection.id, request)`, and renders the structured result.
- Good: output copy uses the current returned stdout/stderr buffer and does not rerun a remote command.
- Base: browser preview has no Tauri runtime; the tab renders stable sample output so the layout remains inspectable.
- Bad: a component calls raw `invoke`, passes SSH credential fields, hides stderr on failure, or creates a separate visual system instead of using toolbox styles and tokens.

### 6. Tests Required

- Run `npm run check` after changing network diagnostic types, wrappers, panel props, or CSS class usage.
- Cross-check TypeScript request/response field names against Rust structs in `src-tauri/src/network_tools.rs`.
- Browser/desktop visual checks should cover no connection, each diagnostic kind, TCP port validation, success result, failed result with stderr, copy output, and dark theme token contrast.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("network_diagnostic_run", {
  request: {
    host: connection.host,
    username: connection.username,
    password,
    kind,
    target,
  },
});
```

#### Correct

```tsx
await networkDiagnosticRun(connection.id, {
  kind: "tcp",
  target,
  port,
});
```

## Scenario: Docker Toolbox UI

### 1. Scope / Trigger

- Trigger: frontend code adds or changes the right-pane toolbox, Docker container/image UI, Docker typed wrappers, or Docker terminal entry behavior.
- Source files: `src/shared/tauri/commands.ts`, `src/features/tools/dockerTypes.ts`, `src/features/tools/DockerToolPanel.tsx`, `src/features/files/RemoteFilePanel.tsx`, `src/features/layout/WorkspaceShell.tsx`, and `src/styles/app.css`.
- Docker toolbox calls Rust through saved `connection_id` only. Frontend components must not pass SSH passwords, private-key passphrases, or raw SSH connection fields to Docker commands.

### 2. Signatures

```ts
dockerListContainers(connectionId: string): Promise<DockerContainerSummary[]>
dockerListImages(connectionId: string): Promise<DockerImageSummary[]>
dockerContainerAction(connectionId: string, containerId: string, action: DockerContainerAction): Promise<DockerActionResult>
dockerContainerLogs(connectionId: string, containerId: string, tail?: number): Promise<DockerLogsResult>
dockerContainerLogsStart(connectionId: string, containerId: string, streamId: string, tail?: number): Promise<void>
dockerContainerLogsStop(streamId: string): Promise<void>
dockerContainerLogsSave(localPath: string, content: string): Promise<void>
dockerContainerInspect(connectionId: string, containerId: string): Promise<DockerContainerDetail>
dockerContainerUpdateRestartPolicy(connectionId: string, containerId: string, policy: DockerRestartPolicyKind): Promise<DockerActionResult>
dockerListNetworks(connectionId: string): Promise<DockerNetworkSummary[]>
dockerContainerConnectNetwork(connectionId: string, containerId: string, networkId: string): Promise<DockerActionResult>
dockerImagePull(connectionId: string, image: string, pullId?: string): Promise<DockerActionResult>
dockerImageRemove(connectionId: string, imageId: string): Promise<DockerActionResult>
dockerImageRun(connectionId: string, request: DockerImageRunRequest): Promise<DockerActionResult>
dockerEngineStatus(connectionId: string): Promise<DockerEngineStatus>
dockerEngineAction(connectionId: string, action: DockerEngineAction): Promise<DockerActionResult>
dockerEngineReadConfig(connectionId: string): Promise<DockerEngineConfigResult>
dockerEngineSaveConfig(connectionId: string, content: string): Promise<DockerActionResult>
```

Docker image pull progress is delivered through the typed event wrapper:

```ts
listenDockerImagePullProgress(handler: (event: DockerImagePullProgressEvent) => void)

type DockerImagePullProgressEvent = {
  pull_id: string
  connection_id: string
  image: string
  status: "running" | "success" | "failed"
  message: string
  percent?: number | null
  current_layer?: string | null
}
```

Docker container logs stream through a typed event wrapper:

```ts
listenDockerLogStream(handler: (event: DockerLogStreamEvent) => void)

type DockerLogStreamEvent = {
  stream_id: string
  connection_id: string
  container_id: string
  kind: "chunk" | "error" | "finished"
  content?: string | null
  message?: string | null
}
```

### 3. Contracts

- Components must use the typed wrappers in `src/shared/tauri/commands.ts`; do not call `invoke("docker_*")` directly from UI components.
- The right-pane first-level tool id is `tools`. The toolbox owns internal tabs for Docker, SSH tunnels, network diagnostics, and scheduled tasks. SSH tunnel management is hosted here through `TunnelPanel`; switching away from Docker must not trigger Docker refresh work.
- Docker actions require an active SSH connection. Local-terminal workspaces should not expose Docker controls unless a future task defines a local Docker model.
- Delete container and delete image actions must use `ConfirmDialog`. Do not use `window.confirm`, bulk destructive actions, prune, or silent optimistic deletion.
- Container terminal entry opens a new SSH terminal tab for the same saved connection and writes `docker exec -it <quoted container id> sh`. It must not embed a second terminal in the right pane or record the command as Command Sender history.
- Clicking a container name opens a compact detail dialog backed by `dockerContainerInspect(...)` and `dockerListNetworks(...)`. The detail dialog is informational first and must not repeat list-level entry buttons such as logs, console, attach, or stats.
- Container detail should display status, image/command metadata, ports, masked environment variables, mounts, connected networks, labels, and raw inspect JSON only behind an explicit copy action.
- Container detail settings may update restart policy and join an existing Docker network. Restart policy selection must use the shared `AppSelect` with `no`, `always`, `unless-stopped`, and `on-failure`; network selection must use `AppSelect` and exclude networks that are already connected.
- Updating restart policy or joining a network must keep the detail dialog open, show backend errors inline, refresh detail after success, and refresh the container list silently.
- Image pull submits an optional frontend-generated `pullId`. The pull dialog should close after the task is accepted, and the image list should render a temporary pull row keyed by `pull_id` while `docker:image_pull_progress` events arrive. Success refreshes the real image list; failure keeps the row visible with the error message.
- Image quick run opens from the image card, uses `dockerImageRun(...)`, and sends only structured run options plus the saved `connection_id`. The dialog must keep errors inline, close only after success, then refresh the container list.
- Container logs use `dockerContainerLogsStart(...)` plus `docker:log_stream` events for live output. The UI must stop the active stream with `dockerContainerLogsStop(streamId)` when the log dialog closes, the container target changes, the connection changes, or the component unmounts.
- Log stream events must be matched by `stream_id` before appending content. Stale chunks from a previous stream must not be appended into the current dialog.
- Log output should strip ANSI control codes before rendering, keep a bounded in-memory buffer, and support follow-tail behavior that pauses when the user scrolls away from the bottom.
- Realtime streaming and follow-tail are separate controls. `暂停实时` stops the backend log stream and keeps the current buffer visible; `启用实时` starts a new stream with `tail = 0` so only new log lines append. `跟随尾部` / `恢复跟随` only controls scroll behavior.
- Log download saves the current visible log buffer through `dockerContainerLogsSave(...)` after a save dialog path is chosen. It must not re-run `docker logs`, append stale stream chunks, or require SSH credentials in the UI.
- The Docker page has `containers`, `images`, and `engine` internal views. Entering the engine view may load Docker status and daemon config; ordinary container/image refreshes must not run expensive engine disk probes.
- Engine service stop, restart, and "save config then restart" require `ConfirmDialog`. Starting the service can run directly.
- Engine config editing is limited to `/etc/docker/daemon.json`. The UI may normalize JSON before save, but Rust remains authoritative for validation and backup/write behavior.
- Engine management v1 targets systemd hosts and does not implement sudo password prompts. Permission failures should be shown as remote errors, not hidden behind fallback UI.
- Long fields such as image id, container status, ports, and logs should be truncated visually with full text available through title/tooltip where useful.
- UI must use Lucide icons, shared tooltip/dialog styles, compact row actions, and global `--mx-*` tokens. Do not introduce native selects, independent overlay styling, or a separate Docker dashboard visual system.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No active SSH connection | Show a neutral unavailable state and do not call Docker commands. |
| No Tauri runtime | Render deterministic preview rows so the layout remains inspectable. |
| `docker_command_missing` | Show that the remote host does not have Docker CLI available. |
| `docker_permission_denied` | Show that the current remote user lacks Docker permission. |
| Container/image delete fails | Keep the row visible, show the backend error, and allow refresh/retry. |
| Container detail load fails | Keep the detail dialog open and show the backend error inside it. |
| Restart policy update fails | Keep the detail dialog open, preserve the selected draft policy, and show the backend error inline. |
| No joinable Docker network exists | Disable the network select and join button with a neutral empty state. |
| Network join fails | Keep the detail dialog open, preserve the selected network, and show the backend error inline. |
| Logs load fails | Keep the logs dialog open and show the backend error inside it. |
| Log stream start fails | Keep the logs dialog open, clear the active stream id, and show the backend error inside it. |
| Log stream emits `error` | Stop the streaming indicator, keep existing visible logs, and show the event message. |
| User pauses realtime logs | Stop the active backend stream, show a paused state, preserve the current visible buffer, and keep copy/download available. |
| User enables realtime logs after pause | Start a new stream with `tail = 0` and append only new chunks. |
| Log dialog closes | Stop the active backend stream idempotently; repeated close/cleanup calls must not surface errors to the user. |
| Log download has no content | Keep the dialog open and show that there is no log content to save. |
| Log download save fails | Keep the current log buffer visible and show the Rust error message inside the dialog. |
| Pull image validation fails before task creation | Keep the pull dialog open and show the error near the input. |
| Pull image starts successfully | Close the pull dialog and show a running row in the image list. |
| Pull image emits progress without a percent | Keep an indeterminate progress row and show the latest Docker stage text. |
| Pull image fails after task creation | Keep a failed pull row in the image list; do not fake-add an image row. |
| Image quick run fails | Keep the run dialog open, preserve the draft options, and show the Rust error message inline. |
| Image quick run succeeds | Close the run dialog, refresh containers, and switch to the container list. |
| Engine status is not loaded yet | Show a neutral unknown state, not a red stopped/error state. |
| `systemctl` is unavailable | Disable service controls and show the raw reason in the engine panel. |
| Engine config JSON is invalid | Keep the editor content intact and show an inline validation error. |
| Engine config save fails | Keep the draft content visible and surface the backend error. |

### 5. Good / Base / Bad Cases

- Good: Docker panel receives the current SSH connection id, loads containers and images through typed wrappers, and keeps delete rows visible until the backend confirms success.
- Good: clicking a container name opens a Radix dialog that uses typed wrappers for inspect/network data, shared `AppSelect` controls for detail settings, and global `--mx-*` token styles.
- Good: container detail shows masked sensitive environment values from Rust and does not try to reveal or reparse raw inspect JSON in the UI.
- Good: opening container logs starts one live stream, appends only matching `stream_id` chunks, pauses follow-tail when the user scrolls up, and stops the stream on close.
- Good: pausing realtime logs stops the remote `docker logs -f` process while preserving the visible buffer; enabling realtime resumes from new output without duplicating the initial tail.
- Good: downloading logs writes the current bounded buffer to the user-selected local path without interrupting the live stream.
- Good: image quick run uses `AppSelect` for network and restart policy, structured rows for ports/env/volumes, and the typed `dockerImageRun(...)` wrapper instead of direct invoke.
- Good: opening a container terminal creates a normal SSH terminal tab and writes the quoted `docker exec -it ... sh` command after the terminal session is connected.
- Good: entering the engine view loads status/config through typed wrappers and confirms service-impacting actions before calling Rust.
- Base: browser preview has no Tauri runtime; the panel renders deterministic preview rows and keeps real persistence/remote operations out of the preview path.
- Bad: a component calls `invoke("docker_*")` directly, passes SSH password fields into Docker commands, deletes rows optimistically before backend success, duplicates list-level actions inside the detail dialog, or uses `window.confirm`.
- Bad: a component calls `dockerContainerLogs(...)` repeatedly to fake live logs, leaves `docker logs -f` running after the dialog closes, appends events without checking `stream_id`, or downloads logs by re-running a separate remote command.

### 6. Tests Required

- Run `npm run check` after changing Docker toolbox types, wrappers, panel props, right-pane tab integration, or workspace terminal-entry wiring when type-check runs are approved for the session.
- Cross-check TypeScript wrapper payload field names against Rust request structs in `src-tauri/src/docker_tools.rs`.
- Run `node scripts/check-docker-tool-refresh-source.mjs` after changing Docker auto-refresh, exec-cache, log-stream behavior, detail dialog commands, or detail styles.
- Browser/desktop visual checks should cover no connection, no containers, running/exited containers, container detail loading/error/settings, image pull dialog, delete confirmations, streaming log dialog, follow-tail pause/resume, and dark theme token contrast.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("docker_container_action", {
  connection_id: connection.id,
  container_id: container.id,
  action: "remove",
});
```

#### Wrong

```tsx
const result = await dockerContainerLogs(connection.id, container.id, 120);
setInterval(() => setLogs(result.content), 1000);
```

#### Correct

```tsx
await dockerContainerLogsStart(connection.id, container.id, streamId, 300);
const unlisten = await listenDockerLogStream((event) => {
  if (event.stream_id === streamId && event.kind === "chunk") {
    appendLogChunk(event.content || "");
  }
});
```

#### Correct

```tsx
await dockerContainerAction(connection.id, container.id, "remove");
```

#### Wrong

```tsx
window.confirm("删除容器？") && removeContainerLocally(container.id);
```

#### Correct

```tsx
<ConfirmDialog
  open={Boolean(deleteTarget)}
  title="删除容器"
  description="确认删除该容器吗？"
  confirmLabel="删除"
  onConfirm={confirmRemoveContainer}
  onOpenChange={closeDeleteDialog}
/>
```

## Scenario: AI Terminal Assistant UI and Tauri Wrappers

### 1. Scope / Trigger

- Trigger: frontend code adds or changes the built-in AI assistant panel, AI provider settings, AI typed wrappers, `ai:chat_stream` event handling, terminal selection handoff, or command suggestion actions.
- Source files: `src/features/ai/*`, `src/features/layout/WorkspaceShell.tsx`, `src/features/files/RemoteFilePanel.tsx`, `src/features/terminal/TerminalPanel.tsx`, `src/features/settings/SettingsView.tsx`, `src/shared/tauri/commands.ts`, `src/shared/tauri/events.ts`, and `src/styles/app.css`.
- The AI assistant spans settings, right-pane tools, terminal output/context capture, command sender integration, and Rust streaming commands, so UI code must keep typed contracts and startup boundaries aligned.

### 2. Signatures

Typed wrappers:

```ts
aiProviderConfigList(): Promise<AiProviderConfig[]>
aiProviderConfigSave(request: AiProviderConfigInput): Promise<AiProviderConfig>
aiProviderConfigDelete(id: string): Promise<void>
aiProviderConfigRevealApiKey(id: string): Promise<{ api_key: string }>
aiChatSessionList(): Promise<AiChatSessionSummary[]>
aiChatSessionGet(sessionId: string): Promise<AiChatSession>
aiChatSessionDelete(sessionId: string): Promise<void>
aiChatSessionClear(sessionId: string): Promise<AiChatSession>
aiChatStreamStart(request: AiChatStreamStartRequest): Promise<AiChatStreamStartResponse>
aiChatStreamStop(streamId: string): Promise<void>
aiCommandAssess(command: string): Promise<AiCommandAssessment>
listenAiChatStream(handler: (event: AiChatStreamEvent) => void): Promise<UnlistenFn>
```

Core payload fields:

```ts
type AiProviderKind = "openai" | "claude"
type AiApiFormat = "openai_compatible" | "anthropic"
type AiCommandRisk = "safe" | "dangerous"

type AiContextBlock = {
  id: string
  kind: string
  title: string
  content: string
  source: string
  line_count: number
  char_count: number
}
```

### 3. Contracts

- Components must call AI backend commands through `src/shared/tauri/commands.ts`; do not call raw `invoke("ai_*")` from feature components.
- Components must listen to `ai:chat_stream` through `listenAiChatStream(...)`, store the returned unlisten function, and call it during cleanup. Stream chunks must be matched by `stream_id` before mutating messages.
- After `aiChatStreamStart(...)` returns, `AiAssistantPanel` must synchronously write the returned `stream_id` into its current stream ref before relying on React state/effects. Some providers can emit the first SSE chunk immediately, and waiting for a state commit can make the listener drop early chunks as stale.
- `AiAssistantPanel` must be lazy-loaded from `WorkspaceShell`; do not statically import the panel component or provider logic into `main.tsx`, `App.tsx`, or top-level workspace startup code.
- The right-pane first-level tool id is `ai`. It lives beside `files`, `monitor`, `commands`, and `tools`; local terminal workspaces may expose `commands` and `ai`.
- Terminal right-click selection handoff uses xterm's selection API. The menu action only opens the AI pane and appends a visible `terminal_selection` context block; it must not automatically submit a model request.
- Adding the AI handoff action must not replace ordinary terminal context-menu actions. Keep copy, paste, select all, and terminal reconnect where available in the same terminal right-click menu, with copy using the raw xterm selection text and AI handoff using the trimmed selection for context.
- Visible context blocks must show source and size metadata and be removable before send. Connection context must be redacted metadata only; do not include passwords, private keys, tokens, or full hidden connection config.
- If a user-visible context block contains sensitive-looking text such as `Authorization: Bearer`, `api_key=`, `password=`, private-key headers, or `sk-` style keys, the AI panel must mark that context chip with a warning and keep the removable pre-send state. The warning does not silently redact or block user-selected content because complete visible context is persisted by design.
- AI provider settings must use `AppSelect`, existing settings rows, project token styles, and the `api_key_touched` convention. Existing saved API keys are never prefilled during ordinary config loads, but the eye button may call `aiProviderConfigRevealApiKey(...)` on demand. Reveal-only values must keep `api_key_touched=false` until the user edits the field.
- Assistant command suggestions may be copied, inserted into Command Sender, saved as snippets, or sent to the active terminal. Only direct terminal sends for commands assessed as `dangerous` require `ConfirmDialog`; copy, insert, and save must not be interrupted by confirmation.
- Direct terminal sends must reuse the existing Command Sender write path so target selection, delivery status, and command history remain consistent.
- Browser preview or non-Tauri runtime must show stable unavailable states and must not fake persistence or model calls.

### 4. Validation & Error Matrix

| Condition | Frontend behavior |
| --- | --- |
| No Tauri runtime | Show that desktop runtime is required for config save and model calls; do not call AI commands. |
| No provider configs | Show an AI settings entry point and disable send. |
| Provider config selected but no saved API key | Surface Rust `ai_api_key_missing` as an inline error. |
| User sends blank input | Keep the message in the compose area and show inline validation. |
| Stream chunk has a stale `stream_id` | Ignore it. |
| Stream emits `error` | Keep partial assistant content, mark message error, and show the event error. |
| User stops generation | Call `aiChatStreamStop(streamId)`, keep partial content, and show stopped status. |
| Terminal selection is blank | Disable the context-menu action. |
| Terminal context menu opens | Show ordinary copy/paste/select-all actions plus the AI handoff action; SSH terminal tabs should also expose current-tab reconnect. Do not leave AI as the only menu item. |
| Context block contains sensitive-looking text | Keep the chip removable and show a visible sensitive-information warning before send. |
| Dangerous command direct-send | Show `ConfirmDialog` before `terminalWrite`. |
| Safe command direct-send | Send without confirmation. |
| Copy / insert / save dangerous command | Do not show the dangerous-send confirmation. |

### 5. Good / Base / Bad Cases

- Good: AI panel registers one stream listener, cleans it up on unmount, and ignores stale stream ids.
- Good: stream start stores the returned `stream_id` in a ref synchronously before the UI waits for React state, so early chunks from fast providers are preserved.
- Good: provider settings edit metadata with `api_key_touched=false` when the API key field was not changed, preserving the vault secret.
- Good: clicking the API Key eye button reveals the saved key for the current config only, shows it in the password field, and still preserves the vault secret if the user saves without editing it.
- Good: terminal selected text becomes a visible context chip and waits for the user to type or send a question.
- Good: a context chip containing `password=` or `Authorization: Bearer ...` is visibly marked as sensitive and can be removed before send.
- Good: dangerous command assessment is requested from Rust immediately before direct terminal send, with the local heuristic only as a runtime-unavailable fallback.
- Base: user has no active SSH connection but a local terminal is active; AI still opens and can use local terminal output plus command draft context.
- Bad: auto-sending selected terminal text to the model from a context-menu action.
- Bad: silently attaching sensitive-looking terminal output without warning, or silently redacting user-selected context while still displaying the original text.
- Bad: preloading AI panel code at app startup or importing provider request code into the workspace shell.
- Bad: using `window.confirm`, native `<select>`, or feature-local menu styling for AI settings/actions.
- Bad: updating only React stream state after `aiChatStreamStart` and letting the event listener read a stale/null ref during the first chunk.

### 6. Tests Required

- Run `npm run check` after changing AI types, wrappers, settings, panel props, terminal selection handoff, right-pane tab integration, or AI CSS.
- Run `npm run build` and confirm the production output keeps `AiAssistantPanel-*.js` as a separate lazy chunk.
- Run `node scripts/check-startup-module-boundary-source.mjs` after touching `WorkspaceShell`, `App`, startup imports, settings imports, or lazy feature boundaries.
- Cross-check TypeScript request/response fields against Rust structs in `src-tauri/src/ai_assistant.rs`.
- Check stream lifecycle changes for first-chunk races by ensuring `streamStateRef.current` is set before any event handler can process returned stream events.
- Manual or automated desktop checks should cover no-config state, provider switching, streaming reply, stop, retry, session delete/clear, terminal-selection context, sensitive-context warning, command copy/insert/save/send, dangerous-send confirmation, and dark theme contrast.

### 7. Wrong vs Correct

#### Wrong

```tsx
await invoke("ai_chat_stream_start", { request });
```

This bypasses the typed command contract and makes payload drift easy.

#### Correct

```tsx
const response = await aiChatStreamStart({
  provider_config_id: selectedProvider.id,
  session_id: activeSessionId,
  content,
  contexts,
});
```

The wrapper owns the command name and request envelope.

#### Wrong

```tsx
useEffect(() => {
  void listenAiChatStream((event) => appendChunk(event.delta || ""));
}, []);
```

This leaks the listener and appends stale chunks.

#### Correct

```tsx
useEffect(() => {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listenAiChatStream((event) => {
    if (!disposed && event.stream_id === streamStateRef.current?.streamId) {
      applyStreamEvent(event);
    }
  }).then((cleanup) => {
    if (disposed) cleanup();
    else unlisten = cleanup;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}, []);
```

The component cleans up and treats `stream_id` as the stream owner.
