# AI 终端小帮手 Implementation Plan

## Checklist

1. Backend foundation
   - Add `src-tauri/src/ai_assistant.rs`.
   - Add SQLite tables for AI sessions/messages in `storage_sqlite.rs`.
   - Add repository helpers for session/message CRUD.
   - Add provider config load/save with API Key stored in vault.
   - Register Tauri commands and stream manager in `lib.rs`.

2. Provider streaming
   - Implement OpenAI-compatible streaming request and SSE parser.
   - Implement Claude/Anthropic streaming request and SSE parser.
   - Emit `ai:chat_stream` chunk/finished/error/stopped events.
   - Add stop generation support.
   - Add unit tests for stream parsers and redaction/error behavior.

3. Chat history and commands
   - Add typed wrappers in `src/shared/tauri/commands.ts`.
   - Add AI event listener in `src/shared/tauri/events.ts`.
   - Add frontend AI types under `src/features/ai/`.
   - Implement session list, load, create, delete, clear current session.

4. AI panel UI
   - Add lazy-loaded `AiAssistantPanel`.
   - Add right-pane `ai` tool entry in `RemoteFilePanel`.
   - Wire `WorkspaceShell` state for active AI session, provider config, context package, stream lifecycle.
   - Support provider switching, config missing state, streaming reply, stop, retry, new session.

5. Terminal context entry
   - Add terminal right-click menu using Radix ContextMenu.
   - If terminal text is selected, expose “发送到 AI 对话”.
   - Wire selected text to open AI right-pane tab and attach as visible context.
   - Do not auto-submit.

6. Command suggestions and safety
   - Extract command suggestions from AI replies.
   - Add command suggestion cards with copy, insert into Command Sender, save snippet, send to terminal.
   - Add dangerous command assessment and confirm dialog only when sending dangerous command to terminal.

7. Settings
   - Add AI settings section as a left-side config list plus right-side detail editor.
   - Fields: config name, access mode, API Key, request endpoint, model.
   - Use `AppSelect` and existing settings panel styles, and derive backend provider/api-format fields from the single access-mode control.

8. Styling
   - Add compact right-pane AI styles in `src/styles/app.css`.
   - Use existing `--mx-*` tokens, shared menu/dialog/button patterns, light/dark compatibility.

9. Validation
   - `npm run check`
   - `npm run build`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
   - `node scripts/check-startup-module-boundary-source.mjs`
   - Optional live API smoke test with a temporary local key only, never persisted into repo files.

## Risk Points

- Streaming cancellation must not leave dangling tasks or wrong message status.
- API Key preservation must follow touched/untouched semantics so saving metadata does not erase secrets.
- Full conversation history stores terminal output by design; delete/clear controls must work.
- `WorkspaceShell` is large; keep AI integration localized and lazy-load feature code.
- Terminal right-click menu must not break xterm selection, copy shortcuts, or normal terminal input.

## Rollback Points

- Backend module and command registration can be removed cleanly if provider streaming fails.
- Frontend AI feature is lazy-loaded and can be hidden by removing the `ai` tool tab wiring.
- SQLite table additions are additive; no migration should mutate existing connection/credential/command data.
