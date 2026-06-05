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
