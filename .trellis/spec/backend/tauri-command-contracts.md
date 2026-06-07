# Tauri Command Contracts

## Scenario: Connection Repository and Terminal Session Handoff

### 1. Scope / Trigger

- Trigger: a backend Tauri command or persistent data contract changes.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/connections/mod.rs`, and `src-tauri/src/terminal/manager.rs`.
- This project treats Tauri commands as the API boundary between React and Rust. Backend structs, serialized field names, validation, and `AppError` codes are executable contracts.

### 2. Signatures

- `connection_list(app: AppHandle) -> Result<Vec<ConnectionProfile>, AppError>`
- `connection_upsert(app: AppHandle, request: ConnectionProfileInput) -> Result<ConnectionProfile, AppError>`
- `connection_delete(app: AppHandle, id: String) -> Result<(), AppError>`
- `connection_probe_latency(app: AppHandle, request: ConnectionLatencyProbeRequest) -> Result<ConnectionLatencyProbeResult, AppError>`
- `terminal_connect(app: AppHandle, manager: State<TerminalManager>, request: TerminalConnectRequest) -> Result<String, AppError>`
- `terminal_write(manager: State<TerminalManager>, request: TerminalWriteRequest) -> Result<(), AppError>`
- `terminal_resize(manager: State<TerminalManager>, request: TerminalResizeRequest) -> Result<(), AppError>`
- `terminal_close(manager: State<TerminalManager>, session_id: String) -> Result<(), AppError>`

`ConnectionProfileInput` fields:

```rust
id: Option<String>
name: Option<String>
host: String
port: u16
username: String
auth_kind: ConnectionAuthKind // "password" | "private_key"
password: Option<String>
private_key_path: Option<String>
private_key_passphrase: Option<String>
notes: Option<String>
```

`ConnectionProfile` adds `id`, normalized `name`, `created_at`, and `updated_at`.

`ConnectionLatencyProbeRequest` fields:

```rust
connection_id: String
```

`ConnectionLatencyProbeResult` serializes to React as:

```rust
latency_ms: Option<u64>
reachable: bool
```

`TerminalConnectRequest` accepts a direct SSH request plus optional `connection_id`. When `connection_id` is present and non-empty, Rust reloads the saved profile and overrides `host`, `port`, `username`, `password`, `private_key_path`, and `private_key_passphrase` before connecting.

### 3. Contracts

- Connection data is stored as JSON at `app.path().app_data_dir()/connections.json`.
- The JSON root has `version: 1` and `profiles: ConnectionProfile[]`.
- `ConnectionAuthKind` uses `#[serde(rename_all = "snake_case")]`; frontend values must be `password` or `private_key`.
- Empty optional strings are normalized to `None`; non-empty `host`, `username`, `password`, `private_key_path`, and `notes` are trimmed.
- Blank `name` defaults to `{username}@{host}`.
- `password` auth clears `private_key_path` and `private_key_passphrase`; `private_key` auth clears `password`.
- The first version intentionally stores passwords and private-key passphrases in clear text. Do not add masking/encryption unless the task explicitly introduces the lock-screen or secret-store feature.
- All command failures return `AppError { code, message, raw_message, recoverable }`.
- `connection_probe_latency` must load the saved profile by `connection_id` and probe only the saved `host`/`port` with a short TCP timeout. It must not require or log passwords, private keys, or passphrases.
- Terminal output and state events include both `session_id` and the optional frontend `request_id`. Keep `request_id` on early connection events so React can display shell output that arrives before the `terminal_connect` promise resolves.
- Tauri event names must use allowed characters only. Use colon-separated names such as `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`; do not use dot-separated names.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| `host` is blank | `connection_host_missing` | true |
| `username` is blank | `connection_username_missing` | true |
| `port == 0` | `connection_port_invalid` | true |
| `auth_kind == password` and password is blank | `connection_password_missing` | true |
| `auth_kind == private_key` and private key path is blank | `connection_private_key_missing` | true |
| Delete/open unknown connection id | `connection_missing` | false |
| Latency probe blank connection id | `connection_probe_connection_missing` | false |
| Latency probe task cannot join | `connection_probe_join_failed` | true |
| Cannot resolve app data dir | `connection_store_path_failed` | true |
| Cannot read store file | `connection_store_read_failed` | true |
| Store JSON cannot parse | `connection_store_parse_failed` | true |
| Cannot create store parent dir | `connection_store_create_dir_failed` | true |
| Cannot serialize store | `connection_store_serialize_failed` | true |
| Cannot write store file | `connection_store_write_failed` | true |
| System clock before UNIX epoch | `connection_clock_invalid` | false |
| Terminal direct request has no auth material | `terminal_auth_missing` | true |

### 5. Good / Base / Bad Cases

- Good: `connection_upsert` receives password auth, trims `host` and `username`, defaults `name`, clears private-key fields, persists the JSON store, and returns the saved profile.
- Base: `terminal_connect` receives both `connection_id` and stale frontend host fields; Rust loads the saved profile and uses the stored values.
- Bad: `connection_delete` receives an unknown id and returns `connection_missing` instead of silently succeeding.

### 6. Tests Required

- Unit-test connection validation for blank host, blank username, zero port, missing password, and missing private key.
- Unit-test auth-field clearing for both auth modes.
- Unit-test JSON store round-trip, get-by-id, update preserving `created_at`, delete persistence, and missing id errors.
- Unit-test terminal connection validation for missing auth and invalid direct SSH request fields.
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
// Trusts stale frontend fields even when a saved connection was selected.
manager.connect(app, request).await
```

#### Correct

```rust
if let Some(connection_id) = request.connection_id.as_ref().map(|value| value.trim()) {
    let profile = load_connection_profile(&app, connection_id)?;
    request.host = profile.host;
    request.port = profile.port;
    request.username = profile.username;
}
manager.connect(app, request).await
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
- `remote_file_upload_file(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFileUploadFileRequest) -> Result<RemoteFileMetadata, AppError>`
- `remote_file_download(app: AppHandle, manager: State<RemoteFileManager>, request: RemoteFilePathRequest) -> Result<RemoteFileDownloadResult, AppError>`
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
- `RemoteFileManager` may reuse a `ReusableExecSession` per connection signature. If an exec fails, invalidate the handle, reconnect once, and retry the command.
- `remote_file_upload_file` is a single-file byte upload. Recursive folder upload is not part of this backend contract.
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
| Create file command exits non-zero | `remote_file_create_failed` | true |
| Create directory command exits non-zero | `remote_file_create_directory_failed` | true |
| Rename command exits non-zero | `remote_file_rename_failed` | true |
| Delete command exits non-zero | `remote_file_delete_failed` | true |
| Upload command exits non-zero | `remote_file_upload_failed` | true |
| Download command exits non-zero | `remote_file_download_failed` | true |

### 5. Good / Base / Bad Cases

- Good: `remote_file_write` receives `/opt/app/app.conf`, current metadata still matches `expected_mtime` and `expected_size`, the shell command contains only quoted path/temp-file logic, content is sent over stdin, and the response returns fresh metadata.
- Base: `remote_file_read` receives a small UTF-8 file, metadata parses with optional mode, content has no NUL bytes, and the response sets `encoding = "utf-8"` and `editable = true`.
- Bad: write logic builds `format!("cat > {}", content)` or accepts a frontend password field for a remote file command.

### 6. Tests Required

- Unit-test `quote_posix_shell` for normal paths, empty strings, and single quotes.
- Unit-test `parse_remote_file_metadata` for NUL-delimited path, size, mtime, empty mode, and present mode.
- Unit-test `looks_like_binary` for plain text and NUL-containing bytes.
- Unit-test `build_remote_write_command` to assert it creates a temp file, uses `cat > "$tmp"`, moves the temp file to the target, and does not contain literal content.
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
