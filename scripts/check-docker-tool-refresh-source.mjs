import { readFileSync } from "node:fs";

const dockerPanelSource = readFileSync("src/features/tools/DockerToolPanel.tsx", "utf8");
const dockerRefreshStrategySource = readFileSync("src/features/tools/dockerRefreshStrategy.ts", "utf8");
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
  'const dockerInitialLoadRef = useRef<Record<"containers" | "images", boolean>>',
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
  "planDockerInitialRefresh({",
  "initialRefreshStarted: dockerInitialLoadRef.current[dockerView]",
  "dockerInitialLoadRef.current = {",
  "dockerInitialLoadRef.current[plannedView] = true;",
  "engineInitialLoadRef.current = false;",
  "shouldRunDockerAutoRefresh({",
  "engineInitialLoadRef.current = true;",
  "if (state.inFlight) {",
  "state.pending = true;",
  "window.setInterval(() => {",
  "void refreshContainers({ silent: true, queueIfBusy: true });",
  "void refreshImages({ silent: true, queueIfBusy: true });",
  "void refreshEngineStatus({ silent: true, queueIfBusy: true });",
  "void refreshEngineConfig({ preserveDirty: true, silent: true, onlyIfMissing: true });",
  "async function refreshCurrentDockerView()",
  "const [logsContent, setLogsContent] = useState(\"\");",
  "const [logsStreamId, setLogsStreamId] = useState<string | null>(null);",
  "const [logsPaused, setLogsPaused] = useState(false);",
  "const [followLogs, setFollowLogs] = useState(true);",
  "const [detailTarget, setDetailTarget] = useState<DockerContainerSummary | null>(null);",
  "const [containerDetail, setContainerDetail] = useState<DockerContainerDetail | null>(null);",
  "const logOutputRef = useRef<HTMLPreElement | null>(null);",
  "listenDockerLogStream((event) => {",
  "dockerContainerInspect(connectionId, container.id)",
  "dockerListNetworks(connectionId)",
  "dockerContainerUpdateRestartPolicy(",
  "dockerContainerConnectNetwork(connectionId, detailTarget.id, networkId)",
  "dockerImageRun(connectionId, normalized)",
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
  "DockerContainerDetailDialog",
  "docker-list--containers",
  "docker-list--images",
  "docker-container-card",
  "docker-container-state-dot",
  "docker-container-card-time",
  "docker-image-card",
  "docker-image-card-tag",
  "docker-image-card-time",
  "DockerImageRunDialog",
  "normalizeImageRunDraft",
  "docker-run-dialog",
  "docker-row-name-button",
  "docker-detail-action-button",
  "function formatImageTag",
  "Restart policy",
  "Join network",
  "scrollLogsToBottom",
];

for (const snippet of requiredDockerPanelSnippets) {
  if (!dockerPanelSource.includes(snippet)) {
    throw new Error(`DockerToolPanel should keep cached auto-refresh without overlapping requests: ${snippet}`);
  }
}

const requiredDockerRefreshStrategySnippets = [
  "export const dockerInitialRefreshDelayMs = 1_200;",
  "lastContainersRefreshAt <= 0",
  "lastImagesRefreshAt <= 0",
  "silent: false,",
  "export function shouldRunDockerAutoRefresh",
  "return active && dockerView === refreshKind;",
];

for (const snippet of requiredDockerRefreshStrategySnippets) {
  if (!dockerRefreshStrategySource.includes(snippet)) {
    throw new Error(`Docker refresh strategy should avoid tab-switch docker ps refreshes: ${snippet}`);
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
  "export function dockerContainerInspect(connectionId: string, containerId: string)",
  'invoke<DockerContainerDetail>("docker_container_inspect"',
  "export function dockerContainerUpdateRestartPolicy(",
  'invoke<DockerActionResult>("docker_container_update_restart_policy"',
  "export function dockerListNetworks(connectionId: string)",
  'invoke<DockerNetworkSummary[]>("docker_list_networks"',
  "export function dockerContainerConnectNetwork(",
  'invoke<DockerActionResult>("docker_container_connect_network"',
  "export function dockerImageRun(connectionId: string, request: DockerImageRunRequest)",
  'invoke<DockerActionResult>("docker_image_run"',
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
  "pub async fn docker_container_inspect",
  "pub async fn docker_container_update_restart_policy",
  "pub async fn docker_list_networks",
  "pub async fn docker_container_connect_network",
  "pub async fn docker_image_run",
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
  "DockerContainerDetail",
  "DockerNetworkSummary",
  "DockerContainerInspectRequest",
  "DockerContainerRestartPolicyRequest",
  "DockerNetworkConnectRequest",
  "DockerContainerLogsStartRequest",
  "DockerContainerLogsStopRequest",
  "DockerContainerLogsSaveRequest",
  "DockerImageRunRequest",
  "build_image_run_command",
  "DOCKER_LIST_NETWORKS_COMMAND",
  "DockerLogStreamManager",
  "container_inspect",
  "container_update_restart_policy",
  "list_networks",
  "container_connect_network",
  "parse_container_detail",
  "parse_networks",
  "docker inspect --",
  "docker update --restart",
  "docker network connect",
  "docker run -d",
  "docker network ls --format",
  "docker_container_inspect_parse_failed",
  "docker_network_parse_failed",
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
  "commands::docker_container_inspect",
  "commands::docker_container_update_restart_policy",
  "commands::docker_list_networks",
  "commands::docker_container_connect_network",
  "commands::docker_image_run",
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
  ".docker-row-name-button",
  ".docker-list--containers",
  ".docker-list--images",
  ".docker-container-card-head",
  ".docker-container-state-dot.running",
  ".docker-container-card-meta",
  ".docker-container-card-time",
  ".docker-image-card-head",
  ".docker-image-card-tag",
  ".docker-image-card-time",
  ".docker-run-dialog",
  ".docker-run-form",
  ".docker-run-section--inline",
  ".docker-run-row",
  ".docker-detail-dialog",
  ".docker-detail-body::-webkit-scrollbar-thumb",
  "scrollbar-color: var(--mx-scrollbar-thumb-hover) transparent;",
  ".docker-detail-section",
  ".docker-detail-settings",
  ".docker-detail-action-button",
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
