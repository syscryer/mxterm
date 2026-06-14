import { readFileSync } from "node:fs";

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const commandsTs = readFileSync(new URL("../src/shared/tauri/commands.ts", import.meta.url), "utf8");
const commandsRs = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const eventsRs = readFileSync(new URL("../src-tauri/src/events.rs", import.meta.url), "utf8");
const libRs = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const remoteFilesRs = readFileSync(new URL("../src-tauri/src/remote_files.rs", import.meta.url), "utf8");
const sshConfigRs = readFileSync(new URL("../src-tauri/src/ssh_config.rs", import.meta.url), "utf8");
const terminalSessionRs = readFileSync(new URL("../src-tauri/src/terminal/session.rs", import.meta.url), "utf8");
const tauriCapability = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
const tauriEventsTs = readFileSync(new URL("../src/shared/tauri/events.ts", import.meta.url), "utf8");
const tauriDialogTs = readFileSync(new URL("../src/shared/tauri/dialog.ts", import.meta.url), "utf8");
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
  "connectionTestProfile",
  "remoteFileRead",
  "remoteFileWrite",
  "remoteFileCreateFile",
  "remoteFileCreateDirectory",
  "remoteFileRename",
  "remoteFileDelete",
  "remoteFileMetadata",
  "remoteFileCheckPath",
  "remoteFileUploadFile",
  "remoteFileUploadLocalFile",
  "remoteFileUploadArchive",
  "remoteFileUploadLocalArchive",
  "remoteFilePrepareUploadTemp",
  "remoteFileAppendUploadTemp",
  "remoteFileDeleteUploadTemp",
  "remoteFileDownload",
  "remoteFileCheckDownloadTarget",
  "remoteFileDownloadToLocal",
]) {
  if (!commandsTs.includes(`export function ${wrapper}`)) {
    throw new Error(`commands.ts should expose ${wrapper}`);
  }
}

if (!commandsTs.includes('"connection_test_profile"')) {
  throw new Error("connectionTestProfile should invoke connection_test_profile");
}

if (/remoteFileAppendUploadTemp[\s\S]*Array\.from\(chunk\)/.test(commandsTs)) {
  throw new Error("remoteFileAppendUploadTemp should pass Uint8Array chunks without Array.from on the hot path");
}

if (!libRs.includes("tauri_plugin_dialog::init()") || !tauriCapability.includes("dialog:allow-open")) {
  throw new Error("Tauri dialog plugin should be registered and allowed for upload pickers");
}

for (const dialogNeedle of [
  "@tauri-apps/plugin-dialog",
  "selectLocalUploadFiles",
  "selectLocalUploadDirectories",
]) {
  if (!tauriDialogTs.includes(dialogNeedle)) {
    throw new Error(`Tauri dialog wrapper should include ${dialogNeedle}`);
  }
}

for (const command of [
  "connection_test_profile",
  "remote_file_read",
  "remote_file_write",
  "remote_file_create_file",
  "remote_file_create_directory",
  "remote_file_rename",
  "remote_file_delete",
  "remote_file_metadata",
  "remote_file_check_path",
  "remote_file_upload_file",
  "remote_file_upload_local_file",
  "remote_file_upload_archive",
  "remote_file_upload_local_archive",
  "remote_file_prepare_upload_temp",
  "remote_file_append_upload_temp",
  "remote_file_delete_upload_temp",
  "remote_file_download",
  "remote_file_check_download_target",
  "remote_file_download_to_local",
]) {
  if (!commandsRs.includes(command) || !libRs.includes(`commands::${command}`)) {
    throw new Error(`Rust command ${command} should be defined and registered`);
  }
}

if (!commandsRs.includes("resolve_transient_connection") || !sshConfigRs.includes("pub fn resolve_transient_connection")) {
  throw new Error("Dialog connection tests should resolve a transient profile without persisting it");
}

const transientResolverMatch = sshConfigRs.match(
  /pub fn resolve_transient_connection\([\s\S]*?\n\}/,
);
if (!transientResolverMatch) {
  throw new Error("ssh_config.rs should define resolve_transient_connection");
}
const transientResolver = transientResolverMatch[0];
if (!transientResolver.includes("validate_profile_input(&input)")) {
  throw new Error("resolve_transient_connection should validate the current dialog profile input");
}
if (/ConnectionStore::load|store\.upsert|\.save\(\)/.test(transientResolver)) {
  throw new Error("resolve_transient_connection must not write or upsert connection profiles");
}

const dialogTestMatch = workspaceShell.match(
  /async function testConnectionFromDialog\([^)]*\)\s*\{([\s\S]*?)\n  \}/,
);
if (!dialogTestMatch) {
  throw new Error("WorkspaceShell should define testConnectionFromDialog");
}
const dialogTestBody = dialogTestMatch[1];
if (!dialogTestBody.includes("connectionTestProfile(input)")) {
  throw new Error("Dialog connection tests should call connectionTestProfile(input)");
}
if (/saveConnection\(|connectionUpsert|connectionTest\(\s*\{/.test(dialogTestBody)) {
  throw new Error("Dialog connection tests must not save/upsert the profile before testing");
}

for (const backendSymbol of [
  "RemoteFileReadResult",
  "RemoteFileWriteResult",
  "RemoteFileEntryMetadata",
  "RemoteFilePathCheckResult",
  "RemoteFileDownloadTargetCheckResult",
  "RemoteFileUploadResult",
  "RemoteFileArchiveUploadResult",
  "TransferConflictPolicy",
  "REMOTE_FILE_EDIT_LIMIT_BYTES",
  "read_file",
  "write_file",
  "upload_file",
  "upload_local_file",
  "upload_archive",
  "upload_local_archive",
  "download_archive",
  "build_remote_write_command",
  "build_remote_path_check_command",
  "build_remote_upload_command",
  "build_remote_resolve_child_command",
  "build_remote_extract_archive_command",
  "build_remote_archive_download_command",
  "parse_remote_file_metadata",
  "parse_remote_entry_metadata",
  "parse_remote_path_check_output",
  "parse_remote_transfer_path",
  "looks_like_binary",
  "ExecProgressCallback",
  "exec_with_stdin_progress",
  "exec_with_stdin_file_progress",
  "exec_with_stdout_progress",
]) {
  if (
    !remoteFilesRs.includes(backendSymbol) &&
    !terminalSessionRs.includes(backendSymbol) &&
    !commandsRs.includes(backendSymbol)
  ) {
    throw new Error(`remote file backend should include ${backendSymbol}`);
  }
}

for (const eventNeedle of [
  "REMOTE_FILE_TRANSFER_PROGRESS",
  "RemoteFileTransferProgressEvent",
  "remote_transfer_progress_callback",
]) {
  if (!eventsRs.includes(eventNeedle) && !commandsRs.includes(eventNeedle)) {
    throw new Error(`Remote file transfer progress events should include ${eventNeedle}`);
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

if (!remoteFilePanel.includes("const [activeDirectoryPath, setActiveDirectoryPath]")) {
  throw new Error("RemoteFilePanel should keep an active directory separate from the tree root path");
}

if (!remoteFilePanel.includes("previewDirectoryEntries") || remoteFilePanel.includes(": previewEntries;")) {
  throw new Error("RemoteFilePanel preview tree should return path-specific entries to avoid self-recursive mock directories");
}

if (!remoteFilePanel.includes("path={activeDirectoryPath}")) {
  throw new Error("RemoteFilePanel path input should render the active directory path");
}

if (!/function toggleDirectory\(entry: RemoteFileEntry\)[\s\S]*setActiveDirectoryPath\(entry\.path\)/.test(remoteFilePanel)) {
  throw new Error("RemoteFilePanel should update the active directory when expanding a directory row");
}

if (remoteFilePanel.includes("onDownloadCurrentDirectory")) {
  throw new Error("RemoteFilePanel toolbar should not expose a download-current-directory button");
}

if (/hasExpandedDirectories\s*\?\s*"active"/.test(remoteFilePanel)) {
  throw new Error("Collapse-expanded-directories should stay visually neutral and not use the active mini-action style");
}

for (const activeDirectoryNeedle of [
  "onRefresh={() => void loadDirectory(activeDirectoryPath, true)}",
  "onCopyCurrentPath={connection ? () => onCopyPath?.(activeDirectoryPath)",
  "handleDropUpload(event, activeDirectoryPath)",
  "onUploadFile?.(activeDirectoryPath)",
  "is-active-directory",
]) {
  if (!remoteFilePanel.includes(activeDirectoryNeedle)) {
    throw new Error(`RemoteFilePanel active-directory behavior should include ${activeDirectoryNeedle}`);
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
  "listenRemoteFileTransferProgress",
  "remoteFileUploadLocalFile",
  "remoteFileUploadLocalArchive",
  "remoteFilePrepareUploadTemp",
  "remoteFileAppendUploadTemp",
  "remoteFileDeleteUploadTemp",
  "remoteFileDownloadToLocal",
  "remoteFileCheckDownloadTarget",
  "resolveDownloadConflictPolicy",
  "downloadTargetOptions",
  "remoteFileMetadata",
  "remoteFileCheckPath",
  "resolveUploadConflictPolicy",
  "progressDetail",
  "speedText",
  "formatTransferSpeed",
  "RemoteFileTransferItem",
  "resolveUploadConflictPolicy",
  "resolveDownloadConflictPolicy",
  "setTransferProgress",
  "uploadTempAppendChunkBytes",
  "concatenateUint8Arrays",
  "selectLocalUploadFiles",
  "selectLocalUploadDirectories",
  "runLocalFileUpload",
  "runLocalDirectoryUpload",
  "localPathName",
  "writeFileToUploadTemp",
  "buildTarGzArchiveToTemp",
  "writeFileToTarGzipStream",
  "yieldToBrowser",
  "setRemoteFileTextValue(\"untitled.txt\")",
  "setRemoteFileTextValue(\"new-folder\")",
  "setRemoteFileTextValue(entry.name)",
  "remote-file-name-field",
  "remoteFileNameValidationMessage",
  "joinRemotePath(action.parentPath, value)",
]) {
  if (!workspaceShell.includes(workspaceNeedle)) {
    throw new Error(`WorkspaceShell should include ${workspaceNeedle}`);
  }
}

for (const forbiddenNameDialogNeedle of [
  "setRemoteFileTextValue(joinRemotePath",
  "remote-file-path-field",
  "请输入有效路径",
  "remoteFileCreateFile(action.connectionId, value",
  "remoteFileCreateDirectory(action.connectionId, value",
]) {
  if (workspaceShell.includes(forbiddenNameDialogNeedle)) {
    throw new Error(
      `Remote file create/rename dialogs should edit names only, found ${forbiddenNameDialogNeedle}`,
    );
  }
}

if (workspaceShell.includes("activeWorkspaceTabId")) {
  throw new Error("WorkspaceShell should keep remote file active state separate from terminal active state");
}

const activeSubterminalMatch = workspaceShell.match(
  /function openTerminalInActiveConnection\(\)\s*\{([\s\S]*?)\n  \}/,
);
if (!activeSubterminalMatch) {
  throw new Error("WorkspaceShell should define openTerminalInActiveConnection");
}
if (/openTerminal\(|startConnectionStep\(/.test(activeSubterminalMatch[1])) {
  throw new Error("Adding a same-connection terminal should not open the connection-preparation page");
}
for (const directTerminalNeedle of [
  "buildDirectTerminalTab",
  "runDirectTerminalTab",
  "terminal-direct-status",
]) {
  if (!workspaceShell.includes(directTerminalNeedle) && !styles.includes(directTerminalNeedle)) {
    throw new Error(`Same-connection terminal flow should include ${directTerminalNeedle}`);
  }
}
if (!/activeConnectedTerminalTab\s*\?\s*\(\s*<Tooltip label="新建同连接终端"/.test(workspaceShell)) {
  throw new Error("Same-connection terminal add button should only render after a terminal session is connected");
}

if (
  !/resolveUploadConflictPolicy[\s\S]*remoteFileCheckPath[\s\S]*promptTransferConflictPolicy/.test(
    workspaceShell,
  )
) {
  throw new Error("Upload conflict policy should preflight the remote target before prompting");
}

if (
  !/resolveDownloadConflictPolicy[\s\S]*remoteFileCheckDownloadTarget[\s\S]*promptTransferConflictPolicy/.test(
    workspaceShell,
  )
) {
  throw new Error("Download conflict policy should preflight the local target before prompting");
}

const transferSessionNameMatch = workspaceShell.match(
  /function transferSessionName\(([^)]*)\)\s*\{([\s\S]*?)\n\}/,
);
if (!transferSessionNameMatch) {
  throw new Error("WorkspaceShell should define transferSessionName for download grouping");
}
if (!/connection:\s*ConnectionProfile/.test(transferSessionNameMatch[1])) {
  throw new Error("transferSessionName should derive the download group from the connection profile");
}
if (/activeTab|terminalTabs/.test(transferSessionNameMatch[1] + transferSessionNameMatch[2])) {
  throw new Error("transferSessionName should not use terminal tab titles for download grouping");
}
if (!/connection\.name[\s\S]*connection\.host[\s\S]*mxterm-session/.test(transferSessionNameMatch[2])) {
  throw new Error("transferSessionName should prefer connection name, then host, then mxterm-session");
}

for (const archiveNeedle of [
  "CompressionStream(\"gzip\")",
  "buildTarGzArchiveToTemp",
  "ArchiveBuildProgress",
  "compression.writable.getWriter",
  "compression.readable.getReader",
  "remoteFileAppendUploadTemp(localPath",
  "webkitdirectory",
  "RemoteFileUploadItem",
]) {
  if (!workspaceShell.includes(archiveNeedle) && !remoteFilePanel.includes(archiveNeedle)) {
    throw new Error(`Folder transfer flow should include ${archiveNeedle}`);
  }
}

for (const transferProgressNeedle of [
  "transfer-progress",
  "transfer-progress-summary",
  "role=\"progressbar\"",
  "transfer_id",
  "remote_file:transfer_progress",
]) {
  if (
    !workspaceShell.includes(transferProgressNeedle) &&
    !styles.includes(transferProgressNeedle) &&
    !commandsTs.includes(transferProgressNeedle) &&
    !tauriEventsTs.includes(transferProgressNeedle) &&
    !remoteFileTypes.includes(transferProgressNeedle)
  ) {
    throw new Error(`Transfer progress UI should include ${transferProgressNeedle}`);
  }
}

for (const typeNeedle of [
  "RemoteFileEntryMetadata",
  "RemoteFilePathCheckResult",
  "RemoteFileDownloadTargetCheckInput",
  "RemoteFileDownloadTargetCheckResult",
  "RemoteFileTransferConflictPolicy",
  "RemoteFileUploadLocalInput",
  "RemoteFileArchiveUploadResult",
  "RemoteFileArchiveUploadLocalInput",
  "RemoteFileDownloadToLocalResult",
  "RemoteFileTransferProgressEvent",
  "LocalUploadTempResult",
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

for (const settingsUiNeedle of ["selectLocalDownloadDirectory", "settings-path-control"]) {
  if (!settingsView.includes(settingsUiNeedle) && !styles.includes(settingsUiNeedle)) {
    throw new Error(`File transfer settings UI should include ${settingsUiNeedle}`);
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
