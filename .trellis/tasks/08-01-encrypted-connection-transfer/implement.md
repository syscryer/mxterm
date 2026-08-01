# Encrypted Connection Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` in the main Codex inline session. Load `trellis-before-dev` first; do not dispatch implement/check sub-agents. Track every step with the checkboxes below.

**Goal:** Build a versioned native JSON export/import flow for all mXterm connections, groups, reusable credentials, and encrypted saved secrets.

**Architecture:** A dedicated Rust `connection_transfer` module owns the portable schema, preflight, conflict plan, and import orchestration. Shared authenticated-encryption primitives are extracted from `sync_snapshot` without changing its external format; a lazy React dialog calls three typed Tauri commands and refreshes the repository only after a successful atomic import.

**Tech Stack:** Rust, serde, rusqlite, Argon2id, AES-256-GCM, Tauri v2, React 19, TypeScript, Radix Dialog, Lucide, project CSS tokens.

---

## File Map

- Create `src-tauri/src/secure_bundle.rs`: shared Argon2id/AES-GCM envelope types, key derivation, authenticated encrypt/decrypt helpers, and unit tests.
- Create `src-tauri/src/connection_transfer.rs`: `mxterm-connections` DTOs, file I/O, validation, preview, conflict planning, import orchestration, result types, and unit tests.
- Create `src-tauri/src/connection_transfer_recovery.rs`: pending journal, encrypted-vault backup, SQLite commit-marker reconciliation, cleanup, and crash-recovery tests.
- Modify `src-tauri/src/sync_snapshot.rs`: consume `secure_bundle` helpers while retaining `mxterm-sync` v1 byte/behavior compatibility.
- Modify `src-tauri/src/storage_repository.rs`: export transfer scope, inspect local identities, and apply skip/overwrite merge with rollback-aware secret writes.
- Modify `src-tauri/src/storage_vault.rs`: expose the smallest batch/snapshot capability needed for compensating secret rollback and failure-injection tests.
- Modify `src-tauri/src/commands.rs`: add export, preview, and import Tauri commands.
- Modify `src-tauri/src/lib.rs`: register new Rust modules and commands.
- Modify `src/shared/tauri/commands.ts`: add typed request/result wrappers.
- Modify `src/shared/tauri/dialog.ts`: add filtered open/save helpers for `*.mxterm-connections.json`.
- Create `src/features/connections/connectionTransferTypes.ts`: frontend command contracts and dialog state types.
- Create `src/features/connections/ConnectionTransferDialog.tsx`: lazy import/export dialog and accessible workflow.
- Modify `src/features/layout/WorkspaceShell.tsx`: replace the refresh-backed fake entry, add export, lazy loader, dialog state, and success reload.
- Modify `src/styles/app.css`: shared-token connection transfer dialog and quick-link styles.
- Create `scripts/check-connection-transfer-source.mjs`: source regression checks for real handlers, lazy loading, typed commands, and token-only styling.

### Task 1: Extract Shared Authenticated Encryption

- [ ] **Step 1: Add failing compatibility and tamper tests**

In `src-tauri/src/secure_bundle.rs`, define tests for a stable helper contract:

```rust
#[test]
fn encrypted_json_round_trips_with_matching_aad() {
    let encrypted = encrypt_json(b"mxterm-test:v1:data-hash", "password", &TestSecret { value: "secret".into() }).unwrap();
    let restored: TestSecret = decrypt_json(b"mxterm-test:v1:data-hash", "password", &encrypted).unwrap();
    assert_eq!(restored.value, "secret");
}

#[test]
fn encrypted_json_rejects_wrong_password_and_changed_aad() {
    let encrypted = encrypt_json(b"mxterm-test:v1:original", "password", &TestSecret { value: "secret".into() }).unwrap();
    assert!(decrypt_json::<TestSecret>(b"mxterm-test:v1:original", "wrong", &encrypted).is_err());
    assert!(decrypt_json::<TestSecret>(b"mxterm-test:v1:changed", "password", &encrypted).is_err());
}
```

- [ ] **Step 2: Run the focused tests and confirm they fail before implementation**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml secure_bundle::tests
```

Expected: compilation fails because `secure_bundle` and its API are not registered.

- [ ] **Step 3: Move the existing crypto primitives into the shared module**

Expose this crate-private API while preserving the current Argon2id parameters and AES-GCM envelope field names:

```rust
pub(crate) const PASSWORD_MEMORY_COST_KIB: u32 = 19 * 1024;
pub(crate) const PASSWORD_TIME_COST: u32 = 2;
pub(crate) const PASSWORD_PARALLELISM: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct EncryptedJsonEnvelope {
    pub kdf: PasswordKdf,
    pub cipher: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

pub(crate) fn encrypt_json<T: Serialize>(aad: &[u8], password: &str, value: &T) -> Result<EncryptedJsonEnvelope, AppError>;
pub(crate) fn decrypt_json<T: DeserializeOwned>(aad: &[u8], password: &str, envelope: &EncryptedJsonEnvelope) -> Result<T, AppError>;
```

Update `sync_snapshot.rs` to construct the same AAD it uses today and delegate encryption/decryption to these helpers. Do not rename `mxterm-sync`, change its protocol version, or change its manifest/artifact hashing.

- [ ] **Step 4: Run shared crypto and existing sync tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml secure_bundle::tests
cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot::tests
```

Expected: both suites pass; existing wrong-password/hash-mismatch error codes remain asserted.

### Task 2: Define and Validate the Portable Bundle

- [ ] **Step 1: Write failing bundle validation tests**

Add tests in `connection_transfer.rs` covering exact `format/version`, canonical `data_sha256`, wrong password, modified `data`, unsupported secret kinds, duplicate IDs, dangling group/credential references, record-count limits, and input file-size limits.

The public command-facing types must match this contract:

```rust
pub const CONNECTION_TRANSFER_FORMAT: &str = "mxterm-connections";
pub const CONNECTION_TRANSFER_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ConnectionTransferBundle {
    pub format: String,
    pub version: u16,
    pub created_at: String,
    pub data: ConnectionTransferData,
    pub data_sha256: String,
    pub secrets: EncryptedJsonEnvelope,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionTransferConflictStrategy {
    Skip,
    Overwrite,
}
```

- [ ] **Step 2: Run focused tests and observe failures**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml connection_transfer::tests
```

Expected: failures identify missing bundle construction and validation paths.

- [ ] **Step 3: Implement deterministic serialization, AAD, file bounds, and error mapping**

Use `serde_json::to_vec(&bundle.data)` for the canonical digest input. Construct AAD as `mxterm-connections\0v1\0<data_sha256>`. Read metadata first and reject files above the defined maximum before `fs::read`; reject empty/oversized passwords before Argon2 work. Use `storage::write_json_document` for atomic export and stable `connection_transfer_*` error codes.

- [ ] **Step 4: Run bundle tests until green**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml connection_transfer::tests
```

Expected: all format, tamper, password, reference, and limit tests pass.

### Task 3: Build Preflight and Atomic Merge

- [ ] **Step 1: Add repository fixtures and failing merge tests**

Add `storage_repository` tests for:

```text
new records insert with restored credential and inline secrets
skip keeps conflicting connection/credential metadata and secrets
overwrite updates conflicting metadata and secrets
same group name with different ID remaps imported connection.group_id
dangling references fail before BEGIN IMMEDIATE
secret write failure rolls back SQLite and restores prior secrets
database failure after secret writes compensates secrets
pending journal without SQLite commit marker restores the encrypted vault backup on reopen
pending journal with matching SQLite commit marker keeps committed data and only cleans recovery files
```

Use `InMemorySecretStore` failure injection; extend it only where the tests need deterministic fail-after-N behavior.

- [ ] **Step 2: Run the focused repository tests and confirm failure**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml connection_transfer_
```

Expected: new tests fail because preview/merge APIs do not exist.

- [ ] **Step 3: Implement export, local identity inspection, conflict plan, and merge transaction**

Add repository methods with explicit responsibilities:

```rust
pub fn export_connection_transfer_data(&self) -> Result<(ConnectionTransferData, ConnectionTransferSecrets), AppError>;
pub fn preview_connection_transfer(&self, data: &ConnectionTransferData) -> Result<ConnectionTransferPlan, AppError>;
pub fn apply_connection_transfer(&mut self, plan: ConnectionTransferPlan, secrets: &ConnectionTransferSecrets, strategy: ConnectionTransferConflictStrategy) -> Result<ConnectionTransferImportResult, AppError>;
```

The plan must contain resolved group-ID mappings and exact entity/secret actions so preview and apply use the same rules. Before mutation, create a transaction ID, copy the encrypted vault file to a same-directory recovery backup, and atomically write a metadata-only pending journal. Write the transaction ID to `app_meta` inside the same SQLite transaction as imported records. On ordinary failure rollback SQLite and restore the encrypted vault backup; on repository reopen recover or clean up by comparing the journal transaction ID with the committed `app_meta` value.

- [ ] **Step 4: Run merge, sync snapshot, and vault suites**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml connection_transfer_
cargo test --manifest-path src-tauri/Cargo.toml sync_snapshot::tests
cargo test --manifest-path src-tauri/Cargo.toml storage_vault::tests
```

Expected: merge rollback tests pass and existing sync/vault behavior remains green.

### Task 4: Expose Typed Tauri Commands and File Pickers

- [ ] **Step 1: Define backend request/result structs and command functions**

Register exactly these commands in `lib.rs`:

```rust
commands::connection_transfer_export,
commands::connection_transfer_preview,
commands::connection_transfer_import,
```

`preview` returns the file fingerprint, counts, conflict details, and private-key-path warnings. `import` accepts the expected fingerprint and repeats full validation before calling the repository merge.

- [ ] **Step 2: Add matching frontend types and wrappers**

In `connectionTransferTypes.ts` and `commands.ts`, keep snake_case payload/result fields aligned with serde and expose:

```ts
export function exportConnections(request: ConnectionTransferExportRequest): Promise<ConnectionTransferExportResult>;
export function previewConnectionImport(request: ConnectionTransferPreviewRequest): Promise<ConnectionTransferPreview>;
export function importConnections(request: ConnectionTransferImportRequest): Promise<ConnectionTransferImportResult>;
```

Extend `dialog.ts` with one-file open and save helpers filtered to `mxterm-connections.json`; cancellation returns `null` and never invokes a backend command.

- [ ] **Step 3: Run Rust and TypeScript contract checks**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml connection_transfer::tests
pnpm check
```

Expected: Rust tests pass and TypeScript reports no command contract mismatch.

### Task 5: Implement the Lazy Desktop Workflow

- [ ] **Step 1: Add the source regression test before UI code**

Create `scripts/check-connection-transfer-source.mjs` using `node:test` and source reads. Assert that `WorkspaceShell.tsx` dynamically imports `ConnectionTransferDialog`, the import quick-link no longer uses `onRefresh`, both import/export handlers exist, `AppSelect` supplies `skip`/`overwrite`, and dialog CSS uses `var(--mx-...)` rather than hard-coded colors.

- [ ] **Step 2: Run the source test and confirm it fails**

```powershell
node scripts/check-connection-transfer-source.mjs
```

Expected: FAIL because the lazy dialog and real handlers are absent.

- [ ] **Step 3: Implement the dialog state machine and homepage entries**

Create `ConnectionTransferDialog.tsx` with `mode: "import" | "export"`, controlled open state, password clearing on close, export password confirmation, import preview state, default `skip`, private-key warning list, busy lock, inline errors, and success feedback. Use Radix Dialog, Lucide icons, `AppSelect`, shared input attributes, accessible labels, and no nested cards.

In `WorkspaceShell.tsx`, add a module-level lazy loader matching existing connection dialog patterns. Pass separate `onImportConnections` and `onExportConnections` callbacks to `ConnectionHome`; after import success await the existing `reload`, while export success does not reload.

- [ ] **Step 4: Add token-based shared styling**

Add compact dialog, summary grid, warning list, and action-row classes to `app.css`. Use only existing `--mx-*` tokens and existing dialog/button patterns; verify radius is at most 8px, focus-visible remains visible, long paths wrap, and light/dark/system-dark selectors need no feature-local colors.

- [ ] **Step 5: Run source, type, startup, and production checks**

```powershell
node scripts/check-connection-transfer-source.mjs
node scripts/check-startup-module-boundary-source.mjs
pnpm check
pnpm build
```

Expected: all commands pass; Vite emits the connection transfer dialog as a separate lazy chunk and does not pull terminal/settings/VNC/Monaco modules into the first screen.

### Task 6: End-to-End Verification and Review Staging

- [ ] **Step 1: Run the complete automated gate**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/check-connection-transfer-source.mjs
node scripts/check-startup-module-boundary-source.mjs
pnpm check
pnpm build
pnpm test:release
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Run desktop smoke checks**

Start `pnpm tauri:dev` and verify: export cancellation; password mismatch; successful encrypted export; readable metadata with no plaintext secret; wrong-password preview; tampered-data preview; new import; skip conflict; explicit overwrite; private-key missing warning; reload only after successful import; keyboard focus and light/dark/system-dark presentation.

- [ ] **Step 3: Inspect and stage only task-owned files for human review**

```powershell
git status --short
git diff --check
git diff -- . ':!.codex/config.toml' ':!.opencode' ':!.tmp-dev'
```

Do not commit or push. Stage only files created or modified by this task after checking that no password, decrypted secret, local path fixture, `.trellis/.runtime/`, `.trellis/.developer`, Python cache, or user-owned dirty file is included.
