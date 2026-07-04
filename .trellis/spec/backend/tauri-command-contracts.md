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
- `connection_reveal_inline_secret(app: AppHandle, id: String) -> Result<RevealedConnectionSecret, AppError>`
- `credential_list(app: AppHandle) -> Result<Vec<CredentialProfile>, AppError>`
- `credential_upsert(app: AppHandle, request: CredentialProfileInput) -> Result<CredentialProfile, AppError>`
- `credential_delete(app: AppHandle, id: String) -> Result<(), AppError>`
- `credential_reveal_secret(app: AppHandle, id: String) -> Result<RevealedCredentialSecret, AppError>`
- `known_host_trust(app: AppHandle, request: KnownHostTrustRequest) -> Result<(), AppError>`
- `connection_test(app: AppHandle, request: ConnectionRuntimeCredentialRequest) -> Result<ConnectionStepResult, AppError>`
- `connection_test_profile(app: AppHandle, request: ConnectionProfileInput) -> Result<ConnectionStepResult, AppError>`
- `connection_probe_system(app: AppHandle, request: ConnectionRuntimeCredentialRequest) -> Result<ConnectionProfile, AppError>`
- `connection_probe_latency(app: AppHandle, request: ConnectionLatencyProbeRequest) -> Result<ConnectionLatencyProbeResult, AppError>`
- `terminal_connect(app: AppHandle, manager: State<TerminalManager>, request: TerminalConnectRequest) -> Result<String, AppError>`
- `terminal_write(manager: State<TerminalManager>, request: TerminalWriteRequest) -> Result<(), AppError>`
- `terminal_resize(manager: State<TerminalManager>, request: TerminalResizeRequest) -> Result<(), AppError>`
- `terminal_close(manager: State<TerminalManager>, session_id: String) -> Result<(), AppError>`
- `telnet_terminal_open(app: AppHandle, manager: State<TerminalManager>, request: TelnetTerminalOpenRequest) -> Result<String, AppError>`
- `serial_list_ports() -> Result<Vec<SerialPortEntry>, AppError>`
- `serial_terminal_open(app: AppHandle, manager: State<TerminalManager>, request: SerialTerminalOpenRequest) -> Result<String, AppError>`
- `get_windows_pty_info() -> Option<WindowsPtyInfo>`

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
inline_password_touched: bool
inline_private_key_path: Option<String>
inline_private_key_passphrase: Option<String>
inline_private_key_passphrase_touched: bool
prompt_auth_kind: Option<ConnectionAuthKind>
proxy: ConnectionProxyConfig
jump: ConnectionJumpConfig
advanced: ConnectionAdvancedConfig
rdp: Option<RdpConnectionConfig>
vnc: Option<VncConnectionConfig>
telnet: Option<TelnetConnectionConfig>
serial: Option<SerialConnectionConfig>
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

`TelnetConnectionConfig` fields:

```rust
enter_mode: TelnetEnterMode // cr | lf | crlf
backspace_mode: TelnetBackspaceMode // del | ctrl_h
```

`SerialConnectionConfig` fields:

```rust
port_name: String
baud_rate: u32
data_bits: SerialDataBits // five | six | seven | eight
parity: SerialParity // none | odd | even
stop_bits: SerialStopBits // one | two
flow_control: SerialFlowControl // none | software | hardware
backspace_mode: SerialBackspaceMode // del | ctrl_h
```

`ConnectionJumpConfig` fields:

```rust
kind: ConnectionJumpKind // "none" | "ssh_jump"
jump_connection_id: Option<String>
```

`ConnectionAdvancedConfig` fields:

```rust
connect_timeout_ms: u64
auth_timeout_ms: u64
keepalive_interval_ms: u64
terminal_encoding: String // utf-8 | gbk | gb18030 | big5 | euc-jp | iso-2022-jp | shift-jis | euc-kr
```

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
username: Option<String>
kind: ConnectionAuthKind // "password" | "private_key"
password: Option<String>
password_touched: bool
private_key_path: Option<String>
private_key_passphrase: Option<String>
private_key_passphrase_touched: bool
notes: Option<String>
```

Reveal responses:

```rust
RevealedConnectionSecret {
    auth_kind: ConnectionAuthKind,
    password: Option<String>,
    private_key_passphrase: Option<String>,
}

RevealedCredentialSecret {
    kind: ConnectionAuthKind,
    password: Option<String>,
    private_key_passphrase: Option<String>,
}
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

`TerminalConnectRequest` accepts a direct SSH request plus optional `connection_id`. When `connection_id` is present and non-empty, Rust resolves the saved connection as authoritative, then combines connection target fields, credential mode, saved or inline credential material, proxy config, SSH jump config, advanced timeouts, and any prompt credential supplied by the request.

### 3. Contracts

- Production connection, credential, trusted host key, and tunnel data is stored in SQLite at `app.path().app_data_dir()/mxterm.db` after the vault migration runs.
- Legacy JSON stores (`connections.json`, `credentials.json`, `known_hosts.json`, `tunnels.json`) are migration sources only. Do not route production commands back to JSON after Phase 2.
- SSH passwords and private-key passphrases are stored in the encrypted vault through `src-tauri/src/storage_vault.rs`; SQLite stores only `secret_ref` and `secret_slot_id`.
- `StorageRepository::open_app(...)` owns the JSON -> SQLite + vault migration and is the production facade for connection, credential, known-host, tunnel, and SSH resolution paths.
- SQLite schema may store `secret_ref` and `secret_slot_id`, but must not define plaintext password or private-key passphrase columns. Do not silently downgrade vault failures back to SQLite/JSON plaintext.
- Connection, credential, known-host, and tunnel JSON stores must use the shared atomic JSON store helper. Writes create a synced temporary file, keep a `.bak` copy of the previous primary file when present, and replace the primary file atomically.
- Store loads should return the default document when the primary file is missing. If the primary file exists but cannot be read or parsed, load should try the `.bak` file before returning the primary error.
- Commands that perform a `load -> mutate -> save` sequence on connection, credential, or known-host stores must serialize that sequence with the matching store lock. Do not hold these locks across SSH, SFTP, terminal, network probing, or other remote operations.
- `ConnectionAuthKind` uses `#[serde(rename_all = "snake_case")]`; frontend values must be `password` or `private_key`.
- `ConnectionCredentialMode` uses `saved`, `inline`, or `prompt`.
- `ConnectionProxyKind` uses `none`, `http_connect`, or `socks5`.
- `ConnectionJumpKind` uses `none` or `ssh_jump`.
- Empty optional strings are normalized to `None`; non-empty target, credential, proxy, and note fields are trimmed.
- Credential profiles represent reusable login accounts: username plus password or private-key material. They must not store host or port.
- Blank `name` defaults to `{username}@{host}`.
- `is_favorite` is the explicit favorite flag. `last_connected_at` stores the last successful terminal connection timestamp. Upserting an existing connection must preserve both values unless the input explicitly supplies them.
- `remote_os_id`, `remote_os_name`, and `remote_os_version` store detected remote system metadata from `connection_probe_system`. Upserting an existing connection must preserve these fields when `host`, `port`, and `username` are unchanged; changing that target identity clears the old detected system fields unless the input explicitly supplies new values.
- `connection_set_favorite` updates only `is_favorite` plus `updated_at`; it must not change `last_connected_at`.
- `connection_mark_connected` updates only `last_connected_at`; recent views must not be derived from `updated_at`.
- `credential_mode=saved` requires `credential_id` and clears inline secrets.
- `credential_mode=inline` requires inline password or inline private key path depending on `inline_auth_kind`.
- Existing inline connection edits use `inline_password_touched` / `inline_private_key_passphrase_touched` to distinguish "field not touched, preserve old vault reference" from "field touched, replace or validate the new secret". Reveal-only values must not force a replacement unless the user edits the field.
- `connection_test_profile` may receive an existing connection `id` with an untouched blank inline secret. It must resolve the transient test by reading the existing inline vault secret, without persisting the profile or returning that secret through the profile payload.
- `credential_mode=prompt` stores no password or private key passphrase; runtime prompt credentials must be supplied by `TerminalConnectRequest` or `ConnectionRuntimeCredentialRequest`.
- Password auth clears private-key fields; private-key auth clears password fields.
- Credential edits use `password_touched` / `private_key_passphrase_touched` to preserve existing vault references when the user did not modify the secret. Account management is the only UI surface that may call `credential_reveal_secret`.
- `connection_reveal_inline_secret` must return only connection inline secrets. It must reject saved-credential or prompt connections with `connection_inline_secret_unavailable`; saved credential secrets are revealed only through `credential_reveal_secret`.
- HTTP CONNECT and SOCKS5 proxy modes require proxy host and port. `none` clears proxy auth and proxy target fields.
- SSH jump config is stored as `jump: ConnectionJumpConfig`. `jump.kind = "ssh_jump"` requires a non-empty `jump_connection_id`; `jump.kind = "none"` clears `jump_connection_id`.
- SSH jump must resolve the saved jump connection, authenticate to the bastion first, then open a `direct-tcpip` channel to the target host for terminal, test, remote-file, and remote-monitor flows. Failures must not silently fall back to direct connection.
- SSH jump runtime validation must reject self-reference (`connection_jump_self_reference`) and nested jump chains (`connection_jump_nested_unsupported`). Bastion authentication failures must use `jump_*` error codes so callers can distinguish jump failures from target-host failures.
- Advanced timeouts are milliseconds. Keep validation ranges in Rust; React may edit numbers as strings but Rust is authoritative.
- Advanced terminal encoding is stored in `advanced.terminal_encoding`. Rust must normalize and validate the encoding, then carry it through `ResolvedSshConfig` into interactive terminal sessions.
- Interactive terminal output is decoded in Rust from the configured terminal encoding into UTF-8 bytes before emitting `terminal:output`. Interactive terminal input is encoded in Rust from the frontend Unicode string into the configured terminal encoding before writing to the SSH channel.
- Remote-file exec/read/write paths do not use `advanced.terminal_encoding`; they keep their own UTF-8 or raw-byte file semantics.
- Legacy JSON stores may contain clear-text passwords and private-key passphrases before migration. Migration must move those values into vault, write only secret references to SQLite, and keep JSON as `.migrated.bak` safety copies after success.
- All command failures return `AppError { code, message, raw_message, recoverable }`.
- `credential_delete` must check saved connection references and return `credential_in_use` instead of deleting a credential currently referenced by `credential_mode=saved`.
- Host-key verification is stateful. Unknown host keys return `host_key_unknown` with serialized `HostKeyInfo` in `raw_message`; changed host keys return `host_key_changed` with the new key and old fingerprint. Only `known_host_trust` may write or update trusted host keys.
- `connection_test`, `terminal_connect`, and remote-file commands must use the same saved-connection resolution path in `ssh_config.rs`; do not re-resolve credentials independently in UI-facing command handlers.
- `connection_test_profile` is only for testing the current `ConnectionDialog` form before it is saved. It must validate and resolve a transient profile through `resolve_transient_connection(...)`, may read saved credentials through `StorageRepository` when `credential_mode=saved`, and must not upsert a connection, mark recent activity, or synthesize a permanent connection id.
- `connection_probe_system` resolves the saved connection with the same runtime prompt credential shape as `connection_test`, opens a short-lived exec session, runs only the read-only `cat /etc/os-release 2>/dev/null || uname -s 2>/dev/null || true` probe, parses `ID`, `NAME`, and `VERSION_ID`, and writes only the `remote_os_*` fields through `StorageRepository`. It must not log passwords, passphrases, or full command payloads, and probe failure must be handled by the frontend as non-fatal after a successful connection.
- `connection_probe_latency` must load the saved profile by `connection_id` and probe only the saved `host`/`port` with a short TCP timeout. It must not require or log passwords, private keys, or passphrases.
- Terminal output and state events include both `session_id` and the optional frontend `request_id`. Keep `request_id` on early connection events so React can display shell output that arrives before the `terminal_connect` promise resolves.
- Telnet and serial sessions are runtime terminal sessions managed by `TerminalManager`; they emit the same terminal output/state events and share `terminal_write`, `terminal_resize`, and `terminal_close`.
- Telnet and serial connection settings are persisted as independent `ConnectionProtocol::Telnet` and `ConnectionProtocol::Serial` profiles. They must not require SSH username, SSH credentials, proxy, jump, or advanced SSH encoding fields.
- Serial profiles mirror `serial.port_name` into `host` and store `port = 1` for repository compatibility; runtime open must use the `serial` JSON config.
- Telnet input owns Enter and Backspace mode conversion in Rust, filters Telnet IAC control bytes, and sends NAWS when negotiated or resized.
- Serial sessions use `serialport` for port enumeration and blocking COM/TTY IO. Reads must run outside the async runtime, and close must release the port instead of leaving Windows COM handles occupied.
- The interactive terminal reader must not stop on `ChannelMsg::Eof`; continue reading until `ChannelMsg::Close` or channel end so a shell prompt or late startup output cannot be lost during frontend handoff.
- Tauri event names must use allowed characters only. Use colon-separated names such as `terminal:output`, `terminal:state_changed`, and `terminal:connect_progress`; do not use dot-separated names.
- On Windows, local terminal profile discovery must treat external command output as a platform boundary. `wsl.exe -l -q` may return UTF-16LE without a BOM, so WSL distribution parsing must decode UTF-16 when the byte shape indicates it and must strip NUL separators before building `wsl.exe -d <distro>` args. Because release GUI builds can otherwise show or block on an external WSL console window, the WSL probe must use `std::os::windows::process::CommandExt` with `CREATE_NO_WINDOW`, pipe stdout/stderr, and enforce a short timeout that skips WSL profiles instead of blocking app startup.
- On Windows, detected PowerShell local terminal profiles must use `-NoLogo -NoProfile` by default. Loading user profile scripts can add seconds of startup latency through prompt themes, module discovery, conda hooks, or network paths; users who need profile scripts should create an explicit custom profile without `-NoProfile`.
- On Windows, `get_windows_pty_info` returns ConPTY metadata including `windows_version::OsVersion::current().build`; on non-Windows it returns `None`. The frontend maps this to xterm's `windowsPty.buildNumber` so ConPTY wrapping and reflow heuristics match the host OS.

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
| Reveal inline secret for non-inline connection | `connection_inline_secret_unavailable` | true |
| Reveal or resolve a missing vault secret | `secret_missing` | true |
| Proxy mode requires proxy target but host is blank | `connection_proxy_host_missing` | true |
| Proxy mode requires proxy target but port is blank / invalid | `connection_proxy_port_invalid` | true |
| SSH jump mode has no saved jump connection id | `connection_jump_missing` | true |
| SSH jump references the same target connection id | `connection_jump_self_reference` | true |
| SSH jump target is itself configured with SSH jump | `connection_jump_nested_unsupported` | true |
| SSH jump TCP/SSH connection fails | `jump_connect_failed` | true |
| SSH jump authentication transport fails | `jump_auth_failed` | true |
| SSH jump authentication is rejected | `jump_auth_rejected` | true |
| SSH jump private key cannot load | `jump_private_key_invalid` | true |
| SSH jump cannot open target direct-tcpip channel | `jump_direct_tcpip_failed` | true |
| Advanced connect timeout outside allowed range | `connection_connect_timeout_invalid` | true |
| Advanced auth timeout outside allowed range | `connection_auth_timeout_invalid` | true |
| Advanced keepalive interval outside allowed range | `connection_keepalive_invalid` | true |
| Advanced terminal encoding is not supported | `connection_terminal_encoding_invalid` | true |
| Terminal output cannot decode with configured encoding | `terminal_encoding_decode_failed` | true |
| Terminal input cannot encode with configured encoding | `terminal_encoding_encode_failed` | true |
| Delete/open unknown connection id | `connection_missing` | false |
| Transient dialog test has invalid profile input | same validation code as `connection_upsert` | true |
| Credential name is blank | `credential_name_missing` | true |
| Credential password auth has blank username | `credential_username_missing` | true |
| Credential private-key auth has blank username | `credential_username_missing` | true |
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
- Good: editing an existing inline-password connection sends `inline_password_touched=false` with no password; Rust preserves the existing vault `secret_ref`, and `connection_test_profile` can still test with the old secret.
- Good: `connection_reveal_inline_secret` returns the inline password for an inline connection, while a saved-credential connection must be opened through account management and `credential_reveal_secret`.
- Good: `connection_test_profile` receives the unsaved dialog form, validates it, resolves inline or saved credential material, opens and closes a test SSH session, and leaves `connections.json` unchanged.
- Good: `terminal_connect` receives `connection_id` for a saved-credential connection plus stale frontend host fields; Rust loads the saved profile, resolves the credential, verifies the host key, carries the proxy/jump/timeout settings, and uses the saved values.
- Base: `connection_test` receives prompt credentials, resolves the saved connection with those runtime credentials, opens a reusable exec session, closes it, and returns `{ ok: true }`.
- Bad: `credential_delete` deletes a credential referenced by an existing connection, a dialog test calls `ConnectionStore::upsert` before connecting, or a command handler accepts frontend-supplied raw credentials for remote-file commands.

### 6. Tests Required

- Unit-test connection validation for blank host, blank username, zero port, credential modes, proxy validation, SSH jump validation, advanced validation, and legacy migration.
- Unit-test SSH jump runtime validation and jump-auth error mapping in the shared terminal session connection path.
- Unit-test terminal encoding validation plus SSH terminal output decode and input encode helpers.
- Unit-test credential validation for blank name, missing password, missing private key, auth-field clearing, and JSON store round-trip/delete.
- Unit-test untouched inline connection and credential secret preservation, reveal command behavior, and transient connection tests that reuse existing inline secrets without persisting.
- Unit-test known-host store behavior for unknown, trusted, and changed fingerprints.
- Unit-test saved connection resolution for saved, inline, prompt, missing credential, proxy, SSH jump round-trip, and advanced timeout behavior.
- Unit-test shared JSON store behavior for missing primary files, atomic write backup creation, and `.bak` recovery when the primary JSON is corrupt.
- Unit-test terminal connection validation for missing runtime prompt credentials and invalid direct SSH request fields.
- Unit-test remote system parsing for Ubuntu/CentOS-style `/etc/os-release` payloads and connection-store round trip/preservation of `remote_os_*` fields.
- Source-check that `connection_test_profile`, `resolve_transient_connection`, and the frontend `connectionTestProfile` wrapper are registered together, and that dialog testing does not call `saveConnection` / `connectionUpsert`.
- Source-check that terminal encoding is present in frontend types, advanced-tab UI, connection normalization, Rust profile validation, `ResolvedSshConfig`, and terminal session read/write paths.
- Run `node scripts/check-local-terminal-launcher-source.mjs` after changing Windows local terminal profile defaults, launcher UI, or Settings profile preview data.
- Run `cargo test --manifest-path src-tauri/Cargo.toml parse_wsl_distributions --lib` and `node scripts/check-local-terminal-wsl-source.mjs` after changing Windows local terminal WSL profile discovery.
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

## Scenario: SQLite Storage Foundation

### 1. Scope / Trigger

- Trigger: backend code adds or changes SQLite schema, storage bootstrap, schema versioning, future JSON-to-SQLite migration helpers, or secret reference columns.
- Source files: `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and future migration code that reads the existing JSON stores.
- This is an infrastructure contract. Phase 1 creates a DB foundation only; existing Tauri commands must keep using JSON stores until vault-backed migration can move structured rows and secrets atomically.

### 2. Signatures

- `sqlite_store_path(app: &AppHandle) -> Result<PathBuf, AppError>`
- `SqliteStore::open(path: impl AsRef<Path>) -> Result<SqliteStore, AppError>`
- `SqliteStore::initialize(&self) -> Result<(), AppError>`
- `SqliteStore::schema_version(&self) -> Result<i64, AppError>`
- `normalize_known_host_host(host: &str) -> String`

Schema version 1 creates these tables:

```sql
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)
app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)
connection_groups(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
connections(..., credential_mode TEXT NOT NULL, credential_id TEXT, inline_secret_ref TEXT, inline_secret_slot_id TEXT, inline_private_key_path TEXT, ...)
credentials(..., kind TEXT NOT NULL, secret_ref TEXT, secret_slot_id TEXT, private_key_path TEXT, ...)
known_hosts(host TEXT NOT NULL, port INTEGER NOT NULL, key_algorithm TEXT NOT NULL, fingerprint_sha256 TEXT NOT NULL, public_key TEXT NOT NULL, first_trusted_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)
tunnels(..., connection_id TEXT NOT NULL, local_host TEXT NOT NULL, local_port INTEGER NOT NULL, remote_host TEXT NOT NULL, remote_port INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, ...)
```

### 3. Contracts

- SQLite file path is `app.path().app_data_dir()/mxterm.db`.
- Use `rusqlite` with the `bundled` feature so Windows development and packaging do not depend on a system SQLite install.
- `initialize()` must be idempotent: it may be called repeatedly and must keep `schema_migrations` at the current max version.
- Migration timestamps and schema-owned time fields are ISO8601 strings. SQLite initialization may use UTC `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` for migration rows.
- `known_hosts.host` migration/write helpers must trim and lowercase host values before writing to SQLite.
- SQLite schema may store only secret references: local `secret_ref` and cross-device `secret_slot_id`. It must not define plaintext password or private-key passphrase columns.
- Phase 2 routes `connection_*`, `credential_*`, `known_host_*`, `tunnel_*`, terminal, SFTP, monitor, and tunnel resolution through SQLite + vault via `StorageRepository`.
- The production cutover migrates SQLite rows and vault secrets as one atomic flow. Do not create an intermediate state where SQLite rows point at empty secret refs and users cannot connect.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| App data dir cannot resolve | `sqlite_store_path_failed` | true |
| DB parent directory cannot be created | `sqlite_store_open_failed` | true |
| DB cannot open | `sqlite_store_open_failed` | true |
| Schema initialization fails | `sqlite_store_init_failed` | true |
| Schema version insert fails | `sqlite_store_init_failed` | true |
| Schema/version/table query fails | `sqlite_store_query_failed` | true |
| Schema introduces `password` or `passphrase` columns in `connections` or `credentials` | test failure | n/a |

### 5. Good / Base / Bad Cases

- Good: `SqliteStore::open(temp_dir/mxterm.db)` creates the parent directory, opens SQLite, `initialize()` creates all core tables, and `schema_version()` returns `1`.
- Good: running `initialize()` twice leaves a single current schema version and no duplicate schema side effects.
- Good: migrating or preparing a known-host row normalizes `"  Example.COM  "` to `"example.com"`.
- Base: application startup continues to use JSON stores even if SQLite foundation exists, because Phase 1 is not a production cutover.
- Bad: a command handler starts loading connections from SQLite before vault secret refs are populated, a migration writes raw passwords into SQLite, or a vault failure silently falls back to SQLite plaintext.

### 6. Tests Required

- Unit-test schema initialization records the current schema version.
- Unit-test repeated initialization is idempotent.
- Unit-test all core tables exist: `schema_migrations`, `app_meta`, `app_settings`, `connection_groups`, `connections`, `credentials`, `known_hosts`, and `tunnels`.
- Unit-test `normalize_known_host_host` trims and lowercases host values.
- Unit-test `connections` and `credentials` column names do not contain plaintext `password` or `passphrase` fields.
- Run `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib` after changing `storage_sqlite.rs`.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `git diff --check` after changing SQLite schema or dependencies.

### 7. Wrong vs Correct

#### Wrong

```rust
// Phase 1 must not cut production reads to SQLite before vault migration.
let store = SqliteStore::open(sqlite_store_path(&app)?)?;
load_connection_from_sqlite(&store, connection_id)
```

#### Correct

```rust
// JSON remains authoritative until SQLite + vault migration cuts over atomically.
let store = ConnectionStore::load(connection_store_path(&app)?)?;
store.get(connection_id)
```

#### Wrong

```sql
CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    password TEXT,
    private_key_passphrase TEXT
);
```

#### Correct

```sql
CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    secret_ref TEXT,
    secret_slot_id TEXT,
    private_key_path TEXT
);
```
## Scenario: SQLite + Encrypted Vault Production Storage

### 1. Scope / Trigger

- Trigger: backend code adds or changes vault-backed secret storage, JSON-to-SQLite migration, repository cutover, or saved SSH credential resolution.
- Source files: `src-tauri/src/storage_vault.rs`, `src-tauri/src/storage_migration.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/ssh_config.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/tunnels.rs`, and `src-tauri/src/terminal/session.rs`.
- This is a storage/security contract. Production commands must use SQLite + encrypted vault after Phase 2; legacy JSON stores are migration inputs only.

### 2. Signatures

- `StorageRepository::open_app(app: &AppHandle) -> Result<StorageRepository, AppError>`
- `StorageRepository::open_root(root, secret_store) -> Result<StorageRepository, AppError>`
- `StorageMigrator::new(root, secret_store).migrate() -> Result<(), AppError>`
- `SecretStore::set_secret(reference, secret) -> Result<(), AppError>`
- `SecretStore::get_secret(reference) -> Result<String, AppError>`
- `SecretStore::delete_secret(reference) -> Result<(), AppError>`
- `secret_vault_status(app, vault_state) -> Result<VaultStatus, AppError>`
- `secret_vault_unlock(app, vault_state, { master_password }) -> Result<VaultStatus, AppError>`
- `secret_vault_unlock_local(app, vault_state) -> Result<VaultStatus, AppError>`
- `secret_vault_lock(app, vault_state) -> Result<VaultStatus, AppError>`
- `secret_vault_enable_master_password(app, vault_state, { master_password }) -> Result<VaultStatus, AppError>`
- `secret_vault_disable_master_password(app, vault_state) -> Result<VaultStatus, AppError>`
- `resolve_saved_connection(app, connection_id, prompt) -> Result<ResolvedSshConfig, AppError>`
- `resolve_transient_connection(app, input) -> Result<ResolvedSshConfig, AppError>`

Secret account formats:

```text
connection:<connection_id>:inline_password
connection:<connection_id>:inline_private_key_passphrase
credential:<credential_id>:password
credential:<credential_id>:private_key_passphrase
```

### 3. Contracts

- `StorageRepository::open_app` must initialize SQLite, run the idempotent JSON migration when needed, and then serve all production connection/credential/known-host/tunnel operations.
- SQLite tables `connections` and `credentials` may contain only `secret_ref` and `secret_slot_id` for SSH login secrets. They must not contain plaintext password or passphrase columns.
- `VaultSecretStore` stores secrets in app data `secrets.enc`, encrypted with Argon2id-derived AES-256-GCM. `VaultState` keeps the unlocked store in memory for the current run.
- `VaultSecretStore` must persist `secrets.enc` through the shared atomic JSON writer: write a synced temp file, keep `secrets.enc.bak` when replacing an existing vault, and then atomically replace the primary file. Rekey and secret updates must not use direct `fs::write`.
- Default master-password protection is off. In this mode `secret_vault_unlock_local` creates/reads app-data `secrets.local.key` and uses it as the vault password so app startup does not show an unlock gate while SSH secrets still avoid SQLite/JSON plaintext.
- When master-password protection is enabled, app startup must require `secret_vault_unlock` before repository commands can read secrets. There is no separate "ask at startup" switch; startup unlock is inherent to master-password protection.
- `secret_vault_lock` clears only the in-memory unlocked store and returns `unlocked=false`. It must not delete vault files, rotate keys, disconnect active SSH sessions, or mutate SQLite rows.
- If `secrets.enc` already exists but `secrets.local.key` is missing, `secret_vault_unlock_local` must not blindly create a new local key and try to decrypt the old vault. It should report `vault_local_key_missing` or, when `.migrated.bak` / legacy JSON contains matching plaintext, rebuild an encrypted vault from those backups and preserve the old vault as `secrets.enc.recovered*.bak`.
- If local-key decrypt fails and the local key file is newer than `secrets.enc`, treat it as a likely regenerated local key and allow the same legacy-backup recovery. If the local key is older than the vault, treat the vault as likely master-password protected and return `vault_unlock_failed` instead of bypassing the master-password model.
- When users enable master-password protection, `secret_vault_enable_master_password` re-encrypts the current unlocked vault plaintext with the supplied master password. Disabling protection re-encrypts the same plaintext back to the local key. Existing secrets must survive both transitions. Rekey commands must fail with `vault_locked` when no unlocked store is present; they must not synthesize an empty vault as a fallback.
- Migration reads legacy JSON, writes non-empty SSH login secrets to vault, writes structured rows to SQLite in one transaction, sets `app_meta.storage_migrated_from_json=true`, then keeps legacy JSON files as `.migrated.bak` copies.
- When the migrated marker is already true, `StorageMigrator::migrate()` must still repair missing vault entries for SQLite `secret_ref` rows from `.migrated.bak` or legacy JSON when matching plaintext exists. It must not overwrite existing vault entries, recreate secrets for deleted SQLite rows, or synthesize secrets when no legacy plaintext is available.
- Migration failure must not delete, rename, or corrupt legacy JSON and must not set the migrated marker.
- Prompt runtime credentials are never written to SQLite, vault, or legacy JSON.
- Host-key checking during SSH handshake must read SQLite known_hosts through `StorageRepository`; it must not read `known_hosts.json` after cutover.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Vault write fails | `secret_store_write_failed` | true |
| Vault read fails | `secret_store_read_failed` | true |
| Vault delete fails | `secret_store_delete_failed` | true |
| Expected secret is missing | `secret_missing` | true |
| Empty master password when enabling/unlocking | `vault_password_missing` | true |
| Wrong master password or local key cannot unlock a master-protected vault | `vault_unlock_failed` | true |
| Existing local vault has no local key and cannot recover from legacy backup | `vault_local_key_missing` or `vault_unlock_failed` | true |
| Enable/disable master-password protection while vault is locked | `vault_locked` | true |
| SQLite migration write/query fails | `storage_migration_sqlite_failed` | true |
| Legacy JSON backup after migration fails | `storage_migration_backup_failed` | true |
| Saved connection references missing credential | `credential_missing` | true |
| Prompt credential required but absent | `credential_prompt_required` | true |

### 5. Good / Base / Bad Cases

- Good: default startup calls `secret_vault_unlock_local` before repository commands, so connection and credential lists load without a master-password prompt.
- Good: master-password startup shows the vault gate, calls `secret_vault_unlock`, and enables storage hooks only after the returned status is unlocked.
- Good: idle lock calls `secret_vault_lock`; existing SSH sessions continue running, but new secret reads require unlock again.
- Good: updating a vault secret leaves a readable `secrets.enc.bak` containing the previous encrypted vault state.
- Good: a migrated install whose local key was regenerated recovers `secrets.enc` from `.migrated.bak`, keeps a `secrets.enc.recovered*.bak` copy of the old vault, and then allows SQLite connection rows to list normally.
- Good: enabling or disabling master-password protection rekeys the vault and preserves an existing saved SSH password.
- Good: a legacy inline-password connection migrates to a SQLite connection row with `inline_secret_ref`, while the password value is stored only in vault and `connection_list` returns no password.
- Good: `terminal_connect`, SFTP, monitor, and tunnel start all call `resolve_saved_connection(...)`, which reads SQLite and vault through the same repository path.
- Base: a new install with no JSON files initializes `mxterm.db`, treats migration as complete, and uses empty SQLite tables.
- Bad: a command writes `connections.json` after Phase 2, stores a password/passphrase in SQLite, reads host keys from `known_hosts.json`, blindly creates a new local key for an existing vault, or silently falls back to plaintext storage when vault fails.

### 6. Tests Required

- Unit-test stable secret account generation and fake secret store set/get/delete/error mapping.
- Unit-test vault atomic replacement behavior by verifying `secrets.enc.bak` exists after a second write and can be restored/read with the same password.
- Unit-test local-key unlock round-trips secrets across `VaultState` instances.
- Unit-test regenerated/missing local-key recovery from `.migrated.bak`, including that the old vault is copied to `secrets.enc.recovered*.bak` and recovered secrets are readable from vault.
- Unit-test local-key -> master-password -> local-key rekey preserves existing secrets and rejects local unlock while master protection is active.
- Unit-test rekey commands reject locked state with `vault_locked` instead of creating an empty vault.
- Unit-test migration of legacy inline password, inline private-key passphrase, saved credential password, saved credential private-key passphrase, known_hosts lowercase normalization, and tunnels round-trip.
- Unit-test vault failure so migration does not mark success and does not create `.migrated.bak` copies.
- Unit-test migrated-marker repair: SQLite has `secret_ref`, vault returns `secret_missing`, and `.migrated.bak` contains matching legacy plaintext, then migration restores the vault secret.
- Unit-test repository upsert/list/resolve behavior so returned profiles do not expose plaintext secrets and saved resolution retrieves the secret from `SecretStore`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml storage_vault --lib`, `storage_migration --lib`, `storage_repository --lib`, `storage_sqlite --lib`, `npm run check`, and `cargo check --manifest-path src-tauri/Cargo.toml` after changing this area.

### 7. Wrong vs Correct

#### Wrong

```rust
let mut store = ConnectionStore::load(connection_store_path(app)?)?;
store.upsert(request, now)?;
```

#### Correct

```rust
let repo = StorageRepository::open_app(app)?;
repo.connection_upsert(request, now)?;
```

#### Wrong

```rust
connection.execute("INSERT INTO credentials(password) VALUES (?1)", [password])?;
```

#### Correct

```rust
let reference = SecretReference::credential(&credential_id, SecretKind::Password);
secret_store.set_secret(&reference, password)?;
// SQLite stores reference.account and reference.slot_id only.
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
- `remote_file_cancel_transfer(manager: State<RemoteFileManager>, request: RemoteFileCancelTransferRequest) -> Result<bool, AppError>`
- `ReusableExecSession::exec_with_stdin(command: &str, stdin: &[u8]) -> Result<ExecOutput, AppError>`
- `ReusableSftpSession::connect_resolved(app: &AppHandle, config: &ResolvedSshConfig) -> Result<ReusableSftpSession, AppError>`

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
    compress: bool, // #[serde(default = "default_compress_enabled")]
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
    compress: bool, // #[serde(default = "default_compress_enabled")], optional tar.gz directory transfer
    conflict_policy: Option<String>,
    transfer_id: Option<String>, // #[serde(default)], enables progress events
}

RemoteFileCancelTransferRequest {
    transfer_id: String,
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
- Transfer commands with `transfer_id` must emit `remote_file:transfer_progress` events from Rust while bytes move. SFTP transfers emit `{ loaded_bytes, total_bytes }` from bounded read/write chunks; legacy exec archive uploads may still emit stdin progress.
- SFTP upload and download progress events must include `total_bytes` once the backend has scanned the source file or directory. Directory progress is global: completed previous files plus the current file's loaded bytes.
- `ReusableExecSession` must keep non-progress `exec_with_stdin` behavior available for save/write commands, and add progress-aware variants instead of forcing every exec caller to emit UI events.
- `RemoteFileManager` may reuse a `ReusableExecSession` per connection signature. If an exec fails, invalidate the handle, reconnect once, and retry the command.
- `RemoteFileManager` owns a transfer registry keyed by `transfer_id`. `remote_file_cancel_transfer` sets the matching token; chunk loops and directory scans must check the token and return `remote_file_transfer_canceled` quickly without deleting `.mxpart` files.
- `remote_file_metadata` returns regular file, directory, symlink, or other metadata for the properties dialog. The serialized kind field is `type`.
- `remote_file_check_path` is a lightweight existence/type preflight for exact transfer targets. It must check only the requested path, return `{ exists, path, type }`, and must not list the parent directory, scan directory contents, read file content, create archives, or start upload/download work.
- `remote_file_upload_file` is a single-file byte upload. It accepts a conflict policy and returns the final remote path plus optional metadata; skipped uploads return `metadata: None`.
- `remote_file_upload_local_file` accepts a trusted local file path from the Tauri dialog path or a backend-owned upload temp path from the drag/drop fallback, streams that file through SFTP to `{remote_path}.mxpart`, and renames the part file to the final path only after the upload completes.
- `remote_file_upload_archive` accepts a legacy frontend-built `tar.gz` archive, uploads it through stdin to a remote temporary archive, extracts it with remote `tar -xzf`, and removes the remote archive unless `keep_archive == true`. Desktop UI should prefer `remote_file_upload_local_archive` so the selected directory path or compressed archive stays in Rust-owned local IO instead of crossing IPC as one `Vec<u8>`.
- `remote_file_upload_local_archive` accepts either a local `tar.gz` path or a local directory path. For a native directory path the backend chooses between two modes based on the `compress` flag (default `true`) and tar availability: when `compress` is on and both `local_tar_available()` and `remote_tar_available(...)` are true, it packs the directory into a backend-owned `tar.gz` via `create_local_directory_archive` and uploads it through `upload_local_archive` (exec + remote `tar -xzf` extract); otherwise it silently falls back to SFTP file-by-file under `{resolved_root}.mxpart` renamed to the resolved root only after completion. A pre-packed `tar.gz` file path always takes the compressed exec path regardless of `compress`.
- `local_path_metadata` is a read-only helper for native desktop drops. It canonicalizes a local path and returns whether it is a file, directory, or other local item before the UI chooses the file or archive upload command.
- Directory upload conflict handling is root-folder level: resolve `target_dir/root_name` using overwrite / skip / rename before creating the SFTP staging directory. Do not remove the old root until the staged SFTP directory has uploaded successfully and is ready to rename.
- `remote_file_check_download_target` resolves the same system/custom download directory shape as `remote_file_download_to_local`, checks only the final local path with `Path::exists`, and returns the path plus `exists`. It must not contact SSH or create directories/files.
- `remote_file_download_to_local` resolves the system or custom download root on the Rust side, creates optional session and timestamp subdirectories, writes files directly to disk, and returns the final local path. Single-file downloads always use SFTP and write to `{local_path}.mxpart` before renaming to the final path. Directory downloads choose between compressed and SFTP modes based on the `compress` flag (default `true`) and tar availability.
- The frontend-owned `session_name` value represents the connection grouping name, not a terminal tab title. Rust should sanitize it as a local path segment and use the fallback segment only when the provided value is blank.
- Directory download mode selection: when `compress` is on and both `local_tar_extract_available()` and `remote_tar_available(...)` are true, the backend calls `download_archive` (remote `tar -czf` streamed back over exec), writes a temporary or retained `tar.gz`, and extracts it locally via `unpack_remote_directory_archive` (local `tar -xzf`); `keep_archives` controls whether the `tar.gz` is retained and `archive_path` reflects that. On Windows, local extraction must pass `--options=hdrcharset=UTF-8` so Linux-created archives with non-ASCII path segments decode correctly under bsdtar. Otherwise it silently falls back to scanning the remote directory over SFTP, creating the local tree, and downloading each regular file to its sibling `.mxpart` with resume support; in SFTP mode `keep_archives` is ignored and `archive_path` is `None`. The compressed path is not resumable mid-stream; only the pre-flight tar-availability probe triggers fallback, not a mid-transfer failure.
- Compressed directory transfer (upload pack + remote extract, or remote pack + local extract) reintroduces a `tar` dependency on both ends. Before choosing the compressed path the backend must probe `local_tar_available()` and `remote_tar_available(...)`; if either is unavailable the command silently falls back to SFTP file-by-file so the user is never blocked by a missing `tar`. The compressed stream is not resumable, so fallback happens only at the pre-flight probe, not after a mid-transfer failure.
- `compress` defaults to `true` (`default_compress_enabled`) to restore the legacy bandwidth-saving experience. The frontend exposes it as a `compressDirectories` setting; single-file transfers ignore it. `keep_archives` / `keep_archive` only take effect on the compressed path.
- Existing `.mxpart` files are resume candidates only when their byte length is less than or equal to the source total. Oversized parts must be discarded and restarted from byte 0.
- SFTP single-file download loops must stop when `loaded_bytes == total_bytes` from remote metadata. Do not issue an extra read only to observe EOF: some SFTP servers or client wrappers surface EOF/past-end reads as a status error, which makes a fully downloaded file fail at 100%. If a read returns zero before the expected total, return `remote_file_download_failed` and keep the `.mxpart` file for retry instead of renaming an incomplete file.
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
| User cancels a registered transfer | `remote_file_transfer_canceled` | true |
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
| SFTP directory scan or transfer fails | `remote_file_archive_download_failed` / `remote_file_download_failed` / `remote_file_upload_failed` | true |
| Compressed directory download (remote `tar -czf`) fails | `remote_file_archive_download_failed` | true |
| Local `tar -xzf` extraction cannot start or fails | `remote_file_download_extract_start_failed` / `remote_file_download_extract_failed` | true |
| Local extracted root missing or cannot move | `remote_file_download_extract_missing` / `remote_file_download_extract_move_failed` | true |
| Local `tar -czf` packing for upload fails | `remote_file_upload_archive_start_failed` / `remote_file_upload_archive_failed` | true |
| System download root cannot resolve | `remote_file_download_root_failed` | true |
| Local download directory cannot be created | `remote_file_download_create_dir_failed` | true |
| Local file or `.mxpart` write fails | `remote_file_download_write_failed` | true |
| Local overwrite fails | `remote_file_download_overwrite_failed` | true |
| Local auto-rename cannot find a free name | `remote_file_download_rename_failed` | true |

### 5. Good / Base / Bad Cases

- Good: `remote_file_write` receives `/opt/app/app.conf`, current metadata still matches `expected_mtime` and `expected_size`, the shell command contains only quoted path/temp-file logic, content is sent over stdin, and the response returns fresh metadata.
- Good: `remote_file_upload_local_file` receives a Tauri-dialog file path for `app.log`, streams that file directly from disk through SFTP to `.mxpart`, emits `loaded / total` progress, and renames the part file only after completion.
- Good: `remote_file_check_path` receives `/opt/app/dist`, runs a single `test -e/-L/-d/-f` style shell command, returns `exists: true` and `type: "directory"` when the root exists, and does not inspect the directory tree.
- Good: `remote_file_upload_local_archive` receives a Tauri-dialog directory path for `dist`, resolves `/opt/app/dist (1)` under rename policy, creates `/opt/app/dist (1).mxpart`, uploads regular files through SFTP with resume, renames the staged root to the final root, and returns the final remote path.
- Good: `remote_file_download_to_local` receives a directory path and settings-derived timestamp name, scans the remote directory over SFTP, downloads each file under `Downloads/<session>/<timestamp>/dist`, emits global loaded/total progress, and returns `local_path` plus `local_directory`.
- Good: `remote_file_cancel_transfer` receives a running `transfer_id`, marks its token canceled, the active SFTP chunk loop returns `remote_file_transfer_canceled`, and the UI keeps the row canceled rather than failed.
- Base: `remote_file_read` receives a small UTF-8 file, metadata parses with optional mode, content has no NUL bytes, and the response sets `encoding = "utf-8"` and `editable = true`.
- Bad: write logic builds `format!("cat > {}", content)`, extracts a directory archive over an existing target instead of using SFTP conflict policy, deletes `.mxpart` on user cancellation, or accepts a frontend password field for a remote file command.

### 6. Tests Required

- Unit-test `quote_posix_shell` for normal paths, empty strings, and single quotes.
- Unit-test `parse_remote_file_metadata` for NUL-delimited path, size, mtime, empty mode, and present mode.
- Unit-test `looks_like_binary` for plain text and NUL-containing bytes.
- Unit-test `build_remote_write_command` to assert it creates a temp file, uses `cat > "$tmp"`, moves the temp file to the target, and does not contain literal content.
- Unit-test `build_remote_path_check_command` and `parse_remote_path_check_output` for missing targets, existing file/directory/symlink targets, quoted paths, and no directory listing/archive work.
- Unit-test `build_remote_upload_command`, `build_remote_resolve_child_command`, and `build_remote_extract_archive_command` for quoted paths, POSIX shell syntax, tar usage in legacy archive upload, and no embedded file content. Source-check local upload temp helpers and `exec_with_stdin_file_progress` when changing legacy upload plumbing.
- Unit-test SFTP part-path helpers, resume offset handling, capped SFTP read lengths, remote relative path joining, local relative path joining, and remote rename parent/name helpers.
- Source-check progress plumbing for `REMOTE_FILE_TRANSFER_PROGRESS`, `RemoteFileTransferProgressEvent`, `ExecProgressCallback`, `SftpProgressCallback`, `remote_sftp_transfer_progress_callback`, `exec_with_stdin_progress`, and `exec_with_stdout_progress`.
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
// Downloads a directory as one in-memory archive, so progress has no stable total
// and large transfers can spike memory.
let content = self.download_archive(app, profile, path, progress).await?;
fs::write(&archive_path, content)?;
```

#### Correct

```rust
let plan = build_remote_transfer_plan(session.sftp(), path, &cancel).await?;
for file in &plan.files {
    download_sftp_file(
        session.sftp(),
        &file.remote_path,
        &local_relative_path(target, &file.relative_path),
        file.size,
        base_loaded,
        progress.clone(),
        &cancel,
    )
    .await?;
    base_loaded += file.size;
}
```

## Scenario: Remote Monitor Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes remote monitoring snapshots, Linux collector scripts, parser output, process signaling, or the `remote_monitor_*` Tauri commands.
- Source files: `src-tauri/src/remote_monitor.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/monitor/monitorTypes.ts`.
- This is a cross-layer command contract because React renders a typed monitoring panel while Rust owns saved SSH resolution, fixed Linux collection scripts, parsing, rate calculation, and process signal safety.

### 2. Signatures

- `remote_monitor_snapshot(app: AppHandle, manager: State<RemoteMonitorManager>, request: RemoteMonitorSnapshotRequest) -> Result<RemoteMonitorSnapshot, AppError>`
- `remote_monitor_process_signal(app: AppHandle, manager: State<RemoteMonitorManager>, request: RemoteProcessSignalRequest) -> Result<RemoteProcessActionResult, AppError>`
- `RemoteMonitorManager::snapshot(app, config, options) -> Result<RemoteMonitorSnapshot, AppError>`
- `RemoteMonitorManager::signal_process(app, config, pid, signal) -> Result<RemoteProcessActionResult, AppError>`

Request fields:

```rust
RemoteMonitorSnapshotRequest {
    connection_id: String,
    include_processes: bool,
    process_limit: Option<u16>,
}

RemoteProcessSignalRequest {
    connection_id: String,
    pid: u32,
    signal: RemoteProcessSignal, // term | kill | hup
}
```

Snapshot response includes `host`, `cpu`, `memory`, `gpus`, `disks`, `network`, `processes`, `collected_at_ms`, and `refresh_hint_ms`.

### 3. Contracts

- `remote_monitor_snapshot` and `remote_monitor_process_signal` must load saved SSH configuration by `connection_id` through `resolve_saved_connection(...)`; React must not send raw host, credentials, proxy, jump, or command strings.
- The collector script is fixed Rust-owned code executed as `sh -lc <quoted script>`. Do not accept arbitrary frontend shell commands or interpolate user text into the collector.
- The collector output uses `MXBEGIN<TAB>section` / `MXEND<TAB>section`. Each section parser owns normalization from remote text into the typed snapshot.
- Partial source failures stay local to `MonitorSourceError` where possible. SSH connection, authentication, host-key, channel, or collector process failure may return command-level `AppError`.
- Missing GPU support is not an error. No `nvidia-smi` or no NVIDIA devices must produce `gpus: []`.
- Missing CPU or GPU temperature must serialize as `None`; UI hides temperature fragments instead of showing unavailable placeholders.
- Virtualized CPU topology must be marked with `cpu.is_virtualized = true` when `lscpu` reports a hypervisor vendor or virtualization type. In that case, do not serialize `physical_cores` from guest socket/core values, because they are virtual topology rather than real physical cores.
- Memory `used_bytes` means `MemTotal - MemAvailable`, matching the panel's occupied/unavailable memory ratio rather than the `free` command's `used` column. `cached_bytes` should match Linux `free`'s `buff/cache` intent where possible: `Buffers + Cached + SReclaimable - Shmem`.
- `RemoteDiskSummary.devices` is the UI-facing storage-device list, not raw `lsblk` rows. It must exclude partitions, loop devices, optical drives, LVM child volumes, and RAM/zram pseudo disks so status counts and hardware storage totals do not inflate.
- `RemoteMonitorManager` stores previous CPU, disk, and network counters per connection id to compute usage percentages and byte rates. The first sample may return `None` rates.
- `RemoteMonitorManager` may keep a short-lived cached `ReusableExecSession` for monitor exec commands, but it must be keyed by `connection_id` plus `ResolvedSshConfig::signature()`, capped to the active monitor connection, and closed after a short idle timeout such as 30 seconds. Signature changes, idle expiry, or exec errors must invalidate and close the cached session; do not keep a permanent monitor SSH connection or retry in a background reconnect loop.
- `process_limit` is clamped server-side. The process collector may request only a bounded top list.
- `remote_monitor_process_signal` accepts only enum signals and validates `pid > 1`. The remote command may contain only the fixed signal flag plus the validated numeric PID.
- All new monitor commands must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!`.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Blank snapshot/signaling `connection_id` | `remote_monitor_connection_missing` | false |
| Unknown connection id | `connection_missing` | false |
| SSH command channel cannot start | existing `remote_exec_*` code | true |
| Collector exits non-zero | `remote_monitor_collect_failed` | true |
| `pid <= 1` | `remote_monitor_process_pid_invalid` | true |
| `kill` exits non-zero | `remote_monitor_process_signal_failed` | true |
| Missing GPU collector | `gpus: []` | n/a |
| Missing CPU/GPU temperature | temperature field `None` | n/a |
| First CPU/disk/network sample has no baseline | usage/rate field `None` | n/a |

### 5. Good / Base / Bad Cases

- Good: `remote_monitor_snapshot` receives a saved connection id, resolves credentials/proxy/jump in Rust, runs the fixed collector, parses Linux sections, and returns CPU model, memory, disk I/O, primary physical NIC/IP, GPU devices, and optional process rows.
- Good: a second snapshot for the same connection computes CPU usage, disk read/write bytes per second, and network rx/tx bytes per second from stored counters.
- Good: monitor polling reuses the same cached exec session while the resolved SSH signature matches and the session is active, then closes it when the monitor has been idle long enough.
- Base: a host without `nvidia-smi` returns an empty GPU array and no visible GPU error.
- Base: a host without readable temperature sensors returns `temperature_celsius: None`.
- Bad: frontend sends `command: "ps aux"` or a signal string interpolated into shell, backend shows a fake GPU placeholder, monitor caching ignores `ResolvedSshConfig::signature()`, or UI hides parser errors by filtering data instead of preserving section errors.

### 6. Tests Required

- Unit-test monitor parser fixtures for `/proc/stat`, `/proc/meminfo`, `df -P -B1`, `lsblk -P`, `/proc/diskstats`, `/proc/net/dev`, `nvidia-smi` CSV, default route/IP parsing, and `ps` output.
- Unit-test virtualized CPU topology so guest `1 core / 8 threads` style `lscpu` output becomes `is_virtualized: true`, `logical_cores: 8`, and no physical core count.
- Unit-test delta calculation from previous CPU, disk, and network counters.
- Unit-test monitor session-cache reuse rules for matching signature, changed signature, and idle expiry.
- Unit-test process PID validation and signal command construction.
- Run `cargo test --manifest-path src-tauri/Cargo.toml remote_monitor --lib` after changing `src-tauri/src/remote_monitor.rs`.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing command registration, monitor structs, or collector behavior.
- Run `pnpm check` after changing frontend monitor types or wrappers.

### 7. Wrong vs Correct

#### Wrong

```rust
let output = session.exec(&request.command).await?;
```

#### Correct

```rust
let command = build_monitor_collect_command(options);
let output = session.exec(&command).await?;
```

#### Wrong

```rust
let command = format!("kill -{} {}", request.signal, request.pid);
```

#### Correct

```rust
let command = build_process_signal_command(pid, signal)?;
```

## Scenario: SSH Tunnel Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes SSH tunnel rules, local/dynamic/remote forwarding lifecycle, tunnel persistence, prompt credentials, or `tunnel_*` Tauri commands.
- Source files: `src-tauri/src/tunnels.rs`, `src-tauri/src/terminal/session.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/ssh_config.rs`, `src/shared/tauri/commands.ts`, and `src/features/tunnels/tunnelTypes.ts`.
- This is a cross-layer command contract because Rust owns saved SSH resolution, local `TcpListener` binding, remote `tcpip-forward` lifecycle, direct-tcpip forwarding, runtime state, and SQLite tunnel persistence, while React renders and edits typed rules.

### 2. Signatures

- `tunnel_list(app: AppHandle, manager: State<TunnelManager>) -> Result<Vec<TunnelRuleWithState>, AppError>`
- `tunnel_upsert(app: AppHandle, manager: State<TunnelManager>, request: TunnelRuleInput) -> Result<TunnelRuleWithState, AppError>`
- `tunnel_delete(app: AppHandle, manager: State<TunnelManager>, request: TunnelRuleIdRequest) -> Result<(), AppError>`
- `tunnel_start(app: AppHandle, manager: State<TunnelManager>, request: TunnelStartRequest) -> Result<TunnelRuleWithState, AppError>`
- `tunnel_stop(app: AppHandle, manager: State<TunnelManager>, request: TunnelRuleIdRequest) -> Result<TunnelRuleWithState, AppError>`
- `tunnel_autostart(app: AppHandle, manager: State<TunnelManager>) -> Result<Vec<TunnelRuleWithState>, AppError>`
- `ReusableForwardSession::connect_resolved(app, config) -> Result<ReusableForwardSession, AppError>`
- `ReusableForwardSession::forward_tcp_stream(local_stream, remote_host, remote_port) -> Result<(), AppError>`
- `ReusableForwardSession::open_direct_tcpip_stream(remote_host, remote_port, source_host, source_port) -> Result<ChannelStream<client::Msg>, AppError>`
- `ReusableForwardSession::request_remote_forward(remote_host, remote_port) -> Result<u16, AppError>`
- `ReusableForwardSession::cancel_remote_forward(remote_host, remote_port) -> Result<(), AppError>`
- `ReusableForwardSession::set_remote_forward_target(local_host, local_port, event_handler)`

Request fields:

```rust
TunnelRuleInput {
    id: Option<String>,
    name: Option<String>,
    kind: TunnelKind, // local | remote | dynamic
    connection_id: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    auto_start: bool,
}

TunnelStartRequest {
    rule_id: String,
    runtime_credential: Option<RuntimeCredentialInput>,
}

TunnelRuleIdRequest {
    rule_id: String,
}
```

Response fields:

```rust
TunnelRuleWithState {
    rule: TunnelRule,
    state: TunnelRuntimeState,
}

TunnelRuntimeState {
    rule_id: String,
    status: TunnelStatus, // stopped | starting | running | failed | credential_required
    bound_host: Option<String>,
    bound_port: Option<u16>,
    started_at: Option<String>,
    last_error: Option<String>,
    last_error_code: Option<String>,
    active_connections: u32,
}
```

### 3. Contracts

- Tunnel rules are stored in SQLite through `StorageRepository`; legacy `tunnels.json` is only a migration source. Runtime state is kept only in `TunnelManager` memory.
- `TunnelKind` supports all three SSH forwarding modes:
  - `local`: `local_host:local_port` is the local listener and `remote_host:remote_port` is the SSH-server-side target.
  - `dynamic`: `local_host:local_port` is a no-auth SOCKS5 listener. `remote_host` is normalized to an empty string and `remote_port` to `1`; the actual target comes from each SOCKS5 CONNECT request.
  - `remote`: `remote_host:remote_port` is the SSH-server-side listener and `local_host:local_port` is the local target service.
- A tunnel rule references a saved `ConnectionProfile` by `connection_id`. React must not send host, port, proxy, jump, password, private-key passphrase, or raw SSH config in tunnel commands.
- `tunnel_start` resolves the saved connection through `resolve_saved_connection(...)` and reuses credential mode, proxy, SSH jump, known_hosts, and timeout behavior.
- Runtime prompt credentials may be supplied only through `TunnelStartRequest.runtime_credential`. They are for this one start attempt and must not be written to SQLite, vault, or legacy JSON stores.
- `tunnel_autostart` starts only `auto_start = true` rules. If a prompt credential is required, it must not open a prompt; set the state to `credential_required` and continue with other rules.
- For `local` and `dynamic`, `running` means the local listener is bound and the SSH forwarding session is ready. It must not claim the remote target service is healthy until a local client actually connects.
- For `remote`, `running` means the SSH server accepted `tcpip-forward`. It must not claim the local target service is healthy; forwarded connections may later fail to connect to `local_host:local_port` and should update runtime `last_error` without stopping the listener.
- Per local client connection, Rust opens `channel_open_direct_tcpip(remote_host, remote_port, source_host, source_port)` and bridges the local `TcpStream` with the SSH channel stream.
- Dynamic SOCKS supports SOCKS5 no-auth TCP CONNECT only. It must support IPv4, domain, and IPv6 targets; reject unsupported auth methods, commands, address types, malformed targets, and port `0` with structured tunnel SOCKS errors.
- Remote forwarding requests must use `tcpip_forward(remote_host, remote_port)`, handle the returned bound port, and cancel with `cancel_tcpip_forward(remote_host, bound_port)` during stop/delete.
- Stopping or deleting a running tunnel must close the SSH session and release the local listener. Deleting a running rule stops it first.
- `TunnelManager.store_lock` may protect only `TunnelStore` load/upsert/delete/save file operations. Do not hold it across `resolve_saved_connection`, local `TcpListener` binding, SSH handshake/auth, accept-loop setup, or autostart attempts; those operations can block for network timeouts and must not freeze tunnel list/edit/stop/delete commands.
- The accept loop owns runtime cleanup on abnormal listener exit: set a failed state, remove the rule id from the `running` map, then close the SSH session. A stale `running` entry whose state is `failed`, `credential_required`, or `stopped` must be replaceable by the next start attempt instead of short-circuiting back to the stale state.
- `tunnel_stop` should be idempotent after a running rule has already been removed from the store: if `stop_running` removed a runtime entry but the persisted rule is missing, return a stopped state based on the removed runtime rule instead of surfacing `tunnel_rule_missing`.
- Editing a starting or running tunnel must be rejected; users must stop the tunnel before changing its rule.
- All new tunnel commands must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!` and exposed through typed frontend wrappers.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Blank or unknown rule id | `tunnel_rule_missing` | false |
| Editing a running rule | `tunnel_update_running` | true |
| Blank `connection_id` | `tunnel_connection_missing` | true |
| Blank local listener/SOCKS address or remote-forward local target | `tunnel_local_host_missing` | true |
| Blank local-forward target or remote-forward remote listener | `tunnel_remote_host_missing` | true |
| Required local/SOCKS/target port is `0` | `tunnel_local_port_invalid` | true |
| Required remote target/listener port is `0` | `tunnel_remote_port_invalid` | true |
| Local bind fails, usually port already used | `tunnel_local_bind_failed` | true |
| SOCKS handshake/auth/command/address type unsupported | `tunnel_socks_handshake_failed` | true |
| SOCKS target host/port cannot be parsed | `tunnel_socks_target_missing` | true |
| SSH server rejects remote forwarding | `tunnel_remote_forward_denied` | true |
| SSH remote forwarding cancellation fails | `tunnel_remote_forward_cancel_failed` | true |
| Remote forwarded connection cannot reach local target | `tunnel_remote_target_connect_failed` | true |
| Prompt credential missing on manual start | `credential_prompt_required` | true |
| Prompt credential missing on autostart | state `credential_required` | n/a |
| SSH connect/auth/direct-tcpip failures | `tunnel_ssh_*` / `tunnel_direct_tcpip_failed` | true |
| Local/SSH stream copy fails | `tunnel_stream_copy_failed` | true |
| Store path/read/parse/write fails | `tunnel_store_*` | true |

### 5. Good / Base / Bad Cases

- Good: `tunnel_start` receives a saved rule id, resolves the saved connection, binds `127.0.0.1:15432`, opens one reusable SSH forwarding session, and creates direct-tcpip channels only when local clients connect.
- Good: a `dynamic` rule binds `127.0.0.1:1080`, completes SOCKS5 no-auth negotiation, parses the CONNECT target, opens direct-tcpip to that target, and only then sends SOCKS success to the local client.
- Good: a `remote` rule requests `tcpip-forward` on the server, stores the returned bound port in runtime state, and forwards incoming server channels to the configured local target without claiming the local service is healthy.
- Good: `tunnel_autostart` starts saved auto-start rules and marks prompt-credential rules as `credential_required` without blocking app startup.
- Base: a rule references a deleted connection; list still returns the rule, while start fails with the saved-connection error so the user can edit or delete the rule.
- Bad: a tunnel command accepts frontend-supplied SSH host/password fields, writes prompt credentials into the rule store, silently downgrades SSH jump failures to direct connections, or reports remote service success just because the local listener was bound.

### 6. Tests Required

- Unit-test tunnel rule validation for blank connection id, kind-specific local/remote host semantics, zero required ports, dynamic remote-field normalization, and trimming/default name behavior.
- Unit-test SOCKS5 parser behavior for no-auth selection, IPv4/domain/IPv6 CONNECT targets, unsupported methods, unsupported commands, malformed targets, and port `0`.
- Unit-test tunnel store round-trip for `{ version, rules }`, created/updated timestamps, and delete-missing behavior.
- Unit-test tunnel runtime lifecycle helpers for replacing stale failed/credential/stopped runtime entries and for resolving a stopped response after a removed running rule no longer exists in the persisted store.
- Cross-check command registration in `commands.rs`, `lib.rs`, and `src/shared/tauri/commands.ts` whenever adding or renaming a `tunnel_*` command.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` after changing Rust tunnel/session code.
- Run `cargo test --manifest-path src-tauri/Cargo.toml tunnels --lib` and `cargo check --manifest-path src-tauri/Cargo.toml` after changing tunnel command structs, storage behavior, or `ReusableForwardSession` when compile/test runs are approved for the session.
- Run `npm run check` after changing frontend tunnel types, command wrappers, or panel props.

### 7. Wrong vs Correct

#### Wrong

```rust
// Bypasses saved connection resolution and can drift from terminal/file behavior.
let config = ResolvedSshConfig {
    host: request.host,
    port: request.port,
    password: request.password,
    ..Default::default()
};
```

#### Correct

```rust
let config = resolve_saved_connection(app, &rule.connection_id, request.runtime_credential)?;
let session = ReusableForwardSession::connect_resolved(app, &config).await?;
```

## Scenario: Command Library Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes Command Sender snippets, Command Sender history, SQLite schema, or command-library Tauri commands.
- Source files: `src-tauri/src/command_library.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/layout/WorkspaceShell.tsx`.
- This is a cross-layer storage contract because Rust owns validation, SQLite persistence, history merge semantics, and error codes while React owns only UI selection and management.

### 2. Signatures

```rust
command_snippet_list(app: AppHandle) -> Result<Vec<CommandSnippet>, AppError>
command_snippet_upsert(app: AppHandle, request: CommandSnippetInput) -> Result<CommandSnippet, AppError>
command_snippet_delete(app: AppHandle, request: CommandSnippetIdRequest) -> Result<(), AppError>
command_snippet_mark_used(app: AppHandle, request: CommandSnippetIdRequest) -> Result<CommandSnippet, AppError>
command_history_list(app: AppHandle, request: CommandHistoryListRequest { limit, scope }) -> Result<Vec<CommandHistoryEntry>, AppError>
command_history_record(app: AppHandle, request: CommandHistoryRecordRequest) -> Result<CommandHistoryEntry, AppError>
command_history_delete(app: AppHandle, request: CommandHistoryIdRequest) -> Result<(), AppError>
command_history_clear(app: AppHandle) -> Result<(), AppError>
```

Serialized fields use snake_case. `CommandHistorySource` currently serializes `command_sender` and `terminal_input`. `CommandHistoryScope.scope_kind` serializes `ssh_connection` and `local_profile`; scope ids are saved connection ids or local terminal profile ids.

### 3. Contracts

- Command snippets and command history are production data in SQLite tables `command_snippets`, `command_history`, and `command_history_scopes`; do not use localStorage or JSON files as production storage.
- Command Sender history is recorded only after Command Sender writes at least one target terminal input stream successfully.
- Optional terminal input history may record `terminal_input` only when the frontend setting is enabled and a conservative xterm input parser sees a successful Enter-submitted printable line. It must drop control sequences, password-like commands, TUI keystrokes, target session ids, runtime tab ids, and full target lists.
- `command_history.command` is unique. Recording an existing command must merge with `ON CONFLICT(command)`, increment `use_count`, update `last_used_at`, and keep the newest `target_count` / `append_enter`.
- `command_history_scopes` records where a command was used for filtering: SSH uses `ssh_connection + connection_id`, local terminals use `local_profile + profile_id`. It may store per-scope source, target count, append-enter flag, use count, and last-used timestamp, but must not store connection names, command output, session ids, or tab ids.
- `command_history_list` without a scope returns global history. With a scope, it joins `command_history_scopes` and returns per-scope source/use-count/last-used values. Legacy unscoped history appears only in the all-history view.
- Command snippets own a display folder field. Rust serializes it as `group`; SQLite stores it as `group_name TEXT NOT NULL DEFAULT ''`. Blank, missing, or legacy `"未分组"` values must normalize to `COMMAND_SNIPPET_DEFAULT_GROUP`, which represents the root folder.
- Existing SQLite databases that already have `command_snippets` must be upgraded by adding `group_name` with a non-null default and creating the group index. Do not require users to delete their database.
- Existing SQLite databases that already have `command_history_scopes` must be upgraded by adding missing metadata columns (`source`, `target_count`, `append_enter`) with non-null defaults, backfilling them from `command_history` when possible, and creating the scope index. `CREATE TABLE IF NOT EXISTS` alone is not a migration for existing tables.
- Snippet `tags` are accepted as an array, trimmed, deduplicated case-insensitively, and stored as JSON text in SQLite.
- Command text is trimmed before storage and limited by `COMMAND_TEXT_MAX_LENGTH`. Rust validation is authoritative; React may disable obvious empty saves but must still surface backend validation errors.
- `command_snippet_mark_used` updates only snippet usage metadata and must not mutate command text, title, tags, or favorite state.
- Command library commands return `AppError { code, message, raw_message, recoverable }` on failure and must be registered in both `commands.rs` and `lib.rs`.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Snippet title is blank | `command_snippet_title_missing` | true |
| Snippet command is blank | `command_snippet_command_missing` | true |
| Snippet command exceeds the configured length | `command_snippet_too_long` | true |
| Snippet id is missing during delete/mark-used | `command_snippet_missing` | false |
| History command is blank | `command_history_command_missing` | true |
| History command exceeds the configured length | `command_history_too_long` | true |
| History id is missing during delete | `command_history_missing` | false |

### 5. Good / Base / Bad Cases

- Good: Command Sender writes `df -h` to 2 of 3 targets, then records one history row with `target_count=2`, `append_enter=true`, and no target ids.
- Good: selecting a snippet and sending it unchanged records history and increments that snippet's use count.
- Base: browser preview has no Tauri runtime; the command library lists are empty and real save/delete actions are unavailable.
- Bad: terminal `onData` records every keypress, history rows contain `session_id`, snippets are stored in localStorage, or React invents a successful history row after every target write failed.

### 6. Tests Required

- Unit-test snippet validation for missing title, missing command, length limit, tag trimming, and case-insensitive tag dedupe.
- Unit-test snippet repository round-trip, delete missing, usage update, and list sorting.
- Unit-test history merge by command, limit clamping, delete, clear, and list sorting.
- Cross-check command registration in `commands.rs`, `lib.rs`, and `src/shared/tauri/commands.ts`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml command_library --lib` after changing command-library validation or repository logic.
- Run `npm run check` after changing frontend command-library types, wrappers, or Command Sender UI when type-check runs are approved for the session.

## Scenario: Application Runtime Info and Updater Release Contract

### 1. Scope / Trigger

- Trigger: backend code adds or changes runtime distribution detection, application update metadata, Tauri updater configuration, release signing environment keys, or command registration for update-related runtime info.
- Source files: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`, `.github/workflows/release.yml`, `scripts/build-platform.mjs`, `scripts/release-assets.mjs`, and `scripts/generate-latest-json.mjs`.
- This is an infra and cross-layer contract because Rust exposes runtime metadata to React while GitHub Actions produces signed updater artifacts consumed by the Tauri updater plugin.

### 2. Signatures

```rust
pub fn get_app_runtime_info() -> Result<AppRuntimeInfo, AppError>

pub struct AppRuntimeInfo {
    pub version: String,
    pub repository_url: String,
    pub distribution_mode: String,
    pub is_tauri: bool,
}

pub(crate) fn detect_distribution_mode(
    platform: &str,
    executable_dir: &Path,
    appimage: Option<OsString>,
) -> &'static str
```

Release environment:

```text
MXTERM_CREATE_UPDATER_ARTIFACTS=1
NODE_OPTIONS=--max-old-space-size=4096
TAURI_SIGNING_PRIVATE_KEY=<GitHub Secret, required>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<GitHub Secret, optional>
```

### 3. Contracts

- `get_app_runtime_info` must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!` and exposed through the typed frontend wrapper.
- The serialized `AppRuntimeInfo` uses camelCase. React may also normalize snake_case for compatibility, but Rust should keep `#[serde(rename_all = "camelCase")]`.
- `version` must come from `env!("CARGO_PKG_VERSION")`; do not hard-code it in Rust.
- `repository_url` must be `https://github.com/syscryer/mxterm`. No mirror or alternate release channel should be part of updater runtime metadata.
- Windows checks for `portable.marker` in the executable directory and returns `desktop-portable` when present. Portable builds must not be treated as updater-installable.
- Linux checks the `APPIMAGE` environment variable. A non-empty value returns `desktop-appimage`; otherwise Linux returns `desktop-package`.
- macOS and ordinary Windows installer builds return `desktop-installer`.
- Tauri config must include the GitHub latest endpoint `https://github.com/syscryer/mxterm/releases/latest/download/latest.json` and the updater public key only. Private keys and key passwords must stay in GitHub Secrets or ignored runtime paths.
- GitHub Release workflow may build Windows x64, macOS Apple Silicon, and Linux x64 only. Do not add macOS Intel artifacts or updater metadata without a new task and spec update.
- Release builds must set `NODE_OPTIONS=--max-old-space-size=4096` so the Vite/TypeScript build does not hit the default Node heap limit on GitHub-hosted macOS Apple Silicon runners.
- `latest.json` must include only signed updater-installable artifacts: Windows NSIS `.exe`, macOS Apple Silicon `.app.tar.gz`, and Linux `.AppImage`. Windows portable zip, Linux deb, and Linux rpm are manual-download assets only.

### 4. Validation & Error Matrix

| Condition | Backend / release behavior |
| --- | --- |
| `current_exe()` fails | Return `AppError` code `runtime_info_path_failed`, recoverable. |
| Windows executable directory contains `portable.marker` | Return `desktop-portable`. |
| Windows executable directory has no marker | Return `desktop-installer`. |
| Linux `APPIMAGE` is non-empty | Return `desktop-appimage`. |
| Linux `APPIMAGE` is missing or blank | Return `desktop-package`. |
| macOS build | Return `desktop-installer`. |
| Tag version differs from `package.json`, `src-tauri/Cargo.toml`, or `src-tauri/tauri.conf.json` | Release workflow fails before publishing. |
| `TAURI_SIGNING_PRIVATE_KEY` is missing | Release workflow fails before building updater artifacts. |
| macOS Apple Silicon runner hits Node heap exhaustion during `pnpm build` | Keep or restore `NODE_OPTIONS=--max-old-space-size=4096` in the release workflow. |
| Updater artifact is missing, ambiguous, or has an empty `.sig` | `generate-latest-json.mjs` fails and publish does not run. |

### 5. Good / Base / Bad Cases

- Good: a Windows NSIS install returns `desktop-installer`, updater check is enabled in React, and `latest.json` points to the signed `.exe`.
- Good: a Windows portable zip contains `portable.marker`, returns `desktop-portable`, and the UI directs the user to GitHub Release manual download.
- Good: a Linux AppImage launch has `APPIMAGE=/path/to/mXterm.AppImage`, returns `desktop-appimage`, and `latest.json` points to the signed AppImage.
- Base: a Linux deb/rpm install returns `desktop-package`, so the UI keeps manual update copy visible.
- Bad: Rust infers updater support from OS alone, workflow writes portable zip/deb/rpm into `latest.json`, a private updater key is committed, or release URLs point outside GitHub.

### 6. Tests Required

- Run targeted Rust tests for distribution detection after changing runtime info logic: `cargo test --manifest-path src-tauri/Cargo.toml distribution_mode --lib`.
- Run `pnpm test:release` after changing platform matrix names, asset naming, GitHub repository URL generation, or `latest.json` target selection.
- Run `pnpm check` after changing frontend runtime info types or wrappers.
- Run `git diff --check` and search the working tree for private key material before staging release/updater changes.
- Confirm `.trellis/.runtime/mxterm-updater.key` or any other private key file is ignored and not staged.

### 7. Wrong vs Correct

#### Wrong

```rust
pub fn get_app_runtime_info() -> AppRuntimeInfo {
    AppRuntimeInfo {
        version: "0.1.0".into(),
        repository_url: "https://example.com/mirror".into(),
        distribution_mode: "desktop-installer".into(),
        is_tauri: true,
    }
}
```

#### Correct

```rust
let executable = std::env::current_exe()?;
let executable_dir = executable.parent().unwrap_or_else(|| Path::new("."));
let distribution_mode = detect_distribution_mode(
    std::env::consts::OS,
    executable_dir,
    std::env::var_os("APPIMAGE"),
);
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
10 => "macOS Glass"
```

Frontend string mapping:

```ts
auto = 0
mica = 2
acrylic = 3
micaAlt = 4
macosGlass = 10
```

### 3. Contracts

- All new Tauri commands must be registered in `src-tauri/src/lib.rs` through `tauri::generate_handler!`.
- `WindowMaterial.id` is the only cross-layer machine-readable value; `name` is display/debug metadata and must not be parsed by React.
- Windows support uses DWM `DWMWA_SYSTEMBACKDROP_TYPE`. Keep Windows-only dependencies under `[target.'cfg(windows)'.dependencies]`.
- Windows should expose `auto` on every build and add `mica`, `acrylic`, and `micaAlt` only when the OS build supports DWM system backdrop types.
- macOS should expose `auto` plus `macosGlass`. Both must keep the WebView/window transparent and apply a native `UnderWindowBackground` effect through Tauri; this requires `app.macOSPrivateApi = true` and the `tauri` `macos-private-api` feature.
- Linux/unknown platforms return only `auto` from `get_supported_window_materials` and reject non-`auto` values from `set_window_material`.
- Invalid numeric material ids must be rejected before calling platform APIs.
- Native material failure is recoverable and should return an `AppError` with code `window_material_set_failed`.
- CSS material tokens remain the visual fallback. Backend command failure must not prevent the app from rendering.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| `get_supported_window_materials` on unsupported platform | Returns `[Auto]` | n/a |
| `set_window_material` with `0` on unsupported platform | Returns `Auto` | n/a |
| `set_window_material` with `2`, `3`, `4`, or `10` on unsupported platform | `window_material_set_failed` | true |
| `set_window_material` with `10` on macOS | Applies `UnderWindowBackground` and returns `macOS Glass` | n/a |
| `set_window_material` with any unknown id | `window_material_set_failed` | true |
| Main window handle cannot be resolved | `window_material_set_failed` | true |
| DWM/window effect call fails | `window_material_set_failed` | true |

### 5. Good / Base / Bad Cases

- Good: Windows 11 build supporting DWM backdrop returns ids `0`, `2`, `3`, and `4`; React chooses `mica`, sends `2`, and Rust applies `DWMWA_SYSTEMBACKDROP_TYPE`.
- Good: macOS returns ids `0` and `10`; React chooses `macosGlass`, sends `10`, and Rust applies the native transparent window effect without enabling Windows-only DWM code.
- Good: Linux returns only `auto`; React normalizes a previously saved `mica` setting to `auto` and does not keep retrying unsupported native material.
- Base: browser preview has no Tauri runtime; no backend command is called, and CSS fallback still uses `data-window-material`.
- Bad: backend returns `"Mica"` as the only payload, accepts arbitrary integer ids, registers the command in Rust but not the frontend wrapper, or adds Windows dependencies as unconditional cross-platform dependencies.

### 6. Tests Required

- Run `cargo check --manifest-path src-tauri/Cargo.toml` after changing command registration, material ids, Windows dependencies, or platform modules.
- Run `pnpm check` after changing frontend wrappers or `WindowMaterialMode`.
- Run `npm run build` after changing CSS material tokens or settings UI.
- Run the release-readiness guard that covers platform window config after changing `src-tauri/tauri*.conf.json`.
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

## Scenario: Sync Snapshot Foundation

### 1. Scope / Trigger

- Trigger: backend code adds or changes local sync snapshot export/import, remote sync secret encryption, artifact validation, or backup behavior.
- Source files: `src-tauri/src/sync_snapshot.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/storage_vault.rs`, and future WebDAV transport code that uploads or downloads snapshot artifacts.
- This is a storage/security contract. WebDAV transport must call the snapshot layer instead of serializing SQLite rows or vault files directly.

### 2. Signatures

- `SyncSnapshotService::export_bundle(repository, SyncExportOptions) -> Result<SyncSnapshotBundle, AppError>`
- `SyncSnapshotService::import_bundle(repository, bundle, SyncImportOptions) -> Result<SyncImportResult, AppError>`
- `SyncSnapshotService::decrypt_remote_secrets(manifest, data_json, secrets_enc, sync_password) -> Result<SyncSecretsPlaintext, AppError>`
- `validate_bundle_artifacts(manifest, data_json, remote_secrets_enc) -> Result<(), AppError>`
- `StorageRepository::export_sync_data() -> Result<SyncDataDocument, AppError>`
- `StorageRepository::export_sync_secrets() -> Result<Vec<SyncSecretEntry>, AppError>`
- `StorageRepository::replace_sync_data(document, restore_secret_refs) -> Result<SyncRepositoryImportStats, AppError>`
- `StorageRepository::create_sync_backup() -> Result<(), AppError>`

Snapshot artifacts:

```text
manifest.json
data.json
secrets.enc
```

### 3. Contracts

- `manifest.json` uses `format="mxterm-sync"`, `protocol_version=1`, `db_schema_version`, and per-artifact `sha256` plus `size` metadata.
- `data.json` stores non-sensitive sync data only: connections, credentials, known_hosts, tunnels, connection_groups, and a whitelisted settings object.
- `data.json` may store cross-device `secret_slot_id`, but must not store local `secret_ref`, plaintext passwords, private-key passphrases, or the local vault account name.
- Remote `secrets.enc` is not the local `secrets.enc` vault file. It is a sync artifact encrypted from `SyncSecretsPlaintext` using the user-supplied sync password.
- Remote secret encryption is Argon2id + AES-256-GCM. AAD is `format|protocol_version|snapshot_id|data_hash`, binding `secrets.enc` to the manifest snapshot and `data.json` hash.
- Import without a sync password imports `data.json`, skips secret restoration, returns `secrets_skipped=true`, and leaves local secret refs empty so connection resolution fails with existing `secret_missing` behavior instead of inventing credentials.
- Import with a sync password decrypts `secrets.enc`, writes local vault entries by `secret_slot_id`, then restores SQLite secret refs from those slot ids.
- Import creates local backups before replacing data. The current backup root is under app data `backups/sync/latest/` and contains `mxterm.db` plus local `secrets.enc` when present.
- Snapshot import replaces the sync scope in a SQLite transaction. On failure, rollback must keep previous SQLite rows visible.
- WebDAV v1 must upload/download the artifact set and must not sync `secrets.local.key`, terminal output, active transfer state, cache files, or private-key file contents.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Unsupported format/protocol/schema or malformed data | `sync_snapshot_incompatible` | true |
| Artifact byte length does not match manifest | `sync_snapshot_size_mismatch` | true |
| Artifact SHA256 does not match manifest | `sync_snapshot_hash_mismatch` | true |
| Remote `secrets.enc` cannot decrypt with provided sync password | `sync_snapshot_secret_decrypt_failed` | true |
| Local backup directory or file copy fails | `sync_snapshot_backup_failed` | true |
| SQLite replacement fails after backup | `sync_snapshot_import_failed` | true |
| Snapshot serialization/encryption preparation fails | `sync_snapshot_serialize_failed` | true |

### 5. Good / Base / Bad Cases

- Good: exporting an inline-password connection produces `data.json` with the connection shape and `inline_secret_slot_id`, while `secrets.enc` does not contain the plaintext password as readable text.
- Good: a wrong sync password returns `sync_snapshot_secret_decrypt_failed` and does not import half of the snapshot.
- Good: importing with no sync password restores non-sensitive rows and reports `secrets_skipped=true`.
- Good: importing with the sync password restores local vault secrets by `secret_slot_id`, then saved connection resolution reads the restored secret through `StorageRepository`.
- Base: a snapshot may omit `secrets.enc` when the export intentionally contains data only.
- Bad: WebDAV uploads the local vault file, syncs `secrets.local.key`, writes `secret_ref` into `data.json`, or hides a failed import by clearing the UI list.

### 6. Tests Required

- Unit-test that `data.json` excludes `secret_ref`, plaintext passwords, private-key passphrases, and local vault account strings.
- Unit-test that remote `secrets.enc` does not contain plaintext secrets and rejects a wrong sync password.
- Unit-test manifest size and SHA256 mismatch failures.
- Unit-test import without sync password: rows import, secrets are skipped, and result reports `secrets_skipped=true`.
- Unit-test import with sync password: local vault secrets restore by `secret_slot_id` and saved connection resolution succeeds.
- Unit-test import failure after backup: previous SQLite rows remain available and a backup exists.
- Run `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`, `cargo test --manifest-path src-tauri/Cargo.toml storage_repository --lib`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, and `cargo check --manifest-path src-tauri/Cargo.toml` after changing this area.

### 7. Wrong vs Correct

#### Wrong

```rust
let remote_secrets = std::fs::read(app_data.join("secrets.enc"))?;
webdav.put("secrets.enc", remote_secrets).await?;
```

This uploads the local vault artifact and risks coupling cloud sync to a device-local key model.

#### Correct

```rust
let bundle = SyncSnapshotService::export_bundle(&repository, options)?;
webdav.put("manifest.json", bundle.manifest_json).await?;
webdav.put("data.json", bundle.data_json).await?;
if let Some(secrets) = bundle.remote_secrets_enc {
    webdav.put("secrets.enc", secrets).await?;
}
```

The transport only moves snapshot artifacts produced by the sync layer; it never reads SQLite or vault files directly.

## Scenario: RDP Connection Runner Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes RDP connection persistence, runner probing, `.rdp` generation, launch lifecycle, native-host events, or `rdp_*` Tauri commands.
- Source files: `src-tauri/src/connections/mod.rs`, `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/rdp.rs`, `src-tauri/src/events.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, and `src/shared/tauri/commands.ts`.
- This is a cross-layer storage/command boundary because Rust owns the protocol discriminator, RDP config shape, validation, runner selection, and redaction rules while React only renders forms and session state.

### 2. Signatures

```rust
rdp_launch_connection(app: AppHandle, manager: State<'_, RdpSessionManager>, request: RdpConnectionRequest) -> Result<RdpLaunchResult, AppError>
rdp_preview_launch(app: AppHandle, request: RdpConnectionRequest) -> Result<RdpLaunchPreview, AppError>
rdp_test_runner(request: RdpRunnerProbeRequest) -> Result<RdpRunnerProbeResult, AppError>
rdp_close_session(manager: State<'_, RdpSessionManager>, request: RdpSessionRequest) -> Result<RdpSessionCloseResult, AppError>
rdp_reveal_session(manager: State<'_, RdpSessionManager>, request: RdpSessionRequest) -> Result<RdpSessionRevealResult, AppError>
rdp_resize_embedded_session(manager: State<'_, RdpSessionManager>, request: RdpResizeRequest) -> Result<RdpSessionResizeResult, AppError>
```

Native-host user closes emit `rdp:session_closed` with:

```rust
RdpSessionClosedEvent {
    session_id: String,
}
```

`RdpConnectionRequest` fields:

```rust
connection_id: String
bounds?: RdpEmbeddedBounds
```

`RdpEmbeddedBounds` is the frontend-measured host area in physical pixels:

```rust
x: i32
y: i32
width: u32
height: u32
```

`ConnectionProfileInput` and `ConnectionProfile` include `protocol = "ssh" | "rdp"`. RDP payloads carry `rdp: RdpConnectionConfig` with display, resources, gateway, RemoteApp, performance, security, runner, and raw advanced settings.

### 3. Contracts

- `StorageRepository` must persist `protocol` and `rdp_json` for RDP rows and default legacy rows to `ssh`.
- SSH-only code paths must reject RDP rows. RDP connections must not be resolved through SSH terminal/files/monitor/tunnels/Docker/Command Sender paths.
- `rdp_preview_launch` must return redacted preview data only. It may expose runner kind, executable path, args, and `.rdp` content, but not plaintext secrets.
- `rdp_launch_connection` must select the runner deterministically by platform and config, then return a result that the UI can render as embedded, native-window, or external launch state.
- Windows ActiveX v1 uses a manager-owned native RDP host window: create one owned top-level Win32 host window, reuse it for later ActiveX sessions, and expose native tabs inside that window for multiple RDP connections. Configure each MSTSC ActiveX COM object directly and keep runtime host/control HWNDs in `RdpSessionManager`. This path intentionally does not promise WebView/DOM painting because WebView composition can occlude child windows. Return `runner = "mstsc_activex"` with `embedded = false` and a fallback/status reason so the frontend renders a native-window session status instead of a DOM embedded placeholder. `rdp_close_session` must close the matching native tab/session while keeping the shared host window alive when other RDP sessions remain. When the user closes a native-host tab or the whole native-host window directly, Rust must emit `rdp:session_closed` for each affected backend `session_id` so React can remove the matching runtime tab without guessing from connection ids.
- `rdp_reveal_session` targets the existing manager-owned native host only. For a managed Windows ActiveX session, it must activate the matching native tab, restore the host window if minimized, and bring that independent top-level RDP host to the foreground. Unknown/non-hosted sessions return a recoverable failure result instead of launching anything new.
- Classic MSTSC ActiveX fallback must prefer NotSafeForScripting-compatible registrations such as `MsTscAx.MsTscAx.13`, `MsTscAx.MsTscAx.12`, `MsTscAx.MsTscAx.11`, `MsTscAx.MsTscAx.10`, and `MsTscAx.MsTscAx.9` before ordinary `MsRDP.MsRDP.*` controls. This matches the desktop-hosted MSTSC control family that supports full COM configuration and in-memory password handoff. A control is usable only after creation and required configuration both succeed; if a candidate creates successfully but rejects required properties, destroy that child window and try the next candidate instead of immediately falling back to external `mstsc.exe`.
- Classic MSTSC ActiveX fallback must configure through stable DISPIDs from the MSTSC type library (`Server=1`, `Domain=2`, `UserName=3`, `DesktopWidth=12`, `DesktopHeight=13`, `ColorDepth=100`, `AdvancedSettings9=701`, `TransportSettings4=800`, `Connect=30`, `Disconnect=31`) instead of first resolving member names with `IDispatch::GetIDsOfNames`. Some hosts expose the working dual interface but fail name lookup for `Server`, causing false fallback to external `mstsc.exe`.
- RDP credentials may use `credential_mode=prompt`, `credential_mode=inline` with `inline_auth_kind=password`, or `credential_mode=saved` with a password credential. RDP must reject private-key credentials. Inline/saved passwords are resolved through the existing encrypted vault and may be passed only in memory to Windows classic MSTSC ActiveX through `IMsTscNonScriptable.ClearTextPassword`; external runners and generated `.rdp` files must still omit plaintext passwords.
- Windows embedded saved-password direct-connect must configure prompt suppression through the MSTSC NonScriptable interfaces around the password handoff: `IMsRdpClientNonScriptable3.PromptForCredentials=false`, `WarnAboutSendingCredentials=false`, `EnableCredSspSupport` according to NLA, `IMsRdpClientNonScriptable4.PromptForCredsOnClient=false`, `AllowCredentialSaving=false`, and `IMsRdpClientNonScriptable5.AllowPromptingForCredentials=false`. Do not treat `IDispatch` property writes or `AdvancedSettings.ClearTextPassword` as the authoritative password path.
- `RdpSessionManager` owns runtime hosted-window state only. It stores session id -> shared host HWND/control HWND/process/temp file metadata plus a transient native-host command channel so close and resize commands can target the native host. Do not persist these runtime ids on `ConnectionProfile`.
- The shared native host window should persist its own size/position/maximized state separately from the main window so reopening a hosted RDP session restores the last host window geometry.
- `rdp_resize_embedded_session` should apply viewport changes only for a future true DOM-embedded session or explicit native host bounds. For the current manager-owned native ActiveX window, the native host owns ordinary drag/resize behavior and must synchronize the active tab's MSTSC control size, remote desktop resolution, and host DPI scale on `WM_SIZE` / `WM_DPICHANGED`. Initial ActiveX configuration for dynamic-resize sessions must seed `DesktopWidth` / `DesktopHeight` from the native host content area before `Connect()`, then retry display sync briefly during the login phase because early `UpdateSessionDisplaySettings` calls can be ignored until the remote session is ready. External sessions return a non-applied result because the external client owns its window.
- `rdp_close_session` should post a close request to manager-owned ActiveX windows and remove generated temp files when possible. External sessions remain user-managed.
- Windows ActiveX support may fall back to `.rdp` plus external `mstsc.exe` when ActiveX hosting is unavailable or unstable.
- Linux/macOS runner selection may use external/custom executables, but must never pass plaintext passwords in process arguments.
- RDP certificate policy must map to mstsc `authentication level` explicitly: `trust` -> `0` (continue without warning), `prompt` -> `2` (warn and allow continue, default), `strict` -> `1` (fail on verification problems).
- A valid RDP profile must still be usable even when the current platform has no compatible runner; the UI should get setup diagnostics instead of losing the saved connection.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| `protocol` blank or unknown | default to `ssh` during legacy migration, reject unknown values on new writes | true |
| RDP host missing | `connection_host_missing` | true |
| RDP username missing | `connection_username_missing` | true |
| RDP port invalid | `connection_port_invalid` | true |
| RDP `.rdp` / runner text field contains control characters | `rdp_field_invalid` / `rdp_runner_args_invalid` | true |
| RDP raw `.rdp` contains invalid control data or secret-like password lines | reject the payload | true |
| No runner available | return setup hint or fallback reason, not a silent failure | true |
| Embedded launch unsupported | fall back to external launch path when possible | true |
| Optional embedded bounds are missing or too small | current native ActiveX host window chooses a safe default size; future true DOM-embedded mode may return a non-applied resize result | true |
| ActiveX host/control cannot be created after launch | fall back to external `mstsc.exe`, return `embedded=false` with fallback reason, and leave the external client visible | true |
| Resize targets a non-managed session id | return `applied=false` instead of failing the caller | true |

### 5. Good / Base / Bad Cases

- Good: `connection_upsert` stores `protocol = "rdp"` with a fully populated RDP config and leaves SSH-only fields untouched or cleared as appropriate.
- Good: `rdp_preview_launch` returns a redacted `.rdp` preview and no plaintext password material.
- Good: Windows ActiveX launch creates or reuses a manager-owned native host window with native tabs, puts each MSTSC ActiveX control in its own tab, returns `runner = "mstsc_activex"` and `embedded = false` so the frontend shows native-window status, and records the host/control HWND in `RdpSessionManager` for close lifecycle.
- Good: classic MSTSC ActiveX configuration writes required properties by fixed DISPID, records the selected control name in error context when configuration or connect fails, and continues to later registered candidates when an earlier control cannot be configured.
- Good: saved inline/account RDP passwords resolve from the vault, set `ClearTextPassword` through `IMsTscNonScriptable`, and suppress native credential prompts through NonScriptable3/4/5 before `Connect()`.
- Good: Windows ActiveX launch falls back to a generated temporary `.rdp` file and visible external `mstsc.exe` window when ActiveX hosting is unavailable.
- Good: closing one RDP tab from React calls `rdp_close_session` and closes only that manager-owned native ActiveX tab/session; the shared native host stays open while other RDP sessions remain. Closing a native tab/window from the Win32 chrome emits `rdp:session_closed` so React removes the matching runtime tab and the backend manager can release stale session state. Native window drag/resize and DPI changes update the active tab's control bounds and remote display settings without DOM-bound resize synchronization; first launch already uses the host content size and login-phase resize retries so users do not need to drag the window once to correct stretching.
- Good: default RDP certificate policy serializes to `authentication level:i:2`, not `i:1`, so self-signed certificates show a continuable mstsc warning instead of a hard failure dialog.
- Base: Linux/macOS can keep the saved RDP profile valid even if only external/custom runner support exists.
- Bad: backend code passes `password` or `private_key_passphrase` in command-line args, writes a plaintext password into `.rdp`, resolves an RDP row through SSH-only terminal helpers, accepts a private-key credential for RDP, stores hosted HWND/session ids in persistent connection data, tells the frontend a DOM-embedded surface is active when the ActiveX host is actually a separate native window, depends on `GetIDsOfNames("Server")` before setting classic MSTSC ActiveX connection fields, writes only `AdvancedSettings.ClearTextPassword`, or treats ActiveX creation alone as success before the required connection properties are accepted.

### 6. Tests Required

- Run `cargo test --manifest-path src-tauri/Cargo.toml connections --lib`, `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`, `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`, and `cargo check --manifest-path src-tauri/Cargo.toml` after changing this area.
- Add/update tests for protocol migration, `rdp_json` persistence, RDP redacted preview, and SSH-only guardrails.
- Add/update tests for mstsc certificate policy serialization: `trust -> authentication level:i:0`, `prompt -> authentication level:i:2`, and `strict -> authentication level:i:1`.
- Cross-check Rust request/response field names against the typed wrappers in `src/shared/tauri/commands.ts`.
- Manual Windows smoke test hosted mode after native-host changes: create/open an embedded-preferred RDP session with a vault-backed password, verify the MSTSC ActiveX native host window appears, verify the fallback reason no longer reports `Server` member lookup failure, verify no Windows Security password dialog appears for a valid saved password, open a second RDP connection and verify it appears as a second native tab in the same host window, drag/resize the host window and verify the active remote desktop resizes with host DPI scaling, close one RDP tab and verify other hosted sessions remain, then close the final tab and verify no orphan hosted window remains.

### 7. Wrong vs Correct

#### Wrong

```rust
let command = format!("xfreerdp /v:{} /u:{} /p:{}", host, username, password);
```

#### Correct

```rust
let preview = build_rdp_preview(&connection)?;
let result = launch_rdp(&app, &connection, runner)?;
```

#### Wrong

```rust
// A close command cannot target the ActiveX window after launch because
// the hosted HWND was never registered.
let session_id = format!("rdp-{}", uuid::Uuid::new_v4());
```

#### Correct

```rust
manager.insert(session_id.clone(), ManagedRdpSession { hwnd, parent_hwnd, process_id, cleanup_path, embedded: true })?;
```

#### Wrong

```rust
// This makes self-signed server certificates fail without a continue option.
RdpCertificatePolicy::Prompt => 1
```

#### Correct

```rust
RdpCertificatePolicy::Trust => 0,
RdpCertificatePolicy::Prompt => 2,
RdpCertificatePolicy::Strict => 1,
```

The backend owns redaction and launch transport; the client never receives or passes plaintext credentials through command arguments.

## Scenario: VNC Connection Runner Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes VNC connection persistence, runner probing, local WebSocket bridge lifecycle, external viewer launch, or `vnc_*` Tauri commands.
- Source files: `src-tauri/src/connections/mod.rs`, `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/vnc.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, and `src/shared/tauri/commands.ts`.
- This is a cross-layer storage/command boundary because Rust owns the protocol discriminator, VNC config shape, validation, bridge lifecycle, credential resolution, runner selection, and redaction rules while React renders forms and runtime session state.

### 2. Signatures

```rust
vnc_launch_connection(app: AppHandle, manager: State<'_, VncSessionManager>, request: VncConnectionRequest) -> Result<VncLaunchResult, AppError>
vnc_preview_launch(app: AppHandle, request: VncConnectionRequest) -> Result<VncLaunchPreview, AppError>
vnc_test_runner(request: VncRunnerProbeRequest) -> Result<VncRunnerProbeResult, AppError>
vnc_close_session(manager: State<'_, VncSessionManager>, request: VncSessionRequest) -> VncSessionCloseResult
```

`VncConnectionRequest` fields:

```rust
connection_id: String
```

`ConnectionProfileInput` and `ConnectionProfile` include `protocol = "ssh" | "rdp" | "vnc"`. VNC payloads carry `vnc: VncConnectionConfig` with display, input, performance, security, runner, and raw runner settings.

### 3. Contracts

- `StorageRepository` must persist `protocol` and `vnc_json` for VNC rows and default legacy rows to `ssh`.
- SSH-only code paths must reject VNC rows. VNC connections must not be resolved through SSH terminal/files/monitor/tunnels/Docker/Command Sender paths.
- `vnc_preview_launch` must return redacted preview data only. It may expose runner kind, executable path, redacted args, and an illustrative local WebSocket shape, but not plaintext secrets or live bridge tokens.
- `vnc_launch_connection` must select the runner deterministically from the saved VNC config and platform capabilities.
- `VncRenderMode::Embedded` and `VncRenderMode::Windowed` both select the built-in noVNC bridge runner. The difference is frontend presentation only; Rust still returns `runner = "novnc"` and `embedded = true`.
- Embedded/windowed VNC uses a Rust-owned local WebSocket-to-TCP bridge for noVNC. The bridge must bind only to `127.0.0.1`, use a per-session tokenized path, relay binary WebSocket frames to the target VNC TCP socket, and stop when `vnc_close_session` aborts the managed bridge task.
- The noVNC bridge should be tuned for local-network responsiveness: connect to the target with an explicit short timeout, set `TCP_NODELAY` on both browser-side and target-side TCP streams, and use a larger target-read buffer than the 8KB baseline so framebuffer updates are not split into excessive WebSocket frames.
- Backend VNC performance defaults must match the frontend LAN-oriented `auto` preset (`quality_level=7`, `compression_level=0`) so missing or legacy config fields do not silently reintroduce high-compression latency.
- Bridge URLs and tokens are runtime-only data. Do not persist them to SQLite, sync snapshots, MCP output, logs, or connection profiles.
- VNC credentials may use `credential_mode=prompt`, `credential_mode=inline` with password auth, or `credential_mode=saved` with a password credential. VNC must reject private-key credentials.
- Inline/saved passwords are resolved through the existing encrypted vault and may be returned only as launch-time in-memory data for embedded noVNC. External/custom runners must not receive plaintext passwords in process arguments, environment variables, temp files, logs, or generated previews.
- External/custom viewer launch may pass host/port plus non-secret viewer flags only. Password entry remains the external viewer's responsibility until a platform-secure handoff contract exists.
- A valid VNC profile must remain usable even when the current platform has no compatible external viewer; embedded noVNC is the preferred path and external viewer absence should surface as diagnostics only when external/custom mode is requested.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| `protocol` blank or unknown | default to `ssh` during legacy migration, reject unknown values on new writes | true |
| VNC host missing | `connection_host_missing` | true |
| VNC username missing | `connection_username_missing` | true |
| VNC port invalid | `connection_port_invalid` | true |
| VNC runner text field contains control characters | `vnc_runner_args_invalid` / `vnc_field_invalid` | true |
| VNC raw runner args contain secret-like password material | reject the payload | true |
| VNC operation targets an SSH/RDP row | `vnc_protocol_required` | true |
| Embedded bridge bind fails | `vnc_bridge_bind_failed` | true |
| WebSocket path/token mismatch | reject the handshake without opening the target TCP socket | true |
| Target VNC TCP connection times out | `vnc_target_connect_timeout` | true |
| Target VNC TCP connection fails | `vnc_target_connect_failed` | true |
| External/custom runner missing | `vnc_runner_missing` / `vnc_custom_runner_missing` | true |

### 5. Good / Base / Bad Cases

- Good: `connection_upsert` stores `protocol = "vnc"` with a fully populated VNC config and clears SSH-only network path assumptions.
- Good: embedded launch creates a tokenized local bridge, returns `runner = "novnc"`, `embedded = true`, and returns a password only when the saved profile resolves one from the vault.
- Good: windowed launch follows the same backend result shape as embedded launch; frontend-owned runner-host events decide where to mount noVNC.
- Good: `vnc_close_session` aborts the matching bridge task and leaves unrelated VNC/RDP/SSH sessions alone.
- Good: external preview and launch arguments contain host/port and non-secret flags only.
- Base: external viewer mode can fail with a setup hint while the saved VNC profile remains valid.
- Bad: backend code passes VNC passwords through command-line args/env/temp files, writes bridge URLs to persistent data, resolves a VNC row through SSH-only helpers, accepts private-key credentials for VNC, or logs live bridge tokens.

### 6. Tests Required

- Run `cargo test --manifest-path src-tauri/Cargo.toml connections --lib`, `cargo test --manifest-path src-tauri/Cargo.toml storage_sqlite --lib`, `cargo test --manifest-path src-tauri/Cargo.toml storage_repository --lib`, `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`, `cargo test --manifest-path src-tauri/Cargo.toml vnc --lib`, and `cargo check --manifest-path src-tauri/Cargo.toml` after changing this area.
- Add/update tests for protocol migration, `vnc_json` persistence, saved-password resolution, VNC redacted preview, raw runner validation, and SSH-only guardrails.
- Cross-check Rust request/response field names against the typed wrappers in `src/shared/tauri/commands.ts`.

## Scenario: WebDAV Sync Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes WebDAV sync settings, transport behavior, snapshot upload/download orchestration, or `webdav_*` Tauri commands.
- Source files: `src-tauri/src/webdav.rs`, `src-tauri/src/webdav_sync.rs`, `src-tauri/src/sync_snapshot.rs`, `src-tauri/src/storage_repository.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/settings/WebDavSyncSettingsSection.tsx`.
- This is a cross-layer storage and secret boundary: Rust owns WebDAV credentials, snapshot artifacts, sync locking, and import/export validation; React owns form state and confirmation UI only.

### 2. Signatures

```rust
webdav_settings_get(app: AppHandle) -> Result<WebDavSettings, AppError>
webdav_settings_save(app: AppHandle, request: WebDavSettingsInput) -> Result<WebDavSettings, AppError>
webdav_test_connection(app: AppHandle, request: Option<WebDavSettingsInput>) -> Result<WebDavTestResult, AppError>
webdav_fetch_remote_info(app: AppHandle) -> Result<WebDavRemoteInfo, AppError>
webdav_upload_snapshot(app: AppHandle, manager: State<WebDavSyncManager>, request: WebDavUploadRequest) -> Result<WebDavSyncResult, AppError>
webdav_download_snapshot(app: AppHandle, manager: State<WebDavSyncManager>, request: WebDavDownloadRequest) -> Result<WebDavSyncResult, AppError>
```

Request fields:

```rust
WebDavSettingsInput {
    enabled: bool,
    base_url: String,
    username: Option<String>,
    password: Option<String>,
    password_touched: bool,
    remote_root: String,
    profile: String,
}

WebDavUploadRequest {
    sync_password: Option<String>,
    device_id: Option<String>,
    device_name: Option<String>,
}

WebDavDownloadRequest {
    sync_password: Option<String>,
}
```

### 3. Contracts

- WebDAV settings are stored under `app_settings` key `webdav.sync.default`; the WebDAV login password is stored through the local vault reference `webdav:<profile>:password`.
- `WebDavSettings.password_saved` is metadata only. Commands must never return the WebDAV password, sync password, SSH password, private-key passphrase, or a URL containing credentials/query secrets.
- `password_touched=false` with a blank or omitted password preserves the existing vault password. `password_touched=true` with a blank password deletes the saved WebDAV password.
- The sync master password is per upload/download request only. It must not be stored in `app_settings`, localStorage, logs, command responses, or the WebDAV settings password slot.
- WebDAV transport moves only artifacts produced by `SyncSnapshotService`: `data.json`, optional `secrets.enc`, and `manifest.json`. It must not read SQLite tables directly or upload the local vault file.
- Upload must ensure the remote collection first, then PUT `data.json`, optional `secrets.enc`, and `manifest.json` last.
- Download must fetch and validate `manifest.json` before downloading data or secrets. Incompatible manifests return `sync_snapshot_incompatible` and must not call import.
- Upload and download are mutually exclusive through `WebDavSyncManager`; a second operation returns `webdav_sync_locked`.
- Tauri command handlers must not hold `StorageRepository` across `.await`; load settings / prepare artifacts before network awaits, then reopen the repository for import or success metadata.
- `webdav_test_connection` may accept unsaved settings input for pre-save testing. It must still honor `password_touched` semantics and use a saved password only when the input does not override it.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Enabled settings with blank `base_url` | `webdav_settings_invalid` | true |
| Invalid profile path characters | `webdav_settings_invalid` | true |
| Username is set but no WebDAV password is available | `webdav_password_missing` | true |
| WebDAV request fails or returns an unexpected status | `webdav_connection_failed` / `webdav_http_status` | true |
| Remote `manifest.json` is absent during download | `webdav_remote_empty` | true |
| Upload/download already running | `webdav_sync_locked` | true |
| Response body exceeds the configured artifact limit | `webdav_response_too_large` | true |
| Upload contains secrets but no sync password was supplied | `webdav_sync_password_missing` | true |

### 5. Good / Base / Bad Cases

- Good: saving settings with an untouched password field updates URL/user/root/profile but keeps the existing vault password.
- Good: uploading a snapshot with saved SSH secrets requires a sync master password, writes remote `secrets.enc`, and PUTs `manifest.json` last.
- Good: downloading without a sync master password imports non-sensitive data and reports `secrets_skipped=true` through the snapshot layer.
- Base: remote info returns `exists=false` when `manifest.json` is missing, allowing the UI to show an empty remote state.
- Bad: WebDAV sync writes plaintext passwords into SQLite, uploads the local `secrets.enc` vault, logs full URLs with credentials, or lets two uploads/downloads run concurrently.

### 6. Tests Required

- Unit-test URL path encoding, URL redaction, Basic Auth header creation, MKCOL conflict verification, and oversized GET rejection in `webdav.rs`.
- Unit-test `password_touched` preserve/delete behavior, upload PUT order, sync lock rejection, and incompatible manifest rejection in `webdav_sync.rs`.
- Run `cargo test --manifest-path src-tauri/Cargo.toml webdav --lib`, `cargo test --manifest-path src-tauri/Cargo.toml webdav_sync --lib`, `cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot --lib`, and `cargo check --manifest-path src-tauri/Cargo.toml` after changing this area.
- Cross-check command registration in `src-tauri/src/lib.rs`, Rust command signatures in `src-tauri/src/commands.rs`, and typed wrappers in `src/shared/tauri/commands.ts` in the same task.

### 7. Wrong vs Correct

#### Wrong

```rust
let vault_file = app_data.join("secrets.enc");
client.put(&["secrets.enc".to_string()], std::fs::read(vault_file)?, "application/octet-stream").await?;
```

#### Correct

```rust
let prepared = prepare_upload_snapshot(&repository, request, &now)?;
manager.upload_prepared_snapshot(&client, &settings, prepared).await?;
```

The WebDAV layer transports snapshot artifacts only; the snapshot layer owns encryption, validation, and import/export behavior.

## Scenario: Network Diagnostics Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes remote network diagnostics, the `network_diagnostic_run` Tauri command, command construction, or network diagnostic request/result structs.
- Source files: `src-tauri/src/network_tools.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/tools/dockerTypes.ts`.
- Network diagnostics are read-only remote commands executed through a saved SSH connection id. They must not accept dynamic plaintext credential fields.

### 2. Signatures

- `network_diagnostic_run(app: AppHandle, manager: State<NetworkDiagnosticSessionManager>, request: NetworkDiagnosticRequest) -> Result<NetworkDiagnosticResult, AppError>`

`NetworkDiagnosticRequest` fields:

```rust
connection_id: String
kind: NetworkDiagnosticKind // "ping" | "tcp" | "dns" | "trace" | "http"
target: String
port: Option<u16>
```

`NetworkDiagnosticResult` serializes to React as:

```rust
kind: NetworkDiagnosticKind
target: String
command_label: String
ok: bool
exit_status: Option<i32>
duration_ms: u64
summary: String
stdout: String
stderr: String
```

### 3. Contracts

- `network_diagnostic_run` must resolve the saved connection through `resolve_saved_connection(app, connection_id, None)` and execute through `NetworkDiagnosticSessionManager`, an alias of `RemoteExecSessionPool`.
- The frontend sends only a saved `connection_id` plus diagnostic parameters. Rust owns connection resolution and command construction.
- User-controlled targets must be trimmed, validated as nonblank, and passed through `quote_posix_shell` or as positional shell arguments. Do not concatenate unquoted target text into a shell script body.
- Supported remote command strategy:
  - Ping: `ping` with finite count and timeout.
  - TCP: `nc -vz` when available; fallback to bash `/dev/tcp`.
  - DNS: `dig +short`, fallback to `nslookup`, then `getent hosts`.
  - Trace: `tracepath`, fallback to `traceroute`.
  - HTTP: `curl -I -L --max-time`; targets without `http://` or `https://` default to `https://`.
- Each diagnostic command must have a remote timeout so missing tools or hung routes do not block the UI indefinitely.
- Remote non-zero exits should return `NetworkDiagnosticResult { ok: false, stdout, stderr, exit_status }` instead of converting every failed probe into an `AppError`. Validation and SSH/session failures still return `AppError`.
- Read-only diagnostics may use `RemoteExecRetry::ReconnectOnce` for stale cached SSH exec sessions.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| Blank connection id | `network_connection_missing` | true |
| Blank target | `network_diagnostic_target_missing` | true |
| TCP port is missing or invalid | `network_diagnostic_port_invalid` | true |
| Saved connection cannot resolve or SSH exec fails | Propagate existing SSH / storage `AppError` | varies |
| Remote diagnostic exits non-zero | Return result with `ok=false`, stdout/stderr, and exit status | n/a |

### 5. Good / Base / Bad Cases

- Good: `network_diagnostic_run` receives `connection_id`, resolves the saved SSH config, quotes every target, runs the diagnostic with a timeout, and returns structured stdout/stderr.
- Good: TCP fallback passes host and port as shell arguments before using `/dev/tcp/$1/$2`, rather than embedding the target directly into the script.
- Base: a host without `dig` can still resolve through `nslookup` or `getent hosts`; a host without trace tools returns `ok=false` with the remote error text.
- Bad: a command accepts SSH password fields, manually reimplements connection resolution, appends an unquoted target to shell, or treats non-zero ping/traceroute exits as missing UI data.

### 6. Tests Required

- Unit-test `build_diagnostic_command` for ping quoting, TCP fallback, DNS fallback, trace fallback, HTTP `https://` normalization, and TCP port validation.
- Run `cargo test --manifest-path src-tauri/Cargo.toml network_tools --lib` after changing diagnostic command construction or validation.
- Run `cargo check --manifest-path src-tauri/Cargo.toml` after adding or changing command registration, request/result structs, or manager state.
- Cross-check backend request/response field names with `src/features/tools/dockerTypes.ts` and `src/shared/tauri/commands.ts`.

### 7. Wrong vs Correct

#### Wrong

```rust
let command = format!("ping -c 4 {}", request.target);
```

#### Correct

```rust
let command = format!(
    "timeout 12 ping -c 4 -W 2 {}",
    quote_posix_shell(target),
);
```

## Scenario: Docker Toolbox Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes Docker toolbox commands, Docker CLI parsing, Docker command registration, or the SSH exec path used by Docker tools.
- Source files: `src-tauri/src/docker_tools.rs`, `src-tauri/src/remote_exec_pool.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/tools/dockerTypes.ts`.
- Docker toolbox is a remote SSH utility. It executes the remote `docker` CLI through the saved connection resolution path and does not connect to Docker TCP API or a local Docker socket.

### 2. Signatures

```rust
docker_list_containers(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerConnectionRequest) -> Result<Vec<DockerContainerSummary>, AppError>
docker_list_images(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerConnectionRequest) -> Result<Vec<DockerImageSummary>, AppError>
docker_container_action(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerContainerActionRequest) -> Result<DockerActionResult, AppError>
docker_container_logs(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerContainerLogsRequest) -> Result<DockerLogsResult, AppError>
docker_container_logs_start(app: AppHandle, manager: State<DockerLogStreamManager>, request: DockerContainerLogsStartRequest) -> Result<(), AppError>
docker_container_logs_stop(manager: State<DockerLogStreamManager>, request: DockerContainerLogsStopRequest) -> Result<(), AppError>
docker_container_logs_save(request: DockerContainerLogsSaveRequest) -> Result<(), AppError>
docker_container_inspect(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerContainerInspectRequest) -> Result<DockerContainerDetail, AppError>
docker_container_update_restart_policy(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerContainerRestartPolicyRequest) -> Result<DockerActionResult, AppError>
docker_list_networks(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerConnectionRequest) -> Result<Vec<DockerNetworkSummary>, AppError>
docker_container_connect_network(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerNetworkConnectRequest) -> Result<DockerActionResult, AppError>
docker_image_pull(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerImagePullRequest) -> Result<DockerActionResult, AppError>
docker_image_remove(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerImageRemoveRequest) -> Result<DockerActionResult, AppError>
docker_engine_status(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerConnectionRequest) -> Result<DockerEngineStatus, AppError>
docker_engine_action(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerEngineActionRequest) -> Result<DockerActionResult, AppError>
docker_engine_read_config(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerEngineConfigRequest) -> Result<DockerEngineConfigResult, AppError>
docker_engine_save_config(app: AppHandle, manager: State<DockerExecSessionManager>, request: DockerEngineSaveConfigRequest) -> Result<DockerActionResult, AppError>
```

`DockerImagePullRequest` accepts optional `pull_id` generated by the frontend for progress correlation. During pull, Rust emits `docker:image_pull_progress` with:

```rust
DockerImagePullProgressEvent {
    pull_id: String,
    connection_id: String,
    image: String,
    status: String, // running | success | failed
    message: String,
    percent: Option<u8>,
    current_layer: Option<String>,
}
```

`DockerContainerLogsStartRequest` starts a live log stream correlated by a frontend-generated `stream_id`. During streaming, Rust emits `docker:log_stream` with:

```rust
DockerLogStreamEvent {
    stream_id: String,
    connection_id: String,
    container_id: String,
    kind: String, // chunk | error | finished
    content: Option<String>,
    message: Option<String>,
}
```

`DockerContainerLogsSaveRequest` writes the already-buffered frontend log text to a user-selected local path:

```rust
DockerContainerLogsSaveRequest {
    local_path: String,
    content: String,
}
```

`DockerImageRunRequest` starts a detached container from an image:

```rust
DockerImageRunRequest {
    connection_id: String,
    image: String,
    name: Option<String>,
    command: Option<String>,
    entrypoint: Option<String>,
    network: Option<String>,
    restart_policy: Option<DockerRestartPolicyKind>,
    privileged: bool,
    ports: Vec<DockerImageRunPort>,
    env: Vec<DockerImageRunKeyValue>,
    volumes: Vec<DockerImageRunVolume>,
}
```

### 3. Contracts

- Docker commands accept a saved `connection_id` only. They must not accept SSH passwords, private-key passphrases, proxy passwords, or raw SSH target fields.
- Commands must call `resolve_saved_connection(app, connection_id, None)` and execute through `DockerExecSessionManager`, backed by `RemoteExecSessionPool`, so proxy, SSH jump, known-host verification, vault secrets, and timeouts match terminal/remote-file behavior without creating a fresh SSH exec connection for every Docker command.
- `RemoteExecSessionPool` caches sessions by saved `connection_id`, validates `ResolvedSshConfig::signature()` before reuse, expires idle sessions, tracks in-flight commands, and invalidates cached sessions after SSH exec failures. Idle cleanup must not close a session while a command such as `docker pull` is still running.
- Read-only Docker commands may reconnect and retry once when a cached SSH exec session is stale: container list, image list, container logs, container inspect, network list, engine status, and engine config read. Side-effecting commands must not auto-retry after an exec failure: container start/stop/restart/remove, restart-policy update, network connect, image pull/remove, engine start/stop/restart, and engine config save.
- Live container log streams use `DockerLogStreamManager`, not the shared short-command `DockerExecSessionManager`. A `docker logs -f` command must have its own `ReusableExecSession` so an open log dialog cannot block container/image refreshes on the pooled exec-session mutex.
- `docker_container_logs_start` must quote the container id, run `docker logs -f --tail <tail> -- <container> 2>&1`, stream stdout chunks through `docker:log_stream`, and avoid accumulating unbounded stdout in memory. `tail = 0` is valid for resuming realtime output without replaying historical log lines.
- `docker_container_logs_stop` must be idempotent for unknown or already-closed `stream_id` values, but blank `stream_id` remains a validation error. Stopping a stream must close the SSH exec session so the remote `docker logs -f` process exits.
- `docker_container_logs_save` writes UTF-8 text to the selected local file path only. It must validate a nonblank path and nonempty content, must not execute remote Docker commands, and must not accept SSH credential fields.
- `docker_container_inspect` must quote the container id, run `docker inspect -- <container>`, parse the first JSON array item into a structured `DockerContainerDetail`, mask sensitive environment values, and keep a pretty `raw_json` copy for explicit user copy actions only.
- `docker_container_update_restart_policy` may accept only `no`, `always`, `unless-stopped`, or `on-failure`, then run `docker update --restart <policy> -- <container>` without automatic retry.
- `docker_list_networks` must parse newline-delimited JSON from `docker network ls --format '{{json .}}'`; do not parse table output.
- `docker_container_connect_network` must quote both network id/name and container id, then run `docker network connect <network> <container>` without automatic retry.
- `docker_image_run` must quote every image, name, entrypoint, network, port, env, volume, and command value before building `docker run -d ...`. It is a side-effecting command and must not auto-retry after an exec failure.
- When a live log stream finishes naturally, Rust should remove it from `DockerLogStreamManager` and emit `kind = "finished"` unless the stream was explicitly stopped. On stream errors, emit `kind = "error"` with a user-facing message.
- Do not hold storage locks across SSH connection or remote command execution.
- User-controlled Docker arguments such as container id, image id, image name, and network id/name must be quoted with the shared POSIX shell quoting helper before being appended to the command string.
- Container/image listing must parse newline-delimited JSON produced by Docker's `--format '{{json .}}'`; do not parse table output.
- Image pull must merge Docker CLI progress output into stdout, parse line/carriage-return updates, and emit progress events. Percent is best-effort from current-layer `loaded/total` output only; do not invent a total pull percentage when Docker does not provide one.
- Engine status may collect service state, `docker info`, network/volume counts, daemon process usage, Docker root disk usage, and Docker system disk usage. It should return a structured status with `raw_error` for partial failures instead of failing the whole status panel when one optional probe fails.
- Engine service actions use `systemctl start|stop|restart docker` in v1. Do not implement sudo password prompts or silently fall back to another service manager without a new contract update.
- Engine config reads and writes are limited to `/etc/docker/daemon.json`. Save must validate JSON before remote execution, write through a temporary file, and back up the previous config before overwriting.
- Delete operations are single-item only. Network management is limited to joining an existing network from the container detail dialog. Do not add prune, batch delete, build, push, compose, volume, network create, network remove, or network disconnect without a new task and contract update.
- Tauri commands must be registered in both `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs`, with matching typed wrappers in `src/shared/tauri/commands.ts`.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Blank connection id | `docker_connection_missing` | true |
| Blank container id | `docker_container_missing` | true |
| Blank log stream id | `docker_log_stream_missing` | true |
| Blank log save path | `docker_log_save_path_missing` | true |
| Empty log save content | `docker_log_save_content_missing` | true |
| Log save write fails | `docker_log_save_failed` | true |
| Blank network id/name | `docker_network_missing` | true |
| Blank image name/id | `docker_image_missing` | true |
| Image quick run port/env/volume row is incomplete | `docker_run_port_invalid` / `docker_run_env_invalid` / `docker_run_volume_invalid` | true |
| Remote `docker` command missing | `docker_command_missing` | true |
| Docker daemon permission denied | `docker_permission_denied` | true |
| Docker reports missing container | `docker_container_missing` | true |
| Docker reports missing image | `docker_image_missing` | true |
| Docker reports missing network | `docker_network_missing` | true |
| Docker JSON line cannot parse | `docker_container_parse_failed` / `docker_image_parse_failed` / `docker_network_parse_failed` | true |
| Docker inspect JSON cannot parse | `docker_container_inspect_parse_failed` | true |
| Docker inspect returns an empty array | `docker_container_inspect_empty` | true |
| Container inspect, restart policy update, network list, or network connect fails | `docker_container_inspect_failed` / `docker_container_restart_policy_failed` / `docker_network_list_failed` / `docker_network_connect_failed` | true |
| Other non-zero Docker command status | operation-specific `docker_*_failed` | true |
| Live log stream command exits non-zero | `docker:log_stream` event with `kind = "error"` | true |
| Invalid daemon config JSON | `docker_engine_config_json_invalid` | true |
| Daemon config read/write fails | `docker_engine_config_read_failed` / `docker_engine_config_save_failed` | true |
| Engine service action fails | `docker_engine_action_failed` | true |

### 5. Good / Base / Bad Cases

- Good: `docker_container_action` receives only `connection_id`, `container_id`, and `action`, resolves the saved connection, quotes the container id, executes the Docker CLI, and returns a structured `DockerActionResult`.
- Good: `docker_container_logs_start` opens a dedicated exec session for `docker logs -f`, emits chunks without buffering the full stream, and `docker_container_logs_stop` closes that session when the UI closes the dialog.
- Good: `docker_container_logs_save` writes the current UI log buffer to the chosen local path without touching the remote SSH session.
- Good: `docker_container_inspect` returns a structured detail payload plus copied raw inspect JSON, with sensitive environment values masked before React receives them.
- Good: `docker_container_update_restart_policy` and `docker_container_connect_network` use saved `connection_id`, quote every user-controlled CLI argument, and do not auto-retry side effects after an exec failure.
- Good: `docker_image_run` receives only saved `connection_id` plus structured run options, quotes all user-controlled Docker CLI arguments, executes `docker run -d`, and returns the container id/output through `DockerActionResult.output`.
- Good: list commands parse Docker JSON lines and fail on malformed nonblank output with a recoverable parse error that includes a truncated raw line.
- Good: `docker_engine_status` tolerates partial probe failures and surfaces them through `raw_error`, while mutating commands still fail explicitly.
- Good: `docker_engine_save_config` validates JSON and backs up the existing daemon config before replacing it.
- Base: a host without Docker returns `docker_command_missing`; the UI can show a clear unavailable state without falling back to another command.
- Bad: a command accepts SSH password fields, manually reimplements connection resolution, parses table output, appends unquoted image/container values, or silently falls back to local Docker.
- Bad: a live log stream reuses the short-command exec pool, accumulates all stdout into `ExecOutput.stdout`, ignores stop requests so remote `docker logs -f` keeps running, or downloads logs by starting a second remote log command.

### 6. Tests Required

- Unit-test container and image JSON-line parsing, including empty output and malformed nonblank lines.
- Unit-test container inspect parsing, sensitive environment masking, and Docker network JSON-line parsing.
- Unit-test image quick-run command construction, including quoting for spaces and single quotes.
- Cross-check backend request/response field names with `src/features/tools/dockerTypes.ts` and `src/shared/tauri/commands.ts`.
- Source-check Docker refresh, log stream, detail command, and command registration contracts through `node scripts/check-docker-tool-refresh-source.mjs`.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` after changing Docker backend code.
- Run `cargo check --manifest-path src-tauri/Cargo.toml` after adding or changing Docker command registrations, event structs, or stream manager state.
- Run targeted Rust tests for `docker_tools` when Rust test runs are approved for the session.
- Run targeted Rust tests for `remote_exec_pool` when changing generic exec session reuse rules and Rust test runs are approved for the session.

### 7. Wrong vs Correct

#### Wrong

```rust
let command = format!("docker rm {}", request.container_id);
let config = ResolvedSshConfig::from_profile(profile)?;
```

#### Wrong

```rust
manager
    .exec_with_stdout_chunks(app, &config, "docker logs -f ...", callback)
    .await?;
```

#### Correct

```rust
let session = Arc::new(ReusableExecSession::connect_resolved(app, &config).await?);
tokio::spawn(async move {
    let _ = session.exec_streaming_stdout_chunks(command, callback).await;
});
```

#### Correct

```rust
let config = resolve_saved_connection(app, connection_id, None)?;
let command = format!("docker rm -- {}", quote_posix_shell(container_id));
```

#### Wrong

```rust
pub async fn docker_list_containers(request: DockerRawConnectionRequest) -> Result<Vec<_>, AppError> {
    // request includes host, username, password, and private_key_passphrase
}
```

#### Correct

```rust
pub async fn docker_list_containers(
    app: AppHandle,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerContainerSummary>, AppError> {
    crate::docker_tools::list_containers(&app, request).await
}
```

## Scenario: Scheduled Task Toolbox Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes remote scheduled task commands, crontab managed-block parsing/writes, command wrapping, log parsing, or scheduled task command registration.
- Source files: `src-tauri/src/scheduled_tasks.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/shared/tauri/commands.ts`, and `src/features/tools/scheduledTaskTypes.ts`.
- This is a cross-layer command contract because Rust owns saved SSH resolution, remote crontab mutation, shell quoting, and log summaries while React owns the toolbox list/form UI.

### 2. Signatures

Backend commands:

```rust
scheduled_task_list(app: AppHandle, manager: State<ScheduledTaskExecSessionManager>, request: ScheduledTaskConnectionRequest) -> Result<Vec<ScheduledTaskSummary>, AppError>
scheduled_task_save(app: AppHandle, manager: State<ScheduledTaskExecSessionManager>, request: ScheduledTaskSaveRequest) -> Result<ScheduledTaskSummary, AppError>
scheduled_task_delete(app: AppHandle, manager: State<ScheduledTaskExecSessionManager>, request: ScheduledTaskIdRequest) -> Result<ScheduledTaskActionResult, AppError>
scheduled_task_set_enabled(app: AppHandle, manager: State<ScheduledTaskExecSessionManager>, request: ScheduledTaskSetEnabledRequest) -> Result<ScheduledTaskSummary, AppError>
scheduled_task_run_now(app: AppHandle, manager: State<ScheduledTaskExecSessionManager>, request: ScheduledTaskIdRequest) -> Result<ScheduledTaskActionResult, AppError>
```

Request fields:

```rust
ScheduledTaskConnectionRequest { connection_id: String }
ScheduledTaskIdRequest { connection_id: String, task_id: String }
ScheduledTaskSetEnabledRequest { connection_id: String, task_id: String, enabled: bool }
ScheduledTaskSaveRequest { connection_id: String, task: ScheduledTaskInput }
ScheduledTaskInput { id: Option<String>, name: String, cron: String, command: String, enabled: bool }
```

Response fields:

```rust
ScheduledTaskSummary {
  id: String,
  name: String,
  cron: String,
  command: String,
  enabled: bool,
  updated_at: String,
  last_run: Option<ScheduledTaskLogEntry>,
}

ScheduledTaskLogEntry {
  started_at: Option<String>,
  exit_code: Option<i32>,
  status: String,
  output_preview: String,
}

ScheduledTaskActionResult { ok: bool, message: String, output: Option<String> }
```

### 3. Contracts

- Commands must resolve the saved SSH connection through `resolve_saved_connection(app, connection_id, None)` and execute through `RemoteExecSessionPool`. Do not accept host, username, password, private-key path, or passphrase from the UI.
- Rust manages only crontab blocks delimited by `# MXTERM-SCHEDULE-BEGIN` and `# MXTERM-SCHEDULE-END`; ordinary crontab lines must be preserved verbatim.
- Managed blocks store metadata as comments: `id`, URL-safe base64 `name`, URL-safe base64 `cron`, URL-safe base64 `command`, `enabled`, and `updated_at`.
- If any existing mXterm managed block is malformed, write operations must fail with `scheduled_task_crontab_invalid` and must not rewrite the crontab.
- Enabled tasks render one executable cron line. Disabled tasks keep metadata and render only a commented `# disabled:` line so cron does not execute them.
- Scheduled and manual runs write remote logs under `~/.mxterm/scheduled-tasks/logs/{task_id}.log`; command output is not stored locally.
- User commands are base64 encoded inside the wrapper and decoded remotely before `/bin/sh -lc`. The raw user command must not be interpolated into the crontab command line.
- Crontab command percent characters generated by the wrapper must be escaped before writing because cron treats unescaped `%` as stdin/newline separators.
- `scheduled_task_run_now` treats the task command's non-zero exit status as an action result (`ok=false`), not as a transport `AppError`.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| `connection_id` is blank | `scheduled_task_connection_missing` | true |
| Task id is blank | `scheduled_task_id_missing` | true |
| Task id has unsafe path characters | `scheduled_task_id_invalid` | true |
| Task name is blank | `scheduled_task_name_missing` | true |
| Cron is blank | `scheduled_task_cron_missing` | true |
| Cron is not 5 fields or an allowed macro | `scheduled_task_cron_invalid` | true |
| Command is blank | `scheduled_task_command_missing` | true |
| Command contains NUL | `scheduled_task_command_invalid` | true |
| Remote `crontab` is unavailable | `scheduled_task_crontab_unavailable` | true |
| Remote `base64` is unavailable for writes | `scheduled_task_base64_unavailable` | true |
| Existing mXterm managed block is malformed | `scheduled_task_crontab_invalid` | true |
| Task id does not exist for delete/toggle/run | `scheduled_task_missing` | true |

### 5. Good / Base / Bad Cases

- Good: `scheduled_task_save` reads the current user crontab, parses managed blocks, preserves ordinary lines, upserts one managed block, and installs the full resulting crontab.
- Good: disabling a task preserves name/cron/command metadata while ensuring there is no active executable cron line.
- Good: `scheduled_task_run_now` executes the same wrapped command immediately, appends to the remote log file, and returns `ok=false` when the command exits non-zero.
- Base: `crontab -l` reports "no crontab"; Rust treats it as an empty crontab and can add the first managed block.
- Bad: a command rewrites all crontab content from scratch, parses or edits user-owned ordinary cron lines, interpolates raw user commands into shell text, logs command output locally, or accepts SSH secrets from React.

### 6. Tests Required

- Run `cargo test scheduled_tasks --manifest-path src-tauri/Cargo.toml` after changing `src-tauri/src/scheduled_tasks.rs`.
- Add/update Rust tests for cron validation, managed block parse/render, preserving ordinary crontab lines, malformed block rejection, disabled task rendering, command wrapper escaping, and log tail parsing.
- Run `npm run check` after changing the matching TypeScript wrappers or payload types.
- Run `node scripts/check-startup-module-boundary-source.mjs` when command registration or toolbox imports change.
- Cross-check Rust request/response field names against `src/shared/tauri/commands.ts` and `src/features/tools/scheduledTaskTypes.ts`.

### 7. Wrong vs Correct

#### Wrong

```rust
pub async fn scheduled_task_list(request: RawSshRequest) -> Result<Vec<_>, AppError> {
    let command = format!("crontab -l | grep {}", request.filter);
}
```

#### Correct

```rust
let config = resolve_saved_connection(app, connection_id, None)?;
let output = manager.exec(app, &config, READ_CRONTAB_COMMAND, RemoteExecRetry::ReconnectOnce).await?;
```

#### Wrong

```rust
let cron_line = format!("{} /bin/sh -lc '{}'", input.cron, input.command);
```

#### Correct

```rust
let run_command = build_run_command(record);
let cron_line = format!("{} {}", record.cron, escape_crontab_percent(&run_command));
```

## Scenario: mXterm MCP Sidecar and MCP Settings Commands

### 1. Scope / Trigger

- Trigger: backend code adds or changes the `mxterm-mcp` sidecar, MCP settings persistence, MCP-side connection filtering, or the `mcp_*` Tauri commands.
- Source files: `src-tauri/src/mcp.rs`, `src-tauri/src/bin/mxterm_mcp.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src/shared/tauri/commands.ts`, and `src/features/settings/mcpSettingsTypes.ts`.
- This is a cross-layer command contract because Rust owns the sidecar protocol, settings gates, storage filtering, and SSH enforcement while React owns persisted settings edits and the executable-path/config display.

### 2. Signatures

- `mcp_settings_get(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpSettingsOutput, AppError>`
- `mcp_settings_save(app: AppHandle, manager: State<McpRemoteServiceManager>, request: McpSettingsInput) -> Result<McpSettingsOutput, AppError>`
- `mcp_executable_path() -> Result<String, AppError>`
- `mcp_local_network_info() -> McpLocalNetworkInfo`
- `mcp_remote_service_status(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpRemoteServiceStatus, AppError>`
- `mcp_remote_service_start(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpRemoteServiceStatus, AppError>`
- `mcp_remote_service_stop(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpRemoteServiceStatus, AppError>`
- `mcp_remote_service_restart(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpRemoteServiceStatus, AppError>`
- `mcp_remote_token_rotate(app: AppHandle, manager: State<McpRemoteServiceManager>) -> Result<McpSettingsOutput, AppError>`

`McpSettings` / `McpSettingsInput` fields:

```rust
enabled: bool
expose_connections: bool
ssh_operations_enabled: bool
allow_dangerous_commands: bool
remote_enabled: bool
remote_host: String // default "0.0.0.0"
remote_port: u16 // default 8765
remote_token: Option<String>
connection_exposure_mode: McpConnectionExposureMode // "all" | "custom"
exposed_connection_ids: Vec<String>
```

Stored `McpSettings` also owns:

```rust
remote_token: Option<String>
remote_token_hash: Option<String>
remote_token_preview: Option<String>
```

`McpSettingsOutput` returned to React must not include `remote_token_hash`. It may include `remote_token`, `remote_token_saved`, `remote_token_preview`, `generated_remote_token` when a token was created or rotated in that command, and `remote_status`.

`McpLocalNetworkInfo` fields:

```rust
primary_ip: Option<String>
ip_addresses: Vec<String>
```

`mxterm-mcp` stdio tool surface:

- `get_mxterm_mcp_status`
- `list_connections`
- `search_connections`
- `get_connection`
- `test_connection`
- `execute_command`
- `server_monitor`
- `upload_file`
- `download_file`
- `upload_directory`
- `download_directory`
- `execute_script`

Sidecar startup:

```text
mxterm-mcp [--data-dir <path>]
mxterm-mcp serve --host <host> --port <port> --token-sha256 <sha256> [--data-dir <path>]
```

### 3. Contracts

- `src-tauri/Cargo.toml` must register `mxterm-mcp` as a standalone binary and keep `default-run = "m-xterm"` so `tauri dev` still launches the desktop app without an explicit `--bin`.
- `mxterm-mcp` speaks JSON-RPC/MCP over stdio as newline-delimited JSON: one JSON-RPC message per line, no `Content-Length` header. It must work while the mXterm desktop app is not running.
- Remote MCP is served by the same sidecar in `serve` mode. The desktop app manages the child process through `McpRemoteServiceManager`; stdio mode remains independent.
- The remote HTTP transport exposes Streamable HTTP at `/mcp`: `POST /mcp` handles one JSON-RPC message per request and `GET /mcp` returns `text/event-stream`.
- The remote HTTP transport keeps legacy SSE compatibility with `GET /sse` returning an endpoint event and `POST /messages?session_id=...` delivering JSON-RPC responses to that SSE session.
- Remote HTTP requests must authenticate with `Authorization: Bearer <token>` or `X-MXterm-MCP-Token`. The sidecar receives and compares only the SHA-256 token hash passed as `--token-sha256`; do not pass token plaintext in process arguments.
- Enabling remote service with no saved token must generate a high-entropy token, persist the token for reusable client snippets, and also persist a hash plus a short preview for sidecar validation/status display.
- Saving a non-empty `remote_token` from settings must replace the stored token, recompute `remote_token_hash`, refresh `remote_token_preview`, and let `McpRemoteServiceManager` restart/reconcile the sidecar because the auth signature changed.
- `mcp_remote_token_rotate` must replace the saved token and token hash, return the new plaintext token, and restart the managed sidecar so old tokens stop working.
- Remote service startup failures such as port conflicts should be exposed through `McpRemoteServiceStatus.error` without logging or returning token material.
- `mcp_local_network_info` may infer the primary LAN-facing IP by connecting an unbound UDP socket to well-known external IPv4 targets and reading the local socket address. It must filter loopback, unspecified, broadcast, and IPv4 link-local addresses before returning values for client snippets.
- Metadata-only MCP reads must open `StorageRepository::open_root(...)` with the in-memory secret store. Read-only MCP listing must not unlock the local vault or reveal secrets.
- SSH-capable MCP tools must resolve saved connections through the normal vault-backed repository path and must not accept dynamic plaintext credential fields.
- MCP exec-capable tools (`test_connection`, `execute_command`, and `server_monitor`) use a process-local `RemoteExecSessionPool` keyed by saved connection id and `ResolvedSshConfig::signature()`. A command timeout must invalidate the cached connection before returning `mcp_command_timeout`. SFTP transfer tools intentionally keep one operation-scoped `ReusableSftpSession` per transfer until a dedicated SFTP pooling contract exists.
- MCP upload/download tools write to `.mxterm-mcp-transfer-*` temporary files next to the final target and only rename after the copy and flush complete. Failed transfers must clean the temporary file when cleanup is possible; partial final files should not replace an existing target.
- MCP transfer responses include `bytes_transferred` and `duration_ms` for files and directories. Directory values are the sum of transferred child file bytes for that operation.
- `reject_plaintext_credential_args(...)` must reject argument keys such as `host`, `user`, `username`, `password`, `passphrase`, `private_key`, and `private_key_content` before tool dispatch.
- MCP connection exposure is SSH-only. RDP, VNC, Telnet, and Serial profiles must not appear in MCP list/search/get results, even when their ids are saved in `exposed_connection_ids`.
- `McpConnectionExposureMode::All` means every saved SSH connection is exposed.
- `McpConnectionExposureMode::Custom` means only SSH ids from `exposed_connection_ids` are exposed.
- `normalize_connection_ids(...)` must trim ids, drop blanks, and deduplicate before persisting them.
- The sidecar must apply connection exposure filtering to:
  - `list_connections`
  - `search_connections`
  - `get_connection`
  - every SSH-capable tool that accepts `connection_id`
- Knowing a hidden `connection_id` must not bypass MCP exposure. SSH operations on a non-exposed connection must fail before any remote session is opened.
- `get_mxterm_mcp_status` may return a summary only when the master MCP switch and the connection-exposure switch are enabled. Disabled status must not leak connection counts or sync/security metadata.
- `mcp_executable_path()` must derive the sidecar path from the current desktop executable directory and return the sibling `mxterm-mcp.exe` path on Windows packaging/dev layouts.
- MCP connection DTOs must remain redacted. They may expose metadata such as `has_inline_secret`, `has_saved_credential`, `private_key_path_saved`, `password_saved`, and `redacted: true`, but never the plaintext secret material or private-key path text.

### 4. Validation & Error Matrix

| Condition | Error code / behavior | Recoverable |
| --- | --- | --- |
| `mcp.enabled` is false | only `get_mxterm_mcp_status` appears in `tools/list`; other tools return disabled error payloads | true |
| `mcp.expose_connections` is false | connection list/search/get tools return disabled error payloads and status summary is `null` | true |
| `mcp.ssh_operations_enabled` is false | SSH-capable tools are omitted from `tools/list` and runtime calls fail with disabled error payloads | true |
| `connection_exposure_mode = custom` and id not in `exposed_connection_ids` | `mcp_connection_not_exposed` | true |
| Connection profile protocol is not `ssh` | Hide it from MCP metadata list/search/get results | true |
| MCP tool args include plaintext credential fields | `mcp_plaintext_credential_arguments_forbidden` | true |
| Unknown tool name | `mcp_tool_unknown` | false |
| `--data-dir` flag is provided without a value | `mcp_data_dir_missing` | true |
| `serve` mode is missing `--token-sha256` | `mcp_remote_token_missing` | true |
| Saved `remote_token` is blank | `mcp_remote_token_missing` | true |
| Remote port is `0` or cannot parse | `mcp_remote_port_invalid` | true |
| Remote HTTP request has missing or invalid token | HTTP 401 | true |
| Dangerous command without required allow/confirm state | command returns recoverable dangerous-command rejection | true |

### 5. Good / Base / Bad Cases

- Good: `mxterm-mcp --data-dir <temp-root>` starts without the desktop app, returns only `get_mxterm_mcp_status` by default, and exposes connection tools only after persisted MCP settings enable them.
- Good: enabling remote MCP starts the managed sidecar on `0.0.0.0:8765` by default, returns a token once, and accepts remote clients only when they send that token.
- Good: `POST /mcp` initialize returns a JSON-RPC response and an MCP session id header, while legacy `/sse` clients can receive responses through `/messages`.
- Good: when `connection_exposure_mode = "custom"` and `exposed_connection_ids = ["conn-prod"]`, list/search/get and SSH tools behave as if only `conn-prod` exists.
- Good: when saved RDP/VNC/Telnet/Serial profiles exist, MCP connection metadata still returns only SSH profiles.
- Good: transfer tools copy into a sibling temporary file, flush it, rename it to the final target, and return transferred bytes plus elapsed milliseconds.
- Base: `connection_exposure_mode = "all"` with an empty id list still exposes every saved SSH connection.
- Bad: metadata reads unlock the local secret store, hidden connection ids remain callable through SSH tools, the sidecar accepts raw `password`/`private_key` arguments, or `tools/list` advertises disabled tools that runtime will always reject.
- Bad: remote token hash is returned to React, token plaintext is logged or embedded in process arguments, or client snippets keep showing placeholders when a saved token is available.
- Bad: a transfer tool writes directly to the final target, leaving a truncated target file after copy failure, or reports success without the byte/duration fields.

### 6. Tests Required

- Run `cargo check --manifest-path src-tauri/Cargo.toml` after changing `src-tauri/src/mcp.rs`, sidecar dispatch, command registration, or MCP settings structs.
- Run `cargo test --manifest-path src-tauri/Cargo.toml mcp --lib` after changing MCP redaction, tool gating, dangerous command checks, or settings normalization.
- Run `cargo test --manifest-path src-tauri/Cargo.toml --bin mxterm-mcp` after changing stdio dispatch, HTTP transport, token auth, or SSE compatibility.
- Add/update tests that assert:
  - default settings expose only status
  - enabled settings expose the expected tool list
  - redacted connection serialization excludes secret material
  - plaintext credential arguments are rejected
  - remote token hashes verify without passing plaintext to the sidecar
  - enabling remote service generates and persists a token only when needed
  - custom remote token replaces hash and preview
  - local IP filtering rejects loopback, unspecified, and link-local addresses
  - HTTP auth accepts bearer/custom token headers and rejects missing or wrong tokens
  - custom exposure mode filters connection list/search/get and blocks SSH actions by hidden id
  - transfer temporary paths stay beside the target and transfer result serialization includes `bytes_transferred` and `duration_ms`
- When sidecar dispatch changes, run a stdio end-to-end check against a temp `--data-dir` repository that verifies disabled gating and custom exposure filtering without launching the desktop app.

### 7. Wrong vs Correct

#### Wrong

```rust
let connection = repository.connection_get(connection_id)?;
let config = repository.resolve_saved_connection(connection_id, None::<RuntimeCredentialInput>)?;
```

This resolves and uses the saved connection without checking whether MCP exposure allows that id.

#### Correct

```rust
ensure_connection_exposed(settings, connection_id)?;
let config = repository.resolve_saved_connection(connection_id.trim(), None::<RuntimeCredentialInput>)?;
```

The sidecar enforces exposure policy before any SSH-capable resolution happens.

#### Wrong

```rust
StorageRepository::open_root(root, local_secret_store(root)?)
```

for metadata-only listing.

#### Correct

```rust
StorageRepository::open_root(
    root,
    Arc::new(crate::storage_vault::InMemorySecretStore::default()),
)
```

Metadata reads stay redacted and do not depend on unlocking the local vault.

## Scenario: AI Terminal Assistant Commands and Streaming

### 1. Scope / Trigger

- Trigger: backend code adds or changes the built-in AI chat assistant, AI provider configuration persistence, chat history tables, command-risk assessment, or `ai:chat_stream` events.
- Source files: `src-tauri/src/ai_assistant.rs`, `src-tauri/src/events.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/storage_sqlite.rs`, `src-tauri/src/storage_repository.rs`, `src/shared/tauri/commands.ts`, and `src/shared/tauri/events.ts`.
- This is a cross-layer command contract because Rust owns API key storage, provider request protocols, streaming events, local chat persistence, and authoritative command-risk assessment while React owns visible context selection and command suggestion actions.

### 2. Signatures

```rust
ai_provider_config_list(app: AppHandle) -> Result<Vec<AiProviderConfig>, AppError>
ai_provider_config_save(app: AppHandle, request: AiProviderConfigInput) -> Result<AiProviderConfig, AppError>
ai_provider_config_delete(app: AppHandle, request: AiProviderConfigIdRequest) -> Result<(), AppError>
ai_provider_config_reveal_api_key(app: AppHandle, request: AiProviderConfigIdRequest) -> Result<RevealedAiProviderApiKey, AppError>
ai_chat_session_list(app: AppHandle) -> Result<Vec<AiChatSessionSummary>, AppError>
ai_chat_session_get(app: AppHandle, request: AiChatSessionIdRequest) -> Result<AiChatSession, AppError>
ai_chat_session_delete(app: AppHandle, request: AiChatSessionIdRequest) -> Result<(), AppError>
ai_chat_session_clear(app: AppHandle, request: AiChatSessionIdRequest) -> Result<AiChatSession, AppError>
ai_chat_stream_start(app: AppHandle, manager: State<AiChatStreamManager>, request: AiChatStreamStartRequest) -> Result<AiChatStreamStartResponse, AppError>
ai_chat_stream_stop(app: AppHandle, manager: State<AiChatStreamManager>, request: AiChatStreamStopRequest) -> Result<(), AppError>
ai_command_assess(request: AiCommandAssessRequest) -> Result<AiCommandAssessment, AppError>
```

Persistent tables:

```sql
ai_chat_sessions(id, title, provider_config_id, created_at, updated_at)
ai_chat_messages(id, session_id, role, content, contexts_json, commands_json, status, created_at, updated_at)
```

Event:

```rust
const AI_CHAT_STREAM_EVENT: &str = "ai:chat_stream";
```

### 3. Contracts

- Provider config metadata is stored under the app-settings key `ai.provider_configs.v1`; API keys must be stored only through the vault using a stable `ai:{config_id}:api_key` slot id.
- `AiProviderConfigInput` uses `api_key_touched` to distinguish preserve vs replace/delete. If `api_key_touched=false`, backend must preserve the existing vault entry even when `api_key` is absent or blank. If `api_key_touched=true` and the trimmed key is blank, backend deletes the vault secret.
- `ai_provider_config_reveal_api_key` is the only command that may return a provider API key. It must load the saved config, read only that config's vault slot, and must not write the revealed key into app settings, SQLite chat tables, logs, or config list responses.
- `provider` is a display/category value (`openai` or `claude`); `api_format` is the actual protocol (`openai_compatible` or `anthropic`) and must drive request shape.
- OpenAI-compatible requests use chat completions shape with bearer auth and streamed `choices[0].delta.content`.
- Anthropic requests use Messages API shape with `x-api-key`, `anthropic-version`, `max_tokens`, and streamed `content_block_delta` text. Base endpoints may be normalized by appending `/v1/messages`.
- Chat history stores complete visible user messages, assistant content, visible context blocks, extracted command suggestions, and message status. Do not store API keys or hidden connection secrets in chat tables.
- AI message ordering must not rely on UUID lexical order. User messages and assistant placeholders can share the same timestamp, so session reads and previews must order messages by numeric timestamp plus SQLite insertion order (`rowid`) to keep the user message before the matching assistant reply.
- `ai_chat_stream_start` must insert the user message plus a streaming assistant placeholder before returning `stream_id`, `session_id`, `user_message_id`, and `assistant_message_id`.
- Stream events must include `stream_id`, `session_id`, and `message_id`; React must be able to ignore stale events by `stream_id`.
- `ai_chat_stream_stop` must be idempotent for unknown or already-finished streams, preserve partial assistant content, update the assistant message status to `stopped`, and emit `kind = "stopped"` when a live stream was stopped.
- Command-risk detection in Rust is the authoritative check for direct terminal sends. It should catch destructive deletion, disk/partition operations, `dd of=`, downloaded script execution, firewall/route/service impact, reboot/shutdown, broad permission/user changes, and SSH config overwrites.
- OpenAI-compatible requests must include the default terminal-assistant system prompt as a `system` message; Anthropic requests must send the same prompt through the `system` field. This keeps provider protocol differences from changing assistant behavior.
- Provider stream parsers should accept common compatibility sentinels such as `[DONE]` when a gateway emits them, even for Anthropic-format streams.
- SSE reading must buffer raw bytes and decode only complete SSE events. Do not decode each network chunk with lossy UTF-8 conversion, because providers can split multibyte Chinese or emoji characters across chunks.
- Provider request and HTTP error raw messages must redact or suppress bodies that contain sensitive-looking fields such as `authorization`, `x-api-key`, `api_key`, bearer tokens, passwords, or `sk-` keys.

### 4. Validation & Error Matrix

| Condition | Error code | Recoverable |
| --- | --- | --- |
| Blank provider config name | `ai_provider_name_missing` | true |
| Blank endpoint | `ai_provider_endpoint_missing` | true |
| Endpoint is not a valid URL | `ai_provider_endpoint_invalid` | true |
| Blank model | `ai_provider_model_missing` | true |
| Provider config id is blank or missing | `ai_provider_config_missing` | true |
| Provider config has no saved API key | `ai_api_key_missing` | true |
| Blank chat message | `ai_message_missing` | true |
| Blank or unknown session id | `ai_session_missing` | true |
| Blank stream id | `ai_stream_missing` | true |
| Provider HTTP request fails or returns non-success | `ai_provider_request_failed` | true |
| Provider stream JSON cannot parse | `ai_stream_parse_failed` | true |
| Provider stream emits an error payload | `ai_provider_stream_error` | true |
| SQLite operation fails | `ai_storage_failed` | true |
| JSON serialization fails | `ai_json_failed` | true |

### 5. Good / Base / Bad Cases

- Good: saving an existing provider with only the model changed sends `api_key_touched=false`, updates metadata, and preserves the vault secret.
- Good: reveal reads the API key from vault on demand and returns it only through `RevealedAiProviderApiKey`, while `ai_provider_config_list` still exposes only `api_key_saved`.
- Good: deleting a provider removes its vault secret and nulls `provider_config_id` on old sessions without deleting chat history.
- Good: stopping a stream keeps partial text visible, marks the assistant message as `stopped`, and removes the stream handle.
- Good: a provider request error truncates the response body and never includes Authorization, `x-api-key`, or the request API key.
- Good: loading a session created by one send shows the user message before the assistant placeholder/reply even when both rows have the same timestamp.
- Good: OpenAI-compatible and Anthropic-compatible calls both receive the same terminal-assistant system instruction.
- Good: streamed Chinese/emoji text remains valid when UTF-8 bytes are split across provider network chunks.
- Base: a provider exists without an API key; list returns `api_key_saved=false`, and stream start fails with `ai_api_key_missing`.
- Bad: storing API keys in `app_settings`, SQLite chat tables, logs, raw errors, or task docs.
- Bad: treating provider display kind as the protocol, such as forcing every `claude` config to Anthropic format when the saved `api_format` says OpenAI-compatible.
- Bad: emitting stream chunks without `stream_id`, causing React to merge stale chunks into the active assistant message.
- Bad: ordering messages by UUID after timestamp ties, because a random assistant id can sort before its user message.
- Bad: calling `String::from_utf8_lossy` on each provider chunk before SSE frame boundaries are known.

### 6. Tests Required

- Run `cargo check --manifest-path src-tauri/Cargo.toml` after changing AI command registration, event structs, provider request structs, or storage schema.
- Run `cargo test --manifest-path src-tauri/Cargo.toml ai_assistant --lib` after changing stream parsers, endpoint normalization, command-risk assessment, or provider config persistence.
- Add or update Rust tests that assert:
  - OpenAI and Anthropic SSE deltas parse correctly.
  - Endpoint normalization appends chat/messages paths without corrupting existing full endpoints.
  - Dangerous command patterns are classified as `dangerous`.
  - Shell fenced code blocks become structured command suggestions.
  - Error messages and persisted config metadata never include plaintext API keys.
  - On-demand provider API key reveal returns the saved secret without adding it to provider metadata.
  - Same-timestamp chat messages read back in insertion order.
  - OpenAI-compatible request message construction includes the default system prompt.
  - SSE event extraction preserves multibyte UTF-8 content split across byte chunks.
- Run the full Rust suite when practical; document unrelated environment-sensitive PTY failures separately instead of hiding them in AI tests.

### 7. Wrong vs Correct

#### Wrong

```rust
repository.app_setting_set("ai.provider_configs.v1", &request, now)?;
```

This can persist the plaintext `api_key` alongside metadata.

#### Correct

```rust
if request.api_key_touched {
    repository.secret_set(&ai_api_key_reference(&secret_slot_id), api_key)?;
}
repository.app_setting_set(AI_PROVIDER_CONFIGS_KEY, &stored_configs, now)?;
```

Metadata and secret material stay on separate storage paths.

#### Wrong

```rust
emit("ai.chat_stream", chunk)?;
```

Dot-separated event names are not the project convention and the payload lacks stale-stream routing.

#### Correct

```rust
app.emit("ai:chat_stream", AiChatStreamEvent {
    stream_id,
    session_id,
    message_id,
    kind: "chunk".to_string(),
    delta: Some(delta),
    content: None,
    error: None,
})?;
```

Colon-separated events and `stream_id` matching keep the UI stream-safe.
