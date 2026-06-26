import { readFileSync } from "node:fs";

const dockerPanelSource = readFileSync("src/features/tools/DockerToolPanel.tsx", "utf8");
const remoteFilePanelSource = readFileSync("src/features/files/RemoteFilePanel.tsx", "utf8");
const appCssSource = readFileSync("src/styles/app.css", "utf8");
const workspaceSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const commandsSource = readFileSync("src/shared/tauri/commands.ts", "utf8");
const dialogSource = readFileSync("src/shared/tauri/dialog.ts", "utf8");
const eventsSource = readFileSync("src/shared/tauri/events.ts", "utf8");
const dockerTypesSource = readFileSync("src/features/tools/dockerTypes.ts", "utf8");
const rustDockerSource = readFileSync("src-tauri/src/docker_tools.rs", "utf8");
const rustCommandsSource = readFileSync("src-tauri/src/commands.rs", "utf8");
const rustEventsSource = readFileSync("src-tauri/src/events.rs", "utf8");
const rustLibSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const tauriCapabilitySource = readFileSync("src-tauri/capabilities/default.json", "utf8");

const requiredDockerPanelSnippets = [
  "const containerAutoRefreshMs = 10_000;",
  "const imageAutoRefreshMs = 30_000;",
  "const engineAutoRefreshMs = 30_000;",
  "const containersRefreshRef = useRef<RefreshRunState>",
  "const imagesRefreshRef = useRef<RefreshRunState>",
  "const engineRefreshRef = useRef<RefreshRunState>",
  "const dockerInitialLoadRef = useRef(false);",
  "const engineInitialLoadRef = useRef(false);",
  "function formatDockerJsonConfig(content: string)",
  "return `${JSON.stringify(JSON.parse(trimmed), null, 2)}\\n`;",
  "const formattedContent = formatDockerJsonConfig(result.content);",
  "setEngineConfigDraft(formattedContent);",
  "const detailLine = formatContainerDetailLine(container);",
  "function formatContainerPorts(ports: string | null | undefined)",
  "formatContainerPortSegment(part)",
  ".replace(/^0\\.0\\.0\\.0:/, \"\")",
  "const dockerAutoRefreshActive = active && toolboxView === \"docker\" && Boolean(connectionId) && documentVisible;",
  "dockerInitialLoadRef.current = false;",
  "engineInitialLoadRef.current = false;",
  "if (!dockerAutoRefreshActive || dockerInitialLoadRef.current) {",
  "dockerInitialLoadRef.current = true;",
  "engineInitialLoadRef.current = true;",
  "if (state.inFlight) {",
  "state.pending = true;",
  "window.setInterval(() => {",
  "void refreshContainers({ silent: true, queueIfBusy: true });",
  "void refreshImages({ silent: true, queueIfBusy: true });",
  "void refreshEngineStatus({ silent: true, queueIfBusy: true });",
  "void refreshEngineConfig({ preserveDirty: true, silent: true, onlyIfMissing: true });",
  "const [logsContent, setLogsContent] = useState(\"\");",
  "const [logsStreamId, setLogsStreamId] = useState<string | null>(null);",
  "const [logsPaused, setLogsPaused] = useState(false);",
  "const [followLogs, setFollowLogs] = useState(true);",
  "const logOutputRef = useRef<HTMLPreElement | null>(null);",
  "listenDockerLogStream((event) => {",
  "startLogsStream(container, 300, true)",
  "dockerContainerLogsStart(connectionId, container.id, streamId, tail)",
  "startLogsStream(logsTarget, 0, false)",
  "dockerContainerLogsStop(streamId)",
  "dockerContainerLogsSave(localPath, logsContent)",
  "selectDockerLogSavePath(fileName)",
  "downloadBrowserTextFile(fileName, logsContent)",
  "onDownload={() => void downloadLogs()}",
  'stripAnsiControlCodes(event.content || "")',
  "setFollowLogs(false);",
  "暂停实时",
  "启用实时",
  "scrollLogsToBottom",
];

for (const snippet of requiredDockerPanelSnippets) {
  if (!dockerPanelSource.includes(snippet)) {
    throw new Error(`DockerToolPanel should keep cached auto-refresh without overlapping requests: ${snippet}`);
  }
}

const requiredWorkspaceSnippets = [
  "dockerExecInvalidateConnection",
  "function invalidateDockerExecConnection(connectionId: string)",
  "invalidateDockerExecConnection(connectionId);",
  "invalidateDockerExecConnection(connectionId);",
  '<DockerToolPanel',
];

for (const snippet of requiredWorkspaceSnippets) {
  if (!workspaceSource.includes(snippet)) {
    throw new Error(`WorkspaceShell should keep Docker panel mounted and release exec cache on final close: ${snippet}`);
  }
}

if (
  !remoteFilePanelSource.includes('className="tool-panel-slot" hidden={effectiveActiveTool !== "tools"}')
) {
  throw new Error("RemoteFilePanel should keep the tools panel mounted while other right-pane tabs are active.");
}

const requiredToolSlotCssSnippets = [
  ".tool-panel-slot {",
  "flex: 1 1 0;",
  "min-height: 0;",
  "display: flex;",
  "flex-direction: column;",
  ".tool-panel-slot[hidden] {",
  "display: none;",
];

for (const snippet of requiredToolSlotCssSnippets) {
  if (!appCssSource.includes(snippet)) {
    throw new Error(`RemoteFilePanel tools slot should preserve flex height while mounted: ${snippet}`);
  }
}

const requiredCommandSnippets = [
  "export function dockerExecInvalidateConnection(connectionId: string)",
  'invoke<void>("docker_exec_invalidate_connection"',
  "export function dockerContainerLogsStart(",
  'invoke<void>("docker_container_logs_start"',
  "export function dockerContainerLogsStop(streamId: string)",
  'invoke<void>("docker_container_logs_stop"',
  "export function dockerContainerLogsSave(localPath: string, content: string)",
  'invoke<void>("docker_container_logs_save"',
];

for (const snippet of requiredCommandSnippets) {
  if (!commandsSource.includes(snippet)) {
    throw new Error(`Tauri command wrappers should expose Docker exec invalidation: ${snippet}`);
  }
}

const requiredRustSnippets = [
  "pub async fn docker_exec_invalidate_connection",
  ".invalidate_connection(request.connection_id.trim())",
  "pub async fn docker_container_logs_start",
  "pub async fn docker_container_logs_stop",
  "pub fn docker_container_logs_save",
];

for (const snippet of requiredRustSnippets) {
  if (!rustCommandsSource.includes(snippet)) {
    throw new Error(`Rust commands should release cached Docker exec sessions: ${snippet}`);
  }
}

if (!rustLibSource.includes("commands::docker_exec_invalidate_connection")) {
  throw new Error("Tauri invoke handler should register docker_exec_invalidate_connection.");
}

const requiredDockerStreamSnippets = [
  "DockerContainerLogsStartRequest",
  "DockerContainerLogsStopRequest",
  "DockerContainerLogsSaveRequest",
  "DockerLogStreamManager",
  "start_log_stream",
  "stop_log_stream",
  "save_logs_to_local",
  ".min(MAX_LOG_TAIL)",
  "docker logs -f --tail",
  "DOCKER_LOG_STREAM_EVENT",
  "DockerLogStreamEvent",
  '"chunk"',
  '"finished"',
];

for (const snippet of requiredDockerStreamSnippets) {
  if (!rustDockerSource.includes(snippet) && !rustEventsSource.includes(snippet)) {
    throw new Error(`Rust Docker log streaming contract is missing: ${snippet}`);
  }
}

if (!rustLibSource.includes(".manage(docker_tools::DockerLogStreamManager::default())")) {
  throw new Error("Tauri builder should manage DockerLogStreamManager.");
}

for (const command of [
  "commands::docker_container_logs_start",
  "commands::docker_container_logs_stop",
  "commands::docker_container_logs_save",
]) {
  if (!rustLibSource.includes(command)) {
    throw new Error(`Tauri invoke handler should register ${command}.`);
  }
}

if (!dialogSource.includes("export async function selectDockerLogSavePath")) {
  throw new Error("Docker log download should use a shared save-dialog wrapper.");
}

if (!tauriCapabilitySource.includes('"dialog:allow-save"')) {
  throw new Error("Tauri capabilities should allow save dialogs for Docker log download.");
}

const requiredEventSnippets = [
  "DockerLogStreamEvent",
  "listenDockerLogStream",
  '"docker:log_stream"',
];

for (const snippet of requiredEventSnippets) {
  if (!eventsSource.includes(snippet) && !dockerTypesSource.includes(snippet)) {
    throw new Error(`Docker log stream event wrapper/type is missing: ${snippet}`);
  }
}

const requiredLogCssSnippets = [
  ".docker-logs-toolbar",
  ".docker-log-toolbar-actions",
  ".docker-log-live",
  ".docker-log-live.active",
  ".docker-log-follow",
  ".docker-log-follow.paused",
  ".docker-log-output.is-following",
  "height: min(760px, calc(100vh - 72px));",
  "width: min(980px, calc(100vw - 80px));",
];

for (const snippet of requiredLogCssSnippets) {
  if (!appCssSource.includes(snippet)) {
    throw new Error(`Docker log dialog streaming styles are missing: ${snippet}`);
  }
}

console.log("Docker tool refresh source check passed.");
