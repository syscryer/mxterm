import { readFileSync } from "node:fs";

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const commandsTs = readFileSync(new URL("../src/shared/tauri/commands.ts", import.meta.url), "utf8");
const commandsRs = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const libRs = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const remoteFilesRs = readFileSync(new URL("../src-tauri/src/remote_files.rs", import.meta.url), "utf8");
const terminalSessionRs = readFileSync(new URL("../src-tauri/src/terminal/session.rs", import.meta.url), "utf8");
const remoteFilePanel = readFileSync(new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url), "utf8");
const remoteFileTypes = readFileSync(new URL("../src/features/files/remoteFileTypes.ts", import.meta.url), "utf8");
const workspaceShell = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");
const settingsTypes = readFileSync(new URL("../src/features/settings/settingsTypes.ts", import.meta.url), "utf8");
const settingsView = readFileSync(new URL("../src/features/settings/SettingsView.tsx", import.meta.url), "utf8");
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
  "remoteFileMetadata",
  "remoteFileUploadFile",
  "remoteFileUploadArchive",
  "remoteFileDownload",
  "remoteFileDownloadToLocal",
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
  "remote_file_metadata",
  "remote_file_upload_file",
  "remote_file_upload_archive",
  "remote_file_download",
  "remote_file_download_to_local",
]) {
  if (!commandsRs.includes(command) || !libRs.includes(`commands::${command}`)) {
    throw new Error(`Rust command ${command} should be defined and registered`);
  }
}

for (const backendSymbol of [
  "RemoteFileReadResult",
  "RemoteFileWriteResult",
  "RemoteFileEntryMetadata",
  "RemoteFileUploadResult",
  "RemoteFileArchiveUploadResult",
  "TransferConflictPolicy",
  "REMOTE_FILE_EDIT_LIMIT_BYTES",
  "read_file",
  "write_file",
  "upload_file",
  "upload_archive",
  "download_archive",
  "build_remote_write_command",
  "build_remote_upload_command",
  "build_remote_resolve_child_command",
  "build_remote_extract_archive_command",
  "build_remote_archive_download_command",
  "parse_remote_file_metadata",
  "parse_remote_entry_metadata",
  "parse_remote_transfer_path",
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
  "onDownloadEntry",
  "onUploadDirectory",
  "onUploadFile",
  "onUploadItems",
  "onCopyPath",
  "onShowProperties",
]) {
  if (!remoteFilePanel.includes(uiNeedle)) {
    throw new Error(`RemoteFilePanel should expose ${uiNeedle}`);
  }
}

for (const dragNeedle of [
  "onDragOver",
  "onDrop",
  "onDragEnd",
  "webkitGetAsEntry",
  "handleRemoteDragStart",
]) {
  if (!remoteFilePanel.includes(dragNeedle)) {
    throw new Error(`RemoteFilePanel should include drag behavior ${dragNeedle}`);
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
  "remoteFileTransfers",
  "RemoteFileTransferPanel",
  "remoteFileUploadArchive",
  "remoteFileDownloadToLocal",
  "remoteFileMetadata",
  "resolveTransferConflictPolicy",
  "setRemoteFileTextValue(entry.name)",
]) {
  if (!workspaceShell.includes(workspaceNeedle)) {
    throw new Error(`WorkspaceShell should include ${workspaceNeedle}`);
  }
}

if (workspaceShell.includes("activeWorkspaceTabId")) {
  throw new Error("WorkspaceShell should keep remote file active state separate from terminal active state");
}

for (const archiveNeedle of [
  "CompressionStream(\"gzip\")",
  "buildTarGzArchive",
  "webkitdirectory",
  "RemoteFileUploadItem",
]) {
  if (!workspaceShell.includes(archiveNeedle) && !remoteFilePanel.includes(archiveNeedle)) {
    throw new Error(`Folder transfer flow should include ${archiveNeedle}`);
  }
}

for (const typeNeedle of [
  "RemoteFileEntryMetadata",
  "RemoteFileTransferConflictPolicy",
  "RemoteFileArchiveUploadResult",
  "RemoteFileDownloadToLocalResult",
]) {
  if (!remoteFileTypes.includes(typeNeedle)) {
    throw new Error(`remoteFileTypes.ts should include ${typeNeedle}`);
  }
}

for (const settingsNeedle of [
  "fileTransfer",
  "downloadRoot",
  "groupBySession",
  "timestampDirectory",
  "timestampFormat",
  "keepArchives",
  "conflictPolicyDefault",
]) {
  if (!settingsTypes.includes(settingsNeedle) || !settingsView.includes(settingsNeedle)) {
    throw new Error(`File transfer settings should include ${settingsNeedle}`);
  }
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
  ".tool-tab-badge",
  ".file-list.is-drop-target",
  ".remote-file-row.is-drop-target",
  ".transfer-panel",
  ".remote-file-properties",
  ".transfer-conflict-dialog",
  ".settings-path-input",
]) {
  if (!styles.includes(className)) {
    throw new Error(`app.css should style ${className}`);
  }
}

console.log("Remote file editor source check passed.");
