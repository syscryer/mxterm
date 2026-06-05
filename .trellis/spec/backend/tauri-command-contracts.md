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
