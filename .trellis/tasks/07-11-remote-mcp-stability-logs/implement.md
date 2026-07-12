# Implementation Plan

1. Add bounded remote MCP log helpers and safe sidecar transport diagnostics.
2. Extend the manager runtime/status contract with health and restart metadata.
3. Start one background supervisor from Tauri setup and implement health probing plus bounded restart backoff.
4. Add typed Tauri commands and frontend wrappers for reading, clearing, and revealing logs.
5. Extend MCP settings status and add the compact log viewer/actions.
6. Route MCP file and directory transfers through the shared remote-file SFTP primitives.
7. Add focused Rust tests for backoff, failure reset, log rotation/redaction boundaries, status serialization, and shared transfer behavior.
8. Add updater blocker detection, confirmation, supervisor suspension, and MCP process termination.
9. Run TypeScript checks, focused Rust tests, source-boundary checks, and diff checks.

## Rollback

The supervisor and log commands are additive. Rollback removes the setup supervisor and new commands/status fields while retaining the existing manual start/stop/restart behavior.
