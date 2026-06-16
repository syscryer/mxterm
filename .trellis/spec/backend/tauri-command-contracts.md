# Tauri Command Contracts

## Scenario: Connection Repository and Terminal Session Handoff

### 1. Scope / Trigger

- Trigger: a backend Tauri command or persistent data contract changes.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/connections/mod.rs`, `src-tauri/src/credentials/mod.rs`, `src-tauri/src/known_hosts/mod.rs`, `src-tauri/src/ssh_config.rs`, and `src-tauri/src/terminal/manager.rs`.
- This project treats Tauri commands as the API boundary between React and Rust. Backend structs, serialized field names, validation, and `AppError` codes are executable contracts.

### 2. Signatures

- `connection_list(app: AppHandle) -> Result<Vec<ConnectionProfile>, AppError>`
- `connection_upsert(app: AppHandle, request: ConnectionProfileInput) -> Result<ConnectionProfile, AppError>`
- `connection_set_favorite(app: AppHandle, request: ConnectionFavoriteRequest) -> Result<ConnectionProfile, AppError>`
- `connection_mark_connected(app: AppHandle, request: ConnectionActivityRequest) -> Result<ConnectionProfile, AppError>`
- `connection_delete(app: AppHandle, id: String) -> Result<(), AppError>`
- `credential_list(app: AppHandle) -> Result<Vec<CredentialProfile>, AppError>`
- `credential_upsert(app: AppHandle, request: CredentialProfileInput) -> Result<CredentialProfile, AppError>`
- `credential_delete(app: AppHandle, id: String) -> Result<(), AppError>`
- `known_host_trust(app: AppHandle, request: KnownHostTrustRequest) -> Result<(), AppError>`
- `connection_test(app: AppHandle, request: ConnectionRuntimeCredentialRequest) -> Result<ConnectionStepResult, AppError>`
- `connection_test_profile(app: AppHandle, request: ConnectionProfileInput) -> Result<ConnectionStepResult, AppError>`
- `connection_probe_system(app: AppHandle, request: ConnectionRuntimeCredentialRequest) -> Result<ConnectionProfile, AppError>`
- `connection_probe_latency(app: AppHandle, request: ConnectionLatencyProbeRequest) -> Result<ConnectionLatencyProbeResult, AppError>`
- `terminal_connect(app: AppHandle, manager: State<TerminalManager>, request: TerminalConnectRequest) -> Result<String, AppError>`
- `terminal_write(manager: State<TerminalManager>, request: TerminalWriteRequest) -> Result<(), AppError>`
- `terminal_resize(manager: State<TerminalManager>, request: TerminalResizeRequest) -> Result<(), AppError>`
- `terminal_close(manager: State<TerminalManager>, session_id: String) -> Result<(), AppError>`

`ConnectionProfileInput` fields:

```rust
id: Option<String>
name: Option<String>
group: Option<String>
host: String
port: u16
username: String
credential_mode: ConnectionCredentialMode // "saved" | "inline" | "prompt"
credential_id: Option<String>
inline_auth_kind: Option<ConnectionAuthKind>
inline_password: Option<String>
inline_private_key_path: Option<String>
inline_private_key_passphrase: Option<String>
prompt_auth_kind: Option<ConnectionAuthKind>
proxy: ConnectionProxyConfig
advanced: ConnectionAdvancedConfig
notes: Option<String>
is_favorite: Option<bool>
last_connected_at: Option<String>
remote_os_id: Option<String>
remote_os_name: Option<String>
remote_os_version: Option<String>
// Legacy migration only:
auth_kind: Option<ConnectionAuthKind>
password: Option<String>
private_key_path: Option<String>
private_key_passphrase: Option<String>
```

`ConnectionProfile` adds `id`, normalized `name`, `is_favorite`, `last_connected_at`, `remote_os_id`, `remote_os_name`, `remote_os_version`, `created_at`, and `updated_at`.

`ConnectionFavoriteRequest` fields:

```rust
connection_id: String
is_favorite: bool
```

`ConnectionActivityRequest` fields:

```rust
connection_id: String
```

`CredentialProfileInput` fields:

```rust
id: Option<String>
name: Option<String>
kind: ConnectionAuthKind // "password" | "private_key"
password: Option<String>
private_key_path: Option<String>
private_key_passphrase: Option<String>
notes: Option<String>
```

`ConnectionRuntimeCredentialRequest` fields:

```rust
connection_id: String
auth_kind: Option<ConnectionAuthKind>
password: Option<String>
private_key_path: Option<String>
private_key_passphrase: Option<String>
```

`KnownHostTrustRequest` fields:

```rust
host_key: HostKeyInfo
```

`HostKeyInfo` fields:

```rust
host: String
port: u16
key_algorithm: String
fingerprint_sha256: String
public_key: String
```

`ConnectionLatencyProbeRequest` fields:

```rust
connection_id: String
```

`ConnectionLatencyProbeResult` serializes to React as:

```rust
latency_ms: Option<u64>
reachable: bool
```

`TerminalConnectRequest` accepts a direct SSH request plus optional `connection_id`. When `connection_id` is present and non-empty, Rust resolves the saved connection as authoritative, then combines connection target fields, credential mode, saved or inline credential material, proxy config, advanced timeouts, and any prompt credential supplied by the request.

### 3. Contracts

- Connection data is stored as JSON at `app.path().app_data_dir()/connections.json`.
- Credential data is stored as JSON at `app.path().app_data_dir()/credentials.json`.
- Trusted host keys are stored as JSON at `app.path().app_data_dir()/known_hosts.json`.
- JSON roots use `version` plus the relevant item list (`profiles`, `credentials`, or `entries`).
- `ConnectionAuthKind` uses `#[serde(rename_all = "snake_case")]`; frontend values must be `password` or `private_key`.
- `ConnectionCredentialMode` uses `saved`, `inline`, or `prompt`.
- `ConnectionProxyKind` uses `none`, `http_connect`, or `socks5`.
- Empty optional strings are normalized to `None`; non-empty target, credential, proxy, and note fields are trimmed.
- Blank `name` defaults to `{username}@{host}`.
- `is_favorite` is the explicit favorite flag. `last_connected_at` stores the last successful terminal connection timestamp. Upserting an existing connection must preserve both values unless the input explicitly supplies them.
- `remote_os_id`, `remote_os_name`, and `remote_os_version` store detected remote system metadata from `connection_probe_system`. Upserting an existing connection must preserve these fields when `host`, `port`, and `username` are unchanged; changing that target identity clears the old detected system fields unless the input explicitly supplies new values.
- `connection_set_favorite` updates only `is_favorite` plus `updated_at`; it must not change `last_connected_at`.
- `connection_mark_connected` updates only `last_connected_at`; recent views must not be derived from `updated_at`.
- `credential_mode=saved` requires `credential_id` and clears inline secrets.
- `credential_mode=inline` requires inline password or inline private key path depending on `inline_auth_kind`.
- `credential_mode=prompt` stores no password or private key passphrase; runtime prompt credentials must be supplied by `TerminalConnectRequest` or `ConnectionRuntimeCredentialRequest`.
- Password auth clears private-key fields; private-key auth clears password fields.
- HTTP CONNECT and SOCKS5 proxy modes require proxy host and port. `none` clears proxy auth and proxy target fields.
- Advanced timeouts are milliseconds. Keep validation ranges in Rust; React may edit numbers as strings but Rust is authoritative.
- The first version intentionally stores passwords and private-key passphrases in clear text. Do not add masking/encryption unless the task explicitly introduces the lock-screen or secret-store feature.
- All command failures return `AppError { code, message, raw_message, recoverable }`.
- `credential_delete` must check saved connection references and return `credential_in_use` instead of deleting a credential currently referenced by `credential_mode=saved`.
- Host-key verification is stateful. Unknown host keys return `host_key_unknown` with serialized `HostKeyInfo` in `raw_message`; changed host keys return `host_key_changed` with the new key and old fingerprint. Only `known_host_trust` may write or update trusted host keys.
- `connection_test`, `terminal_connect`, and remote-file commands must use the same saved-connection resolution path in `ssh_config.rs`; do not re-resolve credentials independently in UI-facing command handlers.
- `connection_test_profile` is only for testing the current `ConnectionDialog` form before it is saved. It must validate and resolve a transient profile through `resolve_transient_connection(...)`, may read `credentials.json` when `credential_mode=saved`, and must not call `ConnectionStore::upsert`, persist `connections.json`, mark recent activity, or synthesize a permanent connection id.
- `connection_probe_system` resolves the saved connection with the same runtime prompt credential shape as `connection_test`, opens a short-lived exec session, runs only the read-only `cat /etc/os-release 2>/dev/null || uname -s 2>/dev/null || true` probe, parses `ID`, `NAME`, and `VERSION_ID`, and writes only the `remote_os_*` fields back to `connections.json`. It must not log passwords, passphrases, or full command payloads, and probe failure must be handled by the frontend as non-fatal after a successful connection.
- `connection_probe_latency` must load the saved profile by `connection_id` and probe only the saved `host`/`port` with a short TCP timeout. It must not require or log passwords, private keys, or passphrases.
- Terminal output and state events include both `session_id` and the optional frontend `request_id`. Keep `request_id` on early connection events so React can display shell output that arrives before the `terminal_connect` promise resolves.
- The interactive terminal reader must not stop on `ChannelMsg::Eof`; continue reading until `ChannelMsg::Close` or channel end so a shell prompt or late startup output cannot be lost during frontend handoff.
- Tauri event names must use allowed characters only. Use colon-separated names such as `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`; do not use dot-separated names.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| `host` is blank | `connection_host_missing` | true |
| `username` is blank | `connection_username_missing` | true |
| `port == 0` | `connection_port_invalid` | true |
| `credential_mode == saved` and credential id is blank | `connection_credential_missing` | true |
| `credential_mode == saved` and credential id is unknown | `credential_missing` | false |
| `credential_mode == inline`, password auth, and password is blank | `connection_password_missing` | true |
| `credential_mode == inline`, private-key auth, and private key path is blank | `connection_private_key_missing` | true |
| Proxy mode requires proxy target but host is blank | `connection_proxy_host_missing` | true |
| Proxy mode requires proxy target but port is blank / invalid | `connection_proxy_port_invalid` | true |
| Advanced connect timeout outside allowed range | `connection_connect_timeout_invalid` | true |
| Advanced auth timeout outside allowed range | `connection_auth_timeout_invalid` | true |
| Advanced keepalive interval outside allowed range | `connection_keepalive_invalid` | true |
| Delete/open unknown connection id | `connection_missing` | false |
| Transient dialog test has invalid profile input | same validation code as `connection_upsert` | true |
| Credential name is blank | `credential_name_missing` | true |
| Credential password auth has blank password | `credential_password_missing` | true |
| Credential private-key auth has blank key path | `credential_private_key_missing` | true |
| Delete unknown credential id | `credential_missing` | false |
| Delete referenced credential id | `credential_in_use` | true |
| Unknown host key during SSH handshake | `host_key_unknown` | true |
| Changed host key during SSH handshake | `host_key_changed` | true |
| Latency probe blank connection id | `connection_probe_connection_missing` | false |
| Latency probe task cannot join | `connection_probe_join_failed` | true |
| Cannot resolve app data dir | `connection_store_path_failed` | true |
| Cannot read store file | `connection_store_read_failed` | true |
| Store JSON cannot parse | `connection_store_parse_failed` | true |
| Cannot create store parent dir | `connection_store_create_dir_failed` | true |
| Cannot serialize store | `connection_store_serialize_failed` | true |
| Cannot write store file | `connection_store_write_failed` | true |
| System clock before UNIX epoch | `connection_clock_invalid` | false |
| Runtime prompt credential is required but missing | `credential_prompt_required` | true |
| Terminal request has no resolved auth material | `terminal_auth_missing` | true |

### 5. Good / Base / Bad Cases

- Good: `connection_upsert` receives inline password auth, trims `host` and `username`, defaults `name`, clears private-key fields, persists the JSON store, and returns the saved profile.
- Good: `connection_test_profile` receives the unsaved dialog form, validates it, resolves inline or saved credential material, opens and closes a test SSH session, and leaves `connections.json` unchanged.
- Good: `terminal_connect` receives `connection_id` for a saved-credential connection plus stale frontend host fields; Rust loads the saved profile, resolves the credential, verifies the host key, applies proxy/timeout settings, and uses the saved values.
- Base: `connection_test` receives prompt credentials, resolves the saved connection with those runtime credentials, opens a reusable exec session, closes it, and returns `{ ok: true }`.
- Bad: `credential_delete` deletes a credential referenced by an existing connection, a dialog test calls `ConnectionStore::upsert` before connecting, or a command handler accepts frontend-supplied raw credentials for remote-file commands.

### 6. Tests Required

- Unit-test connection validation for blank host, blank username, zero port, credential modes, proxy validation, advanced validation, and legacy migration.
- Unit-test credential validation for blank name, missing password, missing private key, auth-field clearing, and JSON store round-trip/delete.
- Unit-test known-host store behavior for unknown, trusted, and changed fingerprints.
- Unit-test saved connection resolution for saved, inline, prompt, missing credential, proxy, and advanced timeout behavior.
- Unit-test terminal connection validation for missing runtime prompt credentials and invalid direct SSH request fields.
- Unit-test remote system parsing for Ubuntu/CentOS-style `/etc/os-release` payloads and connection-store round trip/preservation of `remote_os_*` fields.
- Source-check that `connection_test_profile`, `resolve_transient_connection`, and the frontend `connectionTestProfile` wrapper are registered together, and that dialog testing does not call `saveConnection` / `connectionUpsert`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing command payloads or storage behavior.

### 7. Wrong vs Correct

#### Wrong

```rust
// Bypasses validation and can persist contradictory auth fields.
let profile = ConnectionProfile { password, private_key_path, ..profile };
fs::write(path, serde_json::to_string(&profile)?)?;
```

#### Correct

```rust
let mut store = ConnectionStore::load(connection_store_path(&app)?)?;
let profile = store.upsert(request, &now_timestamp()?)?;
```

#### Wrong

```rust
// Bypasses saved credential, proxy, advanced timeout, and host-key resolution.
manager.connect(app, request).await
```

#### Correct

```rust
let config = resolve_saved_connection(app, connection_id, prompt_credential)?;
manager.connect_resolved(app, &config).await
```

## Scenario: Remote File Listing Command

### 1. Scope / Trigger

- Trigger: backend code adds or changes remote file browsing, short SSH exec, remote path quoting, or the `remote_file_list` Tauri command.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/remote_files.rs`, `src-tauri/src/terminal/session.rs`, and `src-tauri/src/lib.rs`.
- This is a cross-layer command contract because React owns UI tree state while Rust owns saved SSH credentials and remote command execution.

### 2. Signatures

- `remote_file_list(app: AppHandle, request: RemoteFileListRequest) -> Result<Vec<RemoteFileEntry>, AppError>`
- `TerminalSession::exec(request: TerminalConnectRequest, command: &str) -> Result<ExecOutput, AppError>`
- `build_remote_list_command(path: &str) -> String`
- `parse_remote_list_output(output: &[u8]) -> Vec<RemoteFileEntry>`
- `quote_posix_shell(value: &str) -> String`

`RemoteFileListRequest` fields:

```rust
connection_id: String
path: Option<String>
```

`RemoteFileEntry` serializes to React as:

```rust
name: String
path: String
type: "directory" | "file" | "symlink" | "other"
```

### 3. Contracts

- `remote_file_list` must load the saved `ConnectionProfile` by `connection_id`; React must not provide raw credentials for this command.
- Blank `connection_id` returns `remote_file_connection_missing`.
- Missing or blank `path` defaults to `"."`.
- Remote paths must be quoted with POSIX single-quote escaping before interpolation into shell commands.
- The listing command must be POSIX-shell friendly. Do not depend on GNU-only `find -printf`; use shell globs plus `printf '%s\000%s\000%s\000'` structured output so BusyBox / small Linux images work.
- `RemoteFileKind` must use `#[serde(rename_all = "snake_case")]` and the entry field must serialize as `type`, not `kind`.
- Sort order is directory, symlink, file, other; names sort case-insensitively with the raw name as a tie-breaker.
- `TerminalSession::exec` is short-lived: connect, authenticate, open one exec channel, collect stdout/stderr/exit status, then disconnect.
- `TerminalSession::exec` must not stop reading on `ChannelMsg::Eof`. Continue until `ChannelMsg::Close` or channel end so later `ExitStatus` messages are not missed.
- Do not log passwords, private-key passphrases, or full command payloads in remote file listing paths.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| `connection_id` is blank | `remote_file_connection_missing` | false |
| `connection_id` is unknown | `connection_missing` | false |
| No password or private key is available after loading profile | `terminal_auth_missing` | true |
| SSH exec TCP connection times out | `remote_exec_connect_timeout` | true |
| SSH exec TCP connection fails | `remote_exec_connect_failed` | true |
| SSH exec auth times out | `remote_exec_auth_timeout` | true |
| SSH exec auth fails or is rejected | `terminal_auth_failed` / `terminal_auth_rejected` | true |
| SSH exec channel open times out/fails | `remote_exec_channel_timeout` / `remote_exec_channel_failed` | true |
| Remote command start times out/fails | `remote_exec_start_timeout` / `remote_exec_start_failed` | true |
| Remote list script exits non-zero because path is missing/unreadable | `remote_file_list_failed` | true |

### 5. Good / Base / Bad Cases

- Good: `remote_file_list` receives `{ connection_id, path: "/opt/app's data" }`, loads the saved profile, quotes the path as `'/opt/app'\''s data'`, executes the POSIX shell listing script, parses NUL-delimited fields, and returns sorted entries.
- Base: `path` is omitted; Rust lists `"."` for the saved connection and returns immediate children only.
- Bad: the command interpolates an unquoted path such as `/tmp/app; rm -rf /`, depends on `find -printf`, or accepts frontend-supplied password fields for file listing.

### 6. Tests Required

- Unit-test `quote_posix_shell` for normal paths, empty strings, and single quotes.
- Unit-test `parse_remote_list_output` for directory/file/symlink/other mapping, malformed trailing chunks, and sort order.
- Unit-test `build_remote_list_command` to ensure it quotes paths and does not include GNU-only `-printf`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_files --lib` after changing `src-tauri/src/remote_files.rs`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing command registration, request structs, or `TerminalSession::exec`.
- Cross-check `RemoteFileEntry` serialization against `src/features/files/remoteFileTypes.ts`.

### 7. Wrong vs Correct

#### Wrong

```rust
let command = format!("find {path} -maxdepth 1 -mindepth 1 -printf '%y\\0%p\\0%f\\0'");
TerminalSession::exec(request, &command).await?;
```

#### Correct

```rust
let command = build_remote_list_command(path);
TerminalSession::exec(request, &command).await?;
```

#### Wrong

```rust
match message {
    ChannelMsg::Eof | ChannelMsg::Close => break,
    ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
    _ => {}
}
```

#### Correct

```rust
match message {
    ChannelMsg::Close => break,
    ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
    _ => {}
}
```

#### Wrong

```rust
// Accepts secrets from the UI for a file-list request.
let request = TerminalConnectRequest {
    password: frontend_password,
    private_key_passphrase: frontend_passphrase,
    ..request
};
```

#### Correct

```rust
let profile = load_connection_profile(&app, connection_id)?;
let output = TerminalSession::exec(
    TerminalConnectRequest {
        connection_id: Some(profile.id),
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        private_key_path: profile.private_key_path,
        private_key_passphrase: profile.private_key_passphrase,
        cols: 80,
        rows: 24,
        request_id: None,
    },
    &build_remote_list_command(path),
)
.await?;
```

## Scenario: Remote File Edit Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes remote file read, write, create, rename, delete, upload, download, metadata parsing, stdin exec, or the `remote_file_*` Tauri command registration.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/remote_files.rs`, `src-tauri/src/terminal/session.rs`, and `src-tauri/src/lib.rs`.
- This is a cross-layer command contract because React owns Monaco/editor state while Rust owns saved SSH credentials, remote command execution, metadata/version checks, and safe content transfer.

### 2. Signatures

- `remote_file_read(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileReadRequest) -> Result<RemoteFileReadResult, AppError>`
- `remote_file_write(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileWriteRequest) -> Result<RemoteFileWriteResult, AppError>`
- `remote_file_create_file(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<RemoteFileMetadata, AppError>`
- `remote_file_create_directory(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<(), AppError>`
- `remote_file_rename(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileRenameRequest) -> Result<(), AppError>`
- `remote_file_delete(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileDeleteRequest) -> Result<(), AppError>`
- `remote_file_metadata(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<RemoteFileEntryMetadata, AppError>`
- `remote_file_check_path(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<RemoteFilePathCheckResult, AppError>`
- `remote_file_upload_file(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileUploadFileRequest) -> Result<RemoteFileUploadResult, AppError>`
- `remote_file_upload_local_file(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileUploadLocalFileRequest) -> Result<RemoteFileUploadResult, AppError>`
- `remote_file_upload_archive(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileUploadArchiveRequest) -> Result<RemoteFileArchiveUploadResult, AppError>`
- `remote_file_upload_local_archive(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileUploadLocalArchiveRequest) -> Result<RemoteFileArchiveUploadResult, AppError>`
- `remote_file_prepare_upload_temp(request: LocalUploadTempRequest) -> Result<LocalUploadTempResult, AppError>`
- `remote_file_append_upload_temp(request: LocalUploadTempAppendRequest) -> Result<(), AppError>`
- `remote_file_delete_upload_temp(request: LocalUploadTempDeleteRequest) -> Result<(), AppError>`
- `local_path_metadata(request: LocalPathMetadataRequest) -> Result<LocalPathMetadataResult, AppError>`
- `remote_file_download(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<RemoteFileDownloadResult, AppError>`
- `remote_file_check_download_target(app: AppHandle, request: RemoteFileDownloadTargetCheckRequest) -> Result<RemoteFileDownloadTargetCheckResult, AppError>`
- `remote_file_download_to_local(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileDownloadToLocalRequest) -> Result<RemoteFileDownloadToLocalResult, AppError>`
- `ReusableExecSession::exec_with_stdin(command: &str, stdin: &[u8]) -> Result<ExecOutput, AppError>`

Request fields:

```rust
RemoteFileReadRequest {
    connection_id: String,
    path: String,
}

RemoteFileWriteRequest {
    connection_id: String,
    path: String,
    content: String,
    expected_mtime: u64,
    expected_size: u64,
    overwrite: bool, // #[serde(default)]
}

RemoteFilePathRequest {
    connection_id: String,
    path: String,
}

RemoteFileRenameRequest {
    connection_id: String,
    path: String,
    new_path: String,
}

RemoteFileDeleteRequest {
    connection_id: String,
    path: String,
    recursive: bool, // #[serde(default)]
}

RemoteFileUploadFileRequest {
    connection_id: String,
    path: String,
    content: Vec<u8>,
    conflict_policy: Option<String>, // overwrite | skip | rename | ask, default handled as rename
    transfer_id: Option<String>, // #[serde(default)], enables progress events
}

RemoteFileUploadArchiveRequest {
    connection_id: String,
    target_dir: String,
    root_name: String,
    archive_content: Vec<u8>,
    conflict_policy: Option<String>,
    keep_archive: bool, // #[serde(default)]
    transfer_id: Option<String>, // #[serde(default)], enables progress events
}

RemoteFileUploadLocalFileRequest {
    connection_id: String,
    path: String,
    local_path: String,
    conflict_policy: Option<String>,
    transfer_id: Option<String>,
}

RemoteFileUploadLocalArchiveRequest {
    connection_id: String,
    target_dir: String,
    root_name: String,
    local_path: String,
    conflict_policy: Option<String>,
    keep_archive: bool,
    transfer_id: Option<String>,
}

LocalUploadTempAppendRequest {
    local_path: String,
    chunk: Vec<u8>,
}

LocalPathMetadataRequest {
    path: String,
}

RemoteFileDownloadTargetCheckRequest {
    connection_id: String,
    path: String,
    directory: bool, // #[serde(default)]
    download_root: Option<String>,
    session_name: Option<String>,
    timestamp_name: Option<String>,
    group_by_session: bool, // #[serde(default)]
    timestamp_directory: bool, // #[serde(default)]
}

RemoteFileDownloadToLocalRequest {
    connection_id: String,
    path: String,
    directory: bool, // #[serde(default)]
    download_root: Option<String>,
    session_name: Option<String>,
    timestamp_name: Option<String>,
    group_by_session: bool, // #[serde(default)]
    timestamp_directory: bool, // #[serde(default)]
    keep_archives: bool, // #[serde(default)]
    conflict_policy: Option<String>,
    transfer_id: Option<String>, // #[serde(default)], enables progress events
}
```

Response fields:

```rust
RemoteFileMetadata {
    path: String,
    name: String,
    size: u64,
    mtime: u64,
    mode: Option<String>,
}

RemoteFileEntryMetadata {
    path: String,
    name: String,
    size: u64,
    mtime: u64,
    mode: Option<String>,
    type: "directory" | "file" | "symlink" | "other",
}

RemoteFilePathCheckResult {
    path: String,
    exists: bool,
    type: Option<"directory" | "file" | "symlink" | "other">,
}

RemoteFileReadResult {
    content: String,
    encoding: String, // "utf-8"
    editable: bool,
    is_binary: bool,
    metadata: RemoteFileMetadata,
    name: String,
    path: String,
    size: u64,
    mtime: u64,
    mode: Option<String>,
}

RemoteFileWriteResult {
    metadata: RemoteFileMetadata,
    conflict: bool,
}

RemoteFileDownloadResult {
    path: String,
    name: String,
    content: Vec<u8>,
}

RemoteFileUploadResult {
    path: String,
    name: String,
    skipped: bool,
    metadata: Option<RemoteFileMetadata>,
}

RemoteFileArchiveUploadResult {
    path: String,
    name: String,
    archive_path: Option<String>,
    skipped: bool,
}

RemoteFileDownloadToLocalResult {
    remote_path: String,
    name: String,
    local_path: String,
    local_directory: String,
    archive_path: Option<String>,
    skipped: bool,
    directory: bool,
}

RemoteFileDownloadTargetCheckResult {
    remote_path: String,
    name: String,
    local_path: String,
    local_directory: String,
    exists: bool,
    directory: bool,
}

RemoteFileTransferProgressEvent {
    transfer_id: String,
    direction: String, // "upload" | "download"
    loaded_bytes: u64,
    total_bytes: Option<u64>,
}

LocalPathMetadataResult {
    path: String,
    name: String,
    kind: String, // "file" | "directory" | "other"
}
```

### 3. Contracts

- Every remote file edit command must load the saved `ConnectionProfile` by `connection_id`; React must not provide raw SSH credentials for these commands.
- Blank `connection_id` returns `remote_file_connection_missing`. Blank `path` returns `remote_file_path_missing`.
- All remote paths interpolated into shell commands must use `quote_posix_shell`. Do not interpolate unquoted paths.
- `remote_file_read` must read metadata before content. Metadata must reject non-regular files through `build_remote_metadata_command`.
- `REMOTE_FILE_EDIT_LIMIT_BYTES` is `2 * 1024 * 1024`. Files larger than this return `remote_file_too_large` before `cat`.
- `looks_like_binary` must reject content with NUL bytes in the inspected prefix. UTF-8 decoding failures return `remote_file_not_utf8`.
- `remote_file_write` must compare current metadata with `expected_mtime` and `expected_size`. If either differs and `overwrite == false`, return `remote_file_conflict` before writing.
- File content must never be embedded in a shell command string. Save and upload must call `exec_with_reconnect_stdin(..., content.as_bytes())` or `exec_with_reconnect_stdin(..., content)` and send bytes through the SSH channel stdin.
- `build_remote_write_command` writes stdin to a same-directory hidden temp file, tries to preserve mode from the existing file, then moves the temp file over the target path. Cleanup must remove the temp file on command failure where possible.
- `ReusableExecSession::exec_with_stdin` must send `channel.data_bytes(stdin)` and then `channel.eof()` before collecting stdout, stderr, and exit status.
- Transfer commands with `transfer_id` must emit `remote_file:transfer_progress` events from Rust while bytes move over the SSH exec channel. Single-file and archive uploads emit after each stdin chunk; local-path uploads read backend-owned temp files in bounded chunks before writing SSH stdin; downloads emit after each stdout data chunk.
- Upload progress events must include `total_bytes: Some(content.len() as u64)`. Download progress events may use `total_bytes: None` when the remote stream size is not known without an extra command.
- `ReusableExecSession` must keep non-progress `exec_with_stdin` behavior available for save/write commands, and add progress-aware variants instead of forcing every exec caller to emit UI events.
- `RemoteFileManager` may reuse a `ReusableExecSession` per connection signature. If an exec fails, invalidate the handle, reconnect once, and retry the command.
- `remote_file_metadata` returns regular file, directory, symlink, or other metadata for the properties dialog. The serialized kind field is `type`.
- `remote_file_check_path` is a lightweight existence/type preflight for exact transfer targets. It must check only the requested path, return `{ exists, path, type }`, and must not list the parent directory, scan directory contents, read file content, create archives, or start upload/download work.
- `remote_file_upload_file` is a single-file byte upload. It accepts a conflict policy and returns the final remote path plus optional metadata; skipped uploads return `metadata: None`.
- `remote_file_upload_local_file` accepts a trusted local file path from the Tauri dialog path or a backend-owned upload temp path from the drag/drop fallback, streams that file through SSH stdin, and emits transfer progress from bytes read on the Rust side.
- `remote_file_upload_archive` accepts a legacy frontend-built `tar.gz` archive, uploads it through stdin to a remote temporary archive, extracts it with remote `tar -xzf`, and removes the remote archive unless `keep_archive == true`. Desktop UI should prefer `remote_file_upload_local_archive` so the selected directory path or compressed archive stays in Rust-owned local IO instead of crossing IPC as one `Vec<u8>`.
- `remote_file_upload_local_archive` accepts either a local `tar.gz` path or a local directory path. Directory paths must be packed into a backend-owned temporary `tar.gz` before upload, then cleaned up after upload/extract completes.
- `local_path_metadata` is a read-only helper for native desktop drops. It canonicalizes a local path and returns whether it is a file, directory, or other local item before the UI chooses the file or archive upload command.
- Directory upload conflict handling is root-folder level: resolve `target_dir/root_name` using overwrite / skip / rename before extraction. Do not silently extract over an existing directory.
- `remote_file_check_download_target` resolves the same system/custom download directory shape as `remote_file_download_to_local`, checks only the final local path with `Path::exists`, and returns the path plus `exists`. It must not contact SSH or create directories/files.
- `remote_file_download_to_local` resolves the system or custom download root on the Rust side, creates optional session and timestamp subdirectories, writes files directly to disk, and returns the final local path.
- The frontend-owned `session_name` value represents the connection grouping name, not a terminal tab title. Rust should sanitize it as a local path segment and use the fallback segment only when the provided value is blank.
- Directory download must call `download_archive`, write a local temporary or retained `tar.gz`, extract it with local `tar -xzf`, then remove the temporary archive unless `keep_archives == true`.
- Local file and directory conflicts use the same overwrite / skip / rename policy as remote transfers. If the frontend sends `ask`, treat it as `rename` to keep behavior non-destructive.
- Windows path segments for download directories must be sanitized before joining paths. Do not use remote names directly as local path components.
- `remote_file_delete` with `recursive == true` must refuse to delete `/`; non-recursive delete should not recursively remove directories.
- All new commands must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!`.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| `connection_id` is blank | `remote_file_connection_missing` | false |
| `connection_id` is unknown | `connection_missing` | false |
| `path` / `new_path` is blank | `remote_file_path_missing` | true |
| No password or private key is available after loading profile | `terminal_auth_missing` | true |
| Remote metadata command fails or path is not a regular file | `remote_file_metadata_failed` | true |
| Remote metadata output cannot parse | `remote_file_metadata_parse_failed` | true |
| File size exceeds `REMOTE_FILE_EDIT_LIMIT_BYTES` | `remote_file_too_large` | true |
| Remote read command exits non-zero | `remote_file_read_failed` | true |
| Read bytes contain NUL | `remote_file_binary` | true |
| Read bytes are not UTF-8 | `remote_file_not_utf8` | true |
| Current mtime or size differs from expected values and overwrite is false | `remote_file_conflict` | true |
| Remote write command exits non-zero | `remote_file_write_failed` | true |
| SSH stdin send fails | `remote_exec_stdin_failed` | true |
| SSH stdin EOF fails | `remote_exec_stdin_eof_failed` | true |
| Transfer event emit fails | no command error | n/a |
| Create file command exits non-zero | `remote_file_create_failed` | true |
| Create directory command exits non-zero | `remote_file_create_directory_failed` | true |
| Rename command exits non-zero | `remote_file_rename_failed` | true |
| Delete command exits non-zero | `remote_file_delete_failed` | true |
| Upload command exits non-zero | `remote_file_upload_failed` | true |
| Download command exits non-zero | `remote_file_download_failed` | true |
| Entry metadata command exits non-zero | `remote_file_metadata_failed` | true |
| Entry metadata output cannot parse | `remote_file_metadata_parse_failed` | true |
| Remote target preflight command exits non-zero | `remote_file_check_path_failed` | true |
| Remote target preflight output cannot parse | `remote_file_check_path_parse_failed` | true |
| Archive upload target cannot resolve | `remote_file_archive_resolve_failed` / `remote_file_archive_resolve_parse_failed` | true |
| Archive upload write fails | `remote_file_archive_upload_failed` | true |
| Remote archive extraction fails | `remote_file_archive_extract_failed` | true |
| Remote archive download fails | `remote_file_archive_download_failed` | true |
| System download root cannot resolve | `remote_file_download_root_failed` | true |
| Local download directory cannot be created | `remote_file_download_create_dir_failed` | true |
| Local file/archive write fails | `remote_file_download_write_failed` | true |
| Local overwrite fails | `remote_file_download_overwrite_failed` | true |
| Local auto-rename cannot find a free name | `remote_file_download_rename_failed` | true |
| Local tar extraction cannot start or fails | `remote_file_download_extract_start_failed` / `remote_file_download_extract_failed` | true |
| Local extracted root is missing or cannot move | `remote_file_download_extract_missing` / `remote_file_download_extract_move_failed` | true |

### 5. Good / Base / Bad Cases

- Good: `remote_file_write` receives `/opt/app/app.conf`, current metadata still matches `expected_mtime` and `expected_size`, the shell command contains only quoted path/temp-file logic, content is sent over stdin, and the response returns fresh metadata.
- Good: `remote_file_upload_local_file` receives a Tauri-dialog file path for `app.log`, streams that file directly from disk through SSH stdin, emits uploaded-byte progress, and never asks React to copy the file into an upload cache first.
- Good: `remote_file_check_path` receives `/opt/app/dist`, runs a single `test -e/-L/-d/-f` style shell command, returns `exists: true` and `type: "directory"` when the root exists, and does not inspect the directory tree.
- Good: `remote_file_upload_local_archive` receives a Tauri-dialog directory path for `dist`, creates a backend-owned local tar.gz, resolves `/opt/app/dist (1)` under rename policy, streams the archive through stdin from disk, extracts with `tar -xzf`, cleans local and remote temporary archives, and returns the final remote path.
- Good: `remote_file_upload_local_archive` receives `transfer_id`, sends the local archive in chunks, emits `remote_file:transfer_progress` with uploaded bytes, then continues to extraction and returns the final remote path.
- Good: `remote_file_download_to_local` receives a directory path and settings-derived timestamp name, downloads one remote archive while emitting received-byte progress, extracts it under `Downloads/<session>/<timestamp>/`, and returns `local_path` plus `local_directory`.
- Base: `remote_file_read` receives a small UTF-8 file, metadata parses with optional mode, content has no NUL bytes, and the response sets `encoding = "utf-8"` and `editable = true`.
- Bad: write logic builds `format!("cat > {}", content)`, extracts a directory archive over an existing target without applying conflict policy, or accepts a frontend password field for a remote file command.

### 6. Tests Required

- Unit-test `quote_posix_shell` for normal paths, empty strings, and single quotes.
- Unit-test `parse_remote_file_metadata` for NUL-delimited path, size, mtime, empty mode, and present mode.
- Unit-test `looks_like_binary` for plain text and NUL-containing bytes.
- Unit-test `build_remote_write_command` to assert it creates a temp file, uses `cat > "$tmp"`, moves the temp file to the target, and does not contain literal content.
- Unit-test `build_remote_path_check_command` and `parse_remote_path_check_output` for missing targets, existing file/directory/symlink targets, quoted paths, and no directory listing/archive work.
- Unit-test `build_remote_upload_command`, `build_remote_resolve_child_command`, `build_remote_extract_archive_command`, and `build_remote_archive_download_command` for quoted paths, POSIX shell syntax, tar usage, and no embedded file content. Source-check local upload temp helpers and `exec_with_stdin_file_progress` when changing upload plumbing.
- Source-check progress plumbing for `REMOTE_FILE_TRANSFER_PROGRESS`, `RemoteFileTransferProgressEvent`, `ExecProgressCallback`, `exec_with_stdin_progress`, and `exec_with_stdout_progress`.
- Unit-test `parse_remote_entry_metadata` and `parse_remote_transfer_path` for NUL-delimited fields and skipped/final path parsing.
- Unit-test local download helpers for sanitized path segments, rename conflict behavior, skip/overwrite handling, and retained archive naming.
- Unit-test the edit limit constant so `REMOTE_FILE_EDIT_LIMIT_BYTES == 2 * 1024 * 1024`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_files --lib` after changing `src-tauri/src/remote_files.rs`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing command structs, command registration, or `ReusableExecSession`.
- Cross-check response fields against `src/features/files/remoteFileTypes.ts` and wrappers in `src/shared/tauri/commands.ts`.

### 7. Wrong vs Correct

#### Wrong

```rust
let command = format!("cat > {}", content);
session.exec(&command).await?;
```

#### Correct

```rust
let output = self
    .exec_with_reconnect_stdin(
        &config,
        &build_remote_write_command(path),
        content.as_bytes(),
    )
    .await?;
```

#### Wrong

```rust
// Sends the entire upload at once, so the UI cannot show real transfer speed.
channel.data_bytes(stdin.to_vec()).await?;
```

#### Correct

```rust
for chunk in stdin.chunks(REMOTE_EXEC_TRANSFER_CHUNK_BYTES) {
    channel.data_bytes(chunk.to_vec()).await?;
    progress(sent_bytes);
}
```

#### Wrong

```rust
let command = format!("cat {path}");
let output = self.exec_with_reconnect(&config, &command).await?;
```

#### Correct

```rust
let output = self
    .exec_with_reconnect(&config, &build_remote_read_command(path))
    .await?;
```

#### Wrong

```rust
// Overwrites a file even if it changed after the editor opened it.
self.exec_with_reconnect_stdin(&config, &build_remote_write_command(path), content).await?;
```

#### Correct

```rust
let current = self.metadata(&config, path).await?;
if (current.mtime != expected_mtime || current.size != expected_size) && !overwrite {
    return Err(AppError::new("remote_file_conflict", "远端文件已变化。", "...", true));
}
```

#### Wrong

```rust
// Extracts into the destination directly and bypasses directory-level conflict policy.
let command = format!("tar -xzf {} -C {}", archive_path, target_dir);
```

#### Correct

```rust
let output = self
    .exec_with_reconnect(
        &config,
        &build_remote_extract_archive_command(
            &archive_path,
            target_dir,
            root_name,
            &final_path,
            conflict_policy == TransferConflictPolicy::Overwrite,
            keep_archive,
        ),
    )
    .await?;
```

## Scenario: Window Material Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes native window material/backdrop support, material ids, platform support detection, or command registration.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src/shared/tauri/windowMaterial.ts`, and `src/features/settings/settingsTypes.ts`.
- This is a cross-layer command contract because Rust exposes native platform capabilities while React persists a string appearance setting and maps it to numeric ids only at the command boundary.

### 2. Signatures

- `get_supported_window_materials() -> Vec<WindowMaterial>`
- `set_window_material(app: AppHandle, material: i32) -> Result<WindowMaterial, AppError>`

Serialized response:

```rust
WindowMaterial {
    id: i32,
    name: &'static str,
}
```

Material ids:

```rust
0 => "Auto"
2 => "Mica"
3 => "Acrylic"
4 => "Mica Alt"
```

Frontend string mapping:

```ts
auto = 0
mica = 2
acrylic = 3
micaAlt = 4
```

### 3. Contracts

- All new Tauri commands must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!`.
- `WindowMaterial.id` is the only cross-layer machine-readable value; `name` is display/debug metadata and must not be parsed by React.
- Windows support uses DWM `DWMWA_SYSTEMBACKDROP_TYPE`. Keep Windows-only dependencies under `[target.'cfg(windows)'.dependencies]`.
- Windows should expose `auto` on every build and add `mica`, `acrylic`, and `micaAlt` only when the OS build supports DWM system backdrop types.
- Non-Windows platforms return only `auto` from `get_supported_window_materials` and reject non-`auto` values from `set_window_material`.
- Invalid numeric material ids must be rejected before calling platform APIs.
- Native material failure is recoverable and should return an `AppError` with code `window_material_set_failed`.
- CSS material tokens remain the visual fallback. Backend command failure must not prevent the app from rendering.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| `get_supported_window_materials` on unsupported platform | Returns `[Auto]` | n/a |
| `set_window_material` with `0` on unsupported platform | Returns `Auto` | n/a |
| `set_window_material` with `2`, `3`, or `4` on unsupported platform | `window_material_set_failed` | true |
| `set_window_material` with any unknown id | `window_material_set_failed` | true |
| Main window handle cannot be resolved | `window_material_set_failed` | true |
| DWM backdrop call fails | `window_material_set_failed` | true |

### 5. Good / Base / Bad Cases

- Good: Windows 11 build supporting DWM backdrop returns ids `0`, `2`, `3`, and `4`; React chooses `mica`, sends `2`, and Rust applies `DWMWA_SYSTEMBACKDROP_TYPE`.
- Good: non-Windows returns only `auto`; React normalizes a previously saved `mica` setting to `auto` and does not keep retrying unsupported native material.
- Base: browser preview has no Tauri runtime; no backend command is called, and CSS fallback still uses `data-window-material`.
- Bad: backend returns `"Mica"` as the only payload, accepts arbitrary integer ids, registers the command in Rust but not the frontend wrapper, or adds Windows dependencies as unconditional cross-platform dependencies.

### 6. Tests Required

- Run `cargo check --manifest-path src-tauri/Cargo.toml` after changing command registration, material ids, Windows dependencies, or platform modules.
- Run `pnpm check` after changing frontend wrappers or `WindowMaterialMode`.
- Run `npm run build` after changing CSS material tokens or settings UI.
- Cross-check backend ids against `windowMaterialIds` in `src/shared/tauri/windowMaterial.ts` in the same task.
- Add unit or integration tests if material support logic gains more platforms or more complex OS-version branching.

### 7. Wrong vs Correct

#### Wrong

```rust
pub fn set_window_material(material: String) -> Result<(), AppError> {
    apply_backdrop_by_name(&material)
}
```

#### Correct

```rust
pub fn set_window_material(app: AppHandle, material: i32) -> Result<WindowMaterial, AppError> {
    window_material::set_window_material(&app, material).map_err(|error| {
        AppError::new("window_material_set_failed", "窗口材质切换失败。", error, true)
    })
}
```

#### Wrong

```toml
[dependencies]
windows = "0.61"
```

#### Correct

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = ["Win32_Foundation", "Win32_Graphics_Dwm", "Win32_UI_WindowsAndMessaging"] }
```
