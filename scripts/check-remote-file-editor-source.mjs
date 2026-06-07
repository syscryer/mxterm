import { readFileSync } from "node:fs";

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const commandsTs = readFileSync(new URL("../src/shared/tauri/commands.ts", import.meta.url), "utf8");
const commandsRs = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const libRs = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const remoteFilesRs = readFileSync(new URL("../src-tauri/src/remote_files.rs", import.meta.url), "utf8");
const terminalSessionRs = readFileSync(new URL("../src-tauri/src/terminal/session.rs", import.meta.url), "utf8");
const remoteFilePanel = readFileSync(new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url), "utf8");
const workspaceShell = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

let editorSource = "";
try {
  editorSource = readFileSync(new URL("../src/features/editor/RemoteFileEditor.tsx", import.meta.url), "utf8");
} catch {
  throw new Error("RemoteFileEditor.tsx should exist and host Monaco");
}

for (const needle of ["monaco-editor", "RemoteFileEditor", "remoteFileLanguageForPath"]) {
  if (!packageJson.includes(needle) && !editorSource.includes(needle) && !workspaceShell.includes(needle)) {
    throw new Error(`Remote file editor should include ${needle}`);
  }
}

for (const wrapper of [
  "remoteFileRead",
  "remoteFileWrite",
  "remoteFileCreateFile",
  "remoteFileCreateDirectory",
  "remoteFileRename",
  "remoteFileDelete",
  "remoteFileUploadFile",
  "remoteFileDownload",
]) {
  if (!commandsTs.includes(`export function ${wrapper}`)) {
    throw new Error(`commands.ts should expose ${wrapper}`);
  }
}

for (const command of [
  "remote_file_read",
  "remote_file_write",
  "remote_file_create_file",
  "remote_file_create_directory",
  "remote_file_rename",
  "remote_file_delete",
  "remote_file_upload_file",
  "remote_file_download",
]) {
  if (!commandsRs.includes(command) || !libRs.includes(`commands::${command}`)) {
    throw new Error(`Rust command ${command} should be defined and registered`);
  }
}

for (const backendSymbol of [
  "RemoteFileReadResult",
  "RemoteFileWriteResult",
  "REMOTE_FILE_EDIT_LIMIT_BYTES",
  "read_file",
  "write_file",
  "build_remote_write_command",
  "parse_remote_file_metadata",
  "looks_like_binary",
]) {
  if (!remoteFilesRs.includes(backendSymbol)) {
    throw new Error(`remote_files.rs should include ${backendSymbol}`);
  }
}

if (!terminalSessionRs.includes("exec_with_stdin")) {
  throw new Error("ReusableExecSession should support exec_with_stdin for safe file writes");
}

if (remoteFilesRs.includes("format!(\"cat >") || remoteFilesRs.includes("content")) {
  const suspicious = /format!\([^)]*content|content[^;\n]*quote_posix_shell/.test(remoteFilesRs);
  if (suspicious) {
    throw new Error("Remote file content must not be interpolated into shell commands");
  }
}

for (const uiNeedle of [
  "onOpenFile",
  "onCreateFile",
  "onCreateDirectory",
  "onRenameEntry",
  "onDeleteEntry",
  "onUploadFile",
  "onDownloadFile",
]) {
  if (!remoteFilePanel.includes(uiNeedle)) {
    throw new Error(`RemoteFilePanel should expose ${uiNeedle}`);
  }
}

for (const workspaceNeedle of [
  "remoteFileTabs",
  "activeRemoteFileTabId",
  "editorTerminalSplitPercent",
  "editor-terminal-resizer",
  "remote-editor-pane",
  "terminal-workbench-pane",
  "openRemoteFile",
  "saveRemoteFile",
  "closeRemoteFileTab",
  "dirty",
  "remote-file-conflict",
]) {
  if (!workspaceShell.includes(workspaceNeedle)) {
    throw new Error(`WorkspaceShell should include ${workspaceNeedle}`);
  }
}

if (workspaceShell.includes("activeWorkspaceTabId")) {
  throw new Error("WorkspaceShell should keep remote file active state separate from terminal active state");
}

for (const editorNeedle of [
  "MonacoEnvironment",
  "editor.create",
  "remote-file-editor-compactbar",
  "KeyMod.CtrlCmd",
  "KeyCode.KeyS",
  "actions.find",
  "automaticLayout",
]) {
  if (!editorSource.includes(editorNeedle)) {
    throw new Error(`RemoteFileEditor should include Monaco behavior ${editorNeedle}`);
  }
}

for (const className of [
  ".editor-terminal-resizer",
  ".remote-editor-pane",
  ".remote-editor-tabs",
  ".terminal-workbench-pane",
  ".terminal-workbench-pane[data-terminal-tone=\"dark\"] .terminal-subtabs",
  ".remote-file-editor-compactbar",
  ".remote-file-editor",
  ".remote-file-editor-toolbar",
  ".remote-file-editor-status",
  ".file-tab",
]) {
  if (!styles.includes(className)) {
    throw new Error(`app.css should style ${className}`);
  }
}

console.log("Remote file editor source check passed.");
