import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { IWindowsPty } from "@xterm/xterm";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Clipboard,
  CheckCircle2,
  CircleAlert,
  CornerDownLeft,
  KeyRound,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  List,
  Loader2,
  LockKeyhole,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  SquareTerminal,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ConnectionPane } from "../connections/ConnectionPane";
import { ConnectionSystemLogo } from "../connections/ConnectionSystemLogo";
import type {
  ConnectionAuthKind,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionRuntimeCredentialRequest,
  CredentialProfile,
  CredentialProfileInput,
  RdpEmbeddedBounds,
  HostKeyInfo,
  RdpCertificatePolicy,
  RdpLaunchPreview,
  RdpLaunchResult,
  RdpRunnerKind,
  VncLaunchPreview,
  VncLaunchResult,
  VncRunnerWindowPayload,
  VncRunnerKind,
} from "../connections/connectionTypes";
import {
  defaultRdpExternalRunnerForPlatform,
  defaultJumpConfig,
  defaultVncConfig,
  formatRdpRunnerKind,
  formatVncRunnerKind,
} from "../connections/connectionTypes";
import { connectionTimestampOf, sortConnectionsByRecent } from "../connections/connectionSearch";
import { connectionInfoFromVncProfile } from "../connections/vncConnectionInfo";
// RemoteFileEditor 内部静态 import 了 monaco-editor（主体约 4MB）及其 5 个 worker
// （合计约 10MB）。用 React.lazy 延迟到真正打开远程文件编辑标签时才加载，
// 避免在应用启动时解析 monaco 导致 release 构建下首屏卡顿和全局卡顿。
const loadRemoteFileEditor = () => import("../editor/RemoteFileEditor");
const loadConnectionDialog = () => import("../connections/ConnectionDialog");
const loadConnectionSearchDialog = () => import("../connections/ConnectionSearchDialog");
const loadRemoteFilePanel = () => import("../files/RemoteFilePanel");
const loadMonitorPanel = () => import("../monitor/MonitorPanel");
const loadSettingsView = () => import("../settings/SettingsView");
const loadDockerToolPanel = () => import("../tools/DockerToolPanel");
const loadCommandLibraryPanel = () => import("../commands/CommandLibraryPanel");
const loadAiAssistantPanel = () => import("../ai/AiAssistantPanel");
const loadVncViewerSurface = () => import("./VncViewerSurface");
const loadTerminalPanel = () => import("../terminal/TerminalPanel");

type ConnectionDialogModule = typeof import("../connections/ConnectionDialog");
type LoadedConnectionDialogComponent = ConnectionDialogModule["ConnectionDialog"];

let connectionDialogModulePromise: Promise<ConnectionDialogModule> | null = null;
let loadedConnectionDialogComponent: LoadedConnectionDialogComponent | null = null;

function preloadConnectionDialogModule() {
  connectionDialogModulePromise ??= loadConnectionDialog();
  return connectionDialogModulePromise;
}

async function preloadConnectionDialogComponent() {
  if (loadedConnectionDialogComponent) {
    return loadedConnectionDialogComponent;
  }
  const module = await preloadConnectionDialogModule();
  loadedConnectionDialogComponent = module.ConnectionDialog;
  return loadedConnectionDialogComponent;
}

const RemoteFileEditor = lazy(async () => {
  const module = await loadRemoteFileEditor();
  return { default: module.RemoteFileEditor };
});
const ConnectionDialog = lazy(async () => {
  const module = await preloadConnectionDialogModule();
  return { default: module.ConnectionDialog };
});
const ConnectionSearchDialog = lazy(async () => {
  const module = await loadConnectionSearchDialog();
  return { default: module.ConnectionSearchDialog };
});
const RemoteFilePanel = lazy(async () => {
  const module = await loadRemoteFilePanel();
  return { default: module.RemoteFilePanel };
});
const MonitorPanel = lazy(async () => {
  const module = await loadMonitorPanel();
  return { default: module.MonitorPanel };
});
const SettingsView = lazy(async () => {
  const module = await loadSettingsView();
  return { default: module.SettingsView };
});
const DockerToolPanel = lazy(async () => {
  const module = await loadDockerToolPanel();
  return { default: module.DockerToolPanel };
});
const CommandLibraryPanel = lazy(async () => {
  const module = await loadCommandLibraryPanel();
  return { default: module.CommandLibraryPanel };
});
const AiAssistantPanel = lazy(async () => {
  const module = await loadAiAssistantPanel();
  return { default: module.AiAssistantPanel };
});
const VncViewerSurface = lazy(async () => {
  const module = await loadVncViewerSurface();
  return { default: module.VncViewerSurface };
});
const TerminalPanel = lazy(async () => {
  const module = await loadTerminalPanel();
  return { default: module.TerminalPanel };
});

type LazyModuleLoader = () => Promise<unknown>;

const WORKSPACE_IDLE_PREWARM_BATCHES: Array<{
  timeoutMs: number;
  loaders: LazyModuleLoader[];
}> = [
  {
    timeoutMs: 350,
    loaders: [preloadConnectionDialogComponent],
  },
  {
    timeoutMs: 1500,
    loaders: [
      loadSettingsView,
      loadConnectionSearchDialog,
      loadRemoteFilePanel,
    ],
  },
  {
    timeoutMs: 5000,
    loaders: [
      loadCommandLibraryPanel,
      loadAiAssistantPanel,
      loadMonitorPanel,
      loadDockerToolPanel,
    ],
  },
];
import type { RemoteFileEditorTab } from "../editor/remoteFileEditorTypes";
import type { RemoteFileTool, RemoteFileUploadItem } from "../files/RemoteFilePanel";
import type { AiContextBlock } from "../ai/aiTypes";
import {
  isRemotePathStrictDescendant,
  normalizeRemotePath,
  remotePathParent,
} from "../files/remoteFilePaths";
import type {
  RemoteFileArchiveUploadResult,
  RemoteFileDownloadToLocalInput,
  RemoteFileDownloadToLocalResult,
  RemoteFileEntry,
  RemoteFileEntryMetadata,
  RemoteFileMetadata,
  RemoteFileReadResult,
  RemoteFileTransferConflictPolicy,
  RemoteFileTransferProgressEvent,
  RemoteFileUploadResult,
} from "../files/remoteFileTypes";
import type { DockerContainerSummary } from "../tools/dockerTypes";
import {
  getTerminalColorScheme,
  getTerminalColorSchemeTone,
  loadTerminalColorSchemes,
  onTerminalColorSchemesReady,
} from "../settings/terminalColorSchemes";
import {
  resolveSettingsStyle,
  resolveTerminalFontFamily,
  type FileTransferTimestampFormat,
  type RemoteFileOpenMode,
  type SettingsSectionId,
  type WindowMaterialMode,
} from "../settings/settingsTypes";
import { useSettings } from "../settings/useSettings";
import { useAppUpdate } from "../settings/useAppUpdate";
import { SecretVaultGate } from "../security/SecretVaultGate";
import { useSecretVault } from "../security/useSecretVault";
import { useConnections } from "../connections/useConnections";
import { useCredentials } from "../connections/useCredentials";
import { copyTextToClipboard } from "../../shared/clipboard";
import type {
  CommandHistoryEntry,
  CommandHistoryScope,
  CommandSnippet,
} from "../commands/commandLibraryTypes";
import type { CommandHistoryScopeOption } from "../commands/CommandLibraryPanel";
import { compareCommandLibraryTimestampsDesc } from "../commands/commandLibraryTime";
import {
  parseHostKeyError,
  type HostKeyDecision,
} from "../connections/hostKeyErrors";
import type {
  TerminalPromptDirectorySnapshotReader,
  TerminalSearchNavigationRequest,
} from "../terminal/TerminalPanel";
import {
  aiSendMessageShortcutActionId,
  resolveShortcutBindingById,
} from "../shortcuts/shortcutRegistry";
import { useShortcutManager, type ShortcutHandler } from "../shortcuts/useShortcutManager";
import type { TerminalOutputEvent } from "../terminal/terminalTypes";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { AnchoredSurfacePortal } from "../../shared/ui/AnchoredSurfacePortal";
import { AppSelect } from "../../shared/ui/AppSelect";
import { TabContextMenu } from "../../shared/ui/TabContextMenu";
import {
  commandHistoryClear,
  commandHistoryDelete,
  commandHistoryList,
  commandHistoryRecord,
  commandSnippetDelete,
  commandSnippetList,
  commandSnippetMarkUsed,
  commandSnippetUpsert,
  connectionTest,
  connectionTestProfile,
  getWindowsPtyInfo,
  knownHostTrust,
  connectionProbeLatency,
  localTerminalListProfiles,
  localTerminalOpen,
  remoteFileCheckPath,
  localPathMetadata,
  remoteFileCancelTransfer,
  remoteFileCheckDownloadTarget,
  remoteFileCreateDirectory,
  remoteFileCreateFile,
  remoteFileDelete,
  remoteFileDownloadToLocal,
  remoteFileMetadata,
  remoteFileAppendUploadTemp,
  remoteFileDeleteUploadTemp,
  remoteFilePrepareUploadTemp,
  remoteFileRead,
  remoteFileRename,
  remoteFileUploadLocalArchive,
  remoteFileUploadLocalFile,
  remoteFileWrite,
  dockerExecInvalidateConnection,
  rdpCloseSession,
  rdpLaunchConnection,
  rdpPreviewLaunch,
  rdpRevealSession,
  rdpResizeEmbeddedSession,
  vncCloseSession,
  vncLaunchConnection,
  vncPreviewLaunch,
  terminalClose,
  terminalConnect,
  terminalWrite,
  serialTerminalOpen,
  telnetTerminalOpen,
  tunnelAutostart,
} from "../../shared/tauri/commands";
import { selectLocalUploadDirectories, selectLocalUploadFiles } from "../../shared/tauri/dialog";
import {
  emitVncRunnerWindowCloseRequest,
  emitVncRunnerWindowPayload,
  listenRemoteFileTransferProgress,
  listenRdpSessionClosed,
  listenTerminalOutput,
  listenVncRunnerWindowClosed,
  listenVncRunnerWindowError,
  listenVncRunnerWindowMessage,
  listenVncRunnerWindowReady,
} from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import {
  type DesktopPlatform,
  getPlatformCapabilities,
  resolveDesktopPlatform,
} from "../../shared/tauri/platformCapabilities";
import {
  getSupportedWindowMaterials,
  normalizeWindowMaterial,
  setWindowMaterial,
} from "../../shared/tauri/windowMaterial";
import { syncCurrentWebviewBackground } from "../../shared/tauri/webviewBackground";
import { initializeWindowStatePersistence } from "../../shared/tauri/windowState";
import { Tooltip } from "../../shared/ui/Tooltip";
import { AppTitlebar } from "./AppTitlebar";
import { buildSshRemoteFilePanelStack } from "./remoteFilePanelStrategy";
import {
  LocalTerminalIcon,
  localTerminalTitle,
} from "../terminal/LocalTerminalIcons";
import type {
  LocalTerminalProfile,
  LocalTerminalProfileInput,
  LocalTerminalTab,
  WindowsPtyInfo,
} from "../terminal/localTerminalTypes";

type RdpConnectionProfile = ConnectionProfile & { protocol: "rdp" };
type VncConnectionProfile = ConnectionProfile & { protocol: "vnc" };
type TelnetConnectionProfile = ConnectionProfile & { protocol: "telnet" };
type SerialConnectionProfile = ConnectionProfile & { protocol: "serial" };
type SshConnectionProfile = ConnectionProfile & {
  protocol?: "ssh" | null | undefined;
};

const VNC_RUNNER_HOST_WINDOW_LABEL = "vnc-runner-host";

type WorkbenchTabKind = "terminal" | "file";
type WorkbenchTabDropZone = WorkbenchTabKind | "split-file" | "split-terminal";

interface UnifiedWorkbenchTab {
  id: string;
  kind: WorkbenchTabKind;
}

interface WorkbenchTabDragPayload extends UnifiedWorkbenchTab {
  connectionId: string;
}

interface WorkbenchTabMouseDrag {
  active: boolean;
  currentX: number;
  currentY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  payload: WorkbenchTabDragPayload;
  previewWidth: number;
  startX: number;
  startY: number;
}

interface TerminalTab {
  connectionStep?: ConnectionStepState | null;
  error?: string | null;
  id: string;
  connectionId: string;
  index: number;
  requestId?: string;
  sessionId?: string;
  status: string;
  title: string;
  type: "connecting" | "terminal";
  warmupOutput: number[];
}

type RdpSessionStatus = "launching" | "external" | "embedded" | "native" | "error";

interface RdpSessionTab {
  connectionId: string;
  createdAt: number;
  error?: string | null;
  id: string;
  message?: string | null;
  preview?: RdpLaunchPreview | null;
  result?: RdpLaunchResult | null;
  status: RdpSessionStatus;
  title: string;
}

type VncSessionStatus = "launching" | "embedded" | "windowed" | "external" | "error";

interface VncSessionTab {
  connectionId: string;
  createdAt: number;
  error?: string | null;
  id: string;
  message?: string | null;
  preview?: VncLaunchPreview | null;
  result?: VncLaunchResult | null;
  status: VncSessionStatus;
  title: string;
  windowLabel?: string | null;
}

interface ConnectionSessionSummary {
  connectionId: string;
  tabs: Array<{ id: string }>;
}

type CommandSenderDeliveryStatus = "idle" | "sent" | "failed";
type CommandSenderTargetKind = "ssh" | "local";

interface CommandSenderTargetTabOption {
  label: string;
  sessionId: string;
  tabId: string;
}

interface CommandSenderTarget {
  connectionId: string;
  deliveryMessage?: string;
  deliveryStatus: CommandSenderDeliveryStatus;
  description: string;
  key: string;
  kind: CommandSenderTargetKind;
  label: string;
  historyScope: CommandHistoryScope | null;
  sessionId: string;
  tabId: string;
  tabs: CommandSenderTargetTabOption[];
  tabTitle: string;
}

interface CommandSnippetDraft {
  command: string;
  description: string;
  favorite: boolean;
  group: string;
  id?: string;
  tagsText: string;
  title: string;
}

interface CommandSnippetGroupDialogState {
  error?: string | null;
  mode: "create" | "rename";
  originalName?: string;
  selectAfterSave?: boolean;
  value: string;
}

interface TerminalSearchState {
  caseSensitive: boolean;
  open: boolean;
  query: string;
}

type ConnectedTerminalTab = TerminalTab & { sessionId: string; type: "terminal" };

type ConnectionStepMode = "test" | "terminal";
type ConnectionStepStatus = "idle" | "running" | "waiting_host_key" | "prompt" | "success" | "error";

interface ConnectionStepState {
  activeStepIndex?: number | null;
  authKind: ConnectionAuthKind;
  connection: ConnectionProfile;
  errorDetail?: ConnectionStepErrorDetail | null;
  error?: string | null;
  hostKey?: HostKeyInfo | null;
  hostKeyDecision?: HostKeyDecision | null;
  oldHostKeyFingerprint?: string | null;
  id: number;
  logs: string[];
  mode: ConnectionStepMode;
  password: string;
  privateKeyPassphrase: string;
  privateKeyPath: string;
  sessionId?: string | null;
  status: ConnectionStepStatus;
}

interface ConnectionStepErrorDetail {
  code: string;
  message: string;
  rawMessage: string;
  recoverable: boolean;
  stage: string;
  suggestion: string;
}

interface ConnectionGroupInfo {
  color: string;
  id: string;
  name: string;
  parentId?: string | null;
}

interface ConnectionGroupCatalog {
  assignments: Record<string, string>;
  groups: ConnectionGroupInfo[];
}

interface RemoteFileRefreshRequest {
  connectionId: string;
  id: number;
  path: string;
}

interface RemoteFileLocateRequest {
  connectionId: string;
  id: number;
  path: string;
}

type RemoteFileTextAction =
  | { action: "create-directory"; connectionId: string; parentPath: string }
  | { action: "create-file"; connectionId: string; parentPath: string }
  | { action: "rename"; connectionId: string; entry: RemoteFileEntry };

interface RemoteFileDeleteTarget {
  connectionId: string;
  entries: RemoteFileEntry[];
}

type ConnectionFilter = "recent" | "all" | "favorites";

type LatencyProbeState =
  | { status: "checking" }
  | { latencyMs: number; status: "ok" }
  | { status: "failed" };
type ResizablePaneSide = "left" | "right";
type ResizingPane = ResizablePaneSide | "editor-terminal";
type TransferDirection = "upload" | "download";
type TransferKind = "file" | "directory";
type TransferStatus = "queued" | "running" | "success" | "error" | "skipped" | "canceled";
type WorkspaceMode = "home" | "ssh" | "local" | "rdp" | "vnc";

type RemoteFileTransferRetry =
  | {
      action: "local-file-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      localPath: string;
      parentPath: string;
    }
  | {
      action: "local-directory-upload";
      compress: boolean;
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      keepArchive: boolean;
      localPath: string;
      parentPath: string;
    }
  | {
      action: "browser-file-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      item: RemoteFileUploadItem;
      parentPath: string;
    }
  | {
      action: "browser-directory-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      items: RemoteFileUploadItem[];
      keepArchive: boolean;
      parentPath: string;
      rootName: string;
    }
  | {
      action: "download";
      entry: RemoteFileEntry;
      input: Omit<RemoteFileDownloadToLocalInput, "transferId">;
    };

interface RemoteFileTransferItem {
  id: string;
  createdAt: number;
  direction: TransferDirection;
  error?: string | null;
  kind: TransferKind;
  localPath?: string | null;
  name: string;
  progress: number;
  progressDetail?: string | null;
  progressIndeterminate?: boolean;
  retry?: RemoteFileTransferRetry | null;
  remotePath: string;
  speedText?: string | null;
  stage: string;
  startedAt: number;
  status: TransferStatus;
}

interface RemoteFilePropertiesState {
  entry: RemoteFileEntry;
  error?: string | null;
  loading: boolean;
  metadata?: RemoteFileEntryMetadata | null;
}

interface TransferConflictPromptState {
  description: string;
  id: string;
  name: string;
  resolve: (policy: RemoteFileTransferConflictPolicy | null) => void;
}

interface ArchiveBuildProgress {
  archiveBytes: number;
  loadedBytes: number;
  phase: "read" | "compress";
  totalBytes: number;
}

interface TransferRunOptions {
  connection?: ConnectionProfile;
  conflictPolicy?: RemoteFileTransferConflictPolicy;
  transferId?: string;
}

interface DirectoryTransferRunOptions extends TransferRunOptions {
  compress?: boolean;
  keepArchive?: boolean;
}

interface DownloadTransferRunOptions {
  input?: Omit<RemoteFileDownloadToLocalInput, "transferId">;
  transferId?: string;
}

type RemoteFileTransferTask = () => Promise<void>;

const defaultLeftPaneWidth = 336;
const minLeftPaneWidth = 248;
const maxLeftPaneWidth = 520;
const defaultRightPaneWidth = 360;
const minRightPaneWidth = 300;
const maxRightPaneWidth = 560;
const minCenterPaneWidth = 520;
const paneKeyboardResizeStep = 16;
const defaultEditorTerminalSplitPercent = 44;
const commandSnippetRootGroup = "";
const commandSnippetRootGroupLabel = "根目录";
const legacyCommandSnippetGroup = "未分组";
const localCommandSenderTargetId = "__local_terminal__";
const commandHistoryAllScopeKey = "all";
const commandHistorySshScopePrefix = "ssh:";
const commandHistoryLocalScopePrefix = "local:";
const connectionPromptAuthKindOptions: Array<{
  label: string;
  value: ConnectionAuthKind;
}> = [
  { label: "密码", value: "password" },
  { label: "私钥", value: "private_key" },
];
const minEditorTerminalSplitPercent = 24;
const maxEditorTerminalSplitPercent = 72;
const editorTerminalKeyboardResizeStep = 3;
const fileReadChunkBytes = 4 * 1024 * 1024;
const uploadTempAppendChunkBytes = fileReadChunkBytes;
const remoteFileDropTargetAttribute = "data-remote-file-drop-target";

type NativeFileDropPosition = Extract<DragDropEvent, { type: "enter" | "over" | "drop" }>["position"];

export function WorkspaceShell() {
  const {
    reset,
    settings,
    updateAppearance,
    updateBasic,
    updateCommand,
    updateFileTransfer,
    updateLocalTerminal,
    updateSecurity,
    updateShortcuts,
    updateTerminalTheme,
  } = useSettings();
  const appUpdate = useAppUpdate({
    autoCheckEnabled: settings.basic.autoCheckAppUpdate,
  });
  const secretVault = useSecretVault({
    autoLockMinutes: settings.security.autoLockMinutes,
    masterPasswordEnabled: settings.security.masterPasswordEnabled,
  });
  const storageReady = secretVault.ready;
  const effectiveAllowPasswordReveal =
    !settings.security.masterPasswordEnabled || settings.security.allowPasswordReveal;
  const {
    connections,
    error,
    loading,
    markConnected,
    probeSystem,
    reload,
    remove,
    setFavorite,
    upsert,
  } = useConnections({ enabled: storageReady });
  const {
    credentials,
    error: credentialError,
    loading: credentialLoading,
    remove: removeCredential,
    upsert: upsertCredential,
  } = useCredentials({ enabled: storageReady });
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeTabByConnectionId, setActiveTabByConnectionId] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<"workspace" | "settings">("workspace");
  const [settingsSectionRequest, setSettingsSectionRequest] =
    useState<SettingsSectionId | undefined>();
  const [settingsSectionRequestKey, setSettingsSectionRequestKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [LoadedConnectionDialog, setLoadedConnectionDialog] =
    useState<LoadedConnectionDialogComponent | null>(null);
  const [connectionSearchOpen, setConnectionSearchOpen] = useState(false);
  const [connectionSearchQuery, setConnectionSearchQuery] = useState("");
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const terminalTabsRef = useRef<TerminalTab[]>([]);
  const [rdpSessions, setRdpSessions] = useState<RdpSessionTab[]>([]);
  const rdpSessionsRef = useRef<RdpSessionTab[]>([]);
  const [vncSessions, setVncSessions] = useState<VncSessionTab[]>([]);
  const vncSessionsRef = useRef<VncSessionTab[]>([]);
  const pendingVncRunnerWindowPayloadsRef = useRef(new Map<string, VncRunnerWindowPayload>());
  const vncRunnerWindowReadyRef = useRef(false);
  const rdpEmbeddedViewportRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeRdpSessionId, setActiveRdpSessionId] = useState<string | null>(null);
  const [activeVncSessionId, setActiveVncSessionId] = useState<string | null>(null);
  const rdpEmbeddedHostSuppressedRef = useRef(false);
  const setRdpEmbeddedViewportRef = useCallback(
    (sessionId: string, node: HTMLDivElement | null) => {
      if (node) {
        rdpEmbeddedViewportRefs.current.set(sessionId, node);
      } else {
        rdpEmbeddedViewportRefs.current.delete(sessionId);
      }
    },
    [],
  );
  const measureRdpEmbeddedBounds = useCallback((sessionId: string) => {
    return measureRdpEmbeddedViewport(rdpEmbeddedViewportRefs.current.get(sessionId) || null);
  }, []);
  const syncRdpEmbeddedBounds = useCallback(
    (session: RdpSessionTab, bounds: RdpEmbeddedBounds | null, active: boolean) => {
      if (!hasTauriRuntime() || !session.result?.embedded || !session.result.session_id) {
        return;
      }
      const nextBounds = active && bounds ? bounds : hiddenRdpEmbeddedBounds();
      void rdpResizeEmbeddedSession(session.result.session_id, nextBounds).catch(() => undefined);
    },
    [],
  );
  const syncActiveRdpEmbeddedBounds = useCallback(() => {
    if (!hasTauriRuntime() || !activeRdpSessionId) {
      return;
    }
    const session = rdpSessionsRef.current.find((item) => item.id === activeRdpSessionId);
    if (!session?.result?.embedded) {
      return;
    }
    if (rdpEmbeddedHostSuppressedRef.current) {
      syncRdpEmbeddedBounds(session, null, false);
      return;
    }
    const bounds = measureRdpEmbeddedBounds(session.id);
    syncRdpEmbeddedBounds(session, bounds, true);
  }, [activeRdpSessionId, measureRdpEmbeddedBounds, syncRdpEmbeddedBounds]);
  const terminalWarmupCaptureStopsRef = useRef(new Map<string, () => void>());
  const [commandSenderOpen, setCommandSenderOpen] = useState(false);
  const [commandSenderInput, setCommandSenderInput] = useState("");
  const [commandSnippets, setCommandSnippets] = useState<CommandSnippet[]>([]);
  const [commandHistoryEntries, setCommandHistoryEntries] = useState<CommandHistoryEntry[]>([]);
  const [commandLibraryLoading, setCommandLibraryLoading] = useState(false);
  const [commandLibraryError, setCommandLibraryError] = useState<string | null>(null);
  const [commandLibraryUnavailableReason, setCommandLibraryUnavailableReason] =
    useState<string | null>(null);
  const [selectedCommandSnippetId, setSelectedCommandSnippetId] = useState<string | null>(null);
  const [selectedCommandHistoryId, setSelectedCommandHistoryId] = useState<string | null>(null);
  const [commandHistoryScopeKey, setCommandHistoryScopeKey] =
    useState(commandHistoryAllScopeKey);
  const [commandSnippetLocalGroups, setCommandSnippetLocalGroups] = useState<string[]>([]);
  const [commandSnippetDialogOpen, setCommandSnippetDialogOpen] = useState(false);
  const [commandSnippetDraft, setCommandSnippetDraft] = useState<CommandSnippetDraft>(
    () => buildCommandSnippetDraft(""),
  );
  const [commandSnippetGroupDialog, setCommandSnippetGroupDialog] =
    useState<CommandSnippetGroupDialogState | null>(null);
  const [commandSnippetFormError, setCommandSnippetFormError] = useState<string | null>(null);
  const [pendingCommandSnippetDelete, setPendingCommandSnippetDelete] =
    useState<CommandSnippet | null>(null);
  const [pendingCommandSnippetGroupDelete, setPendingCommandSnippetGroupDelete] =
    useState<string | null>(null);
  const [pendingCommandHistoryDelete, setPendingCommandHistoryDelete] =
    useState<CommandHistoryEntry | null>(null);
  const [commandHistoryClearOpen, setCommandHistoryClearOpen] = useState(false);
  const [commandSenderLastSentLabel, setCommandSenderLastSentLabel] =
    useState("上次发送：尚未发送");
  const [selectedCommandTargetKeys, setSelectedCommandTargetKeys] = useState<string[]>([]);
  const [commandSenderTargetTabByConnectionId, setCommandSenderTargetTabByConnectionId] =
    useState<Record<string, string>>({});
  const [commandSenderDeliveryByKey, setCommandSenderDeliveryByKey] =
    useState<Record<string, { message?: string; status: CommandSenderDeliveryStatus }>>({});
  const [terminalSearchByTabId, setTerminalSearchByTabId] =
    useState<Record<string, TerminalSearchState>>({});
  const [terminalSearchNavigationRequest, setTerminalSearchNavigationRequest] =
    useState<TerminalSearchNavigationRequest | null>(null);
  const [terminalRecentOutputByTabId, setTerminalRecentOutputByTabId] =
    useState<Record<string, string>>({});
  const [aiContextRequestKey, setAiContextRequestKey] = useState(0);
  const [aiInitialContexts, setAiInitialContexts] = useState<AiContextBlock[]>([]);
  const [localTerminalTabs, setLocalTerminalTabs] = useState<LocalTerminalTab[]>([]);
  const localTerminalTabsRef = useRef<LocalTerminalTab[]>([]);
  const [localTerminalProfiles, setLocalTerminalProfiles] = useState<LocalTerminalProfile[]>([]);
  const localTerminalProfilesRef = useRef<LocalTerminalProfile[]>([]);
  const [localTerminalProfilesLoading, setLocalTerminalProfilesLoading] = useState(false);
  const [localTerminalProfilesError, setLocalTerminalProfilesError] = useState<string | null>(null);
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState<WorkspaceMode>("home");
  const [activeLocalTerminalTabId, setActiveLocalTerminalTabId] = useState<string | null>(null);
  const [terminalDirectories, setTerminalDirectories] = useState<Record<string, string>>({});
  const terminalDirectoriesRef = useRef<Record<string, string>>({});
  const terminalPromptDirectorySnapshotReadersRef = useRef(
    new Map<string, TerminalPromptDirectorySnapshotReader>(),
  );
  const [remoteFileTabs, setRemoteFileTabs] = useState<RemoteFileEditorTab[]>([]);
  const [activeRemoteFileTabId, setActiveRemoteFileTabId] = useState<string | null>(null);
  const [terminalFileLayoutByConnectionId, setTerminalFileLayoutByConnectionId] =
    useState<Record<string, RemoteFileOpenMode>>({});
  const [activeUnifiedTabByConnectionId, setActiveUnifiedTabByConnectionId] =
    useState<Record<string, UnifiedWorkbenchTab>>({});
  const [workbenchTabMouseDrag, setWorkbenchTabMouseDrag] =
    useState<WorkbenchTabMouseDrag | null>(null);
  const [workbenchTabDropZone, setWorkbenchTabDropZone] = useState<WorkbenchTabDropZone | null>(null);
  const suppressNextWorkbenchTabClickRef = useRef(false);
  const [remoteFileLocateRequest, setRemoteFileLocateRequest] =
    useState<RemoteFileLocateRequest | null>(null);
  const [remoteFileRefreshRequest, setRemoteFileRefreshRequest] =
    useState<RemoteFileRefreshRequest | null>(null);
  const [pendingRemoteFileCloseId, setPendingRemoteFileCloseId] = useState<string | null>(null);
  const [pendingConnectionSessionCloseIds, setPendingConnectionSessionCloseIds] =
    useState<string[] | null>(null);
  const [pendingRemoteFileConflictId, setPendingRemoteFileConflictId] = useState<string | null>(null);
  const [remoteFileDeleteTarget, setRemoteFileDeleteTarget] =
    useState<RemoteFileDeleteTarget | null>(null);
  const [remoteFileTextAction, setRemoteFileTextAction] = useState<RemoteFileTextAction | null>(null);
  const [remoteFileTextValue, setRemoteFileTextValue] = useState("");
  const [remoteFileTextError, setRemoteFileTextError] = useState<string | null>(null);
  const [rightTool, setRightTool] = useState<RemoteFileTool>("files");
  const [aiAssistantPanelLoaded, setAiAssistantPanelLoaded] = useState(false);
  const [settingsViewLoaded, setSettingsViewLoaded] = useState(false);
  const [remoteFileTransfers, setRemoteFileTransfers] = useState<RemoteFileTransferItem[]>([]);
  const remoteFileTransfersRef = useRef<RemoteFileTransferItem[]>([]);
  const transferConcurrencyRef = useRef(settings.fileTransfer.concurrentTransfers);
  const transferQueueRef = useRef<string[]>([]);
  const runningTransferIdsRef = useRef<Set<string>>(new Set());
  const transferTasksRef = useRef<Map<string, RemoteFileTransferTask>>(new Map());
  const [nativeFileDropTargetPath, setNativeFileDropTargetPath] = useState<string | null>(null);
  const [remoteFileProperties, setRemoteFileProperties] =
    useState<RemoteFilePropertiesState | null>(null);
  const [transferConflictPrompt, setTransferConflictPrompt] =
    useState<TransferConflictPromptState | null>(null);
  const [homeActive, setHomeActive] = useState(true);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(defaultLeftPaneWidth);
  const [rightPaneWidth, setRightPaneWidth] = useState(defaultRightPaneWidth);
  const [editorTerminalSplitPercent, setEditorTerminalSplitPercent] = useState(
    defaultEditorTerminalSplitPercent,
  );
  const [resizingPane, setResizingPane] = useState<ResizingPane | null>(null);
  const [pendingConnectionGroupName, setPendingConnectionGroupName] = useState<string | null>(null);
  const [connectionGroupCatalog, setConnectionGroupCatalog] =
    useState<ConnectionGroupCatalog>({ assignments: {}, groups: [] });
  const desktopPlatform = useMemo(() => resolveDesktopPlatform(), []);
  const platformCapabilities = useMemo(
    () => getPlatformCapabilities(desktopPlatform),
    [desktopPlatform],
  );
  const [windowsPtyInfo, setWindowsPtyInfo] = useState<IWindowsPty | undefined>(() =>
    toWindowsPtyOption(null, desktopPlatform),
  );
  const [supportedWindowMaterials, setSupportedWindowMaterials] = useState<WindowMaterialMode[]>(
    () => platformCapabilities.windowMaterials,
  );
  const workspaceShellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    remoteFileTransfersRef.current = remoteFileTransfers;
  }, [remoteFileTransfers]);

  useEffect(() => {
    transferConcurrencyRef.current = settings.fileTransfer.concurrentTransfers;
    drainTransferQueue();
  }, [settings.fileTransfer.concurrentTransfers]);

  const loadCommandLibrary = useCallback(async () => {
    if (!storageReady || !hasTauriRuntime()) {
      setCommandSnippets([]);
      setCommandHistoryEntries([]);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
      setCommandLibraryLoading(false);
      return;
    }

    setCommandLibraryLoading(true);
    setCommandLibraryError(null);
    setCommandLibraryUnavailableReason(null);
    try {
      const [snippets, history] = await Promise.all([
        commandSnippetList(),
        commandHistoryList(50, commandHistoryScopeFromKey(commandHistoryScopeKey)),
      ]);
      setCommandSnippets(snippets);
      setCommandHistoryEntries(history);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      if (isCommandLibraryCommandMissingError(error)) {
        setCommandSnippets([]);
        setCommandHistoryEntries([]);
        setCommandLibraryUnavailableReason(commandLibraryRestartMessage());
        return;
      }
      setCommandLibraryError(formatError(error));
    } finally {
      setCommandLibraryLoading(false);
    }
  }, [commandHistoryScopeKey, storageReady]);

  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  useEffect(() => {
    terminalDirectoriesRef.current = terminalDirectories;
  }, [terminalDirectories]);

  useEffect(() => {
    rdpSessionsRef.current = rdpSessions;
  }, [rdpSessions]);

  useEffect(() => {
    vncSessionsRef.current = vncSessions;
  }, [vncSessions]);

  useEffect(() => {
    if (activeView === "settings") {
      setSettingsViewLoaded(true);
    }
  }, [activeView]);

  useEffect(() => initializeWindowStatePersistence(), []);

  const ensureConnectionDialogLoaded = useCallback(async () => {
    if (LoadedConnectionDialog) {
      return LoadedConnectionDialog;
    }
    const DialogComponent = await preloadConnectionDialogComponent();
    setLoadedConnectionDialog(() => DialogComponent);
    return DialogComponent;
  }, [LoadedConnectionDialog]);

  const preloadCreateConnectionDialog = useCallback(() => {
    void ensureConnectionDialogLoaded();
  }, [ensureConnectionDialogLoaded]);

  useEffect(() => {
    let active = true;
    void preloadConnectionDialogComponent()
      .then((DialogComponent) => {
        if (active) {
          setLoadedConnectionDialog(() => DialogComponent);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // 配色方案数据（约 280KB / 531 项）被拆成独立 chunk。启动阶段只注册就绪
  // 监听，并把预热放到浏览器空闲时段，避免 release 首屏后马上解析大数组。
  const [terminalColorSchemesReady, setTerminalColorSchemesReady] = useState(false);
  useEffect(() => {
    let active = true;
    const unsubscribe = onTerminalColorSchemesReady(() => {
      if (active) {
        setTerminalColorSchemesReady(true);
      }
    });
    const cancelIdleLoad = scheduleIdleTask(() => {
      void loadTerminalColorSchemes().catch(() => undefined);
    }, 3500);
    return () => {
      active = false;
      cancelIdleLoad();
      unsubscribe();
    };
  }, []);

  useEffect(() => scheduleWorkspaceModulePrewarm(), []);

  useEffect(() => {
    if (!hasTauriRuntime() || !storageReady) {
      return;
    }
    void tunnelAutostart().catch(() => undefined);
  }, [storageReady]);

  useEffect(() => {
    void loadCommandLibrary();
  }, [loadCommandLibrary]);

  useEffect(() => {
    localTerminalTabsRef.current = localTerminalTabs;
  }, [localTerminalTabs]);

  useEffect(() => {
    localTerminalProfilesRef.current = localTerminalProfiles;
  }, [localTerminalProfiles]);

  useEffect(() => {
    let disposed = false;

    async function loadProfiles() {
      setLocalTerminalProfilesLoading(true);
      setLocalTerminalProfilesError(null);
      try {
        const detected = hasTauriRuntime()
          ? await localTerminalListProfiles({
              hiddenProfileIds: settings.localTerminal.hiddenProfileIds,
              platform: desktopPlatform,
            })
          : previewLocalTerminalProfiles(desktopPlatform);
        if (disposed) {
          return;
        }
        setLocalTerminalProfiles(
          mergeLocalTerminalProfiles(
            detected,
            settings.localTerminal.customProfiles,
            settings.localTerminal.hiddenProfileIds,
          ),
        );
      } catch (error) {
        if (!disposed) {
          setLocalTerminalProfilesError(formatError(error));
          setLocalTerminalProfiles(
            mergeLocalTerminalProfiles(
              previewLocalTerminalProfiles(desktopPlatform),
              settings.localTerminal.customProfiles,
              settings.localTerminal.hiddenProfileIds,
            ),
          );
        }
      } finally {
        if (!disposed) {
          setLocalTerminalProfilesLoading(false);
        }
      }
    }

    void loadProfiles();

    return () => {
      disposed = true;
    };
  }, [
    desktopPlatform,
    settings.localTerminal.customProfiles,
    settings.localTerminal.hiddenProfileIds,
  ]);

  const connectionById = useMemo(() => {
    return new Map(connections.map((connection) => [connection.id, connection]));
  }, [connections]);

  const activeConnection = activeConnectionId
    ? connectionById.get(activeConnectionId) || null
    : null;
  const terminalTabsByConnection = useMemo(() => {
    const groups = new Map<string, TerminalTab[]>();

    terminalTabs.forEach((tab) => {
      const group = groups.get(tab.connectionId) || [];
      group.push(tab);
      groups.set(tab.connectionId, group);
    });

    return groups;
  }, [terminalTabs]);
  const rdpSessionsByConnection = useMemo(() => {
    const groups = new Map<string, RdpSessionTab[]>();

    rdpSessions.forEach((session) => {
      const group = groups.get(session.connectionId) || [];
      group.push(session);
      groups.set(session.connectionId, group);
    });

    return groups;
  }, [rdpSessions]);
  const vncSessionsByConnection = useMemo(() => {
    const groups = new Map<string, VncSessionTab[]>();

    vncSessions.forEach((session) => {
      const group = groups.get(session.connectionId) || [];
      group.push(session);
      groups.set(session.connectionId, group);
    });

    return groups;
  }, [vncSessions]);
  const connectionSessions = useMemo<ConnectionSessionSummary[]>(() => {
    const sessions = new Map<string, ConnectionSessionSummary>();

    terminalTabsByConnection.forEach((tabs, connectionId) => {
      sessions.set(connectionId, { connectionId, tabs });
    });
    rdpSessionsByConnection.forEach((tabs, connectionId) => {
      const existing = sessions.get(connectionId);
      sessions.set(connectionId, {
        connectionId,
        tabs: existing ? [...existing.tabs, ...tabs] : tabs,
      });
    });
    vncSessionsByConnection.forEach((tabs, connectionId) => {
      const existing = sessions.get(connectionId);
      sessions.set(connectionId, {
        connectionId,
        tabs: existing ? [...existing.tabs, ...tabs] : tabs,
      });
    });

    return Array.from(sessions.values());
  }, [rdpSessionsByConnection, terminalTabsByConnection, vncSessionsByConnection]);
  const activeConnectionTabs = activeConnectionId
    ? terminalTabsByConnection.get(activeConnectionId) || []
    : [];
  const activeRdpSessions = activeConnectionId
    ? rdpSessionsByConnection.get(activeConnectionId) || []
    : [];
  const activeRdpSession =
    (activeRdpSessionId
      ? rdpSessions.find(
          (session) =>
            session.id === activeRdpSessionId &&
            (!activeConnectionId || session.connectionId === activeConnectionId),
        ) || null
      : null) ||
    activeRdpSessions[0] ||
    null;
  const activeVncSessions = activeConnectionId
    ? vncSessionsByConnection.get(activeConnectionId) || []
    : [];
  const activeVncSession =
    (activeVncSessionId
      ? vncSessions.find(
          (session) =>
            session.id === activeVncSessionId &&
            (!activeConnectionId || session.connectionId === activeConnectionId),
        ) || null
      : null) ||
    activeVncSessions[0] ||
    null;
  const activeTerminalTab = activeTabId
    ? terminalTabs.find((tab) => tab.id === activeTabId) || null
    : null;
  const activeConnectedTerminalTab =
    activeTerminalTab?.type === "terminal" && activeTerminalTab.sessionId
      ? activeTerminalTab
      : null;
  const activeLocalTerminalTab = activeLocalTerminalTabId
    ? localTerminalTabs.find((tab) => tab.id === activeLocalTerminalTabId) || null
    : null;
  const activeTerminalSearch = activeConnectedTerminalTab
    ? terminalSearchByTabId[activeConnectedTerminalTab.id]
    : null;
  const activeLocalTerminalSearch = activeLocalTerminalTab
    ? terminalSearchByTabId[activeLocalTerminalTab.id]
    : null;
  const defaultCommandHistoryScopeKey = useMemo(
    () =>
      commandHistoryDefaultScopeKey({
        activeConnectionId,
        activeLocalTerminalTab,
        activeWorkspaceMode,
      }),
    [activeConnectionId, activeLocalTerminalTab, activeWorkspaceMode],
  );
  const commandHistoryScopeOptions = useMemo(
    () =>
      buildCommandHistoryScopeOptions({
        activeConnection,
        activeLocalTerminalTab,
        activeWorkspaceMode,
        connections,
        defaultScopeKey: defaultCommandHistoryScopeKey,
        localTerminalProfiles,
      }),
    [
      activeConnection,
      activeLocalTerminalTab,
      activeWorkspaceMode,
      connections,
      defaultCommandHistoryScopeKey,
      localTerminalProfiles,
    ],
  );
  useEffect(() => {
    setCommandHistoryScopeKey(defaultCommandHistoryScopeKey);
  }, [defaultCommandHistoryScopeKey]);

  useEffect(() => {
    if (
      commandHistoryScopeOptions.length > 0 &&
      !commandHistoryScopeOptions.some((option) => option.value === commandHistoryScopeKey)
    ) {
      setCommandHistoryScopeKey(defaultCommandHistoryScopeKey);
    }
  }, [commandHistoryScopeKey, commandHistoryScopeOptions, defaultCommandHistoryScopeKey]);

  const activeShortcutTerminalTabId =
    activeWorkspaceMode === "local"
      ? activeLocalTerminalTab?.id || null
      : activeWorkspaceMode === "ssh"
        ? activeConnectedTerminalTab?.id || null
        : null;
  const activeShortcutTerminalSearch = activeShortcutTerminalTabId
    ? terminalSearchByTabId[activeShortcutTerminalTabId]
    : null;
  const commandSnippetGroups = useMemo(
    () => buildCommandSnippetGroupCatalog(commandSnippets, commandSnippetLocalGroups),
    [commandSnippetLocalGroups, commandSnippets],
  );
  const commandSnippetGroupOptions = useMemo(
    () => [
      { label: commandSnippetRootGroupLabel, value: commandSnippetRootGroup },
      ...commandSnippetGroups.map((group) => ({ label: group, value: group })),
    ],
    [commandSnippetGroups],
  );
  const commandSenderTargets = useMemo(
    () =>
      buildCommandSenderTargets({
        activeTabByConnectionId,
        activeLocalTerminalTabId,
        connectionById,
        deliveryByKey: commandSenderDeliveryByKey,
        localTerminalProfiles,
        localTerminalTabs,
        selectedTabByConnectionId: commandSenderTargetTabByConnectionId,
        terminalTabs,
      }),
    [
      activeTabByConnectionId,
      activeLocalTerminalTabId,
      commandSenderDeliveryByKey,
      commandSenderTargetTabByConnectionId,
      connectionById,
      localTerminalProfiles,
      localTerminalTabs,
      terminalTabs,
    ],
  );
  const selectedCommandTargetKeySet = useMemo(
    () => new Set(selectedCommandTargetKeys),
    [selectedCommandTargetKeys],
  );
  const selectedCommandTargets = commandSenderTargets.filter((target) =>
    selectedCommandTargetKeySet.has(target.key),
  );
  const commandSenderSelectedCount = selectedCommandTargets.length;
  const commandSenderAllSelected =
    commandSenderTargets.length > 0 &&
    commandSenderSelectedCount === commandSenderTargets.length;
  const commandSenderPartiallySelected =
    commandSenderSelectedCount > 0 && !commandSenderAllSelected;
  const commandSenderCanSend =
    commandSenderInput.trim().length > 0 && selectedCommandTargets.length > 0;
  const commandSenderRisky = useMemo(
    () => isCommandSenderRisky(commandSenderInput),
    [commandSenderInput],
  );
  const shortcutHandlers = useMemo<Partial<Record<string, ShortcutHandler>>>(
    () => ({
      "commandSender.toggle": {
        enabled: () => commandSenderTargets.length > 0,
        run: openCommandSender,
      },
      "connection.quickOpen": {
        run: () => {
          setConnectionSearchOpen(true);
        },
      },
      "settings.open": {
        run: () => {
          openSettingsSection();
        },
      },
      "terminal.closeTab": {
        enabled: () =>
          activeWorkspaceMode === "local"
            ? Boolean(activeLocalTerminalTab)
            : activeWorkspaceMode === "rdp"
              ? Boolean(activeRdpSession)
              : activeWorkspaceMode === "vnc"
                ? Boolean(activeVncSession)
              : Boolean(activeTerminalTab),
        run: () => {
          if (activeWorkspaceMode === "local" && activeLocalTerminalTab) {
            closeLocalTerminal(activeLocalTerminalTab.id);
            return;
          }
          if (activeWorkspaceMode === "rdp" && activeRdpSession) {
            closeRdpSession(activeRdpSession.id);
            return;
          }
          if (activeWorkspaceMode === "vnc" && activeVncSession) {
            closeVncSession(activeVncSession.id);
            return;
          }
          if (activeTerminalTab) {
            closeTerminal(activeTerminalTab.id);
          }
        },
      },
      "terminal.newTab": {
        enabled: () =>
          activeWorkspaceMode === "local" ||
          (activeWorkspaceMode === "ssh" && isSshConnection(activeConnection)),
        run: () => {
          if (activeWorkspaceMode === "local") {
            void openLocalTerminalByProfile(resolveDefaultLocalTerminalProfile());
            return;
          }
          openTerminalInActiveConnection();
        },
      },
      "terminal.search.next": {
        enabled: () =>
          Boolean(activeShortcutTerminalTabId && activeShortcutTerminalSearch?.query.trim()),
        run: () => requestTerminalSearchNavigation("next"),
      },
      "terminal.search.previous": {
        enabled: () =>
          Boolean(activeShortcutTerminalTabId && activeShortcutTerminalSearch?.query.trim()),
        run: () => requestTerminalSearchNavigation("previous"),
      },
      "terminal.search.toggle": {
        enabled: () => Boolean(activeShortcutTerminalTabId),
        run: () => toggleTerminalSearch(activeShortcutTerminalTabId),
      },
    }),
    [
      activeConnectedTerminalTab,
      activeConnection,
      activeLocalTerminalTab,
      activeRdpSession,
      activeVncSession,
      activeShortcutTerminalSearch,
      activeShortcutTerminalTabId,
      activeTerminalTab,
      activeWorkspaceMode,
      commandSenderTargets.length,
    ],
  );

  useShortcutManager({
    bindings: settings.shortcuts.bindings,
    handlers: shortcutHandlers,
  });

  useEffect(() => {
    const availableKeys = new Set(commandSenderTargets.map((target) => target.key));

    setSelectedCommandTargetKeys((keys) => {
      const nextKeys = keys.filter((key) => availableKeys.has(key));
      return nextKeys.length === keys.length ? keys : nextKeys;
    });

    setCommandSenderDeliveryByKey((deliveryByKey) => {
      const entries = Object.entries(deliveryByKey).filter(([key]) => availableKeys.has(key));
      return entries.length === Object.keys(deliveryByKey).length
        ? deliveryByKey
        : Object.fromEntries(entries);
    });
  }, [commandSenderTargets]);

  useEffect(() => {
    if (
      selectedCommandSnippetId &&
      !commandSnippets.some((snippet) => snippet.id === selectedCommandSnippetId)
    ) {
      setSelectedCommandSnippetId(null);
    }
  }, [commandSnippets, selectedCommandSnippetId]);

  useEffect(() => {
    if (
      selectedCommandHistoryId &&
      !commandHistoryEntries.some((entry) => entry.id === selectedCommandHistoryId)
    ) {
      setSelectedCommandHistoryId(null);
    }
  }, [commandHistoryEntries, selectedCommandHistoryId]);

  useEffect(() => {
    const availableTabIds = new Set([
      ...terminalTabs.map((tab) => tab.id),
      ...localTerminalTabs.map((tab) => tab.id),
    ]);

    setTerminalSearchByTabId((states) => {
      const entries = Object.entries(states).filter(([tabId]) => availableTabIds.has(tabId));
      return entries.length === Object.keys(states).length ? states : Object.fromEntries(entries);
    });
    setTerminalRecentOutputByTabId((outputs) => {
      const entries = Object.entries(outputs).filter(([tabId]) => availableTabIds.has(tabId));
      return entries.length === Object.keys(outputs).length ? outputs : Object.fromEntries(entries);
    });
  }, [localTerminalTabs, terminalTabs]);

  useEffect(() => {
    setTerminalFileLayoutByConnectionId((layouts) => {
      const liveConnectionIds = new Set([
        ...terminalTabs.map((tab) => tab.connectionId),
        ...remoteFileTabs.map((tab) => tab.connectionId),
      ]);
      const fileConnectionIds = new Set(remoteFileTabs.map((tab) => tab.connectionId));
      let changed = false;
      const nextLayouts: Record<string, RemoteFileOpenMode> = {};

      Object.entries(layouts).forEach(([connectionId, mode]) => {
        if (!liveConnectionIds.has(connectionId)) {
          changed = true;
          return;
        }
        nextLayouts[connectionId] = mode;
      });

      fileConnectionIds.forEach((connectionId) => {
        if (!nextLayouts[connectionId]) {
          nextLayouts[connectionId] = settings.basic.remoteFileOpenMode;
          changed = true;
        }
      });

      return changed ? nextLayouts : layouts;
    });
  }, [remoteFileTabs, settings.basic.remoteFileOpenMode, terminalTabs]);

  useEffect(() => {
    setActiveUnifiedTabByConnectionId((activeTabs) => {
      let changed = false;
      const nextActiveTabs: Record<string, UnifiedWorkbenchTab> = {};

      Object.entries(activeTabs).forEach(([connectionId, activeTab]) => {
        const terminalTab = terminalTabs.find(
          (tab) => tab.connectionId === connectionId && tab.id === activeTab.id,
        );
        const fileTab = remoteFileTabs.find(
          (tab) => tab.connectionId === connectionId && tab.id === activeTab.id,
        );

        if (
          (activeTab.kind === "terminal" && terminalTab) ||
          (activeTab.kind === "file" && fileTab)
        ) {
          nextActiveTabs[connectionId] = activeTab;
          return;
        }

        const fallbackFileTab = remoteFileTabs.find((tab) => tab.connectionId === connectionId);
        const fallbackTerminalTab = terminalTabs.find((tab) => tab.connectionId === connectionId);
        if (fallbackFileTab) {
          nextActiveTabs[connectionId] = { kind: "file", id: fallbackFileTab.id };
        } else if (fallbackTerminalTab) {
          nextActiveTabs[connectionId] = { kind: "terminal", id: fallbackTerminalTab.id };
        }
        changed = true;
      });

      return changed ? nextActiveTabs : activeTabs;
    });
  }, [remoteFileTabs, terminalTabs]);

  useEffect(() => {
    if (!workbenchTabMouseDrag) {
      return;
    }

    const currentDrag = workbenchTabMouseDrag;

    function handleMouseMove(event: MouseEvent) {
      const active =
        currentDrag.active || mouseDragDistance(currentDrag, event.clientX, event.clientY) > 6;

      if (!active) {
        return;
      }

      event.preventDefault();
      setWorkbenchTabDropZone(getWorkbenchTabDropZoneFromPoint(event.clientX, event.clientY));
      setWorkbenchTabMouseDrag((drag) =>
        drag
          ? {
              ...drag,
              active: true,
              currentX: event.clientX,
              currentY: event.clientY,
            }
          : drag,
      );
    }

    function handleMouseUp(event: MouseEvent) {
      const active =
        currentDrag.active || mouseDragDistance(currentDrag, event.clientX, event.clientY) > 6;

      if (active) {
        event.preventDefault();
        suppressNextWorkbenchTabClickRef.current = true;
        window.setTimeout(() => {
          suppressNextWorkbenchTabClickRef.current = false;
        }, 0);

        const dropZone = getWorkbenchTabDropZoneFromPoint(event.clientX, event.clientY);
        if (dropZone) {
          applyWorkbenchTabMouseDrop(currentDrag.payload, dropZone);
          return;
        }
      }

      finishWorkbenchTabMouseDrag();
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [workbenchTabMouseDrag]);

  const activeRemoteFileTabs = activeWorkspaceMode === "ssh" && activeConnectionId && activeConnectedTerminalTab
    ? remoteFileTabs.filter((tab) => tab.connectionId === activeConnectionId)
    : [];
  const activeRemoteFileTab =
    (activeRemoteFileTabId
      ? activeRemoteFileTabs.find((tab) => tab.id === activeRemoteFileTabId) || null
      : null) ||
    activeRemoteFileTabs[0] ||
    null;
  const activeTerminalFileLayout = activeConnectionId
    ? terminalFileLayoutByConnectionId[activeConnectionId] || settings.basic.remoteFileOpenMode
    : settings.basic.remoteFileOpenMode;
  const isActiveTerminalFileUnified =
    activeTerminalFileLayout === "unified" && activeRemoteFileTabs.length > 0;
  const requestedUnifiedTab = activeConnectionId
    ? activeUnifiedTabByConnectionId[activeConnectionId] || null
    : null;
  const requestedUnifiedTerminalTab =
    requestedUnifiedTab?.kind === "terminal"
      ? activeConnectionTabs.find((tab) => tab.id === requestedUnifiedTab.id) || null
      : null;
  const requestedUnifiedFileTab =
    requestedUnifiedTab?.kind === "file"
      ? activeRemoteFileTabs.find((tab) => tab.id === requestedUnifiedTab.id) || null
      : null;
  const activeUnifiedTab: UnifiedWorkbenchTab | null = isActiveTerminalFileUnified
    ? requestedUnifiedFileTab
      ? { kind: "file", id: requestedUnifiedFileTab.id }
      : requestedUnifiedTerminalTab
        ? { kind: "terminal", id: requestedUnifiedTerminalTab.id }
        : activeRemoteFileTab
          ? { kind: "file", id: activeRemoteFileTab.id }
          : activeConnectedTerminalTab
            ? { kind: "terminal", id: activeConnectedTerminalTab.id }
            : null
    : null;
  const activeUnifiedTabKind = activeUnifiedTab?.kind || null;
  const isUnifiedFileTabActive = isActiveTerminalFileUnified && activeUnifiedTabKind === "file";
  const activeSshToolbarTerminalTab = isUnifiedFileTabActive ? null : activeConnectedTerminalTab;
  const showSshTerminalScopedActions = Boolean(activeSshToolbarTerminalTab);
  const showSshCommandSenderPanel = commandSenderOpen && showSshTerminalScopedActions;
  useEffect(() => {
    if (isUnifiedFileTabActive && commandSenderOpen) {
      setCommandSenderOpen(false);
    }
  }, [commandSenderOpen, isUnifiedFileTabActive]);
  const activeWorkbenchSurface =
    isUnifiedFileTabActive
      ? "panel"
      : activeConnectedTerminalTab
        ? "terminal"
        : "panel";
  const showUnifiedSplitDropZones = Boolean(
    isActiveTerminalFileUnified &&
      workbenchTabMouseDrag?.active &&
      activeConnectionId &&
      workbenchTabMouseDrag.payload.connectionId === activeConnectionId,
  );
  const hasSessionWorkspace =
    terminalTabs.length > 0 ||
    remoteFileTabs.length > 0 ||
    localTerminalTabs.length > 0 ||
    rdpSessions.length > 0 ||
    vncSessions.length > 0;
  const showingHome = activeWorkspaceMode === "home" || (!hasSessionWorkspace && homeActive);
  const showingLocalTerminal = activeWorkspaceMode === "local";
  const showingRdp = activeWorkspaceMode === "rdp";
  const showingVnc = activeWorkspaceMode === "vnc";
  const showSessionWorkspace = !showingHome && activeWorkspaceMode === "ssh" && hasSessionWorkspace;
  const showRdpWorkspace = !showingHome && showingRdp && hasSessionWorkspace;
  const showVncWorkspace = !showingHome && showingVnc && hasSessionWorkspace;
  const showWorkspaceToolPane = !showingHome && hasSessionWorkspace;
  const shouldShowAiAssistantPanel = showWorkspaceToolPane && rightTool === "ai";
  const shouldRenderAiAssistantPanel =
    aiAssistantPanelLoaded || shouldShowAiAssistantPanel;
  const shouldRenderSettingsView = settingsViewLoaded || activeView === "settings";
  const activeConnectionSelectionId =
    activeWorkspaceMode === "ssh" || activeWorkspaceMode === "rdp" || activeWorkspaceMode === "vnc"
      ? activeConnectionId
      : null;
  const activeTerminalDirectory = activeConnectedTerminalTab
    ? terminalDirectories[activeConnectedTerminalTab.id] || null
    : null;
  const activeAiTerminalTab =
    activeWorkspaceMode === "local" ? activeLocalTerminalTab : activeConnectedTerminalTab;
  const activeAiRecentTerminalOutput = activeAiTerminalTab
    ? terminalRecentOutputByTabId[activeAiTerminalTab.id] || ""
    : "";
  const activeAiTerminalTitle = activeAiTerminalTab?.title || null;
  const aiSendMessageShortcutBinding = resolveShortcutBindingById(
    settings.shortcuts.bindings,
    aiSendMessageShortcutActionId,
  );
  const remoteFileConnection =
    showSessionWorkspace && activeConnectedTerminalTab ? activeConnection : null;
  const remoteFilePanelKey = showingRdp
    ? activeRdpSession?.id || "no-rdp-session"
    : showingVnc
      ? activeVncSession?.id || "no-vnc-session"
      : remoteFileConnection?.id || "no-active-connection";
  const sshRemoteFilePanelStack = useMemo(
    () =>
      buildSshRemoteFilePanelStack({
        activeTabId,
        activeWorkspaceMode,
        rightPaneCollapsed,
        rightTool,
        tabs: terminalTabs,
      }),
    [activeTabId, activeWorkspaceMode, rightPaneCollapsed, rightTool, terminalTabs],
  );
  // 依赖 terminalColorSchemesReady：数据预热完成后重新取值，确保终端在
  // 首屏 fallback 主题渲染后切换到用户选择的真实主题（缓存就绪前
  // getTerminalColorScheme 返回 fallback）。
  const terminalColorScheme = useMemo(
    () => getTerminalColorScheme(settings.terminalTheme.scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.terminalTheme.scheme, terminalColorSchemesReady],
  );
  const terminalTone = getTerminalColorSchemeTone(terminalColorScheme);
  const terminalFontFamily = resolveTerminalFontFamily(settings.appearance);
  const defaultLocalTerminalProfile = useMemo(
    () => localTerminalProfiles[0] || null,
    [localTerminalProfiles],
  );
  const pendingRemoteFileCloseTab = pendingRemoteFileCloseId
    ? remoteFileTabs.find((tab) => tab.id === pendingRemoteFileCloseId) || null
    : null;
  const pendingConnectionSessionCloseSet = pendingConnectionSessionCloseIds
    ? new Set(pendingConnectionSessionCloseIds)
    : null;
  const pendingConnectionSessionDirtyTabs = pendingConnectionSessionCloseSet
    ? remoteFileTabs.filter(
        (tab) => pendingConnectionSessionCloseSet.has(tab.connectionId) && tab.dirty,
      )
    : [];
  const pendingRemoteFileConflictTab = pendingRemoteFileConflictId
    ? remoteFileTabs.find((tab) => tab.id === pendingRemoteFileConflictId) || null
    : null;
  const remoteFileDeleteEntries = remoteFileDeleteTarget
    ? collapseRemoteFileDeleteEntries(remoteFileDeleteTarget.entries)
    : [];
  const remoteFileDeleteAffectedTabs = remoteFileDeleteTarget
    ? remoteFileTabs.filter((tab) =>
        remoteFileDeleteEntries.some((entry) =>
          isRemoteFileTabUnderEntry(tab, remoteFileDeleteTarget.connectionId, entry.path),
        ),
      )
    : [];
  const remoteFileDeleteDirtyCount = remoteFileDeleteAffectedTabs.filter((tab) => tab.dirty).length;
  const shouldSuppressRdpEmbeddedHost =
    dialogOpen ||
    connectionSearchOpen ||
    commandSnippetDialogOpen ||
    Boolean(commandSnippetGroupDialog) ||
    Boolean(pendingCommandSnippetDelete) ||
    Boolean(pendingCommandSnippetGroupDelete) ||
    Boolean(pendingCommandHistoryDelete) ||
    commandHistoryClearOpen ||
    Boolean(pendingRemoteFileCloseTab) ||
    Boolean(pendingConnectionSessionCloseSet) ||
    Boolean(remoteFileDeleteTarget) ||
    Boolean(pendingRemoteFileConflictTab) ||
    Boolean(remoteFileTextAction) ||
    Boolean(remoteFileProperties) ||
    Boolean(transferConflictPrompt);
  const effectiveWindowMaterial = normalizeWindowMaterial(
    settings.appearance.windowMaterial,
    supportedWindowMaterials,
  );
  const appShellStyle = {
    ...resolveSettingsStyle(settings),
    "--editor-terminal-split-percent": `${editorTerminalSplitPercent.toString()}%`,
    "--left-pane-custom-width": `${leftPaneWidth.toString()}px`,
    "--right-pane-custom-width": `${rightPaneWidth.toString()}px`,
  } as CSSProperties;

  useEffect(() => {
    if (shouldShowAiAssistantPanel) {
      setAiAssistantPanelLoaded(true);
    }
  }, [shouldShowAiAssistantPanel]);

  const aiAssistantPanelNode = shouldRenderAiAssistantPanel ? (
    <Suspense fallback={<p className="file-panel-empty">正在加载 AI 面板...</p>}>
      <AiAssistantPanel
        active={showWorkspaceToolPane && !rightPaneCollapsed && rightTool === "ai"}
        commandDraft={commandSenderInput}
        connection={activeWorkspaceMode === "ssh" ? activeConnection : null}
        contextRequestKey={aiContextRequestKey}
        initialContexts={aiInitialContexts}
        recentCommands={commandHistoryEntries}
        recentTerminalOutput={activeAiRecentTerminalOutput}
        sendShortcutBinding={aiSendMessageShortcutBinding}
        terminalDirectory={activeWorkspaceMode === "ssh" ? activeTerminalDirectory : null}
        terminalTitle={activeAiTerminalTitle}
        onInsertCommand={insertAiCommandToSender}
        onOpenSettings={() => openSettingsSection("ai")}
        onSaveCommand={saveAiCommandAsSnippet}
        onSendCommand={sendAiCommandToTerminal}
      />
    </Suspense>
  ) : null;

  useLayoutEffect(() => {
    const body = document.body;
    document.body.dataset.themeMode = settings.appearance.themeMode;
    document.body.dataset.windowMaterial = effectiveWindowMaterial;
    document.body.dataset.density = settings.appearance.density;
    document.body.dataset.platform = desktopPlatform;

    const portalThemeStyle = resolveSettingsStyle(settings);
    for (const [name, value] of Object.entries(portalThemeStyle)) {
      body.style.setProperty(name, value);
    }

    void syncCurrentWebviewBackground();

    // system 主题模式下，监听系统深浅色切换，同步 WebView 背景
    let mediaQuery: MediaQueryList | null = null;
    let cleanup: (() => void) | null = null;

    if (settings.appearance.themeMode === "system") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        void syncCurrentWebviewBackground();
      };
      mediaQuery.addEventListener("change", handleChange);
      cleanup = () => mediaQuery?.removeEventListener("change", handleChange);
    }

    return () => {
      delete document.body.dataset.themeMode;
      delete document.body.dataset.windowMaterial;
      delete document.body.dataset.density;
      delete document.body.dataset.platform;
      for (const name of Object.keys(portalThemeStyle)) {
        body.style.removeProperty(name);
      }
      cleanup?.();
    };
  }, [
    desktopPlatform,
    effectiveWindowMaterial,
    settings,
    settings.appearance.density,
    settings.appearance.themeMode,
  ]);

  useEffect(() => {
    if (!platformCapabilities.supportsWindowsPty) {
      setWindowsPtyInfo(undefined);
      return;
    }

    if (!hasTauriRuntime()) {
      setWindowsPtyInfo(toWindowsPtyOption(null, desktopPlatform));
      return;
    }

    let disposed = false;
    void getWindowsPtyInfo()
      .then((info) => {
        if (!disposed) {
          setWindowsPtyInfo(toWindowsPtyOption(info, desktopPlatform));
        }
      })
      .catch(() => {
        if (!disposed) {
          setWindowsPtyInfo(toWindowsPtyOption(null, desktopPlatform));
        }
      });

    return () => {
      disposed = true;
    };
  }, [desktopPlatform, platformCapabilities.supportsWindowsPty]);

  useEffect(() => {
    let disposed = false;
    void getSupportedWindowMaterials().then((materials) => {
      if (!disposed) {
        setSupportedWindowMaterials(materials);
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (settings.appearance.windowMaterial !== effectiveWindowMaterial) {
      updateAppearance({ windowMaterial: effectiveWindowMaterial });
    }
  }, [effectiveWindowMaterial, settings.appearance.windowMaterial, updateAppearance]);

  useEffect(() => {
    rdpEmbeddedHostSuppressedRef.current = shouldSuppressRdpEmbeddedHost;
    if (!hasTauriRuntime()) {
      return;
    }

    if (shouldSuppressRdpEmbeddedHost) {
      if (activeRdpSession?.result?.embedded) {
        syncRdpEmbeddedBounds(activeRdpSession, null, false);
      }
      return;
    }

    const frame = window.requestAnimationFrame(syncActiveRdpEmbeddedBounds);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeRdpSession,
    shouldSuppressRdpEmbeddedHost,
    syncActiveRdpEmbeddedBounds,
    syncRdpEmbeddedBounds,
  ]);

  useEffect(() => {
    void setWindowMaterial(effectiveWindowMaterial);
  }, [effectiveWindowMaterial]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let frameId: number | null = null;
    const unlisteners: Array<() => void> = [];
    const scheduleSync = () => {
      if (disposed || frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncActiveRdpEmbeddedBounds();
      });
    };

    void (async () => {
      const unlistenMove = await appWindow.onMoved(scheduleSync);
      if (disposed) {
        unlistenMove();
        return;
      }
      unlisteners.push(unlistenMove);

      const unlistenResize = await appWindow.onResized(scheduleSync);
      if (disposed) {
        unlistenResize();
        return;
      }
      unlisteners.push(unlistenResize);

      const unlistenScale = await appWindow.onScaleChanged(scheduleSync);
      if (disposed) {
        unlistenScale();
        return;
      }
      unlisteners.push(unlistenScale);

      const unlistenFocus = await appWindow.onFocusChanged(scheduleSync);
      if (disposed) {
        unlistenFocus();
        return;
      }
      unlisteners.push(unlistenFocus);
    })();

    return () => {
      disposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [syncActiveRdpEmbeddedBounds]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenRemoteFileTransferProgress((event) => {
      if (!disposed) {
        applyRemoteTransferProgress(event);
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenRdpSessionClosed((event) => {
      if (disposed) {
        return;
      }
      const closedTabIds = rdpSessionsRef.current
        .filter((session) => session.result?.session_id === event.session_id)
        .map((session) => session.id);
      if (closedTabIds.length === 0) {
        return;
      }
      removeRdpSessionsLocally(closedTabIds);
      void rdpCloseSession(event.session_id).catch(() => undefined);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeConnectionId, activeRdpSessionId, activeWorkspaceMode, remoteFileTabs.length]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void Promise.all([
      listenVncRunnerWindowReady((event) => {
        if (disposed) {
          return;
        }
        vncRunnerWindowReadyRef.current = true;
        pendingVncRunnerWindowPayloadsRef.current.forEach((payload, sessionId) => {
          if (payload.window_label !== event.window_label) {
            return;
          }
          void emitVncRunnerWindowPayload(event.window_label, payload)
            .then(() => {
              pendingVncRunnerWindowPayloadsRef.current.delete(sessionId);
            })
            .catch(() => undefined);
        });
      }),
      listenVncRunnerWindowClosed((event) => {
        if (disposed) {
          return;
        }
        pendingVncRunnerWindowPayloadsRef.current.delete(event.workspace_session_id);
        closeVncSessions([event.workspace_session_id], { notifyRunnerWindow: false });
      }),
      listenVncRunnerWindowMessage((event) => {
        if (disposed || !vncSessionExists(event.workspace_session_id)) {
          return;
        }
        updateVncSession(event.workspace_session_id, (session) => ({
          ...session,
          message: event.message,
        }));
      }),
      listenVncRunnerWindowError((event) => {
        if (disposed || !vncSessionExists(event.workspace_session_id)) {
          return;
        }
        const session = vncSessionsRef.current.find(
          (item) => item.id === event.workspace_session_id,
        );
        if (session?.result?.session_id) {
          void vncCloseSession(session.result.session_id).catch(() => undefined);
        }
        updateVncSession(event.workspace_session_id, (current) => ({
          ...current,
          error: event.message,
          message: null,
          status: "error",
        }));
      }),
    ]).then((cleanups) => {
      if (disposed) {
        cleanups.forEach((cleanup) => cleanup());
      } else {
        unlisteners.push(...cleanups);
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [activeConnectionId, activeVncSessionId, activeWorkspaceMode, remoteFileTabs.length]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (!disposed) {
        handleNativeFileDropEvent(event.payload);
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      setNativeFileDropTargetPath(null);
    };
  }, [
    remoteFileConnection?.id,
    rightPaneCollapsed,
    rightTool,
    settings.fileTransfer.conflictPolicyDefault,
    settings.fileTransfer.keepArchives,
    showSessionWorkspace,
    showWorkspaceToolPane,
  ]);

  const updateTabStatus = useCallback((tabId: string, status: string) => {
    setTerminalTabs((tabs) =>
      tabs.map((tab) => (tab.id === tabId && tab.status !== status ? { ...tab, status } : tab)),
    );
  }, []);

  const updateTerminalRuntimeSession = useCallback((
    tabId: string,
    sessionId: string,
    requestId?: string,
  ) => {
    setTerminalTabs((tabs) => {
      let changed = false;
      const nextTabs = tabs.map((tab) => {
        if (tab.id !== tabId || tab.type !== "terminal") {
          return tab;
        }
        const nextRequestId = requestId || tab.requestId;
        if (
          tab.sessionId === sessionId &&
          tab.requestId === nextRequestId &&
          tab.status === "已连接" &&
          tab.error === null &&
          tab.warmupOutput.length === 0
        ) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          error: null,
          requestId: nextRequestId,
          sessionId,
          status: "已连接",
          warmupOutput: [],
        };
      });
      if (!changed) {
        return tabs;
      }
      terminalTabsRef.current = nextTabs;
      return nextTabs;
    });
  }, []);

  const updateLocalTerminalTabStatus = useCallback((tabId: string, status: string) => {
    setLocalTerminalTabs((tabs) =>
      tabs.map((tab) => (tab.id === tabId && tab.status !== status ? { ...tab, status } : tab)),
    );
  }, []);

  const updateTerminalDirectory = useCallback((tabId: string, path: string) => {
    setTerminalDirectories((directories) => {
      if (directories[tabId] === path) {
        terminalDirectoriesRef.current = directories;
        return directories;
      }
      const nextDirectories = { ...directories, [tabId]: path };
      terminalDirectoriesRef.current = nextDirectories;
      return nextDirectories;
    });
  }, []);

  const updateTerminalPromptDirectorySnapshotReader = useCallback((
    tabId: string,
    reader: TerminalPromptDirectorySnapshotReader | null,
  ) => {
    if (reader) {
      terminalPromptDirectorySnapshotReadersRef.current.set(tabId, reader);
    } else {
      terminalPromptDirectorySnapshotReadersRef.current.delete(tabId);
    }
  }, []);

  const resolveTerminalLocatePath = useCallback((tabId: string) => {
    const snapshotPath = terminalPromptDirectorySnapshotReadersRef.current.get(tabId)?.() || null;
    if (snapshotPath) {
      const normalizedPath = normalizeRemotePath(snapshotPath);
      updateTerminalDirectory(tabId, normalizedPath);
      return normalizedPath;
    }
    return terminalDirectoriesRef.current[tabId] || null;
  }, [updateTerminalDirectory]);

  const appendTerminalRecentOutput = useCallback((tabId: string, output: string) => {
    if (!output) {
      return;
    }
    setTerminalRecentOutputByTabId((items) => {
      const nextOutput = tailStringByChars(`${items[tabId] || ""}${stripTerminalControlText(output)}`, 12000);
      return nextOutput === items[tabId] ? items : { ...items, [tabId]: nextOutput };
    });
  }, []);

  function remoteFileTabId(connectionId: string, path: string) {
    return `file:${connectionId}:${normalizeRemotePath(path)}`;
  }

  function updateRemoteFileTab(
    tabId: string,
    updater: (tab: RemoteFileEditorTab) => RemoteFileEditorTab,
  ) {
    setRemoteFileTabs((tabs) => tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }

  function triggerRemoteFileRefresh(connectionId: string, path: string) {
    setRemoteFileRefreshRequest((request) => ({
      connectionId,
      id: (request?.id || 0) + 1,
      path: normalizeRemotePath(path),
    }));
  }

  function triggerRemoteFileLocate(connectionId: string, path: string) {
    setRemoteFileLocateRequest((request) => ({
      connectionId,
      id: (request?.id || 0) + 1,
      path: normalizeRemotePath(path),
    }));
  }

  function applyRemoteTransferProgress(event: RemoteFileTransferProgressEvent) {
    setRemoteFileTransfers((items) => {
      const nextItems = items.map((item) => {
        if (item.id !== event.transfer_id || item.status !== "running") {
          return item;
        }

        const hasKnownTotal = event.total_bytes !== null && event.total_bytes !== undefined;
        const totalBytes = event.total_bytes ?? 0;
        const progress =
          totalBytes > 0 ? transferProgressPercent(event.loaded_bytes, totalBytes) : item.progress;
        const displayProgress =
          event.direction === "upload" && progress >= 100 ? 99 : progress;
        const stage =
          event.direction === "upload" && progress >= 100
            ? "等待远端确认"
            : item.kind === "directory" && event.direction === "download" && !hasKnownTotal
              ? "压缩中"
              : event.direction === "upload"
                ? "上传中"
                : "下载中";
        const progressDetail =
          item.kind === "directory" && event.direction === "download" && !hasKnownTotal
            ? `压缩包 ${formatFileSize(event.loaded_bytes)}`
            : formatTransferProgressBytes(event.loaded_bytes, totalBytes);

        return {
          ...item,
          progress: clampTransferProgress(displayProgress),
          progressDetail,
          progressIndeterminate: totalBytes <= 0,
          speedText: formatTransferSpeed(
            calculateTransferAverageSpeed(event.loaded_bytes, item.startedAt),
          ),
          stage,
        };
      });
      remoteFileTransfersRef.current = nextItems;
      return nextItems;
    });
  }

  function addRemoteFileTransfer(input: {
    direction: TransferDirection;
    kind: TransferKind;
    name: string;
    progress?: number;
    progressDetail?: string | null;
    progressIndeterminate?: boolean;
    remotePath: string;
    retry?: RemoteFileTransferRetry | null;
    speedText?: string | null;
    stage: string;
  }) {
    const id = `transfer-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: RemoteFileTransferItem = {
      createdAt: Date.now(),
      direction: input.direction,
      error: null,
      id,
      kind: input.kind,
      localPath: null,
      name: input.name,
      progress: input.progress ?? 0,
      progressDetail: input.progressDetail ?? null,
      progressIndeterminate: input.progressIndeterminate ?? false,
      remotePath: normalizeRemotePath(input.remotePath),
      retry: input.retry ?? null,
      speedText: input.speedText ?? null,
      stage: input.stage,
      startedAt: Date.now(),
      status: "queued",
    };
    setRemoteFileTransfers((items) => {
      const nextItems = [item, ...items];
      remoteFileTransfersRef.current = nextItems;
      return nextItems;
    });
    return id;
  }

  function updateRemoteFileTransfer(
    transferId: string,
    update: Partial<Omit<RemoteFileTransferItem, "id" | "createdAt">>,
  ) {
    setRemoteFileTransfers((items) => {
      const nextItems = items.map((item) => {
        if (item.id !== transferId) {
          return item;
        }
        const next = { ...item, ...update };
        if (update.progressDetail === "100%" && item.progressDetail?.includes(" / ")) {
          next.progressDetail = item.progressDetail;
        }
        return next;
      });
      remoteFileTransfersRef.current = nextItems;
      return nextItems;
    });
  }

  function setTransferProgress(
    transferId: string,
    input: {
      detail?: string | null;
      indeterminate?: boolean;
      progress: number;
      speedText?: string | null;
      stage: string;
      status?: TransferStatus;
    },
  ) {
    updateRemoteFileTransfer(transferId, {
      progress: clampTransferProgress(input.progress),
      progressDetail: input.detail ?? null,
      progressIndeterminate: input.indeterminate ?? false,
      speedText: input.speedText ?? null,
      stage: input.stage,
      status: input.status ?? "running",
    });
  }

  function startTransferProgressPulse(
    transferId: string,
    input: {
      cap: number;
      detail?: string | null;
      start: number;
      stage: string;
      speedText?: string | null;
    },
  ) {
    let tick = 0;
    setTransferProgress(transferId, {
      detail: input.detail,
      indeterminate: true,
      progress: input.start,
      speedText: input.speedText,
      stage: input.stage,
    });

    const timer = window.setInterval(() => {
      tick += 1;
      const eased = input.start + (input.cap - input.start) * (1 - Math.pow(0.86, tick));
      updateRemoteFileTransfer(transferId, {
        progress: Math.min(input.cap, eased),
        progressIndeterminate: true,
        stage: input.stage,
        status: "running",
      });
    }, 1200);

    return () => window.clearInterval(timer);
  }

  function enqueueRemoteFileTransfer(transferId: string, task: RemoteFileTransferTask) {
    transferTasksRef.current.set(transferId, task);
    if (
      !transferQueueRef.current.includes(transferId) &&
      !runningTransferIdsRef.current.has(transferId)
    ) {
      transferQueueRef.current.push(transferId);
    }
    drainTransferQueue();
  }

  function drainTransferQueue() {
    const maxConcurrentTransfers = transferConcurrencyRef.current;

    while (
      runningTransferIdsRef.current.size < maxConcurrentTransfers &&
      transferQueueRef.current.length > 0
    ) {
      const transferId = transferQueueRef.current.shift();
      if (!transferId) {
        continue;
      }

      const task = transferTasksRef.current.get(transferId);
      const item = remoteFileTransfersRef.current.find((transfer) => transfer.id === transferId);
      if (!task || (item && item.status !== "queued")) {
        transferTasksRef.current.delete(transferId);
        continue;
      }

      runningTransferIdsRef.current.add(transferId);
      updateRemoteFileTransfer(transferId, {
        startedAt: Date.now(),
        status: "running",
      });

      void task()
        .catch((error) => {
          failTransfer(transferId, "传输失败", error);
        })
        .finally(() => {
          runningTransferIdsRef.current.delete(transferId);
          transferTasksRef.current.delete(transferId);
          drainTransferQueue();
        });
    }
  }

  function dropQueuedTransfer(transferId: string) {
    transferQueueRef.current = transferQueueRef.current.filter((id) => id !== transferId);
    transferTasksRef.current.delete(transferId);
  }

  function isTransferNoLongerActive(transferId: string) {
    const item = remoteFileTransfersRef.current.find((transfer) => transfer.id === transferId);
    return Boolean(item && (item.status === "canceled" || item.status === "error"));
  }

  function cancelQueuedTransfer(transferId: string) {
    dropQueuedTransfer(transferId);
    updateRemoteFileTransfer(transferId, {
      error: null,
      progress: 0,
      progressDetail: null,
      progressIndeterminate: false,
      speedText: null,
      stage: "已取消",
      status: "canceled",
    });
  }

  function clearFinishedTransfers() {
    setRemoteFileTransfers((items) => {
      const nextItems = items.filter((item) => item.status === "queued" || item.status === "running");
      remoteFileTransfersRef.current = nextItems;
      return nextItems;
    });
  }

  function removeRemoteFileTransfer(transferId: string) {
    dropQueuedTransfer(transferId);
    setRemoteFileTransfers((items) => {
      const nextItems = items.filter((item) => item.id !== transferId);
      remoteFileTransfersRef.current = nextItems;
      return nextItems;
    });
  }

  function cancelTransfer(transferId: string) {
    updateRemoteFileTransfer(transferId, {
      progress: 0,
      progressDetail: null,
      progressIndeterminate: false,
      speedText: null,
      status: "canceled",
      stage: "已取消",
    });
  }

  function requestCancelTransfer(transferId: string) {
    const item = remoteFileTransfers.find((transfer) => transfer.id === transferId);
    if (!item || item.status === "queued") {
      cancelQueuedTransfer(transferId);
      return;
    }
    if (item.status !== "running") {
      return;
    }
    cancelTransfer(transferId);
    if (hasTauriRuntime()) {
      void remoteFileCancelTransfer(transferId).catch(() => undefined);
    }
  }

  function prepareTransferRetry(transferId: string, stage: string) {
    updateRemoteFileTransfer(transferId, {
      error: null,
      localPath: null,
      progress: 0,
      progressDetail: null,
      progressIndeterminate: false,
      speedText: null,
      stage,
      startedAt: Date.now(),
      status: "queued",
    });
  }

  function connectionForTransfer(connectionId: string) {
    return connectionById.get(connectionId) || null;
  }

  function retryRemoteFileTransfer(transferId: string) {
    const item = remoteFileTransfers.find((transfer) => transfer.id === transferId);
    if (!item || item.status !== "error" || !item.retry) {
      return;
    }

    const retry = item.retry;
    const connection = retry.action === "download" ? null : connectionForTransfer(retry.connectionId);
    if (retry.action !== "download" && !connection) {
      failTransfer(transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      return;
    }

    switch (retry.action) {
      case "local-file-upload":
        void runLocalFileUpload(retry.parentPath, retry.localPath, {
          connection: connection!,
          conflictPolicy: retry.conflictPolicy,
          transferId,
        });
        return;
      case "local-directory-upload":
        void runLocalDirectoryUpload(retry.parentPath, retry.localPath, {
          compress: retry.compress,
          connection: connection!,
          conflictPolicy: retry.conflictPolicy,
          keepArchive: retry.keepArchive,
          transferId,
        });
        return;
      case "browser-file-upload":
        void runSingleFileUpload(retry.parentPath, retry.item, {
          connection: connection!,
          conflictPolicy: retry.conflictPolicy,
          transferId,
        });
        return;
      case "browser-directory-upload":
        void runDirectoryUpload(retry.parentPath, retry.rootName, retry.items, {
          connection: connection!,
          conflictPolicy: retry.conflictPolicy,
          keepArchive: retry.keepArchive,
          transferId,
        });
        return;
      case "download":
        void runRemoteFileDownload(retry.entry, {
          input: retry.input,
          transferId,
        });
    }
  }

  function failTransfer(transferId: string, stage: string, error: unknown) {
    if (isTransferCanceledError(error)) {
      cancelTransfer(transferId);
      return;
    }
    const code = extractTransferErrorCode(error);
    const mappedStage = code ? transferErrorStage(code) : null;
    const suggestion = code ? transferErrorSuggestion(code) : null;
    const baseError = formatDetailedError(error);
    const errorText = suggestion ? `${baseError}\n建议：${suggestion}` : baseError;
    updateRemoteFileTransfer(transferId, {
      error: errorText,
      progressIndeterminate: false,
      speedText: null,
      stage: mappedStage ?? stage,
      status: "error",
    });
  }

  function downloadTargetOptions(connection: ConnectionProfile, entry: RemoteFileEntry) {
    return {
      connectionId: connection.id,
      directory: entry.type === "directory",
      downloadRoot: settings.fileTransfer.downloadRoot || undefined,
      groupBySession: settings.fileTransfer.groupBySession,
      path: entry.path,
      sessionName: transferSessionName(connection),
      timestampDirectory: settings.fileTransfer.timestampDirectory,
      timestampName: formatTransferTimestamp(new Date(), settings.fileTransfer.timestampFormat),
    };
  }

  async function resolveDownloadConflictPolicy(
    downloadOptions: Omit<RemoteFileDownloadToLocalInput, "transferId" | "compress" | "conflictPolicy" | "keepArchives">,
    transferId: string,
  ): Promise<RemoteFileTransferConflictPolicy | "failed" | null> {
    const defaultPolicy = settings.fileTransfer.conflictPolicyDefault;
    if (defaultPolicy !== "ask") {
      return toRemoteFileConflictPolicy(defaultPolicy);
    }

    if (!hasTauriRuntime()) {
      return "rename";
    }

    setTransferProgress(transferId, {
      detail: null,
      indeterminate: true,
      progress: 2,
      stage: "检查本地目标",
    });
    let check;
    try {
      check = await remoteFileCheckDownloadTarget(downloadOptions);
    } catch (error) {
      failTransfer(transferId, "检查本地目标失败", error);
      return "failed";
    }
    if (!check.exists) {
      return "rename";
    }

    return promptTransferConflictPolicy(
      check.name,
      `本地目标已存在：${check.local_path}。请选择本次下载的处理方式。`,
    );
  }

  async function resolveUploadConflictPolicy(
    connection: ConnectionProfile,
    remotePath: string,
    transferId: string,
  ): Promise<RemoteFileTransferConflictPolicy | "failed" | null> {
    const defaultPolicy = settings.fileTransfer.conflictPolicyDefault;
    if (defaultPolicy !== "ask") {
      return toRemoteFileConflictPolicy(defaultPolicy);
    }

    if (!hasTauriRuntime()) {
      return "rename";
    }

    setTransferProgress(transferId, {
      detail: null,
      indeterminate: true,
      progress: 2,
      stage: "检查同名目标",
    });
    let check;
    try {
      check = await remoteFileCheckPath(connection.id, remotePath);
    } catch (error) {
      failTransfer(transferId, "检查同名目标失败", error);
      return "failed";
    }
    if (!check.exists) {
      return "rename";
    }

    return promptTransferConflictPolicy(
      remoteFileName(remotePath),
      `远程目标已存在：${check.path}。请选择本次上传的处理方式。`,
    );
  }

  function promptTransferConflictPolicy(name: string, description: string) {
    return new Promise<RemoteFileTransferConflictPolicy | null>((resolve) => {
      setTransferConflictPrompt({
        description,
        id: `conflict-${Date.now().toString()}`,
        name,
        resolve,
      });
    });
  }

  function settleTransferConflictPrompt(policy: RemoteFileTransferConflictPolicy | null) {
    const prompt = transferConflictPrompt;
    if (!prompt) {
      return;
    }
    prompt.resolve(policy);
    setTransferConflictPrompt(null);
  }

  function openLocalTransferPath(path: string) {
    if (!hasTauriRuntime()) {
      void copyText(path);
      return;
    }
    void openPath(path);
  }

  function revealLocalTransferPath(path: string) {
    if (!hasTauriRuntime()) {
      void copyText(path);
      return;
    }
    void revealItemInDir(path);
  }

  function activateRemoteFileTab(tab: RemoteFileEditorTab) {
    setHomeActive(false);
    setActiveWorkspaceMode("ssh");
    setActiveConnectionId(tab.connectionId);
    setActiveRemoteFileTabId(tab.id);
    if (isConnectionTerminalFileUnified(tab.connectionId)) {
      rememberUnifiedActiveTab(tab.connectionId, { kind: "file", id: tab.id });
    }

    const sameConnectionActiveTerminal = activeTabId
      ? terminalTabs.find((item) => item.id === activeTabId && item.connectionId === tab.connectionId)
      : null;
    const terminalTab = sameConnectionActiveTerminal || preferredTabForConnection(tab.connectionId);
    if (terminalTab) {
      setActiveTabId(terminalTab.id);
      rememberActiveTab(terminalTab);
    }
  }

  function activateRemoteFileFallbackAfterRemoval(
    nextRemoteFileTabs: RemoteFileEditorTab[],
    preferredConnectionId: string,
  ) {
    const sameConnectionFileTab = nextRemoteFileTabs.find(
      (tab) => tab.connectionId === preferredConnectionId,
    );
    if (sameConnectionFileTab) {
      activateRemoteFileTab(sameConnectionFileTab);
      return;
    }

    const anyFileTab = nextRemoteFileTabs[0];
    if (anyFileTab) {
      activateRemoteFileTab(anyFileTab);
      return;
    }

    setActiveRemoteFileTabId(null);
    activateTerminalFallbackAfterFilesClose();
  }

  function activateTerminalFallbackAfterFilesClose() {
    const nextTerminalTab =
      (activeTabId ? terminalTabs.find((tab) => tab.id === activeTabId) || null : null) ||
      (activeConnectionId ? preferredTabForConnection(activeConnectionId) : null) ||
      terminalTabs[0] ||
      null;

    if (nextTerminalTab) {
      activateTerminalTab(nextTerminalTab);
      return;
    }

    const nextRdpSession = activeRdpSessionId
      ? rdpSessions.find((session) => session.id === activeRdpSessionId) || null
      : rdpSessions[0] || null;
    if (nextRdpSession) {
      activateRdpSession(nextRdpSession);
      return;
    }

    const nextVncSession = activeVncSessionId
      ? vncSessions.find((session) => session.id === activeVncSessionId) || null
      : vncSessions[0] || null;
    if (nextVncSession) {
      activateVncSession(nextVncSession);
      return;
    }

    setActiveConnectionId(null);
    setActiveWorkspaceMode("home");
    setHomeActive(true);
  }

  function openRemoteFile(entry: RemoteFileEntry) {
    if (!activeConnection || entry.type === "directory") {
      return;
    }

    const path = normalizeRemotePath(entry.path);
    const existingTab = remoteFileTabs.find(
      (tab) => tab.connectionId === activeConnection.id && tab.path === path,
    );
    if (existingTab) {
      activateRemoteFileTab(existingTab);
      return;
    }

    const tab: RemoteFileEditorTab = {
      connectionId: activeConnection.id,
      connectionName: activeConnection.name,
      content: "",
      dirty: false,
      error: null,
      id: remoteFileTabId(activeConnection.id, path),
      metadata: null,
      name: entry.name,
      path,
      savedContent: "",
      saveState: "loading",
      statusMessage: "读取中",
    };

    setRemoteFileTabs((tabs) => [...tabs, tab]);
    activateRemoteFileTab(tab);

    void loadRemoteFileTab(activeConnection, path, tab.id);
  }

  function locateRemoteFileFolder(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }

    activateRemoteFileTab(tab);
    setRightTool("files");
    setRightPaneCollapsed(false);
    triggerRemoteFileLocate(tab.connectionId, remotePathParent(tab.path));
  }

  async function loadRemoteFileTab(connection: ConnectionProfile, path: string, tabId: string) {
    try {
      const result = hasTauriRuntime()
        ? await remoteFileRead(connection.id, path)
        : previewRemoteFileRead(connection, path);
      updateRemoteFileTab(tabId, (tab) => ({
        ...tab,
        content: result.content,
        dirty: false,
        error: null,
        metadata: result.metadata,
        name: result.name,
        path: result.path,
        savedContent: result.content,
        saveState: "ready",
        statusMessage: "就绪",
      }));
    } catch (error) {
      updateRemoteFileTab(tabId, (tab) => ({
        ...tab,
        content: "",
        dirty: false,
        error: formatError(error),
        saveState: "error",
        statusMessage: formatError(error),
      }));
    }
  }

  function handleRemoteFileChange(tabId: string, content: string) {
    updateRemoteFileTab(tabId, (tab) => ({
      ...tab,
      content,
      dirty: content !== tab.savedContent,
      saveState: content === tab.savedContent ? "ready" : "dirty",
      statusMessage: content === tab.savedContent ? "就绪" : "已修改",
    }));
  }

  function saveRemoteFile(tabId: string, overwrite = false) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (!tab || !tab.metadata || tab.saveState === "saving") {
      return;
    }

    updateRemoteFileTab(tabId, (item) => ({
      ...item,
      error: null,
      saveState: "saving",
      statusMessage: "保存中",
    }));

    void (hasTauriRuntime()
      ? remoteFileWrite({
          connectionId: tab.connectionId,
          content: tab.content,
          expectedMtime: tab.metadata.mtime,
          expectedSize: tab.metadata.size,
          overwrite,
          path: tab.path,
        })
      : Promise.resolve({
          conflict: false,
          metadata: {
            ...tab.metadata,
            mtime: Date.now(),
            size: new TextEncoder().encode(tab.content).length,
          },
        }))
      .then((result) => {
        updateRemoteFileTab(tabId, (item) => ({
          ...item,
          dirty: false,
          error: null,
          metadata: result.metadata,
          savedContent: item.content,
          saveState: "saved",
          statusMessage: "已保存",
        }));
        triggerRemoteFileRefresh(tab.connectionId, remotePathParent(tab.path));
      })
      .catch((error: unknown) => {
        if (isRemoteFileConflict(error)) {
          updateRemoteFileTab(tabId, (item) => ({
            ...item,
            error: formatError(error),
            saveState: "conflict",
            statusMessage: "远端已变化",
          }));
          setPendingRemoteFileConflictId(tabId);
          return;
        }

        updateRemoteFileTab(tabId, (item) => ({
          ...item,
          error: formatError(error),
          saveState: "error",
          statusMessage: formatError(error),
        }));
      });
  }

  function reloadRemoteFile(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    const connection = tab ? connectionById.get(tab.connectionId) : null;
    if (!tab || !connection) {
      return;
    }

    updateRemoteFileTab(tabId, (item) => ({
      ...item,
      error: null,
      saveState: "loading",
      statusMessage: "读取中",
    }));
    void loadRemoteFileTab(connection, tab.path, tabId);
  }

  function discardRemoteFileChanges(tabId: string) {
    updateRemoteFileTab(tabId, (tab) => ({
      ...tab,
      content: tab.savedContent,
      dirty: false,
      error: null,
      saveState: "ready",
      statusMessage: "已放弃更改",
    }));
  }

  function clearRemoteFileSessionStateForConnections(closingConnectionIds: Set<string>) {
    const nextRemoteFileTabs = remoteFileTabs.filter(
      (tab) => !closingConnectionIds.has(tab.connectionId),
    );

    if (nextRemoteFileTabs.length !== remoteFileTabs.length) {
      setRemoteFileTabs(nextRemoteFileTabs);
    }
    if (
      activeRemoteFileTabId &&
      !nextRemoteFileTabs.some((tab) => tab.id === activeRemoteFileTabId)
    ) {
      setActiveRemoteFileTabId(null);
    }
    setPendingRemoteFileCloseId((tabId) =>
      tabId && nextRemoteFileTabs.some((tab) => tab.id === tabId) ? tabId : null,
    );
    setPendingRemoteFileConflictId((tabId) =>
      tabId && nextRemoteFileTabs.some((tab) => tab.id === tabId) ? tabId : null,
    );
    setRemoteFileDeleteTarget((target) =>
      target && closingConnectionIds.has(target.connectionId) ? null : target,
    );
    if (remoteFileTextAction && closingConnectionIds.has(remoteFileTextAction.connectionId)) {
      setRemoteFileTextAction(null);
      setRemoteFileTextValue("");
      setRemoteFileTextError(null);
    }
    setRemoteFileLocateRequest((request) =>
      request && closingConnectionIds.has(request.connectionId) ? null : request,
    );
    setRemoteFileRefreshRequest((request) =>
      request && closingConnectionIds.has(request.connectionId) ? null : request,
    );
    setTerminalFileLayoutByConnectionId((layouts) =>
      removeConnectionRecordEntries(layouts, closingConnectionIds),
    );
    setActiveUnifiedTabByConnectionId((activeTabs) =>
      removeConnectionRecordEntries(activeTabs, closingConnectionIds),
    );

    return nextRemoteFileTabs;
  }

  function closeRemoteFileTab(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (tab?.dirty) {
      setPendingRemoteFileCloseId(tabId);
      return;
    }
    closeRemoteFileTabNow(tabId);
  }

  function closeRemoteFileTabs(tabIds: string[]) {
    const closingIds = new Set(tabIds);
    const dirtyTab = remoteFileTabs.find((tab) => closingIds.has(tab.id) && tab.dirty);
    const cleanTabIds = remoteFileTabs
      .filter((tab) => closingIds.has(tab.id) && !tab.dirty)
      .map((tab) => tab.id);

    if (cleanTabIds.length > 0) {
      closeRemoteFileTabsNow(cleanTabIds);
    }
    if (dirtyTab) {
      setPendingRemoteFileCloseId(dirtyTab.id);
    }
  }

  function closeRemoteFileTabNow(tabId: string) {
    closeRemoteFileTabsNow([tabId]);
  }

  function closeRemoteFileTabsNow(tabIds: string[]) {
    const closingIds = new Set(tabIds);
    const closingActiveTab = activeRemoteFileTabId
      ? remoteFileTabs.find((tab) => tab.id === activeRemoteFileTabId && closingIds.has(tab.id)) || null
      : null;
    const nextTabs = remoteFileTabs.filter((tab) => !closingIds.has(tab.id));

    setRemoteFileTabs(nextTabs);
    if (closingActiveTab) {
      activateRemoteFileFallbackAfterRemoval(nextTabs, closingActiveTab.connectionId);
    }
  }

  function closeOtherRemoteFileTabs(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    closeRemoteFileTabs(
      remoteFileTabs
        .filter((item) => item.connectionId === tab.connectionId && item.id !== tabId)
        .map((item) => item.id),
    );
  }

  function closeRemoteFileTabsToRight(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    const sameConnectionTabs = remoteFileTabs.filter((item) => item.connectionId === tab.connectionId);
    const index = sameConnectionTabs.findIndex((item) => item.id === tabId);
    if (index < 0) {
      return;
    }
    closeRemoteFileTabs(sameConnectionTabs.slice(index + 1).map((item) => item.id));
  }

  function closeAllRemoteFileTabsForConnection(connectionId: string) {
    closeRemoteFileTabs(
      remoteFileTabs
        .filter((tab) => tab.connectionId === connectionId)
        .map((tab) => tab.id),
    );
  }

  function closeSavedRemoteFileTabsForConnection(connectionId: string) {
    closeRemoteFileTabsNow(
      remoteFileTabs
        .filter((tab) => tab.connectionId === connectionId && isClosableSavedRemoteFileTab(tab))
        .map((tab) => tab.id),
    );
  }

  function requestCreateRemoteFile(parentPath: string) {
    if (!activeConnection) {
      return;
    }
    setRemoteFileTextAction({
      action: "create-file",
      connectionId: activeConnection.id,
      parentPath: normalizeRemotePath(parentPath),
    });
    setRemoteFileTextValue("untitled.txt");
    setRemoteFileTextError(null);
  }

  function requestCreateRemoteDirectory(parentPath: string) {
    if (!activeConnection) {
      return;
    }
    setRemoteFileTextAction({
      action: "create-directory",
      connectionId: activeConnection.id,
      parentPath: normalizeRemotePath(parentPath),
    });
    setRemoteFileTextValue("new-folder");
    setRemoteFileTextError(null);
  }

  function requestRenameRemoteEntry(entry: RemoteFileEntry) {
    if (!activeConnection) {
      return;
    }
    setRemoteFileTextAction({ action: "rename", connectionId: activeConnection.id, entry });
    setRemoteFileTextValue(entry.name);
    setRemoteFileTextError(null);
  }

  function requestDeleteRemoteEntry(entry: RemoteFileEntry) {
    requestDeleteRemoteEntries([entry]);
  }

  function requestDeleteRemoteEntries(entries: RemoteFileEntry[]) {
    if (!activeConnection) {
      return;
    }
    const normalizedEntries = collapseRemoteFileDeleteEntries(entries);
    if (normalizedEntries.length === 0) {
      return;
    }
    setRemoteFileDeleteTarget({ connectionId: activeConnection.id, entries: normalizedEntries });
  }

  async function submitRemoteFileTextAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = remoteFileTextAction;
    if (!action) {
      return;
    }

    const value = remoteFileTextValue.trim();
    if (!isValidRemoteBaseName(value)) {
      setRemoteFileTextError(remoteFileNameValidationMessage(value));
      return;
    }

    try {
      if (action.action === "create-file") {
        const path = joinRemotePath(action.parentPath, value);
        const metadata = hasTauriRuntime()
          ? await remoteFileCreateFile(action.connectionId, path)
          : previewRemoteFileMetadata(path);
        triggerRemoteFileRefresh(action.connectionId, remotePathParent(metadata.path));
        if (activeConnection) {
          openRemoteFile({
            name: metadata.name,
            path: metadata.path,
            type: "file",
          });
        }
      } else if (action.action === "create-directory") {
        const path = joinRemotePath(action.parentPath, value);
        if (hasTauriRuntime()) {
          await remoteFileCreateDirectory(action.connectionId, path);
        }
        triggerRemoteFileRefresh(action.connectionId, action.parentPath);
      } else {
        const newPath = joinRemotePath(remotePathParent(action.entry.path), value);
        if (hasTauriRuntime()) {
          await remoteFileRename({
            connectionId: action.connectionId,
            newPath,
            path: action.entry.path,
          });
        }
        renameRemoteFileTabs(action.connectionId, action.entry.path, newPath);
        triggerRemoteFileRefresh(action.connectionId, remotePathParent(action.entry.path));
        triggerRemoteFileRefresh(action.connectionId, remotePathParent(newPath));
      }
      setRemoteFileTextAction(null);
      setRemoteFileTextValue("");
      setRemoteFileTextError(null);
    } catch (error) {
      setRemoteFileTextError(formatError(error));
    }
  }

  function renameRemoteFileTabs(connectionId: string, oldPath: string, newPath: string) {
    const normalizedOldPath = normalizeRemotePath(oldPath);
    const normalizedNewPath = normalizeRemotePath(newPath);
    setRemoteFileTabs((tabs) =>
      tabs.map((tab) => {
        if (
          tab.connectionId !== connectionId ||
          (tab.path !== normalizedOldPath && !isRemotePathStrictDescendant(tab.path, normalizedOldPath))
        ) {
          return tab;
        }
        const nextPath = tab.path === normalizedOldPath
          ? normalizedNewPath
          : joinRemotePath(normalizedNewPath, tab.path.slice(normalizedOldPath.length + 1));
        return {
          ...tab,
          id: remoteFileTabId(connectionId, nextPath),
          name: remoteFileName(nextPath),
          path: nextPath,
        };
      }),
    );
    if (activeRemoteFileTabId === remoteFileTabId(connectionId, normalizedOldPath)) {
      setActiveRemoteFileTabId(remoteFileTabId(connectionId, normalizedNewPath));
    }
  }

  async function confirmRemoteFileDelete() {
    const target = remoteFileDeleteTarget;
    if (!target) {
      return;
    }
    const entries = collapseRemoteFileDeleteEntries(target.entries);
    if (entries.length === 0) {
      setRemoteFileDeleteTarget(null);
      return;
    }

    if (hasTauriRuntime()) {
      for (const entry of entries) {
        await remoteFileDelete({
          connectionId: target.connectionId,
          path: entry.path,
          recursive: entry.type === "directory",
        });
      }
    }
    for (const parentPath of uniqueRemoteParentPaths(entries)) {
      triggerRemoteFileRefresh(target.connectionId, parentPath);
    }
    const nextRemoteFileTabs = remoteFileTabs.filter(
      (tab) =>
        !entries.some((entry) =>
          isRemoteFileTabUnderEntry(tab, target.connectionId, entry.path),
        ),
    );
    const removedActiveRemoteFileTab = Boolean(
      activeRemoteFileTabId &&
        remoteFileTabs.some((tab) => tab.id === activeRemoteFileTabId) &&
        !nextRemoteFileTabs.some((tab) => tab.id === activeRemoteFileTabId),
    );

    setRemoteFileTabs(nextRemoteFileTabs);
    if (pendingRemoteFileCloseId && !nextRemoteFileTabs.some((tab) => tab.id === pendingRemoteFileCloseId)) {
      setPendingRemoteFileCloseId(null);
    }
    if (pendingRemoteFileConflictId && !nextRemoteFileTabs.some((tab) => tab.id === pendingRemoteFileConflictId)) {
      setPendingRemoteFileConflictId(null);
    }
    if (removedActiveRemoteFileTab) {
      activateRemoteFileFallbackAfterRemoval(nextRemoteFileTabs, target.connectionId);
    }
    setRemoteFileDeleteTarget(null);
  }

  function uploadRemoteFile(parentPath: string) {
    if (!activeConnection) {
      return;
    }
    if (hasTauriRuntime()) {
      void selectLocalUploadFiles()
        .then((paths) => {
          paths.forEach((path) => {
            void runLocalFileUpload(parentPath, path);
          });
        })
        .catch((error: unknown) => {
          showTransferPickerError("上传文件", parentPath, error);
        });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        return;
      }
      uploadRemoteItems(parentPath, files.map((file) => ({ file, relativePath: file.name })));
    };
    input.click();
  }

  function uploadRemoteDirectory(parentPath: string) {
    if (!activeConnection) {
      return;
    }
    if (hasTauriRuntime()) {
      void selectLocalUploadDirectories()
        .then((paths) => {
          paths.forEach((path) => {
            void runLocalDirectoryUpload(parentPath, path);
          });
        })
        .catch((error: unknown) => {
          showTransferPickerError("上传文件夹", parentPath, error);
        });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        return;
      }
      uploadRemoteItems(
        parentPath,
        files.map((file) => ({
          file,
          relativePath: getFileRelativePath(file),
        })),
      );
    };
    input.click();
  }

  function uploadRemoteItems(parentPath: string, items: RemoteFileUploadItem[]) {
    if (!activeConnection || items.length === 0) {
      return;
    }

    const normalizedParent = normalizeRemotePath(parentPath);
    const directFiles = items.filter((item) => !normalizeUploadRelativePath(item.relativePath).includes("/"));
    const directoryGroups = groupUploadDirectories(items);

    directFiles.forEach((item) => {
      void runSingleFileUpload(normalizedParent, item);
    });
    Array.from(directoryGroups.entries()).forEach(([rootName, groupItems]) => {
      void runDirectoryUpload(normalizedParent, rootName, groupItems);
    });
  }

  function handleNativeFileDropEvent(event: DragDropEvent) {
    if (!remoteFileConnection || rightPaneCollapsed || rightTool !== "files" || !showSessionWorkspace) {
      setNativeFileDropTargetPath(null);
      return;
    }

    if (event.type === "leave") {
      setNativeFileDropTargetPath(null);
      return;
    }

    const targetPath = resolveNativeFileDropTargetPath(event.position);
    if (event.type === "drop") {
      setNativeFileDropTargetPath(null);
      if (!targetPath || event.paths.length === 0) {
        return;
      }
      uploadNativeDroppedPaths(targetPath, event.paths);
      return;
    }

    setNativeFileDropTargetPath(targetPath);
  }

  function uploadNativeDroppedPaths(parentPath: string, paths: string[]) {
    paths.forEach((path) => {
      void uploadNativeDroppedPath(parentPath, path);
    });
  }

  async function uploadNativeDroppedPath(parentPath: string, localPath: string) {
    try {
      const metadata = await localPathMetadata(localPath);
      if (metadata.kind === "directory") {
        await runLocalDirectoryUpload(parentPath, metadata.path);
        return;
      }
      if (metadata.kind === "file") {
        await runLocalFileUpload(parentPath, metadata.path);
        return;
      }
      showTransferPickerError("Unsupported local item", parentPath, new Error(`Unsupported local path: ${localPath}`));
    } catch (error) {
      showTransferPickerError("Drop upload", parentPath, error);
    }
  }

  function showTransferPickerError(action: string, parentPath: string, error: unknown) {
    const transferId = addRemoteFileTransfer({
      direction: "upload",
      kind: "file",
      name: action,
      progress: 100,
      progressDetail: null,
      remotePath: parentPath,
      stage: "选择失败",
    });
    updateRemoteFileTransfer(transferId, {
      error: formatError(error),
      progressIndeterminate: false,
      status: "error",
    });
  }

  async function runLocalFileUpload(
    parentPath: string,
    localPath: string,
    options: TransferRunOptions = {},
  ) {
    const connection = options.connection ?? activeConnection;
    if (!connection) {
      if (options.transferId) {
        failTransfer(options.transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      }
      return;
    }
    const normalizedParentPath = normalizeRemotePath(parentPath);
    const localName = localPathName(localPath);
    const uploadPath = joinRemotePath(normalizedParentPath, localName);
    const transferId = options.transferId ?? addRemoteFileTransfer({
      direction: "upload",
      kind: "file",
      name: localName,
      progress: 0,
      remotePath: uploadPath,
      stage: "等待上传",
    });
    if (options.transferId) {
      prepareTransferRetry(transferId, "准备重试");
    }

    enqueueRemoteFileTransfer(transferId, async () => {
      try {
        const conflictPolicy = options.conflictPolicy ?? await resolveUploadConflictPolicy(connection, uploadPath, transferId);
        if (conflictPolicy === "failed") {
          return;
        }
        if (!conflictPolicy) {
          cancelTransfer(transferId);
          return;
        }
        if (isTransferNoLongerActive(transferId)) {
          return;
        }

        updateRemoteFileTransfer(transferId, {
          retry: {
            action: "local-file-upload",
            connectionId: connection.id,
            conflictPolicy,
            localPath,
            parentPath: normalizedParentPath,
          },
        });
        setTransferProgress(transferId, {
          indeterminate: true,
          progress: 4,
          stage: "上传中",
        });
        const result = await remoteFileUploadLocalFile({
          connectionId: connection.id,
          conflictPolicy,
          localPath,
          path: uploadPath,
          transferId,
        });
        finishUploadTransfer(transferId, connection.id, result);
      } catch (error) {
        failTransfer(transferId, "上传失败", error);
      }
    });
  }

  async function runLocalDirectoryUpload(
    parentPath: string,
    localPath: string,
    options: DirectoryTransferRunOptions = {},
  ) {
    const connection = options.connection ?? activeConnection;
    if (!connection) {
      if (options.transferId) {
        failTransfer(options.transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      }
      return;
    }
    const normalizedParentPath = normalizeRemotePath(parentPath);
    const rootName = localPathName(localPath);
    const remotePath = joinRemotePath(normalizedParentPath, rootName);
    const transferId = options.transferId ?? addRemoteFileTransfer({
      direction: "upload",
      kind: "directory",
      name: rootName,
      progress: 0,
      remotePath,
      stage: "等待上传",
    });
    if (options.transferId) {
      prepareTransferRetry(transferId, "准备重试");
    }

    enqueueRemoteFileTransfer(transferId, async () => {
      try {
        const conflictPolicy = options.conflictPolicy ?? await resolveUploadConflictPolicy(connection, remotePath, transferId);
        if (conflictPolicy === "failed") {
          return;
        }
        if (!conflictPolicy) {
          cancelTransfer(transferId);
          return;
        }
        if (isTransferNoLongerActive(transferId)) {
          return;
        }

        const compress = options.compress ?? settings.fileTransfer.compressDirectories;
        const keepArchive = options.keepArchive ?? settings.fileTransfer.keepArchives;
        updateRemoteFileTransfer(transferId, {
          retry: {
            action: "local-directory-upload",
            compress,
            connectionId: connection.id,
            conflictPolicy,
            keepArchive,
            localPath,
            parentPath: normalizedParentPath,
          },
        });
        setTransferProgress(transferId, {
          indeterminate: true,
          progress: 4,
          stage: compress ? "打包并上传目录" : "扫描目录",
        });
        const result = await remoteFileUploadLocalArchive({
          compress,
          connectionId: connection.id,
          conflictPolicy,
          keepArchive,
          localPath,
          rootName,
          targetDir: normalizedParentPath,
          transferId,
        });
        finishArchiveUploadTransfer(transferId, connection.id, result);
      } catch (error) {
        failTransfer(transferId, "目录上传失败", error);
      }
    });
  }

  async function runSingleFileUpload(
    parentPath: string,
    item: RemoteFileUploadItem,
    options: TransferRunOptions = {},
  ) {
    const connection = options.connection ?? activeConnection;
    if (!connection) {
      if (options.transferId) {
        failTransfer(options.transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      }
      return;
    }
    const normalizedParentPath = normalizeRemotePath(parentPath);
    const uploadPath = joinRemotePath(normalizedParentPath, item.file.name);
    const transferId = options.transferId ?? addRemoteFileTransfer({
      direction: "upload",
      kind: "file",
      name: item.file.name,
      progress: 0,
      remotePath: uploadPath,
      stage: "等待上传",
    });
    if (options.transferId) {
      prepareTransferRetry(transferId, "准备重试");
    }

    enqueueRemoteFileTransfer(transferId, async () => {
      if (!hasTauriRuntime()) {
        const stopPulse = startTransferProgressPulse(transferId, {
          cap: 92,
          detail: formatTransferProgressBytes(0, item.file.size),
          start: 8,
          stage: "上传中",
        });
        const result = await wait(240).then(() => {
          stopPulse();
          return previewRemoteFileUploadResult(uploadPath, item.file.size);
        });
        finishUploadTransfer(transferId, connection.id, result);
        return;
      }

      let localPath: string | null = null;
      try {
        const conflictPolicy = options.conflictPolicy ?? await resolveUploadConflictPolicy(connection, uploadPath, transferId);
        if (conflictPolicy === "failed") {
          return;
        }
        if (!conflictPolicy) {
          cancelTransfer(transferId);
          return;
        }
        if (isTransferNoLongerActive(transferId)) {
          return;
        }

        updateRemoteFileTransfer(transferId, {
          retry: {
            action: "browser-file-upload",
            connectionId: connection.id,
            conflictPolicy,
            item,
            parentPath: normalizedParentPath,
          },
        });
        setTransferProgress(transferId, {
          detail: formatTransferProgressBytes(0, item.file.size),
          progress: 4,
          stage: "写入本地上传缓存",
        });
        const temp = await remoteFilePrepareUploadTemp(item.file.name);
        localPath = temp.local_path;
        const localSpeed = createTransferSpeedTracker();
        await writeFileToUploadTemp(localPath, item.file, (loaded, total) => {
          setTransferProgress(transferId, {
            detail: formatTransferProgressBytes(loaded, total),
            progress: interpolateTransferProgress(4, 34, loaded, total),
            speedText: localSpeed.sample(loaded),
            stage: "写入本地上传缓存",
          });
        });
        setTransferProgress(transferId, {
          detail: formatTransferProgressBytes(0, item.file.size),
          indeterminate: false,
          progress: 36,
          stage: "上传中",
        });
        const result = await remoteFileUploadLocalFile({
          connectionId: connection.id,
          conflictPolicy,
          localPath,
          path: uploadPath,
          transferId,
        });
        finishUploadTransfer(transferId, connection.id, result);
      } catch (error) {
        failTransfer(transferId, "上传失败", error);
      } finally {
        if (localPath) {
          void remoteFileDeleteUploadTemp(localPath).catch(() => undefined);
        }
      }
    });
  }

  async function runDirectoryUpload(
    parentPath: string,
    rootName: string,
    items: RemoteFileUploadItem[],
    options: DirectoryTransferRunOptions = {},
  ) {
    const connection = options.connection ?? activeConnection;
    if (!connection) {
      if (options.transferId) {
        failTransfer(options.transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      }
      return;
    }
    const normalizedParentPath = normalizeRemotePath(parentPath);
    const remotePath = joinRemotePath(normalizedParentPath, rootName);
    const transferId = options.transferId ?? addRemoteFileTransfer({
      direction: "upload",
      kind: "directory",
      name: rootName,
      progress: 0,
      remotePath,
      stage: "等待打包",
    });
    if (options.transferId) {
      prepareTransferRetry(transferId, "准备重试");
    }

    enqueueRemoteFileTransfer(transferId, async () => {
      if (!hasTauriRuntime()) {
        const stopPulse = startTransferProgressPulse(transferId, {
          cap: 92,
          detail: formatTransferProgressBytes(0, totalUploadBytes(items)),
          start: 8,
          stage: "上传归档并远程解压",
        });
        const result = await wait(320).then(() => {
          stopPulse();
          return previewRemoteFileArchiveUploadResult(remotePath);
        });
        finishArchiveUploadTransfer(transferId, connection.id, result);
        return;
      }

      let localPath: string | null = null;
      try {
        const conflictPolicy = options.conflictPolicy ?? await resolveUploadConflictPolicy(connection, remotePath, transferId);
        if (conflictPolicy === "failed") {
          return;
        }
        if (!conflictPolicy) {
          cancelTransfer(transferId);
          return;
        }
        if (isTransferNoLongerActive(transferId)) {
          return;
        }

        const keepArchive = options.keepArchive ?? settings.fileTransfer.keepArchives;
        updateRemoteFileTransfer(transferId, {
          retry: {
            action: "browser-directory-upload",
            connectionId: connection.id,
            conflictPolicy,
            items,
            keepArchive,
            parentPath: normalizedParentPath,
            rootName,
          },
        });
        const totalBytes = totalUploadBytes(items);
        const archiveSpeed = createTransferSpeedTracker();
        setTransferProgress(transferId, {
          detail: formatTransferProgressBytes(0, totalBytes),
          progress: 3,
          stage: "本地打包 tar.gz",
        });
        const temp = await remoteFilePrepareUploadTemp(`${rootName}.tar.gz`);
        localPath = temp.local_path;
        const archiveSize = await buildTarGzArchiveToTemp(localPath, items, (progress) => {
          const detail =
            progress.phase === "compress"
              ? `压缩包 ${formatFileSize(progress.archiveBytes)}`
              : formatTransferProgressBytes(progress.loadedBytes, progress.totalBytes);
          const speedBytes = progress.phase === "compress" ? progress.archiveBytes : progress.loadedBytes;
          setTransferProgress(transferId, {
            detail,
            progress:
              progress.phase === "compress"
                ? 34
                : interpolateTransferProgress(3, 32, progress.loadedBytes, progress.totalBytes),
            speedText: archiveSpeed.sample(speedBytes),
            stage: progress.phase === "compress" ? "压缩 tar.gz" : "本地打包 tar.gz",
          });
        });
        const stopPulse = startTransferProgressPulse(transferId, {
          cap: 92,
          detail: `压缩包 ${formatFileSize(archiveSize)}`,
          start: 38,
          stage: "上传归档并远程解压",
        });
        const result = await remoteFileUploadLocalArchive({
          compress: true,
          connectionId: connection.id,
          conflictPolicy,
          keepArchive,
          localPath,
          rootName,
          targetDir: normalizedParentPath,
          transferId,
        }).finally(stopPulse);
        finishArchiveUploadTransfer(transferId, connection.id, result);
      } catch (error) {
        failTransfer(transferId, "目录上传失败", error);
      } finally {
        if (localPath) {
          void remoteFileDeleteUploadTemp(localPath).catch(() => undefined);
        }
      }
    });
  }

  function finishUploadTransfer(
    transferId: string,
    connectionId: string,
    result: RemoteFileUploadResult,
  ) {
    updateRemoteFileTransfer(transferId, {
      name: result.name,
      progress: 100,
      progressDetail: result.skipped ? null : "100%",
      progressIndeterminate: false,
      remotePath: result.path,
      speedText: null,
      stage: result.skipped ? "已跳过" : "上传完成",
      status: result.skipped ? "skipped" : "success",
    });
    triggerRemoteFileRefresh(connectionId, remotePathParent(result.path));
  }

  function finishArchiveUploadTransfer(
    transferId: string,
    connectionId: string,
    result: RemoteFileArchiveUploadResult,
  ) {
    updateRemoteFileTransfer(transferId, {
      name: result.name,
      progress: 100,
      progressDetail: result.skipped ? null : "100%",
      progressIndeterminate: false,
      remotePath: result.path,
      speedText: null,
      stage: result.skipped ? "已跳过" : "目录上传完成",
      status: result.skipped ? "skipped" : "success",
    });
    triggerRemoteFileRefresh(connectionId, remotePathParent(result.path));
  }

  function downloadRemoteFile(entry: RemoteFileEntry) {
    downloadRemoteFiles([entry]);
  }

  function downloadRemoteFiles(entries: RemoteFileEntry[]) {
    if (!activeConnection) {
      return;
    }
    void runRemoteFileDownloadQueue(entries);
  }

  async function runRemoteFileDownloadQueue(entries: RemoteFileEntry[]) {
    for (const entry of entries) {
      await runRemoteFileDownload(entry);
    }
  }

  async function runRemoteFileDownload(
    entry: RemoteFileEntry,
    options: DownloadTransferRunOptions = {},
  ) {
    const connection = options.input
      ? connectionForTransfer(options.input.connectionId)
      : activeConnection;
    if (!connection) {
      if (options.transferId) {
        failTransfer(options.transferId, "重试失败", new Error("连接已不存在，无法重试传输。"));
      }
      return;
    }
    const isDirectory = entry.type === "directory";
    const transferId = options.transferId ?? addRemoteFileTransfer({
      direction: "download",
      kind: isDirectory ? "directory" : "file",
      name: entry.name,
      progress: 0,
      remotePath: entry.path,
      stage: isDirectory ? "等待扫描" : "等待下载",
    });
    if (options.transferId) {
      prepareTransferRetry(transferId, "准备重试");
    }

    enqueueRemoteFileTransfer(transferId, async () => {
      let stopPulse: (() => void) | null = null;
      try {
        const downloadOptions = options.input ?? downloadTargetOptions(connection, entry);
        const conflictPolicy = options.input?.conflictPolicy ?? await resolveDownloadConflictPolicy(downloadOptions, transferId);
        if (conflictPolicy === "failed") {
          return;
        }
        if (!conflictPolicy) {
          cancelTransfer(transferId);
          return;
        }
        if (isTransferNoLongerActive(transferId)) {
          return;
        }

        const request: Omit<RemoteFileDownloadToLocalInput, "transferId"> = options.input ?? {
          ...downloadOptions,
          compress: settings.fileTransfer.compressDirectories,
          conflictPolicy,
          keepArchives: settings.fileTransfer.keepArchives,
        };
        updateRemoteFileTransfer(transferId, {
          retry: {
            action: "download",
            entry,
            input: request,
          },
        });

        let result: RemoteFileDownloadToLocalResult;
        if (hasTauriRuntime()) {
          setTransferProgress(transferId, {
            indeterminate: true,
            progress: 4,
            stage: isDirectory
              ? request.compress
                ? "压缩中"
                : "扫描目录"
              : "准备下载",
          });
          result = await remoteFileDownloadToLocal({
            ...request,
            transferId,
          });
        } else {
          stopPulse = startTransferProgressPulse(transferId, {
            cap: 92,
            detail: null,
            start: 8,
            stage: isDirectory ? "模拟目录下载" : "下载到本地",
          });
          result = await wait(300).then(() =>
            previewRemoteFileDownloadToLocalResult(entry, isDirectory),
          );
          stopPulse?.();
        }
        finishDownloadTransfer(transferId, result);
      } catch (error) {
        stopPulse?.();
        failTransfer(transferId, "下载失败", error);
      }
    });
  }

  function finishDownloadTransfer(transferId: string, result: RemoteFileDownloadToLocalResult) {
    updateRemoteFileTransfer(transferId, {
      localPath: result.local_path,
      name: result.name,
      progress: 100,
      progressDetail: result.skipped ? null : "100%",
      progressIndeterminate: false,
      remotePath: result.remote_path,
      speedText: null,
      stage: result.skipped ? "已跳过" : "下载完成",
      status: result.skipped ? "skipped" : "success",
    });
  }

  function showRemoteFileProperties(entry: RemoteFileEntry) {
    if (!activeConnection) {
      return;
    }
    setRemoteFileProperties({ entry, loading: true, metadata: null });
    void (hasTauriRuntime()
      ? remoteFileMetadata(activeConnection.id, entry.path)
      : Promise.resolve(previewRemoteFileEntryMetadata(entry)))
      .then((metadata) => {
        setRemoteFileProperties({ entry, loading: false, metadata });
      })
      .catch((error: unknown) => {
        setRemoteFileProperties({ entry, error: formatError(error), loading: false, metadata: null });
      });
  }

  function copyRemotePath(path: string) {
    void copyText(path);
  }

  async function createConnection(groupName?: string) {
    setLeftPaneCollapsed(false);
    setPendingConnectionGroupName(groupName || null);
    setEditingConnection(null);
    await ensureConnectionDialogLoaded();
    setDialogOpen(true);
  }

  function openHome() {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
    setActiveWorkspaceMode("home");
    setHomeActive(true);
  }

  async function editConnection(connection: ConnectionProfile) {
    setPendingConnectionGroupName(null);
    setEditingConnection(connection);
    await ensureConnectionDialogLoaded();
    setDialogOpen(true);
  }

  async function saveConnection(input: ConnectionProfileInput) {
    const saved = await upsert({
      ...input,
      group: input.group || pendingConnectionGroupName || undefined,
    });
    setSelectedConnectionId(saved.id);
    setPendingConnectionGroupName(null);
    return saved;
  }

  async function deleteConnection(connection: ConnectionProfile) {
    await remove(connection.id);
    const remainingRemoteFileTabs = clearRemoteFileSessionStateForConnections(new Set([connection.id]));
    closeRdpSessions(
      rdpSessionsRef.current
        .filter((session) => session.connectionId === connection.id)
        .map((session) => session.id),
    );
    closeVncSessions(
      vncSessionsRef.current
        .filter((session) => session.connectionId === connection.id)
        .map((session) => session.id),
    );
    const closingTabIds = terminalTabs.filter((tab) => tab.connectionId === connection.id).map((tab) => tab.id);
    closingTabIds.forEach(stopTerminalWarmupCapture);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs([connection.id]);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id);
      terminalTabsRef.current = nextTabs;
      if (
        nextTabs.length === 0 &&
        remainingRemoteFileTabs.length === 0 &&
        localTerminalTabsRef.current.length === 0 &&
        !rdpSessionsRef.current.some((session) => session.connectionId !== connection.id) &&
        !vncSessionsRef.current.some((session) => session.connectionId !== connection.id)
      ) {
        setActiveConnectionId(null);
        setActiveTabId(null);
        setActiveWorkspaceMode("home");
        setHomeActive(true);
      }
      if (activeConnectionId === connection.id) {
        const nextActiveTab = nextTabs[0] || null;
        const nextActiveFile = remainingRemoteFileTabs[0] || null;
        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
        if (nextActiveFile && !nextActiveTab) {
          setActiveRemoteFileTabId(nextActiveFile.id);
        } else if (!nextActiveTab) {
          const nextRdpSession =
            rdpSessionsRef.current.find((session) => session.connectionId !== connection.id) || null;
          if (nextRdpSession) {
            activateRdpSession(nextRdpSession);
          } else {
            const nextVncSession =
              vncSessionsRef.current.find((session) => session.connectionId !== connection.id) || null;
            if (nextVncSession) {
              activateVncSession(nextVncSession);
            } else {
              const nextLocalTerminalTab = localTerminalTabsRef.current[0] || null;
              if (nextLocalTerminalTab) {
                activateLocalTerminalTab(nextLocalTerminalTab);
              }
            }
          }
        }
      } else if (!nextTabs.some((tab) => tab.id === activeTabId)) {
        setActiveTabId(nextTabs[0]?.id || null);
      }
      return nextTabs;
    });

    if (selectedConnectionId === connection.id) {
      setSelectedConnectionId(null);
    }
  }

  async function refreshConnectedProfile(
    connectionId: string,
    request: ConnectionRuntimeCredentialRequest,
  ) {
    if (hasTauriRuntime()) {
      await probeSystem(request).catch(() => null);
    }
    await markConnected(connectionId).catch(() => null);
  }

  function buildConnectingTab(
    tabs: TerminalTab[],
    connection: ConnectionProfile,
    step: ConnectionStepState,
  ): TerminalTab {
    const nextIndex = nextTerminalIndexForConnection(tabs, connection.id);

    return {
      connectionId: connection.id,
      connectionStep: step,
      id: `connection-${connection.id}-${step.id.toString()}`,
      index: nextIndex,
      status: connectionStepStatusTitle(step),
      title: step.mode === "terminal" ? "连接准备" : "连接测试",
      type: "connecting",
      warmupOutput: [],
    };
  }

  function buildDirectTerminalTab(
    tabs: TerminalTab[],
    connection: ConnectionProfile,
    title?: string,
  ): TerminalTab {
    const now = Date.now();
    const nextIndex = nextTerminalIndexForConnection(tabs, connection.id);

    return {
      connectionId: connection.id,
      connectionStep: null,
      id: `terminal-${connection.id}-${now.toString()}`,
      index: nextIndex,
      requestId: `terminal-${connection.id}-${now.toString()}`,
      status: "正在连接",
      title: title || terminalTabTitle(nextIndex),
      type: "terminal",
      warmupOutput: [],
    };
  }

  function updateConnectingTabStep(tabId: string, step: ConnectionStepState) {
    setTerminalTabs((tabs) =>
      {
        const nextTabs: TerminalTab[] = tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              connectionStep: step,
              status: connectionStepStatusTitle(step),
              title:
                step.status === "error"
                  ? "连接失败"
                  : step.mode === "terminal"
                    ? "连接准备"
                    : "连接测试",
            }
          : tab,
        );
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      },
    );
  }

  function replaceConnectingTabWithTerminal(
    tabId: string,
    sessionId: string,
    warmupOutput: number[] = [],
    requestId?: string,
  ) {
    setTerminalTabs((tabs) =>
      {
        const nextTabs = tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              connectionStep: null,
              error: null,
              requestId,
              sessionId,
              status: "已连接",
              title: terminalTabTitle(tab.index),
              type: "terminal" as const,
              warmupOutput,
            }
          : tab,
        );
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      },
    );
  }

  function appendTerminalWarmupOutput(tabId: string, data: number[]) {
    if (data.length === 0) {
      return;
    }

    setTerminalTabs((tabs) => {
      let changed = false;
      const nextTabs = tabs.map((tab) => {
        if (tab.id !== tabId || tab.type !== "terminal") {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          warmupOutput: [...tab.warmupOutput, ...data],
        };
      });
      if (!changed) {
        return tabs;
      }
      terminalTabsRef.current = nextTabs;
      return nextTabs;
    });
  }

  function appendLocalTerminalWarmupOutput(tabId: string, data: number[]) {
    if (data.length === 0) {
      return;
    }

    setLocalTerminalTabs((tabs) => {
      let changed = false;
      const nextTabs = tabs.map((tab) => {
        if (tab.id !== tabId || !tab.sessionId) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          warmupOutput: [...tab.warmupOutput, ...data],
        };
      });
      if (!changed) {
        return tabs;
      }
      localTerminalTabsRef.current = nextTabs;
      return nextTabs;
    });
  }

  function setTerminalWarmupCaptureStop(tabId: string, stop: () => void) {
    stopTerminalWarmupCapture(tabId);
    terminalWarmupCaptureStopsRef.current.set(tabId, stop);
  }

  function stopTerminalWarmupCapture(tabId: string) {
    const stop = terminalWarmupCaptureStopsRef.current.get(tabId);
    if (!stop) {
      return;
    }
    terminalWarmupCaptureStopsRef.current.delete(tabId);
    stop();
  }

  function connectingTabExists(tabId: string) {
    return terminalTabsRef.current.some((tab) => tab.id === tabId && tab.type === "connecting");
  }

  function terminalTabExists(tabId: string) {
    return terminalTabsRef.current.some((tab) => tab.id === tabId);
  }

  function syncCommandSenderTargetTab(connectionId: string, tabId: string) {
    setCommandSenderTargetTabByConnectionId((tabs) =>
      tabs[connectionId] === tabId ? tabs : { ...tabs, [connectionId]: tabId },
    );
    setSelectedCommandTargetKeys((keys) =>
      keys.map((key) => {
        const [keyConnectionId] = key.split(":", 2);
        return keyConnectionId === connectionId ? commandSenderTargetKey(connectionId, tabId) : key;
      }),
    );
  }

  function returnHomeWhenWorkspaceEmpty({
    localCount = localTerminalTabsRef.current.length,
    rdpCount = rdpSessionsRef.current.length,
    sshCount = terminalTabsRef.current.length,
    vncCount = vncSessionsRef.current.length,
  }: {
    localCount?: number;
    rdpCount?: number;
    sshCount?: number;
    vncCount?: number;
  } = {}) {
    // 远程文件 tab 必须依附一个活的 SSH 终端才能渲染（见 activeRemoteFileTabs 派生）。
    // 因此只要没有终端/RDP/VNC/本地终端，即使剩孤立 remoteFile 也视作工作区为空，直接回首页。
    if (
      sshCount === 0 &&
      localCount === 0 &&
      rdpCount === 0 &&
      vncCount === 0
    ) {
      setActiveConnectionId(null);
      setActiveTabId(null);
      setActiveRdpSessionId(null);
      setActiveVncSessionId(null);
      setActiveLocalTerminalTabId(null);
      setActiveWorkspaceMode("home");
      setHomeActive(true);
    }
  }

  function rememberActiveTab(tab: TerminalTab) {
    setActiveTabByConnectionId((activeTabs) =>
      activeTabs[tab.connectionId] === tab.id
        ? activeTabs
        : { ...activeTabs, [tab.connectionId]: tab.id },
    );
  }

  function setConnectionTerminalFileLayout(connectionId: string, mode: RemoteFileOpenMode) {
    setTerminalFileLayoutByConnectionId((layouts) =>
      layouts[connectionId] === mode ? layouts : { ...layouts, [connectionId]: mode },
    );
  }

  function isConnectionTerminalFileUnified(connectionId: string) {
    return (
      (terminalFileLayoutByConnectionId[connectionId] || settings.basic.remoteFileOpenMode) ===
      "unified"
    );
  }

  function rememberUnifiedActiveTab(connectionId: string, tab: UnifiedWorkbenchTab) {
    setActiveUnifiedTabByConnectionId((activeTabs) => {
      const current = activeTabs[connectionId];
      return current?.kind === tab.kind && current.id === tab.id
        ? activeTabs
        : { ...activeTabs, [connectionId]: tab };
    });
  }

  function forgetActiveConnectionTabs(connectionIds: string[]) {
    if (connectionIds.length === 0) {
      return;
    }

    setActiveTabByConnectionId((activeTabs) => removeDirectoryState(activeTabs, connectionIds));
  }

  function preferredTabForConnection(connectionId: string, tabs = terminalTabs) {
    const rememberedTabId = activeTabByConnectionId[connectionId];
    return (
      (rememberedTabId
        ? tabs.find((tab) => tab.connectionId === connectionId && tab.id === rememberedTabId)
        : null) ||
      tabs.find((tab) => tab.connectionId === connectionId) ||
      null
    );
  }

  function pendingTabForConnection(connectionId: string, tabs = terminalTabs) {
    return tabs.find((tab) => tab.connectionId === connectionId && tab.type === "connecting") || null;
  }

  function activateTerminalTab(tab: TerminalTab) {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
    setActiveWorkspaceMode("ssh");
    setHomeActive(false);
    setActiveConnectionId(tab.connectionId);
    setActiveTabId(tab.id);
    rememberActiveTab(tab);
    if (isConnectionTerminalFileUnified(tab.connectionId)) {
      rememberUnifiedActiveTab(tab.connectionId, { kind: "terminal", id: tab.id });
    }
    syncCommandSenderTargetTab(tab.connectionId, tab.id);
  }

  function handleWorkbenchTabMouseDown(
    event: ReactMouseEvent<HTMLElement>,
    payload: WorkbenchTabDragPayload,
  ) {
    if (event.button !== 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    setWorkbenchTabMouseDrag({
      active: false,
      currentX: event.clientX,
      currentY: event.clientY,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      payload,
      previewWidth: bounds.width,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function handleTerminalSubtabClick(event: ReactMouseEvent<HTMLElement>, tab: TerminalTab) {
    if (suppressNextWorkbenchTabClickRef.current) {
      event.preventDefault();
      return;
    }
    activateTerminalTab(tab);
  }

  function handleRemoteFileSubtabClick(
    event: ReactMouseEvent<HTMLElement>,
    tab: RemoteFileEditorTab,
  ) {
    if (suppressNextWorkbenchTabClickRef.current) {
      event.preventDefault();
      return;
    }
    activateRemoteFileTab(tab);
  }

  function finishWorkbenchTabMouseDrag() {
    setWorkbenchTabMouseDrag(null);
    setWorkbenchTabDropZone(null);
  }

  function applyWorkbenchTabMouseDrop(
    payload: WorkbenchTabDragPayload,
    dropZone: WorkbenchTabDropZone,
  ) {
    if (dropZone === "split-file" || dropZone === "split-terminal") {
      restoreConnectionTerminalFileSplit(
        payload.connectionId,
        dropZone === "split-file" ? "file" : "terminal",
        payload,
      );
    } else if (payload.kind === "file" && dropZone === "terminal") {
      const tab = remoteFileTabs.find(
        (item) => item.id === payload.id && item.connectionId === payload.connectionId,
      );
      if (tab) {
        setConnectionTerminalFileLayout(tab.connectionId, "unified");
        rememberUnifiedActiveTab(tab.connectionId, { kind: "file", id: tab.id });
        activateRemoteFileTab(tab);
      }
    } else if (payload.kind === "terminal" && dropZone === "file") {
      const tab = terminalTabs.find(
        (item) => item.id === payload.id && item.connectionId === payload.connectionId,
      );
      if (tab) {
        setConnectionTerminalFileLayout(tab.connectionId, "unified");
        rememberUnifiedActiveTab(tab.connectionId, { kind: "terminal", id: tab.id });
        activateTerminalTab(tab);
      }
    }

    finishWorkbenchTabMouseDrag();
  }

  function restoreConnectionTerminalFileSplit(
    connectionId: string,
    preferredActiveKind?: WorkbenchTabKind,
    payload?: WorkbenchTabDragPayload,
  ) {
    setConnectionTerminalFileLayout(connectionId, "split");

    if (preferredActiveKind === "file") {
      const fileTab =
        payload?.kind === "file"
          ? remoteFileTabs.find(
              (item) => item.id === payload.id && item.connectionId === connectionId,
            )
          : null;
      const fallbackFileTab =
        fileTab ||
        (activeRemoteFileTab?.connectionId === connectionId ? activeRemoteFileTab : null) ||
        remoteFileTabs.find((item) => item.connectionId === connectionId) ||
        null;
      if (fallbackFileTab) {
        activateRemoteFileTab(fallbackFileTab);
      }
      return;
    }

    if (preferredActiveKind === "terminal") {
      const terminalTab =
        payload?.kind === "terminal"
          ? terminalTabs.find(
              (item) => item.id === payload.id && item.connectionId === connectionId,
            )
          : null;
      const fallbackTerminalTab = terminalTab || preferredTabForConnection(connectionId);
      if (fallbackTerminalTab) {
        activateTerminalTab(fallbackTerminalTab);
      }
    }
  }

  function getWorkbenchTabDragLabel(payload: WorkbenchTabDragPayload) {
    if (payload.kind === "file") {
      const tab = remoteFileTabs.find(
        (item) => item.id === payload.id && item.connectionId === payload.connectionId,
      );
      return tab?.name || "远程文件";
    }

    const tab = terminalTabs.find(
      (item) => item.id === payload.id && item.connectionId === payload.connectionId,
    );
    return tab?.title || "终端";
  }

  function isTerminalSubtabActive(tab: TerminalTab) {
    return isActiveTerminalFileUnified
      ? activeUnifiedTab?.kind === "terminal" && activeUnifiedTab.id === tab.id
      : tab.id === activeTabId;
  }

  function isRemoteFileSubtabActive(tab: RemoteFileEditorTab) {
    return isActiveTerminalFileUnified
      ? activeUnifiedTab?.kind === "file" && activeUnifiedTab.id === tab.id
      : tab.id === activeRemoteFileTab?.id;
  }

  function isTerminalPanelActive(tabId: string) {
    if (isActiveTerminalFileUnified) {
      return showSessionWorkspace && activeUnifiedTab?.kind === "terminal" && activeUnifiedTab.id === tabId;
    }
    return showSessionWorkspace && tabId === activeTabId;
  }

  function isRemoteFileEditorActive(tabId: string) {
    if (isActiveTerminalFileUnified) {
      return !showingHome && activeUnifiedTab?.kind === "file" && activeUnifiedTab.id === tabId;
    }
    return !showingHome && tabId === activeRemoteFileTab?.id;
  }

  function renderRemoteFileSubtab(tab: RemoteFileEditorTab, index: number) {
    const savedTabs = activeRemoteFileTabs.filter(isClosableSavedRemoteFileTab);
    return (
      <TabContextMenu
        key={tab.id}
        actions={[
          {
            hint: "Ctrl+F4",
            label: "关闭",
            onSelect: () => closeRemoteFileTab(tab.id),
          },
          {
            disabled: activeRemoteFileTabs.length <= 1,
            label: "关闭其他",
            onSelect: () => closeOtherRemoteFileTabs(tab.id),
          },
          {
            disabled: index >= activeRemoteFileTabs.length - 1,
            label: "关闭右侧标签页",
            onSelect: () => closeRemoteFileTabsToRight(tab.id),
          },
          {
            disabled: savedTabs.length === 0,
            hint: "Ctrl+K U",
            label: "关闭已保存",
            onSelect: () => closeSavedRemoteFileTabsForConnection(tab.connectionId),
          },
          {
            disabled: activeRemoteFileTabs.length === 0,
            hint: "Ctrl+K W",
            label: "全部关闭",
            onSelect: () => closeAllRemoteFileTabsForConnection(tab.connectionId),
          },
          {
            hint: "Shift+Alt+C",
            label: "复制路径",
            onSelect: () => copyRemotePath(tab.path),
            separatorBefore: true,
          },
          ...(isConnectionTerminalFileUnified(tab.connectionId)
            ? [
                {
                  label: "恢复上下分屏",
                  onSelect: () =>
                    restoreConnectionTerminalFileSplit(tab.connectionId, "file", {
                      connectionId: tab.connectionId,
                      id: tab.id,
                      kind: "file",
                    }),
                },
              ]
            : []),
        ]}
      >
        <div
          className={`subtab-shell file-tab ${isRemoteFileSubtabActive(tab) ? "active" : ""}`}
        >
          <button
            className="subtab workbench-draggable-tab"
            type="button"
            title={tab.path}
            onClick={(event) => handleRemoteFileSubtabClick(event, tab)}
            onMouseDown={(event) =>
              handleWorkbenchTabMouseDown(event, {
                connectionId: tab.connectionId,
                id: tab.id,
                kind: "file",
              })
            }
          >
            <span>{tab.name}</span>
            {tab.dirty ? <span className="dirty-dot" aria-label="已修改" /> : null}
          </button>
          <button
            className="subtab-close"
            type="button"
            aria-label={`关闭 ${tab.name}`}
            onClick={() => closeRemoteFileTab(tab.id)}
          >
            <X className="ui-icon" aria-hidden="true" />
          </button>
        </div>
      </TabContextMenu>
    );
  }

  function toggleTerminalSearch(tabId: string | null | undefined) {
    if (!tabId) {
      return;
    }
    setTerminalSearchByTabId((states) => {
      const current = states[tabId] || { caseSensitive: false, open: false, query: "" };
      return {
        ...states,
        [tabId]: {
          ...current,
          open: !current.open,
        },
      };
    });
  }

  function requestTerminalSearchNavigation(direction: TerminalSearchNavigationRequest["direction"]) {
    if (!activeShortcutTerminalTabId) {
      return;
    }

    setTerminalSearchByTabId((states) => {
      const current = states[activeShortcutTerminalTabId] || {
        caseSensitive: false,
        open: true,
        query: "",
      };
      return {
        ...states,
        [activeShortcutTerminalTabId]: {
          ...current,
          open: true,
        },
      };
    });
    setTerminalSearchNavigationRequest({
      direction,
      id: Date.now(),
      tabId: activeShortcutTerminalTabId,
    });
  }

  function closeTerminalSearch(tabId: string) {
    setTerminalSearchByTabId((states) => {
      const current = states[tabId];
      if (!current?.open) {
        return states;
      }
      return {
        ...states,
        [tabId]: {
          ...current,
          open: false,
        },
      };
    });
  }

  function updateTerminalSearchQuery(tabId: string, query: string) {
    setTerminalSearchByTabId((states) => {
      const current = states[tabId] || { caseSensitive: false, open: true, query: "" };
      return {
        ...states,
        [tabId]: {
          ...current,
          open: true,
          query,
        },
      };
    });
  }

  function toggleTerminalSearchCaseSensitive(tabId: string) {
    setTerminalSearchByTabId((states) => {
      const current = states[tabId] || { caseSensitive: false, open: true, query: "" };
      return {
        ...states,
        [tabId]: {
          ...current,
          caseSensitive: !current.caseSensitive,
          open: true,
        },
      };
    });
  }

  function handleCommandSenderInputChange(value: string) {
    setCommandSenderInput(value);
    setSelectedCommandSnippetId(null);
    setSelectedCommandHistoryId(null);
  }

  function prepareCommandSenderTargets() {
    void loadCommandLibrary();
    const availableKeys = commandSenderTargets.map((target) => target.key);
    const availableKeySet = new Set(availableKeys);
    const retainedKeys = selectedCommandTargetKeys.filter((key) => availableKeySet.has(key));
    const nextKeys = retainedKeys.length > 0 ? retainedKeys : availableKeys;
    const nextKeySet = new Set(nextKeys);

    setSelectedCommandTargetKeys((keys) => {
      const retainedKeys = keys.filter((key) => availableKeySet.has(key));
      return retainedKeys.length > 0 ? retainedKeys : availableKeys;
    });

    return commandSenderTargets.filter((target) => nextKeySet.has(target.key));
  }

  function openCommandSenderAndPrepareTargets() {
    setCommandSenderOpen(true);
    return prepareCommandSenderTargets();
  }

  function sendTerminalSelectionToAi(tabId: string, selectedText: string) {
    const content = selectedText.trim();
    if (!content) {
      return;
    }
    const sshTab = terminalTabsRef.current.find((tab) => tab.id === tabId);
    const localTab = localTerminalTabsRef.current.find((tab) => tab.id === tabId);
    const sourceConnection = sshTab ? connectionById.get(sshTab.connectionId) || null : null;
    const source = sourceConnection?.name || localTab?.title || sshTab?.title || "终端选区";
    const directory = terminalDirectories[tabId];
    setAiInitialContexts([
      buildAiContextBlock({
        kind: "terminal_selection",
        title: "终端选中文本",
        source: directory ? `${source} · ${directory}` : source,
        content,
      }),
    ]);
    setAiContextRequestKey((key) => key + 1);
    setAiAssistantPanelLoaded(true);
    setRightPaneCollapsed(false);
    setRightTool("ai");
  }

  function insertAiCommandToSender(command: string) {
    setCommandSenderInput(command);
    setSelectedCommandSnippetId(null);
    setSelectedCommandHistoryId(null);
    openCommandSenderAndPrepareTargets();
  }

  function saveAiCommandAsSnippet(command: string) {
    setCommandSenderInput(command);
    setSelectedCommandSnippetId(null);
    setSelectedCommandHistoryId(null);
    setCommandSnippetDraft(buildCommandSnippetDraft(command));
    setCommandSnippetFormError(null);
    setCommandSnippetDialogOpen(true);
  }

  async function sendAiCommandToTerminal(command: string) {
    const target = resolveActiveAiCommandTarget();
    if (!target) {
      setCommandSenderLastSentLabel("上次发送：当前没有可写入的激活终端");
      throw new Error("当前没有可写入的激活终端。");
    }
    setSelectedCommandSnippetId(null);
    setSelectedCommandHistoryId(null);
    await sendCommandTextToTargets(command, true, null, [target], {
      clearInput: false,
    });
  }

  function resolveActiveAiCommandTarget(): CommandSenderTarget | null {
    if (activeWorkspaceMode === "local") {
      if (!activeLocalTerminalTab?.sessionId) {
        return null;
      }
      const profile = localTerminalProfiles.find((item) => item.id === activeLocalTerminalTab.profileId);
      return {
        connectionId: localCommandSenderTargetId,
        deliveryStatus: "idle",
        description: profile?.name || activeLocalTerminalTab.title,
        historyScope: {
          scope_kind: "local_profile",
          scope_id: activeLocalTerminalTab.profileId,
        },
        key: commandSenderTargetKey(localCommandSenderTargetId, activeLocalTerminalTab.id),
        kind: "local",
        label: "当前激活终端",
        sessionId: activeLocalTerminalTab.sessionId,
        tabId: activeLocalTerminalTab.id,
        tabs: [
          {
            label: activeLocalTerminalTab.title,
            sessionId: activeLocalTerminalTab.sessionId,
            tabId: activeLocalTerminalTab.id,
          },
        ],
        tabTitle: activeLocalTerminalTab.title,
      };
    }

    if (activeWorkspaceMode === "ssh") {
      if (!activeConnectedTerminalTab?.sessionId) {
        return null;
      }
      const connection = connectionById.get(activeConnectedTerminalTab.connectionId) || null;
      if (connection && !isSshConnection(connection)) {
        return null;
      }
      return {
        connectionId: activeConnectedTerminalTab.connectionId,
        deliveryStatus: "idle",
        description: connection
          ? formatConnectionAddress(connection)
          : activeConnectedTerminalTab.title,
        historyScope: {
          scope_kind: "ssh_connection",
          scope_id: activeConnectedTerminalTab.connectionId,
        },
        key: commandSenderTargetKey(activeConnectedTerminalTab.connectionId, activeConnectedTerminalTab.id),
        kind: "ssh",
        label: connection?.name || "当前激活终端",
        sessionId: activeConnectedTerminalTab.sessionId,
        tabId: activeConnectedTerminalTab.id,
        tabs: [
          {
            label: activeConnectedTerminalTab.title,
            sessionId: activeConnectedTerminalTab.sessionId,
            tabId: activeConnectedTerminalTab.id,
          },
        ],
        tabTitle: activeConnectedTerminalTab.title,
      };
    }

    return null;
  }

  function insertCommandSnippet(snippet: CommandSnippet) {
    setCommandSenderInput(snippet.command);
    setSelectedCommandSnippetId(snippet.id);
    setSelectedCommandHistoryId(null);
    return openCommandSenderAndPrepareTargets();
  }

  function insertCommandHistoryEntry(entry: CommandHistoryEntry) {
    setCommandSenderInput(entry.command);
    setSelectedCommandHistoryId(entry.id);
    setSelectedCommandSnippetId(null);
    return openCommandSenderAndPrepareTargets();
  }

  async function runCommandSnippet(snippet: CommandSnippet) {
    const targets = prepareCommandSenderTargets();
    if (targets.length === 0) {
      setCommandSenderLastSentLabel("上次发送：请选择目标后再执行片段");
      return;
    }
    await sendCommandTextToTargets(snippet.command, true, snippet.id, targets, {
      clearInput: false,
    });
  }

  async function runCommandHistoryEntry(entry: CommandHistoryEntry) {
    const targets = prepareCommandSenderTargets();
    if (targets.length === 0) {
      setCommandSenderLastSentLabel("上次发送：请选择目标后再执行历史命令");
      return;
    }
    await sendCommandTextToTargets(entry.command, true, null, targets, {
      clearInput: false,
    });
  }

  function saveHistoryAsSnippet(entry: CommandHistoryEntry) {
    setCommandSnippetDraft(buildCommandSnippetDraft(entry.command));
    setCommandSnippetFormError(null);
    setCommandSnippetDialogOpen(true);
  }

  async function copyCommandLibraryText(command: string, label: string) {
    try {
      await copyText(command);
      setCommandSenderLastSentLabel(`上次操作：已复制${label}`);
      setCommandLibraryError(null);
    } catch (error) {
      setCommandLibraryError(`复制失败：${formatError(error)}`);
    }
  }

  async function recordTerminalInputHistoryCommand(tabId: string, command: string) {
    if (!settings.command.recordTerminalInputHistory || !hasTauriRuntime()) {
      return;
    }

    const scope = commandHistoryScopeForTerminalTab(tabId);
    try {
      const historyEntry = await commandHistoryRecord({
        append_enter: true,
        command,
        scopes: scope ? [scope] : [],
        source: "terminal_input",
        target_count: 1,
      });
      await loadCommandLibrary();
      setSelectedCommandHistoryId(historyEntry.id);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      handleCommandLibraryOperationError(error);
    }
  }

  function commandHistoryScopeForTerminalTab(tabId: string): CommandHistoryScope | null {
    const localTab = localTerminalTabs.find((tab) => tab.id === tabId);
    if (localTab) {
      return {
        scope_kind: "local_profile",
        scope_id: localTab.profileId,
      };
    }

    const sshTab = terminalTabs.find((tab) => tab.id === tabId);
    if (sshTab) {
      return {
        scope_kind: "ssh_connection",
        scope_id: sshTab.connectionId,
      };
    }

    return null;
  }

  function clearCommandSenderInput() {
    setCommandSenderInput("");
    setSelectedCommandSnippetId(null);
    setSelectedCommandHistoryId(null);
  }

  function openCommandSnippetDialog(snippet?: CommandSnippet | null, defaultGroup?: string) {
    setCommandSnippetDraft(
      snippet
        ? commandSnippetToDraft(snippet)
        : buildCommandSnippetDraft(commandSenderInput, defaultGroup),
    );
    setCommandSnippetFormError(null);
    setCommandSnippetDialogOpen(true);
  }

  function openCommandSnippetGroupCreateDialog(selectAfterSave = false) {
    setCommandSnippetGroupDialog({
      mode: "create",
      selectAfterSave,
      value: "",
    });
  }

  function openCommandSnippetGroupRenameDialog(groupName: string) {
    setCommandSnippetGroupDialog({
      mode: "rename",
      originalName: normalizeCommandSnippetGroupValue(groupName),
      value: normalizeCommandSnippetGroupValue(groupName),
    });
  }

  async function saveCommandSnippetGroupDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commandSnippetGroupDialog) {
      return;
    }

    const nextGroup = normalizeCommandSnippetGroupValue(commandSnippetGroupDialog.value);
    const originalGroup = normalizeCommandSnippetGroupValue(commandSnippetGroupDialog.originalName);
    if (!nextGroup) {
      setCommandSnippetGroupDialog((state) =>
        state ? { ...state, error: "请填写分组名称。" } : state,
      );
      return;
    }
    if (
      commandSnippetGroups.some(
        (group) => group === nextGroup && group !== originalGroup,
      )
    ) {
      setCommandSnippetGroupDialog((state) =>
        state ? { ...state, error: "分组名称已存在。" } : state,
      );
      return;
    }

    if (commandSnippetGroupDialog.mode === "create") {
      setCommandSnippetLocalGroups((groups) => appendCommandSnippetLocalGroup(groups, nextGroup));
      if (commandSnippetGroupDialog.selectAfterSave) {
        setCommandSnippetDraft((draft) => ({ ...draft, group: nextGroup }));
      }
      setCommandSnippetGroupDialog(null);
      return;
    }

    if (!originalGroup || originalGroup === nextGroup) {
      setCommandSnippetGroupDialog(null);
      return;
    }

    const affectedSnippets = commandSnippets.filter(
      (snippet) => normalizeCommandSnippetGroupValue(snippet.group) === originalGroup,
    );
    try {
      const savedSnippets = await Promise.all(
        affectedSnippets.map((snippet) =>
          commandSnippetUpsert(commandSnippetToInput(snippet, nextGroup)),
        ),
      );
      const affectedIds = new Set(affectedSnippets.map((snippet) => snippet.id));
      setCommandSnippets((snippets) =>
        [
          ...snippets.filter((snippet) => !affectedIds.has(snippet.id)),
          ...savedSnippets,
        ].sort(compareCommandSnippets),
      );
      setCommandSnippetLocalGroups((groups) =>
        appendCommandSnippetLocalGroup(
          groups.filter((group) => group !== originalGroup),
          nextGroup,
        ),
      );
      setCommandSnippetDraft((draft) =>
        normalizeCommandSnippetGroupValue(draft.group) === originalGroup
          ? { ...draft, group: nextGroup }
          : draft,
      );
      setCommandSnippetGroupDialog(null);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      if (isCommandLibraryCommandMissingError(error)) {
        const message = commandLibraryRestartMessage();
        setCommandLibraryUnavailableReason(message);
        setCommandSnippetGroupDialog((state) =>
          state ? { ...state, error: message } : state,
        );
      } else {
        setCommandSnippetGroupDialog((state) =>
          state ? { ...state, error: formatError(error) } : state,
        );
      }
    }
  }

  async function saveCommandSnippetDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommandSnippetFormError(null);

    if (commandLibraryUnavailableReason) {
      setCommandSnippetFormError(commandLibraryUnavailableReason);
      return;
    }

    if (!hasTauriRuntime()) {
      setCommandSnippetFormError("当前环境无法保存命令片段。");
      return;
    }

    try {
      const saved = await commandSnippetUpsert({
        command: commandSnippetDraft.command,
        description: commandSnippetDraft.description || null,
        favorite: commandSnippetDraft.favorite,
        group: normalizeCommandSnippetGroupValue(commandSnippetDraft.group) || null,
        id: commandSnippetDraft.id,
        tags: parseCommandSnippetTags(commandSnippetDraft.tagsText),
        title: commandSnippetDraft.title,
      });
      setCommandSnippets((snippets) => upsertCommandSnippet(snippets, saved));
      setCommandSenderInput(saved.command);
      setSelectedCommandSnippetId(saved.id);
      setSelectedCommandHistoryId(null);
      setCommandSnippetDraft(commandSnippetToDraft(saved));
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
      setCommandSnippetDialogOpen(false);
    } catch (error) {
      if (isCommandLibraryCommandMissingError(error)) {
        const message = commandLibraryRestartMessage();
        setCommandLibraryUnavailableReason(message);
        setCommandSnippetFormError(message);
      } else {
        setCommandSnippetFormError(formatError(error));
      }
    }
  }

  async function confirmDeleteCommandSnippetGroup() {
    const groupName = normalizeCommandSnippetGroupValue(pendingCommandSnippetGroupDelete);
    if (!groupName) {
      return;
    }

    const snippetsInGroup = commandSnippets.filter(
      (snippet) => normalizeCommandSnippetGroupValue(snippet.group) === groupName,
    );

    try {
      await Promise.all(
        snippetsInGroup.map((snippet) =>
          commandSnippetDelete(snippet.id),
        ),
      );
      const deletedIds = new Set(snippetsInGroup.map((snippet) => snippet.id));
      setCommandSnippets((snippets) =>
        snippets.filter((snippet) => !deletedIds.has(snippet.id)),
      );
      setCommandSnippetLocalGroups((groups) => groups.filter((group) => group !== groupName));
      if (selectedCommandSnippetId && deletedIds.has(selectedCommandSnippetId)) {
        setSelectedCommandSnippetId(null);
      }
      if (
        commandSnippetDraft.id &&
        deletedIds.has(commandSnippetDraft.id)
      ) {
        setCommandSnippetDraft(buildCommandSnippetDraft(commandSenderInput));
      } else if (normalizeCommandSnippetGroupValue(commandSnippetDraft.group) === groupName) {
        setCommandSnippetDraft((draft) => ({ ...draft, group: commandSnippetRootGroup }));
      }
      setPendingCommandSnippetGroupDelete(null);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      handleCommandLibraryOperationError(error);
    }
  }

  async function confirmDeleteCommandSnippet() {
    if (!pendingCommandSnippetDelete) {
      return;
    }

    try {
      await commandSnippetDelete(pendingCommandSnippetDelete.id);
      setCommandSnippets((snippets) =>
        snippets.filter((snippet) => snippet.id !== pendingCommandSnippetDelete.id),
      );
      if (selectedCommandSnippetId === pendingCommandSnippetDelete.id) {
        setSelectedCommandSnippetId(null);
      }
      if (commandSnippetDraft.id === pendingCommandSnippetDelete.id) {
        setCommandSnippetDraft(buildCommandSnippetDraft(commandSenderInput));
      }
      setPendingCommandSnippetDelete(null);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      handleCommandLibraryOperationError(error);
    }
  }

  async function confirmDeleteCommandHistory() {
    if (!pendingCommandHistoryDelete) {
      return;
    }

    try {
      await commandHistoryDelete(pendingCommandHistoryDelete.id);
      setCommandHistoryEntries((entries) =>
        entries.filter((entry) => entry.id !== pendingCommandHistoryDelete.id),
      );
      if (selectedCommandHistoryId === pendingCommandHistoryDelete.id) {
        setSelectedCommandHistoryId(null);
      }
      setPendingCommandHistoryDelete(null);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      handleCommandLibraryOperationError(error);
    }
  }

  async function confirmClearCommandHistory() {
    try {
      await commandHistoryClear();
      setCommandHistoryEntries([]);
      setSelectedCommandHistoryId(null);
      setCommandLibraryError(null);
      setCommandLibraryUnavailableReason(null);
    } catch (error) {
      handleCommandLibraryOperationError(error);
    }
  }

  function handleCommandLibraryOperationError(error: unknown) {
    if (isCommandLibraryCommandMissingError(error)) {
      setCommandLibraryUnavailableReason(commandLibraryRestartMessage());
      setCommandLibraryError(null);
      return;
    }

    setCommandLibraryError(formatError(error));
  }

  function openCommandSender() {
    setCommandSenderOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        prepareCommandSenderTargets();
      }
      return nextOpen;
    });
  }

  function toggleCommandSenderAllTargets() {
    setSelectedCommandTargetKeys(
      commandSenderAllSelected ? [] : commandSenderTargets.map((target) => target.key),
    );
  }

  function toggleCommandSenderTarget(target: CommandSenderTarget) {
    setSelectedCommandTargetKeys((keys) =>
      keys.includes(target.key)
        ? keys.filter((key) => key !== target.key)
        : [...keys, target.key],
    );
  }

  function selectCommandSenderTargetTab(target: CommandSenderTarget, tabId: string) {
    const nextTab = target.tabs.find((tab) => tab.tabId === tabId);
    if (!nextTab) {
      return;
    }

    const nextKey = commandSenderTargetKey(target.connectionId, tabId);
    setCommandSenderTargetTabByConnectionId((tabs) => ({
      ...tabs,
      [target.connectionId]: tabId,
    }));
    setSelectedCommandTargetKeys((keys) =>
      keys.includes(target.key)
        ? keys.map((key) => (key === target.key ? nextKey : key))
        : keys,
    );
  }

  function activateCommandSenderTarget(target: CommandSenderTarget) {
    if (target.kind === "local") {
      const tab = localTerminalTabs.find((item) => item.id === target.tabId);
      if (tab) {
        activateLocalTerminalTab(tab);
      }
      return;
    }

    const tab = terminalTabs.find((item) => item.id === target.tabId);
    if (tab) {
      activateTerminalTab(tab);
    }
  }

  async function sendCommandTextToTargets(
    command: string,
    appendEnter: boolean,
    snippetId: string | null,
    targetsOverride?: CommandSenderTarget[],
    options: { clearInput?: boolean } = {},
  ) {
    const historyCommand = command.trim();
    const targets = targetsOverride ?? selectedCommandTargets;
    if (!historyCommand || targets.length === 0) {
      return;
    }

    const payload = appendEnter ? `${command}\r` : command;

    setCommandSenderDeliveryByKey((deliveryByKey) => {
      const nextDeliveryByKey = { ...deliveryByKey };
      targets.forEach((target) => {
        nextDeliveryByKey[target.key] = { status: "idle" };
      });
      return nextDeliveryByKey;
    });

    const successfulTargets: CommandSenderTarget[] = [];
    for (const target of targets) {
      try {
        if (!hasTauriRuntime()) {
          throw new Error("当前环境无法写入终端输入流。");
        }
        await terminalWrite(target.sessionId, payload);
        setCommandSenderDeliveryByKey((deliveryByKey) => ({
          ...deliveryByKey,
          [target.key]: { status: "sent" },
        }));
        successfulTargets.push(target);
      } catch (error) {
        setCommandSenderDeliveryByKey((deliveryByKey) => ({
          ...deliveryByKey,
          [target.key]: { message: formatError(error), status: "failed" },
        }));
      }
    }
    const successCount = successfulTargets.length;
    const failedCount = targets.length - successCount;
    setCommandSenderLastSentLabel(
      failedCount > 0
        ? `上次发送：写入 ${successCount.toString()}，失败 ${failedCount.toString()}`
        : `上次发送：已写入 ${successCount.toString()} 个目标`,
    );
    if (options.clearInput ?? true) {
      clearCommandSenderInput();
    }

    if (successCount > 0 && historyCommand && hasTauriRuntime()) {
      try {
        const historyEntry = await commandHistoryRecord({
          append_enter: appendEnter,
          command: historyCommand,
          scopes: uniqueCommandHistoryScopes(
            successfulTargets
              .map((target) => target.historyScope)
              .filter((scope): scope is CommandHistoryScope => Boolean(scope)),
          ),
          source: "command_sender",
          target_count: successCount,
        });
        await loadCommandLibrary();
        setSelectedCommandHistoryId(historyEntry.id);

        if (snippetId) {
          const snippet = await commandSnippetMarkUsed(snippetId);
          setCommandSnippets((snippets) => upsertCommandSnippet(snippets, snippet));
        }
        setCommandLibraryError(null);
        setCommandLibraryUnavailableReason(null);
      } catch (error) {
        if (isCommandLibraryCommandMissingError(error)) {
          setCommandLibraryUnavailableReason(commandLibraryRestartMessage());
        } else {
          setCommandLibraryError(formatError(error));
        }
      }
    }
  }

  async function sendCommandToTargets(appendEnter: boolean) {
    if (!commandSenderCanSend) {
      return;
    }

    await sendCommandTextToTargets(commandSenderInput, appendEnter, selectedCommandSnippetId);
  }

  function handleCommandSenderInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void sendCommandToTargets(true);
    }
  }

  function activateLocalTerminalTab(tab: LocalTerminalTab) {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
    setActiveWorkspaceMode("local");
    setHomeActive(false);
    setActiveLocalTerminalTabId(tab.id);
    syncCommandSenderTargetTab(localCommandSenderTargetId, tab.id);
  }

  function resolveDefaultLocalTerminalProfile() {
    const defaultProfileId = settings.localTerminal.defaultProfileId;
    return (
      localTerminalProfilesRef.current.find((profile) => profile.id === defaultProfileId) ||
      localTerminalProfilesRef.current[0] ||
      null
    );
  }

  function buildLocalTerminalTab(
    tabs: LocalTerminalTab[],
    profile: LocalTerminalProfile,
  ): LocalTerminalTab {
    const nextIndex =
      tabs.filter((tab) => tab.profileId === profile.id).length + 1;
    const now = Date.now();

    return {
      id: `local-terminal-${now.toString()}-${Math.random().toString(36).slice(2, 8)}`,
      profileId: profile.id,
      profileKind: profile.kind,
      requestId: `local-terminal-${now.toString()}`,
      source: "local",
      sessionId: undefined,
      status: "正在打开",
      title: localTerminalTitle(profile, nextIndex),
      warmupOutput: [],
    };
  }

  function closeLocalTerminal(tabId: string) {
    closeLocalTerminalTabs([tabId]);
  }

  function closeLocalTerminalTabs(tabIds: string[]) {
    const closingIds = new Set(tabIds);
    tabIds.forEach(stopTerminalWarmupCapture);
    setLocalTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => !closingIds.has(tab.id));
      localTerminalTabsRef.current = nextTabs;
      if (activeLocalTerminalTabId && closingIds.has(activeLocalTerminalTabId)) {
        const nextActive = nextTabs[0] || null;
        setActiveLocalTerminalTabId(nextActive?.id || null);
        if (
          !nextActive &&
          terminalTabsRef.current.length === 0 &&
          remoteFileTabs.length === 0 &&
          rdpSessionsRef.current.length === 0 &&
          vncSessionsRef.current.length === 0
        ) {
          setHomeActive(true);
          setActiveWorkspaceMode("home");
        } else if (!nextActive && terminalTabsRef.current.length > 0) {
          setActiveWorkspaceMode("ssh");
        } else if (!nextActive && rdpSessionsRef.current.length > 0) {
          activateRdpSession(rdpSessionsRef.current[0]);
        } else if (!nextActive && vncSessionsRef.current.length > 0) {
          activateVncSession(vncSessionsRef.current[0]);
        }
      }
      return nextTabs;
    });
  }

  function closeOtherLocalTerminalTabs(tabId: string) {
    closeLocalTerminalTabs(localTerminalTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  }

  function closeLocalTerminalTabsToRight(tabId: string) {
    const index = localTerminalTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return;
    }
    closeLocalTerminalTabs(localTerminalTabs.slice(index + 1).map((tab) => tab.id));
  }

  function openLocalTerminalWorkspace() {
    setActiveView("workspace");
    setActiveWorkspaceMode("local");
    setHomeActive(false);
    setSettingsSectionRequest(undefined);
    if (localTerminalTabsRef.current.length > 0) {
      if (!activeLocalTerminalTabId) {
        setActiveLocalTerminalTabId(localTerminalTabsRef.current[0]?.id || null);
      }
      return;
    }
    void openLocalTerminalByProfile(resolveDefaultLocalTerminalProfile());
  }

  async function openLocalTerminalByProfile(profile: LocalTerminalProfile | null) {
    if (!profile) {
      setLocalTerminalProfilesError("没有可用的本地终端类型。");
      return;
    }

    const tab = buildLocalTerminalTab(localTerminalTabsRef.current, profile);
    setLocalTerminalTabs((tabs) => {
      const nextTabs = [...tabs, tab];
      localTerminalTabsRef.current = nextTabs;
      return nextTabs;
    });
    activateLocalTerminalTab(tab);

    await openRuntimeLocalTerminalSession(tab, "local-preview", () =>
      localTerminalOpen({
        cols: 80,
        cwd: profile.cwd || undefined,
        profile: toLocalTerminalProfileInput(profile),
        request_id: tab.requestId,
        rows: 24,
      }),
    );
  }

  async function openRuntimeLocalTerminalSession(
    tab: LocalTerminalTab,
    previewPrefix: string,
    openSession: () => Promise<string>,
  ) {
    if (!hasTauriRuntime()) {
      await wait(120);
      setLocalTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: null,
                sessionId: `${previewPrefix}-${Date.now().toString()}`,
                status: "预览",
              }
            : item,
        );
        localTerminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      return;
    }

    try {
      const warmupOutput: number[] = [];
      let stopWarmupCapture: (() => void) | null = null;
      let handoffComplete = false;

      stopWarmupCapture = await listenTerminalOutput((event: TerminalOutputEvent) => {
        if (event.request_id !== tab.requestId) {
          return;
        }
        if (handoffComplete) {
          appendLocalTerminalWarmupOutput(tab.id, event.data);
          return;
        }
        warmupOutput.push(...event.data);
      });
      setTerminalWarmupCaptureStop(tab.id, () => {
        stopWarmupCapture?.();
        stopWarmupCapture = null;
      });

      const sessionId = await openSession();
      if (!localTerminalTabExists(tab.id)) {
        stopTerminalWarmupCapture(tab.id);
        await terminalClose(sessionId).catch(() => undefined);
        return;
      }
      handoffComplete = true;
      setLocalTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: null,
                sessionId,
                status: "已连接",
                warmupOutput: [...warmupOutput],
              }
            : item,
        );
        localTerminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      window.setTimeout(() => {
        stopTerminalWarmupCapture(tab.id);
      }, 3000);
    } catch (error) {
      stopTerminalWarmupCapture(tab.id);
      setLocalTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: formatDetailedError(error),
                sessionId: undefined,
                status: "连接失败",
              }
            : item,
        );
        localTerminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      throw error;
    }
  }

  function buildCharacterTerminalTab(
    source: "telnet" | "serial",
    title: string,
    profileId: string,
  ): LocalTerminalTab {
    const now = Date.now();
    return {
      id: `${source}-terminal-${now.toString()}-${Math.random().toString(36).slice(2, 8)}`,
      profileId,
      profileKind: source,
      requestId: `${source}-terminal-${now.toString()}`,
      sessionId: undefined,
      source,
      status: "正在连接",
      title,
      warmupOutput: [],
    };
  }

  function addAndActivateCharacterTerminalTab(tab: LocalTerminalTab) {
    setLocalTerminalTabs((tabs) => {
      const nextTabs = [...tabs, tab];
      localTerminalTabsRef.current = nextTabs;
      return nextTabs;
    });
    activateLocalTerminalTab(tab);
  }

  function openCharacterConnectionSession(
    connection: TelnetConnectionProfile | SerialConnectionProfile,
  ) {
    const existingTab = localTerminalTabsRef.current.find(
      (tab) => tab.profileId === connection.id,
    );
    if (existingTab) {
      activateLocalTerminalTab(existingTab);
      return;
    }

    const source = connection.protocol;
    const title = connection.name || formatConnectionAddress(connection);
    const tab = buildCharacterTerminalTab(source, title, connection.id);
    addAndActivateCharacterTerminalTab(tab);
    void runCharacterConnectionSession(tab, connection);
  }

  async function runCharacterConnectionSession(
    tab: LocalTerminalTab,
    connection: TelnetConnectionProfile | SerialConnectionProfile,
  ) {
    try {
      if (connection.protocol === "telnet") {
        await openRuntimeLocalTerminalSession(tab, "telnet-preview", () =>
          telnetTerminalOpen({
            backspace_mode: connection.telnet?.backspace_mode || "del",
            enter_mode: connection.telnet?.enter_mode || "crlf",
            host: connection.host,
            port: connection.port || 23,
            request_id: tab.requestId,
          }),
        );
      } else {
        const serial = connection.serial;
        const portName = serial?.port_name || connection.host;
        await openRuntimeLocalTerminalSession(tab, "serial-preview", () =>
          serialTerminalOpen({
            backspace_mode: serial?.backspace_mode || "del",
            baud_rate: serial?.baud_rate || 9600,
            data_bits: serial?.data_bits || "eight",
            flow_control: serial?.flow_control || "none",
            parity: serial?.parity || "none",
            port_name: portName,
            request_id: tab.requestId,
            stop_bits: serial?.stop_bits || "one",
          }),
        );
      }
      void markConnected(connection.id);
    } catch {
      // openRuntimeLocalTerminalSession 已经把错误写入标签状态。
    }
  }

  function closeLocalTerminalSession(tab: LocalTerminalTab) {
    const { id } = tab;
    stopTerminalWarmupCapture(id);
    closeLocalTerminal(id);
  }

  function localTerminalTabExists(tabId: string) {
    return localTerminalTabsRef.current.some((tab) => tab.id === tabId);
  }

  function openSettingsSection(sectionId?: SettingsSectionId) {
    setSettingsSectionRequest(sectionId);
    setSettingsSectionRequestKey((current) => current + 1);
    setActiveView("settings");
  }

  function returnFromSettings() {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
  }

  function openLocalTerminalSettings() {
    openSettingsSection("localTerminal");
  }

  function selectConnection(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);
  }

  function openConnectionSession(connection: ConnectionProfile) {
    if (isRdpConnection(connection)) {
      openRdpConnectionSession(connection);
      return;
    }
    if (isVncConnection(connection)) {
      openVncConnectionSession(connection);
      return;
    }
    if (isTelnetConnection(connection) || isSerialConnection(connection)) {
      openCharacterConnectionSession(connection);
      return;
    }

    const pendingTab = pendingTabForConnection(connection.id);
    if (pendingTab) {
      activateTerminalTab(pendingTab);
      return;
    }

    startConnectionStep(connection, "terminal");
  }

  function openTerminal(connection: ConnectionProfile) {
    if (isRdpConnection(connection)) {
      openRdpConnectionSession(connection);
      return;
    }
    if (isVncConnection(connection)) {
      openVncConnectionSession(connection);
      return;
    }
    if (isTelnetConnection(connection) || isSerialConnection(connection)) {
      openCharacterConnectionSession(connection);
      return;
    }

    startConnectionStep(connection, "terminal");
  }

  function openRdpConnectionSession(connection: ConnectionProfile) {
    const existingSession = preferredRdpSessionForConnection(connection.id);
    if (existingSession) {
      activateRdpSession(existingSession);
      revealNativeRdpHostSession(existingSession);
      return;
    }

    startRdpSession(connection);
  }

  function startRdpSession(connection: ConnectionProfile) {
    const existingSession = preferredRdpSessionForConnection(connection.id);
    if (existingSession) {
      activateRdpSession(existingSession);
      revealNativeRdpHostSession(existingSession);
      return;
    }

    const session = buildRdpSession(connection);
    setRdpSessions((sessions) => {
      const nextSessions = [...sessions, session];
      rdpSessionsRef.current = nextSessions;
      return nextSessions;
    });
    activateRdpSession(session);
    void runRdpSession(session.id, connection);
  }

  function revealNativeRdpHostSession(session: RdpSessionTab) {
    if (!hasTauriRuntime()) {
      return;
    }
    const backendSessionId = session.result?.session_id;
    if (!backendSessionId || session.result?.runner !== "mstsc_activex") {
      return;
    }
    void rdpRevealSession(backendSessionId).catch(() => undefined);
  }

  async function runRdpSession(sessionId: string, connection: ConnectionProfile) {
    updateRdpSession(sessionId, (session) => ({
      ...session,
      error: null,
      message: "正在选择可用 RDP runner 并启动客户端。",
      preview: null,
      result: null,
      status: "launching",
    }));

    if (!hasTauriRuntime()) {
      await wait(160);
      if (!rdpSessionExists(sessionId)) {
        return;
      }
      updateRdpSession(sessionId, (session) => ({
        ...session,
        message: "浏览器预览模式不会启动桌面客户端，真实运行时会打开 RDP runner 或原生子窗口。",
        preview: previewRdpLaunchForBrowser(connection, desktopPlatform),
        status: "external",
      }));
      void markConnected(connection.id);
      return;
    }

    try {
      const result = await rdpLaunchConnection(connection.id);
      if (!rdpSessionExists(sessionId)) {
        if (result.session_id) {
          await rdpCloseSession(result.session_id).catch(() => undefined);
        }
        return;
      }
      const nativeActiveX = result.runner === "mstsc_activex" && !result.embedded;
      updateRdpSession(sessionId, (session) => ({
        ...session,
        error: null,
        message:
          result.fallback_reason ||
          (result.embedded
            ? "嵌入式 RDP 会话已创建。"
            : nativeActiveX
              ? "RDP 原生子窗口已打开。"
            : "RDP 客户端已启动，凭据由客户端提示。"),
        result,
        status: result.embedded ? "embedded" : nativeActiveX ? "native" : "external",
      }));
      void markConnected(connection.id);
    } catch (error) {
      if (!rdpSessionExists(sessionId)) {
        return;
      }
      updateRdpSession(sessionId, (session) => ({
        ...session,
        error: formatDetailedError(error),
        message: null,
        status: "error",
      }));
    }
  }

  async function previewRdpSessionLaunch(sessionId: string) {
    const session = rdpSessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const connection = connectionById.get(session.connectionId);
    if (!connection) {
      updateRdpSession(sessionId, (current) => ({
        ...current,
        message: "连接已删除，无法生成启动预览。",
      }));
      return;
    }

    updateRdpSession(sessionId, (current) => ({
      ...current,
      message: "正在生成启动预览。",
    }));

    try {
      const preview = hasTauriRuntime()
        ? await rdpPreviewLaunch(connection.id)
        : previewRdpLaunchForBrowser(connection, desktopPlatform);
      updateRdpSession(sessionId, (current) => ({
        ...current,
        message: "启动预览已更新，内容已隐藏敏感凭据。",
        preview,
      }));
    } catch (error) {
      updateRdpSession(sessionId, (current) => ({
        ...current,
        message: `启动预览失败：${formatError(error)}`,
      }));
    }
  }

  function retryRdpSession(sessionId: string) {
    const session = rdpSessionsRef.current.find((item) => item.id === sessionId);
    const connection = session ? connectionById.get(session.connectionId) : null;
    if (!session || !connection) {
      return;
    }
    activateRdpSession(session);
    void runRdpSession(session.id, connection);
  }

  function activateRdpSession(session: RdpSessionTab) {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
    setActiveWorkspaceMode("rdp");
    setHomeActive(false);
    setActiveConnectionId(session.connectionId);
    setActiveRdpSessionId(session.id);
    setRightTool("tools");
  }

  function closeRdpSession(sessionId: string) {
    closeRdpSessions([sessionId]);
  }

  function removeRdpSessionsLocally(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return;
    }

    const closingIds = new Set(sessionIds);
    setRdpSessions((sessions) => {
      const nextSessions = sessions.filter((session) => !closingIds.has(session.id));
      rdpSessionsRef.current = nextSessions;
      const activeRdpClosed = activeRdpSessionId
        ? closingIds.has(activeRdpSessionId)
        : activeWorkspaceMode === "rdp";

      if (activeRdpClosed) {
        const sameConnectionSession =
          activeConnectionId
            ? nextSessions.find((session) => session.connectionId === activeConnectionId) || null
            : null;
        const nextRdpSession = sameConnectionSession || nextSessions[0] || null;
        if (nextRdpSession) {
          setActiveRdpSessionId(nextRdpSession.id);
          setActiveConnectionId(nextRdpSession.connectionId);
          setActiveWorkspaceMode("rdp");
          setHomeActive(false);
        } else {
          setActiveRdpSessionId(null);
          const nextVncSession = vncSessionsRef.current[0] || null;
          const nextTerminalTab = terminalTabsRef.current[0] || null;
          const nextLocalTerminalTab = localTerminalTabsRef.current[0] || null;
          if (nextVncSession) {
            activateVncSession(nextVncSession);
          } else if (nextTerminalTab) {
            activateTerminalTab(nextTerminalTab);
          } else if (nextLocalTerminalTab) {
            activateLocalTerminalTab(nextLocalTerminalTab);
          } else {
            returnHomeWhenWorkspaceEmpty({ rdpCount: nextSessions.length });
          }
        }
      }

      return nextSessions;
    });
  }

  function closeRdpSessions(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return;
    }

    const closingIds = new Set(sessionIds);
    const closingSessions = rdpSessionsRef.current.filter((session) => closingIds.has(session.id));
    if (hasTauriRuntime()) {
      closingSessions.forEach((session) => {
        const backendSessionId = session.result?.session_id;
        if (backendSessionId) {
          void rdpCloseSession(backendSessionId).catch(() => undefined);
        }
      });
    }

    removeRdpSessionsLocally(sessionIds);
  }

  function closeOtherRdpSessions(sessionId: string) {
    const session = rdpSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    closeRdpSessions(
      rdpSessions
        .filter((item) => item.connectionId === session.connectionId && item.id !== sessionId)
        .map((item) => item.id),
    );
  }

  function closeRdpSessionsToRight(sessionId: string) {
    const session = rdpSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const sameConnectionSessions = rdpSessions.filter((item) => item.connectionId === session.connectionId);
    const index = sameConnectionSessions.findIndex((item) => item.id === sessionId);
    if (index < 0) {
      return;
    }
    closeRdpSessions(sameConnectionSessions.slice(index + 1).map((item) => item.id));
  }

  function closeAllRdpSessionsForConnection(connectionId: string) {
    closeRdpSessions(rdpSessions.filter((session) => session.connectionId === connectionId).map((session) => session.id));
  }

  function preferredRdpSessionForConnection(connectionId: string) {
    const activeSession = activeRdpSessionId
      ? rdpSessionsRef.current.find(
          (session) => session.id === activeRdpSessionId && session.connectionId === connectionId,
        ) || null
      : null;
    return (
      activeSession ||
      rdpSessionsRef.current.find((session) => session.connectionId === connectionId) ||
      null
    );
  }

  function rdpSessionExists(sessionId: string) {
    return rdpSessionsRef.current.some((session) => session.id === sessionId);
  }

  function buildRdpSession(connection: ConnectionProfile): RdpSessionTab {
    const now = Date.now();
    const index =
      rdpSessionsRef.current.filter((session) => session.connectionId === connection.id).length + 1;
    return {
      connectionId: connection.id,
      createdAt: now,
      id: `rdp-${connection.id}-${now.toString()}`,
      message: null,
      preview: null,
      result: null,
      status: "launching",
      title: index === 1 ? "RDP" : `RDP ${index.toString()}`,
    };
  }

  function updateRdpSession(
    sessionId: string,
    updater: (session: RdpSessionTab) => RdpSessionTab,
  ) {
    setRdpSessions((sessions) => {
      const nextSessions = sessions.map((session) =>
        session.id === sessionId ? updater(session) : session,
      );
      rdpSessionsRef.current = nextSessions;
      return nextSessions;
    });
  }

  function openVncConnectionSession(connection: ConnectionProfile) {
    const existingSession = preferredVncSessionForConnection(connection.id);
    if (existingSession) {
      activateVncSession(existingSession);
      return;
    }

    startVncSession(connection);
  }

  function startVncSession(connection: ConnectionProfile) {
    const existingSession = preferredVncSessionForConnection(connection.id);
    if (existingSession) {
      activateVncSession(existingSession);
      return;
    }

    const session = buildVncSession(connection);
    setVncSessions((sessions) => {
      const nextSessions = [...sessions, session];
      vncSessionsRef.current = nextSessions;
      return nextSessions;
    });
    activateVncSession(session);
    void runVncSession(session.id, connection);
  }

  async function runVncSession(sessionId: string, connection: ConnectionProfile) {
    const renderMode = connection.vnc?.runner.render_mode || defaultVncConfig.runner.render_mode;
    const openInRunnerHost = renderMode === "windowed";
    updateVncSession(sessionId, (session) => ({
      ...session,
      error: null,
      message: openInRunnerHost
        ? "正在创建 VNC 本地桥接并打开 runner host。"
        : "正在创建 VNC 本地桥接并启动 noVNC。",
      preview: null,
      result: null,
      status: "launching",
      windowLabel: null,
    }));

    if (!hasTauriRuntime()) {
      await wait(160);
      if (!vncSessionExists(sessionId)) {
        return;
      }
      updateVncSession(sessionId, (session) => ({
        ...session,
        message: openInRunnerHost
          ? "浏览器预览模式不会创建 VNC 桥接，真实运行时会打开 VNC runner host。"
          : "浏览器预览模式不会创建 VNC 桥接，真实运行时会打开 noVNC 内嵌画面。",
        preview: previewVncLaunchForBrowser(connection),
        status: openInRunnerHost ? "windowed" : "external",
      }));
      void markConnected(connection.id);
      return;
    }

    try {
      const result = await vncLaunchConnection(connection.id);
      if (!vncSessionExists(sessionId)) {
        if (result.session_id) {
          await vncCloseSession(result.session_id).catch(() => undefined);
        }
        return;
      }
      if (result.embedded && openInRunnerHost) {
        try {
          const windowLabel = await openVncRunnerHostWindow(sessionId, connection, result);
          if (!vncSessionExists(sessionId)) {
            await vncCloseSession(result.session_id).catch(() => undefined);
            void emitVncRunnerWindowCloseRequest(windowLabel, {
              window_label: windowLabel,
              workspace_session_id: sessionId,
            }).catch(() => undefined);
            return;
          }
          updateVncSession(sessionId, (session) => ({
            ...session,
            error: null,
            message: result.fallback_reason || "VNC 画面已交给 RDP 风格 runner host。",
            result,
            status: "windowed",
            windowLabel,
          }));
          void markConnected(connection.id);
          return;
        } catch (error) {
          await vncCloseSession(result.session_id).catch(() => undefined);
          updateVncSession(sessionId, (session) => ({
            ...session,
            error: `VNC runner host 打开失败：${formatDetailedError(error)}`,
            message: null,
            status: "error",
          }));
          return;
        }
      }
      updateVncSession(sessionId, (session) => ({
        ...session,
        error: null,
        message:
          result.fallback_reason ||
          (result.embedded
            ? "VNC 桥接已创建，正在连接远程画面。"
            : "VNC 客户端已启动，凭据由客户端提示。"),
        result,
        status: result.embedded ? "embedded" : "external",
        windowLabel: null,
      }));
      void markConnected(connection.id);
    } catch (error) {
      if (!vncSessionExists(sessionId)) {
        return;
      }
      updateVncSession(sessionId, (session) => ({
        ...session,
        error: formatDetailedError(error),
        message: null,
        status: "error",
      }));
    }
  }

  async function openVncRunnerHostWindow(
    sessionId: string,
    connection: ConnectionProfile,
    result: VncLaunchResult,
  ) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const windowLabel = VNC_RUNNER_HOST_WINDOW_LABEL;
    const payload: VncRunnerWindowPayload = {
      config: connection.vnc || defaultVncConfig,
      connection: connectionInfoFromVncProfile(connection) || {
        host: connection.host,
        name: connection.name,
        port: connection.port || 5900,
        username: connection.username,
      },
      result,
      window_label: windowLabel,
      workspace_session_id: sessionId,
    };
    pendingVncRunnerWindowPayloadsRef.current.set(sessionId, payload);

    let host = await WebviewWindow.getByLabel(windowLabel);
    if (!host) {
      vncRunnerWindowReadyRef.current = false;
      host = new WebviewWindow(windowLabel, {
        center: true,
        decorations: false,
        focus: true,
        height: 820,
        minHeight: 480,
        minWidth: 720,
        parent: "main",
        resizable: true,
        title: "mXterm VNC",
        url: vncRunnerWindowUrl(),
        visible: true,
        width: 1280,
      });
      await waitForWebviewWindowCreation(host);
    } else {
      vncRunnerWindowReadyRef.current = true;
      await host.unminimize().catch(() => undefined);
      await host.show().catch(() => undefined);
      await host.setFocus().catch(() => undefined);
    }

    if (vncRunnerWindowReadyRef.current) {
      await emitVncRunnerWindowPayload(windowLabel, payload);
      pendingVncRunnerWindowPayloadsRef.current.delete(sessionId);
    }

    return windowLabel;
  }

  async function previewVncSessionLaunch(sessionId: string) {
    const session = vncSessionsRef.current.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const connection = connectionById.get(session.connectionId);
    if (!connection) {
      updateVncSession(sessionId, (current) => ({
        ...current,
        message: "连接已删除，无法生成启动预览。",
      }));
      return;
    }

    updateVncSession(sessionId, (current) => ({
      ...current,
      message: "正在生成 VNC 启动预览。",
    }));

    try {
      const preview = hasTauriRuntime()
        ? await vncPreviewLaunch(connection.id)
        : previewVncLaunchForBrowser(connection);
      updateVncSession(sessionId, (current) => ({
        ...current,
        message: "VNC 启动预览已更新，内容已隐藏敏感凭据。",
        preview,
      }));
    } catch (error) {
      updateVncSession(sessionId, (current) => ({
        ...current,
        message: `VNC 启动预览失败：${formatError(error)}`,
      }));
    }
  }

  function retryVncSession(sessionId: string) {
    const session = vncSessionsRef.current.find((item) => item.id === sessionId);
    const connection = session ? connectionById.get(session.connectionId) : null;
    if (!session || !connection) {
      return;
    }
    activateVncSession(session);
    void runVncSession(session.id, connection);
  }

  function activateVncSession(session: VncSessionTab) {
    setActiveView("workspace");
    setSettingsSectionRequest(undefined);
    setActiveWorkspaceMode("vnc");
    setHomeActive(false);
    setActiveConnectionId(session.connectionId);
    setActiveVncSessionId(session.id);
    setRightTool("tools");
  }

  function closeVncSession(sessionId: string) {
    closeVncSessions([sessionId]);
  }

  function removeVncSessionsLocally(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return;
    }

    const closingIds = new Set(sessionIds);
    setVncSessions((sessions) => {
      const nextSessions = sessions.filter((session) => !closingIds.has(session.id));
      vncSessionsRef.current = nextSessions;
      const activeVncClosed = activeVncSessionId
        ? closingIds.has(activeVncSessionId)
        : activeWorkspaceMode === "vnc";

      if (activeVncClosed) {
        const sameConnectionSession =
          activeConnectionId
            ? nextSessions.find((session) => session.connectionId === activeConnectionId) || null
            : null;
        const nextVncSession = sameConnectionSession || nextSessions[0] || null;
        if (nextVncSession) {
          setActiveVncSessionId(nextVncSession.id);
          setActiveConnectionId(nextVncSession.connectionId);
          setActiveWorkspaceMode("vnc");
          setHomeActive(false);
        } else {
          setActiveVncSessionId(null);
          const nextRdpSession = rdpSessionsRef.current[0] || null;
          const nextTerminalTab = terminalTabsRef.current[0] || null;
          const nextLocalTerminalTab = localTerminalTabsRef.current[0] || null;
          if (nextRdpSession) {
            activateRdpSession(nextRdpSession);
          } else if (nextTerminalTab) {
            activateTerminalTab(nextTerminalTab);
          } else if (nextLocalTerminalTab) {
            activateLocalTerminalTab(nextLocalTerminalTab);
          } else {
            returnHomeWhenWorkspaceEmpty({ vncCount: nextSessions.length });
          }
        }
      }

      return nextSessions;
    });
  }

  function closeVncSessions(
    sessionIds: string[],
    options: { notifyRunnerWindow?: boolean } = {},
  ) {
    if (sessionIds.length === 0) {
      return;
    }

    const notifyRunnerWindow = options.notifyRunnerWindow ?? true;
    const closingIds = new Set(sessionIds);
    const closingSessions = vncSessionsRef.current.filter((session) => closingIds.has(session.id));
    closingSessions.forEach((session) => {
      pendingVncRunnerWindowPayloadsRef.current.delete(session.id);
    });
    if (hasTauriRuntime()) {
      closingSessions.forEach((session) => {
        const backendSessionId = session.result?.session_id;
        if (backendSessionId) {
          void vncCloseSession(backendSessionId).catch(() => undefined);
        }
        if (notifyRunnerWindow && session.windowLabel) {
          void emitVncRunnerWindowCloseRequest(session.windowLabel, {
            window_label: session.windowLabel,
            workspace_session_id: session.id,
          }).catch(() => undefined);
        }
      });
    }

    removeVncSessionsLocally(sessionIds);
  }

  function closeOtherVncSessions(sessionId: string) {
    const session = vncSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    closeVncSessions(
      vncSessions
        .filter((item) => item.connectionId === session.connectionId && item.id !== sessionId)
        .map((item) => item.id),
    );
  }

  function closeVncSessionsToRight(sessionId: string) {
    const session = vncSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const sameConnectionSessions = vncSessions.filter((item) => item.connectionId === session.connectionId);
    const index = sameConnectionSessions.findIndex((item) => item.id === sessionId);
    if (index < 0) {
      return;
    }
    closeVncSessions(sameConnectionSessions.slice(index + 1).map((item) => item.id));
  }

  function closeAllVncSessionsForConnection(connectionId: string) {
    closeVncSessions(vncSessions.filter((session) => session.connectionId === connectionId).map((session) => session.id));
  }

  function preferredVncSessionForConnection(connectionId: string) {
    const activeSession = activeVncSessionId
      ? vncSessionsRef.current.find(
          (session) => session.id === activeVncSessionId && session.connectionId === connectionId,
        ) || null
      : null;
    return (
      activeSession ||
      vncSessionsRef.current.find((session) => session.connectionId === connectionId) ||
      null
    );
  }

  function vncSessionExists(sessionId: string) {
    return vncSessionsRef.current.some((session) => session.id === sessionId);
  }

  function buildVncSession(connection: ConnectionProfile): VncSessionTab {
    const now = Date.now();
    const index =
      vncSessionsRef.current.filter((session) => session.connectionId === connection.id).length + 1;
    return {
      connectionId: connection.id,
      createdAt: now,
      id: `vnc-${connection.id}-${now.toString()}`,
      message: null,
      preview: null,
      result: null,
      status: "launching",
      title: index === 1 ? "VNC" : `VNC ${index.toString()}`,
    };
  }

  function updateVncSession(
    sessionId: string,
    updater: (session: VncSessionTab) => VncSessionTab,
  ) {
    setVncSessions((sessions) => {
      const nextSessions = sessions.map((session) =>
        session.id === sessionId ? updater(session) : session,
      );
      vncSessionsRef.current = nextSessions;
      return nextSessions;
    });
  }

  function closeTerminal(tabId: string) {
    closeTerminalTabs([tabId]);
  }

  function invalidateDockerExecConnection(connectionId: string) {
    if (!hasTauriRuntime()) {
      return;
    }
    void dockerExecInvalidateConnection(connectionId).catch(() => undefined);
  }

  function closeTerminalTabs(tabIds: string[]) {
    const closingIds = new Set(tabIds);
    const closingTabIds = terminalTabs.filter((tab) => closingIds.has(tab.id)).map((tab) => tab.id);
    closingTabIds.forEach(stopTerminalWarmupCapture);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    setTerminalTabs((tabs) => {
      const activeClosingTab = activeTabId
        ? tabs.find((tab) => tab.id === activeTabId && closingIds.has(tab.id)) || null
        : null;
      const closingActiveConnectionTab =
        activeClosingTab ||
        (activeConnectionId
          ? tabs.find((tab) => tab.connectionId === activeConnectionId && closingIds.has(tab.id)) || null
          : null);
      const nextTabs = tabs.filter((tab) => !closingIds.has(tab.id));
      const finalClosedConnectionIds = new Set(
        tabs
          .filter((tab) => closingIds.has(tab.id))
          .map((tab) => tab.connectionId)
          .filter((connectionId) => !nextTabs.some((tab) => tab.connectionId === connectionId)),
      );
      finalClosedConnectionIds.forEach((connectionId) => {
        invalidateDockerExecConnection(connectionId);
      });
      terminalTabsRef.current = nextTabs;
      if (
        nextTabs.length === 0 &&
        remoteFileTabs.length === 0 &&
        localTerminalTabsRef.current.length === 0 &&
        rdpSessionsRef.current.length === 0 &&
        vncSessionsRef.current.length === 0
      ) {
        setActiveTabId(null);
        setActiveConnectionId(null);
        setActiveWorkspaceMode("home");
        setHomeActive(true);
      }

      if (activeClosingTab) {
        const nextActiveTab =
          (activeClosingTab
            ? nextTabs.find((tab) => tab.connectionId === activeClosingTab.connectionId)
            : null) ||
          nextTabs[0] ||
          null;
        const nextActiveFile =
          (activeClosingTab
            ? remoteFileTabs.find((tab) => tab.connectionId === activeClosingTab.connectionId)
            : null) ||
          remoteFileTabs[0] ||
          null;

        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
        if (nextActiveFile && !nextActiveTab) {
          setActiveRemoteFileTabId(nextActiveFile.id);
        }
        if (nextActiveTab) {
          rememberActiveTab(nextActiveTab);
        } else if (activeClosingTab) {
          forgetActiveConnectionTabs([activeClosingTab.connectionId]);
          if (!nextActiveFile) {
            const nextRdpSession = rdpSessionsRef.current[0] || null;
            const nextVncSession = vncSessionsRef.current[0] || null;
            const nextLocalTerminalTab = localTerminalTabsRef.current[0] || null;
            if (nextRdpSession) {
              activateRdpSession(nextRdpSession);
            } else if (nextVncSession) {
              activateVncSession(nextVncSession);
            } else if (nextLocalTerminalTab) {
              activateLocalTerminalTab(nextLocalTerminalTab);
            }
          }
        }
      } else if (
        closingActiveConnectionTab &&
        activeConnectionId === closingActiveConnectionTab.connectionId &&
        !nextTabs.some((tab) => tab.connectionId === closingActiveConnectionTab.connectionId)
      ) {
        const nextActiveFile =
          remoteFileTabs.find((tab) => tab.connectionId === closingActiveConnectionTab.connectionId) ||
          remoteFileTabs[0] ||
          null;
        setActiveConnectionId(nextTabs[0]?.connectionId || nextActiveFile?.connectionId || null);
        forgetActiveConnectionTabs([closingActiveConnectionTab.connectionId]);
        if (!nextTabs[0] && !nextActiveFile && rdpSessionsRef.current.length > 0) {
          activateRdpSession(rdpSessionsRef.current[0]);
        } else if (!nextTabs[0] && !nextActiveFile && vncSessionsRef.current.length > 0) {
          activateVncSession(vncSessionsRef.current[0]);
        } else if (!nextTabs[0] && !nextActiveFile && localTerminalTabsRef.current.length > 0) {
          activateLocalTerminalTab(localTerminalTabsRef.current[0]);
        }
      }
      return nextTabs;
    });
  }

  function closeOtherTerminalTabs(tabId: string) {
    const tab = terminalTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    closeTerminalTabs(
      terminalTabs
        .filter((item) => item.connectionId === tab.connectionId && item.id !== tabId)
        .map((item) => item.id),
    );
  }

  function closeTerminalTabsToRight(tabId: string) {
    const tab = terminalTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    const sameConnectionTabs = terminalTabs.filter((item) => item.connectionId === tab.connectionId);
    const index = sameConnectionTabs.findIndex((item) => item.id === tabId);
    if (index < 0) {
      return;
    }
    closeTerminalTabs(sameConnectionTabs.slice(index + 1).map((item) => item.id));
  }

  function closeAllTerminalTabsForConnection(connectionId: string) {
    closeTerminalTabs(terminalTabs.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.id));
  }

  function closeConnectionSession(connectionId: string) {
    closeConnectionSessions([connectionId]);
  }

  function closeConnectionSessions(
    connectionIds: string[],
    options: { discardDirtyRemoteFiles?: boolean } = {},
  ) {
    const closingConnectionIds = new Set(connectionIds);
    const dirtyRemoteFileTabs = remoteFileTabs.filter(
      (tab) => closingConnectionIds.has(tab.connectionId) && tab.dirty,
    );
    if (dirtyRemoteFileTabs.length > 0 && !options.discardDirtyRemoteFiles) {
      setPendingConnectionSessionCloseIds(connectionIds);
      return;
    }
    setPendingConnectionSessionCloseIds(null);
    const remainingRemoteFileTabs = clearRemoteFileSessionStateForConnections(closingConnectionIds);
    connectionIds.forEach((connectionId) => {
      invalidateDockerExecConnection(connectionId);
    });
    closeRdpSessions(
      rdpSessionsRef.current
        .filter((session) => closingConnectionIds.has(session.connectionId))
        .map((session) => session.id),
    );
    closeVncSessions(
      vncSessionsRef.current
        .filter((session) => closingConnectionIds.has(session.connectionId))
        .map((session) => session.id),
    );
    const closingTabIds = terminalTabs
      .filter((tab) => closingConnectionIds.has(tab.connectionId))
      .map((tab) => tab.id);
    closingTabIds.forEach(stopTerminalWarmupCapture);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs(connectionIds);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => !closingConnectionIds.has(tab.connectionId));
      terminalTabsRef.current = nextTabs;
      if (
        nextTabs.length === 0 &&
        remainingRemoteFileTabs.length === 0 &&
        localTerminalTabsRef.current.length === 0 &&
        !rdpSessionsRef.current.some((session) => !closingConnectionIds.has(session.connectionId)) &&
        !vncSessionsRef.current.some((session) => !closingConnectionIds.has(session.connectionId))
      ) {
        setActiveConnectionId(null);
        setActiveTabId(null);
        setActiveWorkspaceMode("home");
        setHomeActive(true);
      }

      if (activeConnectionId && closingConnectionIds.has(activeConnectionId)) {
        const nextActiveTab = nextTabs[0] || null;
        const nextActiveFile =
          remainingRemoteFileTabs.find((tab) => !closingConnectionIds.has(tab.connectionId)) ||
          remainingRemoteFileTabs[0] ||
          null;
        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
        if (nextActiveFile) {
          setActiveRemoteFileTabId(nextActiveFile.id);
        } else if (!nextActiveTab) {
          const nextRdpSession = rdpSessionsRef.current.find(
            (session) => !closingConnectionIds.has(session.connectionId),
          );
          if (nextRdpSession) {
            activateRdpSession(nextRdpSession);
          } else {
            const nextVncSession = vncSessionsRef.current.find(
              (session) => !closingConnectionIds.has(session.connectionId),
            );
            if (nextVncSession) {
              activateVncSession(nextVncSession);
            } else {
              const nextLocalTerminalTab = localTerminalTabsRef.current[0] || null;
              if (nextLocalTerminalTab) {
                activateLocalTerminalTab(nextLocalTerminalTab);
              }
            }
          }
        }
      }

      return nextTabs;
    });
  }

  function closeOtherConnectionSessions(connectionId: string) {
    closeConnectionSessions(
      connectionSessions
        .filter((session) => session.connectionId !== connectionId)
        .map((session) => session.connectionId),
    );
  }

  function closeConnectionSessionsToRight(connectionId: string) {
    const index = connectionSessions.findIndex((session) => session.connectionId === connectionId);
    if (index < 0) {
      return;
    }
    closeConnectionSessions(connectionSessions.slice(index + 1).map((session) => session.connectionId));
  }

  function openTerminalInActiveConnection() {
    if (isSshConnection(activeConnection)) {
      const tab = buildDirectTerminalTab(terminalTabsRef.current, activeConnection);
      setTerminalTabs((tabs) => {
        const nextTabs = [...tabs, tab];
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      activateTerminalTab(tab);
      void runDirectTerminalTab(tab, activeConnection);
    }
  }

  function openDockerContainerTerminal(container: DockerContainerSummary) {
    if (!isSshConnection(activeConnection)) {
      return;
    }
    const title = `容器 ${container.name || shortDockerRuntimeId(container.id)}`;
    const tab = buildDirectTerminalTab(terminalTabsRef.current, activeConnection, title);
    const command = `docker exec -it ${quotePosixShellForTerminal(container.id)} sh\r`;
    setTerminalTabs((tabs) => {
      const nextTabs = [...tabs, tab];
      terminalTabsRef.current = nextTabs;
      return nextTabs;
    });
    activateTerminalTab(tab);
    void runDirectTerminalTab(tab, activeConnection, command);
  }

  async function runDirectTerminalTab(
    tab: TerminalTab,
    connection: ConnectionProfile,
    initialCommand?: string,
  ) {
    if (!tab.requestId) {
      return;
    }

    if (!hasTauriRuntime()) {
      await wait(120);
      if (!terminalTabExists(tab.id)) {
        return;
      }
      setTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: null,
                requestId: tab.requestId,
                sessionId: `preview-${Date.now().toString()}`,
                status: "预览",
                warmupOutput: [],
              }
            : item,
        );
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      void markConnected(connection.id);
      return;
    }

    const warmupOutput: number[] = [];
    let stopWarmupCapture: (() => void) | null = null;
    let handoffComplete = false;

    try {
      stopWarmupCapture = await listenTerminalOutput((event: TerminalOutputEvent) => {
        if (event.request_id !== tab.requestId) {
          return;
        }
        if (handoffComplete) {
          appendTerminalWarmupOutput(tab.id, event.data);
          return;
        }
        warmupOutput.push(...event.data);
      });
      setTerminalWarmupCaptureStop(tab.id, () => {
        stopWarmupCapture?.();
        stopWarmupCapture = null;
      });

      const sessionId = await terminalConnect({
        cols: 80,
        connection_id: connection.id,
        host: connection.host,
        port: connection.port,
        request_id: tab.requestId,
        rows: 24,
        username: connection.username,
      });

      if (!terminalTabExists(tab.id)) {
        stopTerminalWarmupCapture(tab.id);
        await terminalClose(sessionId).catch(() => {});
        return;
      }

      handoffComplete = true;
      setTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: null,
                requestId: tab.requestId,
                sessionId,
                status: "已连接",
                warmupOutput,
              }
            : item,
        );
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      });
      void refreshConnectedProfile(connection.id, { connection_id: connection.id });
      if (initialCommand) {
        void terminalWrite(sessionId, initialCommand).catch((error) => {
          setTerminalTabs((tabs) => {
            const nextTabs = tabs.map((item) =>
              item.id === tab.id
                ? {
                    ...item,
                    error: `命令发送失败：${formatError(error)}`,
                  }
                : item,
            );
            terminalTabsRef.current = nextTabs;
            return nextTabs;
          });
        });
      }
      window.setTimeout(() => {
        stopTerminalWarmupCapture(tab.id);
      }, 3000);
    } catch (error) {
      stopTerminalWarmupCapture(tab.id);
      if (!terminalTabExists(tab.id)) {
        return;
      }
      setTerminalTabs((tabs) => {
        const nextTabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                error: formatError(error),
                sessionId: undefined,
                status: "连接失败",
                warmupOutput,
              }
            : item,
        );
        terminalTabsRef.current = nextTabs;
        return nextTabs;
      });
    }
  }

  async function moveConnectionToGroup(connection: ConnectionProfile, groupName: string | null) {
    await upsert(connectionToInput({ ...connection, group: groupName || undefined }));
  }

  async function toggleConnectionFavorite(connection: ConnectionProfile) {
    await setFavorite(connection.id, !connection.is_favorite);
  }

  function openCredentialSettings() {
    closeConnectionDialog();
    openSettingsSection("credentials");
  }

  async function saveConnectionFromDialog(input: ConnectionProfileInput) {
    await saveConnection(input);
  }

  async function testConnectionFromDialog(input: ConnectionProfileInput) {
    if (!hasTauriRuntime()) {
      await wait(260);
      return;
    }
    await connectionTestProfile(input);
  }

  async function saveCredentialFromSettings(input: CredentialProfileInput) {
    await upsertCredential(input);
  }

  async function deleteCredentialFromSettings(credential: CredentialProfile) {
    await removeCredential(credential.id);
  }

  function startConnectionStep(connection: ConnectionProfile, mode: ConnectionStepMode) {
    if (isRdpConnection(connection)) {
      openRdpConnectionSession(connection);
      return;
    }
    if (isVncConnection(connection)) {
      openVncConnectionSession(connection);
      return;
    }

    const authKind = connection.prompt_auth_kind || connection.inline_auth_kind || "password";
    const step: ConnectionStepState = {
      authKind,
      connection,
      error: null,
      hostKey: null,
      hostKeyDecision: null,
      id: Date.now(),
      logs: [
        `${mode === "terminal" ? "打开终端" : "测试连接"}：${formatConnectionAddress(connection)}`,
      ],
      mode,
      password: "",
      privateKeyPassphrase: "",
      privateKeyPath: "",
      oldHostKeyFingerprint: null,
      sessionId: null,
      status: connection.credential_mode === "prompt" ? "prompt" : "idle",
    };
    const tab = buildConnectingTab(terminalTabsRef.current, connection, step);
    setTerminalTabs((tabs) => {
      const nextTabs = [...tabs, tab];
      terminalTabsRef.current = nextTabs;
      return nextTabs;
    });
    setActiveWorkspaceMode("ssh");
    setHomeActive(false);
    setActiveConnectionId(connection.id);
    setActiveTabId(tab.id);
    rememberActiveTab(tab);
    if (connection.credential_mode !== "prompt") {
      void runConnectionStep(tab.id, step);
    }
  }

  async function runConnectionStep(tabId: string, step: ConnectionStepState) {
    const runningStep: ConnectionStepState = {
      ...step,
      activeStepIndex: 1,
      errorDetail: null,
      error: null,
      hostKey: null,
      hostKeyDecision: null,
      logs: [...step.logs, "读取连接配置", "建立网络连接"],
      oldHostKeyFingerprint: null,
      sessionId: null,
      status: "running",
    };
    updateConnectingTabStep(tabId, runningStep);

    if (!hasTauriRuntime()) {
      await wait(260);
      if (!connectingTabExists(tabId)) {
        return;
      }
      const previewStep = {
        ...runningStep,
        logs: [...runningStep.logs, "普通浏览器预览已跳过真实 SSH", "连接步骤完成"],
        status: "success" as ConnectionStepStatus,
      };
      if (step.mode === "terminal") {
        void markConnected(step.connection.id);
        replaceConnectingTabWithTerminal(tabId, `preview-${Date.now().toString()}`);
      } else {
        updateConnectingTabStep(tabId, previewStep);
      }
      return;
    }

    const prepareRequestId = `prepare-${step.id.toString()}`;
    const warmupOutput: number[] = [];
    let stopWarmupCapture: (() => void) | null = null;
    let handoffComplete = false;

    try {
      if (step.mode === "terminal") {
        stopWarmupCapture = await listenTerminalOutput((event: TerminalOutputEvent) => {
          if (event.request_id !== prepareRequestId) {
            return;
          }
          if (handoffComplete) {
            appendTerminalWarmupOutput(tabId, event.data);
            return;
          }
          warmupOutput.push(...event.data);
        });
        setTerminalWarmupCaptureStop(tabId, () => {
          stopWarmupCapture?.();
          stopWarmupCapture = null;
        });
      }

      if (step.mode === "test") {
        await connectionTest(runtimeCredentialRequest(step));
        if (!connectingTabExists(tabId)) {
          return;
        }
        void probeSystem(runtimeCredentialRequest(step)).catch(() => null);
        updateConnectingTabStep(tabId, {
          ...runningStep,
          logs: [...runningStep.logs, "认证通过", "连接测试通过"],
          status: "success",
        });
        return;
      }

      const sessionId = await terminalConnect({
        auth_kind: step.connection.credential_mode === "prompt" ? step.authKind : undefined,
        cols: 80,
        connection_id: step.connection.id,
        host: step.connection.host,
        password: step.password || undefined,
        port: step.connection.port,
        private_key_path: step.privateKeyPath || undefined,
        private_key_passphrase: step.privateKeyPassphrase || undefined,
        request_id: prepareRequestId,
        rows: 24,
        username: step.connection.username,
      });
      if (!connectingTabExists(tabId)) {
        stopTerminalWarmupCapture(tabId);
        await terminalClose(sessionId).catch(() => {});
        return;
      }
      void refreshConnectedProfile(step.connection.id, runtimeCredentialRequest(step));
      handoffComplete = true;
      replaceConnectingTabWithTerminal(tabId, sessionId, [...warmupOutput], prepareRequestId);
      window.setTimeout(() => {
        stopTerminalWarmupCapture(tabId);
      }, 3000);
    } catch (nextError) {
      stopTerminalWarmupCapture(tabId);
      if (!connectingTabExists(tabId)) {
        return;
      }
      const errorDetail = describeConnectionStepError(nextError);
      const hostKeyError = parseHostKeyError(nextError);
      if (hostKeyError) {
        updateConnectingTabStep(tabId, {
          ...runningStep,
          error: errorDetail.message,
          errorDetail,
          hostKey: hostKeyError.hostKey,
          hostKeyDecision: hostKeyError.decision,
          logs: [...runningStep.logs, "等待确认主机密钥"],
          oldHostKeyFingerprint: hostKeyError.oldFingerprint,
          status: "waiting_host_key",
        });
        return;
      }

      updateConnectingTabStep(tabId, {
        ...runningStep,
        error: errorDetail.message,
        errorDetail,
        logs: appendUniqueLogs(runningStep.logs, [
          errorDetail.message,
          errorDetail.rawMessage,
        ]),
        status: "error",
      });
    }
  }

  function retryConnectionStep(tabId: string, step: ConnectionStepState) {
    void runConnectionStep(tabId, resetConnectionStepForRetry(step));
  }

  async function trustHostKeyAndRetry(tabId: string, step: ConnectionStepState) {
    if (!step.hostKey) {
      return;
    }
    const nextStep: ConnectionStepState = {
      ...step,
      logs: [
        ...step.logs,
        step.hostKeyDecision === "changed"
          ? "已更新主机密钥信任，重新连接"
          : "已信任主机密钥，重新连接",
      ],
      status: "running",
    };
    updateConnectingTabStep(tabId, nextStep);
    try {
      await knownHostTrust(step.hostKey);
      await runConnectionStep(tabId, nextStep);
    } catch (nextError) {
      if (!connectingTabExists(tabId)) {
        return;
      }
      const errorDetail = describeConnectionStepError(nextError);
      updateConnectingTabStep(tabId, {
        ...nextStep,
        error: errorDetail.message,
        errorDetail,
        logs: appendUniqueLogs(nextStep.logs, [
          errorDetail.message,
          errorDetail.rawMessage,
        ]),
        status: "error",
      });
    }
  }

  function submitPromptCredential(
    tabId: string,
    step: ConnectionStepState,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void runConnectionStep(tabId, {
      ...step,
      logs: [...step.logs, "已输入本次凭据"],
    });
  }


  function handlePaneResizeStart(
    side: ResizablePaneSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (side === "left" && leftPaneCollapsed) {
      return;
    }
    if (side === "right" && (rightPaneCollapsed || !showWorkspaceToolPane)) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftPaneWidth : rightPaneWidth;
    const oppositeWidth = side === "left"
      ? (showWorkspaceToolPane && !rightPaneCollapsed ? rightPaneWidth : 0)
      : (leftPaneCollapsed ? 0 : leftPaneWidth);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizingPane(side);

    let animationFrameId: number | null = null;
    let latestClientX = startX;

    function applyResize(currentX: number) {
      const deltaX = currentX - startX;
      const rawWidth = side === "left" ? startWidth + deltaX : startWidth - deltaX;
      const containerWidth = getWorkspaceWidth(workspaceShellRef.current);
      const nextWidth = clampPaneWidth(side, rawWidth, containerWidth, oppositeWidth);

      if (side === "left") {
        setLeftPaneWidth(nextWidth);
        return;
      }

      setRightPaneWidth(nextWidth);
    }

    function scheduleResize() {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        applyResize(latestClientX);
      });
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      latestClientX = pointerEvent.clientX;
      scheduleResize();
    }

    function finishResize(pointerEvent?: PointerEvent) {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (pointerEvent) {
        applyResize(pointerEvent.clientX);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingPane(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize, { once: true });
    window.addEventListener("pointercancel", finishResize, { once: true });
  }

  function handlePaneResizeKeyDown(
    side: ResizablePaneSide,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (side === "left") {
      resizePaneByKeyboard("left", direction * paneKeyboardResizeStep);
      return;
    }

    resizePaneByKeyboard("right", -direction * paneKeyboardResizeStep);
  }

  function resizePaneByKeyboard(side: ResizablePaneSide, delta: number) {
    const containerWidth = getWorkspaceWidth(workspaceShellRef.current);

    if (side === "left") {
      const oppositeWidth = showWorkspaceToolPane && !rightPaneCollapsed ? rightPaneWidth : 0;
      setLeftPaneWidth((width) => clampPaneWidth("left", width + delta, containerWidth, oppositeWidth));
      return;
    }

    const oppositeWidth = leftPaneCollapsed ? 0 : leftPaneWidth;
    setRightPaneWidth((width) => clampPaneWidth("right", width + delta, containerWidth, oppositeWidth));
  }

  function handleEditorTerminalResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeRemoteFileTabs.length === 0) {
      return;
    }

    event.preventDefault();
    const container = event.currentTarget.parentElement;
    const containerHeight = getElementHeight(container);
    if (containerHeight <= 0) {
      return;
    }

    const editorPaneHeight =
      container?.querySelector<HTMLElement>(".remote-editor-pane")?.getBoundingClientRect().height ||
      (containerHeight * editorTerminalSplitPercent) / 100;
    const startY = event.clientY;

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    setResizingPane("editor-terminal");

    let animationFrameId: number | null = null;
    let latestClientY = startY;

    function applyResize(currentY: number) {
      const deltaY = currentY - startY;
      const nextPercent = ((editorPaneHeight + deltaY) / containerHeight) * 100;
      setEditorTerminalSplitPercent(clampEditorTerminalSplitPercent(nextPercent));
    }

    function scheduleResize() {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        applyResize(latestClientY);
      });
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      latestClientY = pointerEvent.clientY;
      scheduleResize();
    }

    function finishResize(pointerEvent?: PointerEvent) {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (pointerEvent) {
        applyResize(pointerEvent.clientY);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingPane(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize, { once: true });
    window.addEventListener("pointercancel", finishResize, { once: true });
  }

  function handleEditorTerminalResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setEditorTerminalSplitPercent((percent) =>
      clampEditorTerminalSplitPercent(percent + (direction * editorTerminalKeyboardResizeStep)),
    );
  }

  function renderCommandLibraryPanel() {
    return (
      <Suspense fallback={<p className="file-panel-empty">正在加载命令库...</p>}>
        <CommandLibraryPanel
          activeHistoryId={selectedCommandHistoryId}
          activeSnippetId={selectedCommandSnippetId}
          error={commandLibraryError}
          historyEntries={commandHistoryEntries}
          historyScopeOptions={commandHistoryScopeOptions}
          historyScopeValue={commandHistoryScopeKey}
          loading={commandLibraryLoading}
          groups={commandSnippetGroups}
          snippets={commandSnippets}
          unavailableReason={commandLibraryUnavailableReason}
          onClearHistory={() => setCommandHistoryClearOpen(true)}
          onCopyHistory={(entry) => void copyCommandLibraryText(entry.command, "历史命令")}
          onCopySnippet={(snippet) => void copyCommandLibraryText(snippet.command, `片段“${snippet.title}”`)}
          onCreateGroup={() => openCommandSnippetGroupCreateDialog()}
          onCreateSnippet={(group) => openCommandSnippetDialog(null, group)}
          onDeleteGroup={(group) => setPendingCommandSnippetGroupDelete(group)}
          onDeleteHistory={setPendingCommandHistoryDelete}
          onDeleteSnippet={setPendingCommandSnippetDelete}
          onEditSnippet={openCommandSnippetDialog}
          onHistoryToSnippet={saveHistoryAsSnippet}
          onHistoryScopeChange={setCommandHistoryScopeKey}
          onInsertHistory={insertCommandHistoryEntry}
          onInsertSnippet={insertCommandSnippet}
          onRenameGroup={openCommandSnippetGroupRenameDialog}
          onRunHistory={(entry) => void runCommandHistoryEntry(entry)}
          onRunSnippet={(snippet) => void runCommandSnippet(snippet)}
        />
      </Suspense>
    );
  }

  function renderCommandSenderPanel() {
    if (!commandSenderOpen) {
      return null;
    }

    return (
      <section className="command-sender-panel" aria-label="命令操作台">
        <div className="command-sender-console">
          <header className="command-sender-console-head">
            <div className="command-sender-title">
              <span>命令操作台</span>
            </div>
            <div className="command-select-row">
              <AppSelect
                ariaLabel="发送模式"
                className="command-toolbar-app-select command-send-mode-select"
                value="sequential"
                options={[
                  {
                    label: (
                      <span className="command-select-label">
                        <Send className="ui-icon" aria-hidden="true" />
                        <span>逐条发送</span>
                      </span>
                    ),
                    value: "sequential",
                  },
                ]}
                onChange={() => undefined}
              />
            </div>
            <span />
            <div className="command-sender-head-actions">
              <span className="command-last-sent">{commandSenderLastSentLabel}</span>
              <button
                className="command-console-toggle command-sender-close"
                type="button"
                aria-label="关闭命令操作台"
                onClick={() => setCommandSenderOpen(false)}
              >
                <X className="ui-icon" aria-hidden="true" />
                <span className="command-close-text">关闭</span>
              </button>
            </div>
          </header>

          <div className="command-sender-console-body">
            <aside className="command-sender-block command-target-pane" aria-label="投递目标">
              <div className="command-sender-label">
                <span className="command-target-title">
                  <span>目标</span>
                  <span className="command-target-count">
                    已选 {commandSenderSelectedCount.toString()} / {commandSenderTargets.length.toString()}
                  </span>
                </span>
                <span className="command-target-tools">
                  <label
                    className="command-target-select-all"
                    data-state={
                      commandSenderAllSelected
                        ? "checked"
                        : commandSenderPartiallySelected
                          ? "mixed"
                          : "unchecked"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={commandSenderAllSelected}
                      onChange={toggleCommandSenderAllTargets}
                    />
                    <span>{commandSenderAllSelected ? "取消全选" : "全选"}</span>
                  </label>
                </span>
              </div>

              <div className="command-target-list">
                {commandSenderTargets.length === 0 ? (
                  <p className="command-sender-empty">暂无可写入的终端。</p>
                ) : (
                  commandSenderTargets.map((target) => {
                    const selected = selectedCommandTargetKeySet.has(target.key);
                    const hasDelivery = target.deliveryStatus !== "idle";
                    return (
                      <div
                        className={`command-target command-sender-target ${
                          selected ? "selected" : ""
                        } ${hasDelivery ? "has-delivery" : ""} ${
                          target.deliveryStatus === "failed" ? "has-failed-delivery" : ""
                        }`}
                        data-delivery={target.deliveryStatus}
                        key={target.connectionId}
                      >
                        <label className="command-target-select">
                          <input
                            className="command-target-checkbox"
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleCommandSenderTarget(target)}
                          />
                          <span className="command-target-copy">
                            <strong>{target.label}</strong>
                            <span>{target.description}</span>
                          </span>
                        </label>
                        <span className="command-target-meta">
                          <span className="command-target-terminal-shell">
                            <SquareTerminal className="ui-icon" aria-hidden="true" />
                            <AppSelect
                              ariaLabel={`${target.label} 子 tab`}
                              className="command-target-terminal-select"
                              menuMinWidth={176}
                              value={target.tabId}
                              options={target.tabs.map((tab) => ({
                                label: tab.label,
                                value: tab.tabId,
                              }))}
                              onChange={(tabId) => selectCommandSenderTargetTab(target, tabId)}
                            />
                          </span>
                          <span className="command-target-state">在线</span>
                          <button
                            className={`command-target-delivery command-sender-status ${target.deliveryStatus}`}
                            type="button"
                            title={target.deliveryMessage || "点击查看对应终端"}
                            onClick={() => activateCommandSenderTarget(target)}
                          >
                            {commandSenderDeliveryLabel(target.deliveryStatus)}
                          </button>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>

            <section className="command-sender-block command-compose-pane" aria-label="命令编辑">
              <div className="command-compose-label">命令</div>
              <textarea
                className="command-input command-sender-input"
                value={commandSenderInput}
                placeholder="输入要投递到目标终端的命令"
                spellCheck={false}
                onChange={(event) =>
                  handleCommandSenderInputChange(event.currentTarget.value)
                }
                onKeyDown={handleCommandSenderInputKeyDown}
              />
              {commandLibraryError ? (
                <div className="command-library-error" role="status">
                  {commandLibraryError}
                </div>
              ) : null}
              {commandLibraryUnavailableReason ? (
                <div className="command-library-notice" role="status">
                  {commandLibraryUnavailableReason}
                </div>
              ) : null}
              {commandSenderRisky ? (
                <div className="command-risk-warning command-sender-risk-warning show" role="status">
                  检测到高风险片段，请确认目标机器和命令内容。
                </div>
              ) : null}
              <div className="command-compose-footer command-sender-actions">
                <div className="command-send-result">
                  {commandSenderInput.trim()
                    ? commandSenderSelectedCount > 0
                      ? `${commandSenderSelectedCount.toString()} 个目标待发送。`
                      : "请选择至少一个目标。"
                    : "等待输入命令。"}
                </div>
                <div className="command-actions">
                  <button
                    className="primary-button command-sender-primary"
                    type="button"
                    disabled={!commandSenderCanSend}
                    onClick={() => void sendCommandToTargets(true)}
                  >
                    <CornerDownLeft className="ui-icon" aria-hidden="true" />
                    <span>发送并回车</span>
                  </button>
                  <button
                    className="secondary-button command-sender-secondary"
                    type="button"
                    disabled={!commandSenderCanSend}
                    onClick={() => void sendCommandToTargets(false)}
                  >
                    发送不回车
                  </button>
                  <button
                    className="secondary-button clear-command-button command-sender-secondary"
                    type="button"
                    disabled={!commandSenderInput}
                    onClick={clearCommandSenderInput}
                  >
                    <Trash2 className="ui-icon" aria-hidden="true" />
                    <span>清空</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div
      className="app-shell"
      data-home-active={showingHome}
      data-local-terminal-active={showingLocalTerminal}
      data-density={settings.appearance.density}
      data-left-collapsed={leftPaneCollapsed}
      data-pane-resizing={resizingPane || undefined}
      data-platform={desktopPlatform}
      data-right-collapsed={rightPaneCollapsed}
      data-theme-mode={settings.appearance.themeMode}
      data-window-material={effectiveWindowMaterial}
      style={appShellStyle}
    >
      {secretVault.requiresUnlock ? (
        <SecretVaultGate
          error={secretVault.error}
          loading={secretVault.loading}
          onUnlock={secretVault.unlock}
          status={secretVault.status}
          unlocking={secretVault.unlocking}
        />
      ) : null}

      <AppTitlebar
        activeConnectionId={activeConnectionId}
        appUpdateNotice={
          appUpdate.workspaceNoticeVisible
            ? {
                label: appUpdate.workspaceNoticeLabel || "有可用更新",
                onDismiss: appUpdate.dismissWorkspaceNotice,
                onOpen: () => openSettingsSection("basic"),
              }
            : null
        }
        connectionById={connectionById}
        connectionSessions={connectionSessions}
        homeActive={showingHome}
        localTerminalActive={showingLocalTerminal}
        leftPaneCollapsed={leftPaneCollapsed}
        onCloseAllConnectionSessions={() =>
          closeConnectionSessions(connectionSessions.map((session) => session.connectionId))
        }
        onCloseConnectionSession={closeConnectionSession}
        onCloseConnectionSessionsToRight={closeConnectionSessionsToRight}
        onCloseOtherConnectionSessions={closeOtherConnectionSessions}
        onOpenHome={openHome}
        onOpenLocalTerminal={openLocalTerminalWorkspace}
        onSelectConnectionSession={(connectionId) => {
          const rdpSession = preferredRdpSessionForConnection(connectionId);
          if (rdpSession) {
            activateRdpSession(rdpSession);
            return;
          }
          const vncSession = preferredVncSessionForConnection(connectionId);
          if (vncSession) {
            activateVncSession(vncSession);
            return;
          }
          const nextTab = preferredTabForConnection(connectionId);
          if (nextTab) {
            activateTerminalTab(nextTab);
          }
        }}
        onToggleLeftPane={() => setLeftPaneCollapsed((collapsed) => !collapsed)}
      />

      <main className="workspace-shell" ref={workspaceShellRef} hidden={activeView === "settings"}>
        <ConnectionPane
          connections={connections}
          error={error}
          loading={loading}
          onConnect={openConnectionSession}
          onCreate={createConnection}
          onDelete={deleteConnection}
          onEdit={editConnection}
          onGroupCatalogChange={setConnectionGroupCatalog}
          onMoveConnectionToGroup={moveConnectionToGroup}
          onOpen={openTerminal}
          onOpenSearch={() => setConnectionSearchOpen(true)}
          onOpenSettings={() => openSettingsSection()}
          onPreloadCreate={preloadCreateConnectionDialog}
          onRefresh={reload}
          onSelect={selectConnection}
          onToggleFavorite={toggleConnectionFavorite}
          recentConnectionLimit={settings.basic.recentConnectionLimit}
          selectedId={activeConnectionSelectionId}
        />

        {!leftPaneCollapsed ? (
          <div
            className="pane-resizer left-pane-resizer"
            role="separator"
            aria-label="拖拽调整左侧栏宽度，双击恢复默认"
            aria-orientation="vertical"
            aria-valuemin={minLeftPaneWidth}
            aria-valuemax={maxLeftPaneWidth}
            aria-valuenow={leftPaneWidth}
            tabIndex={0}
            onDoubleClick={() => setLeftPaneWidth(defaultLeftPaneWidth)}
            onKeyDown={(event) => handlePaneResizeKeyDown("left", event)}
            onPointerDown={(event) => handlePaneResizeStart("left", event)}
          />
        ) : null}

        <section className="main-workbench" aria-label="工作区">
          <ConnectionHome
            connections={connections}
            error={error}
            groups={connectionGroupCatalog}
            loading={loading}
            onConnect={openConnectionSession}
            onCreateConnection={() => createConnection()}
            onDelete={deleteConnection}
            onEdit={editConnection}
            onPreloadCreateConnection={preloadCreateConnectionDialog}
            onRefresh={reload}
            hidden={!showingHome}
          />

          {hasSessionWorkspace ? (
            <section
              className={`session-workbench ${showingHome ? "is-hidden" : ""}`}
              data-editor-open={
                activeRemoteFileTabs.length > 0 && !isActiveTerminalFileUnified ? "true" : "false"
              }
              data-workbench-tab-dragging={workbenchTabMouseDrag?.active ? "true" : undefined}
              aria-label="编辑器和终端"
              aria-hidden={showingHome}
            >
              {activeRemoteFileTabs.length > 0 && !isActiveTerminalFileUnified ? (
                <section className="remote-editor-pane" aria-label="远程文件编辑区">
                  <nav
                    className="remote-editor-tabs"
                    aria-label="远程文件标签"
                    data-workbench-tab-drop-zone="file"
                    data-workbench-tab-drop-active={workbenchTabDropZone === "file" ? "true" : undefined}
                  >
                    {activeRemoteFileTabs.map(renderRemoteFileSubtab)}
                  </nav>

                  <section className="remote-editor-stack" aria-label="文件编辑器">
                    <Suspense fallback={<RemoteEditorLoadingFallback />}>
                      {remoteFileTabs.map((tab) => (
                        <RemoteFileEditor
                          active={isRemoteFileEditorActive(tab.id)}
                          desktopPlatform={desktopPlatform}
                          fontFamily={terminalFontFamily}
                          fontSize={settings.appearance.terminalFontSize}
                          key={tab.id}
                          tab={tab}
                          themeMode={settings.appearance.themeMode}
                          onChange={handleRemoteFileChange}
                          onClose={closeRemoteFileTab}
                          onDiscard={discardRemoteFileChanges}
                          onLocateFolder={locateRemoteFileFolder}
                          onReload={reloadRemoteFile}
                          onSave={saveRemoteFile}
                        />
                      ))}
                    </Suspense>
                  </section>
                </section>
              ) : null}

              {activeRemoteFileTabs.length > 0 && !isActiveTerminalFileUnified ? (
                <div
                  className="editor-terminal-resizer"
                  role="separator"
                  aria-label="拖拽调整文件编辑器和终端高度，双击恢复默认"
                  aria-orientation="horizontal"
                  aria-valuemin={minEditorTerminalSplitPercent}
                  aria-valuemax={maxEditorTerminalSplitPercent}
                  aria-valuenow={editorTerminalSplitPercent}
                  tabIndex={0}
                  onDoubleClick={() => setEditorTerminalSplitPercent(defaultEditorTerminalSplitPercent)}
                  onKeyDown={handleEditorTerminalResizeKeyDown}
                  onPointerDown={handleEditorTerminalResizeStart}
                />
              ) : null}

              <section
                className={`terminal-workbench-pane ${showSshCommandSenderPanel ? "command-sender-open" : ""} ${
                  showSessionWorkspace ? "" : "is-hidden"
                }`}
                data-workbench-surface={activeWorkbenchSurface}
                data-terminal-tone={terminalTone}
                aria-label="终端区"
                aria-hidden={!showSessionWorkspace}
              >
                <nav
                  className={`terminal-subtabs ${isActiveTerminalFileUnified ? "unified-subtabs" : ""}`}
                  aria-label={isActiveTerminalFileUnified ? "当前连接终端和文件标签" : "当前连接终端标签"}
                  data-workbench-tab-drop-zone="terminal"
                  data-workbench-tab-drop-active={workbenchTabDropZone === "terminal" ? "true" : undefined}
                >
                  {activeConnectionTabs.map((tab, index) => (
                    <TabContextMenu
                      key={tab.id}
                      actions={[
                        {
                          hint: "Ctrl+F4",
                          label: "关闭",
                          onSelect: () => closeTerminal(tab.id),
                        },
                        {
                          disabled: activeConnectionTabs.length <= 1,
                          label: "关闭其他",
                          onSelect: () => closeOtherTerminalTabs(tab.id),
                        },
                        {
                          disabled: index >= activeConnectionTabs.length - 1,
                          label: "关闭右侧标签页",
                          onSelect: () => closeTerminalTabsToRight(tab.id),
                        },
                        {
                          disabled: activeConnectionTabs.length === 0,
                          hint: "Ctrl+K W",
                          label: "全部关闭",
                          onSelect: () => closeAllTerminalTabsForConnection(tab.connectionId),
                        },
                        ...(isConnectionTerminalFileUnified(tab.connectionId)
                          ? [
                              {
                                label: "恢复上下分屏",
                                onSelect: () =>
                                  restoreConnectionTerminalFileSplit(tab.connectionId, "terminal", {
                                    connectionId: tab.connectionId,
                                    id: tab.id,
                                    kind: "terminal",
                                  }),
                                separatorBefore: true,
                              },
                            ]
                          : []),
                      ]}
                    >
                      <div
                        className={`subtab-shell ${isTerminalSubtabActive(tab) ? "active" : ""}`}
                      >
                        <button
                          className="subtab workbench-draggable-tab"
                          type="button"
                          onClick={(event) => handleTerminalSubtabClick(event, tab)}
                          onMouseDown={(event) =>
                            handleWorkbenchTabMouseDown(event, {
                              connectionId: tab.connectionId,
                              id: tab.id,
                              kind: "terminal",
                            })
                          }
                        >
                          <span>{tab.title}</span>
                        </button>
                        <button
                          className="subtab-close"
                          type="button"
                          aria-label={`关闭 ${tab.title}`}
                          onClick={() => closeTerminal(tab.id)}
                        >
                          <X className="ui-icon" aria-hidden="true" />
                        </button>
                      </div>
                    </TabContextMenu>
                  ))}
                  {isActiveTerminalFileUnified ? activeRemoteFileTabs.map(renderRemoteFileSubtab) : null}
                  {activeConnectedTerminalTab ? (
                    <Tooltip label="新建同连接终端">
                      <button
                        className="add-subtab"
                        type="button"
                        aria-label="新建同连接终端"
                        onClick={openTerminalInActiveConnection}
                      >
                        <Plus className="ui-icon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  ) : null}
                  <div className="terminal-subtab-actions">
                    {activeSshToolbarTerminalTab ? (
                      <Tooltip label={activeTerminalSearch?.open ? "关闭终端搜索" : "搜索终端输出"}>
                        <button
                          className={`add-subtab terminal-search-toggle ${
                            activeTerminalSearch?.open ? "active" : ""
                          }`}
                          type="button"
                          aria-label="搜索终端输出"
                          aria-expanded={Boolean(activeTerminalSearch?.open)}
                          onClick={() => toggleTerminalSearch(activeSshToolbarTerminalTab.id)}
                        >
                          <Search className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {showSshTerminalScopedActions && commandSenderTargets.length > 0 ? (
                      <Tooltip label="Command Sender">
                        <button
                          className={`add-subtab command-sender-toggle ${commandSenderOpen ? "active" : ""}`}
                          type="button"
                          aria-label="打开命令操作台 Command Sender"
                          aria-expanded={commandSenderOpen}
                          onClick={openCommandSender}
                        >
                          <Send className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    <Tooltip label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}>
                      <button
                        className="add-subtab terminal-subtab-panel-toggle"
                        type="button"
                        aria-label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}
                        aria-expanded={!rightPaneCollapsed}
                        onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
                      >
                        {rightPaneCollapsed ? (
                          <PanelRightOpen className="ui-icon" aria-hidden="true" />
                        ) : (
                          <PanelRightClose className="ui-icon" aria-hidden="true" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </nav>

                <section
                  className={`terminal-stack ${isActiveTerminalFileUnified ? "terminal-file-unified-stack" : ""}`}
                  data-unified-active-kind={activeUnifiedTabKind || undefined}
                  aria-label={isActiveTerminalFileUnified ? "终端和文件编辑器" : "终端"}
                >
                  {isActiveTerminalFileUnified ? (
                    <Suspense fallback={<RemoteEditorLoadingFallback />}>
                      {remoteFileTabs.map((tab) => (
                        <RemoteFileEditor
                          active={isRemoteFileEditorActive(tab.id)}
                          desktopPlatform={desktopPlatform}
                          fontFamily={terminalFontFamily}
                          fontSize={settings.appearance.terminalFontSize}
                          key={tab.id}
                          tab={tab}
                          themeMode={settings.appearance.themeMode}
                          onChange={handleRemoteFileChange}
                          onClose={closeRemoteFileTab}
                          onDiscard={discardRemoteFileChanges}
                          onLocateFolder={locateRemoteFileFolder}
                          onReload={reloadRemoteFile}
                          onSave={saveRemoteFile}
                        />
                      ))}
                    </Suspense>
                  ) : null}
                  {terminalTabs.map((tab) => {
                    const tabStep = tab.type === "connecting" ? tab.connectionStep : null;
                    return tabStep ? (
                      <ConnectionStepPanel
                        key={tab.id}
                        step={tabStep}
                        active={isTerminalPanelActive(tab.id)}
                        onCancel={() => closeTerminal(tab.id)}
                        onEdit={(connection) => {
                          editConnection(connection);
                        }}
                        onPromptAuthKindChange={(authKind) =>
                          updateConnectingTabStep(tab.id, {
                            ...tabStep,
                            authKind,
                            password: "",
                            privateKeyPath: "",
                          })
                        }
                        onPromptPasswordChange={(password) =>
                          updateConnectingTabStep(tab.id, { ...tabStep, password })
                        }
                        onPromptPrivateKeyPathChange={(privateKeyPath) =>
                          updateConnectingTabStep(tab.id, { ...tabStep, privateKeyPath })
                        }
                        onPromptPrivateKeyPassphraseChange={(privateKeyPassphrase) =>
                          updateConnectingTabStep(tab.id, {
                            ...tabStep,
                            privateKeyPassphrase,
                          })
                        }
                        onRetry={() => retryConnectionStep(tab.id, tabStep)}
                        onSubmitPrompt={(event) =>
                          submitPromptCredential(tab.id, tabStep, event)
                        }
                        onTrustHostKey={() => void trustHostKeyAndRetry(tab.id, tabStep)}
                      />
                    ) : tab.type === "terminal" && tab.sessionId ? (
                      <Suspense
                        key={tab.id}
                        fallback={
                          <DirectTerminalStatusPanel
                            active={isTerminalPanelActive(tab.id)}
                            connection={connectionById.get(tab.connectionId) || null}
                            error={null}
                            status="正在加载终端"
                            title={tab.title}
                          />
                        }
                      >
                        <TerminalPanel
                          active={isTerminalPanelActive(tab.id)}
                          connection={connectionById.get(tab.connectionId) || null}
                          ctrlVPaste={settings.localTerminal.ctrlVPaste}
                          cursorBlink={settings.appearance.cursorBlink}
                          cursorStyle={settings.appearance.cursorStyle}
                          fontFamily={terminalFontFamily}
                          fontSize={settings.appearance.terminalFontSize}
                          initialSessionId={tab.sessionId}
                          initialOutput={tab.warmupOutput}
                          initialRequestId={tab.requestId}
                          onCurrentDirectoryChange={updateTerminalDirectory}
                          onPromptDirectorySnapshotChange={updateTerminalPromptDirectorySnapshotReader}
                          onRecentOutput={appendTerminalRecentOutput}
                          onSearchClose={closeTerminalSearch}
                          onSearchCaseSensitiveToggle={toggleTerminalSearchCaseSensitive}
                          onSearchQueryChange={updateTerminalSearchQuery}
                          onSendSelectionToAi={sendTerminalSelectionToAi}
                          onSessionIdChange={updateTerminalRuntimeSession}
                          onStatusChange={updateTabStatus}
                          onTerminalInputCommand={
                            settings.command.recordTerminalInputHistory
                              ? (tabId, command) => void recordTerminalInputHistoryCommand(tabId, command)
                              : undefined
                          }
                          onWarmupCaptureReady={stopTerminalWarmupCapture}
                          searchCaseSensitive={Boolean(terminalSearchByTabId[tab.id]?.caseSensitive)}
                          searchNavigationRequest={terminalSearchNavigationRequest}
                          searchOpen={Boolean(terminalSearchByTabId[tab.id]?.open)}
                          searchQuery={terminalSearchByTabId[tab.id]?.query || ""}
                          tabId={tab.id}
                          theme={terminalColorScheme.theme}
                          title={tab.title}
                        />
                      </Suspense>
                    ) : tab.type === "terminal" ? (
                      <DirectTerminalStatusPanel
                        active={isTerminalPanelActive(tab.id)}
                        connection={connectionById.get(tab.connectionId) || null}
                        error={tab.error || null}
                        status={tab.status}
                        title={tab.title}
                      />
                    ) : null;
                  })}
                  {showUnifiedSplitDropZones ? (
                    <div className="workbench-split-drop-zones" aria-hidden="true">
                      <div
                        className="workbench-split-drop-zone"
                        data-workbench-tab-drop-zone="split-file"
                        data-workbench-tab-drop-active={
                          workbenchTabDropZone === "split-file" ? "true" : undefined
                        }
                      />
                      <div
                        className="workbench-split-drop-zone"
                        data-workbench-tab-drop-zone="split-terminal"
                        data-workbench-tab-drop-active={
                          workbenchTabDropZone === "split-terminal" ? "true" : undefined
                        }
                      />
                    </div>
                  ) : null}
                </section>
                {showSshCommandSenderPanel ? (
                  <section className="command-sender-panel" aria-label="命令操作台">
                    <div className="command-sender-console">
                      <header className="command-sender-console-head">
                        <div className="command-sender-title">
                          <span>命令操作台</span>
                        </div>
                        <div className="command-select-row">
                          <AppSelect
                            ariaLabel="发送模式"
                            className="command-toolbar-app-select command-send-mode-select"
                            value="sequential"
                            options={[
                              {
                                label: (
                                  <span className="command-select-label">
                                    <Send className="ui-icon" aria-hidden="true" />
                                    <span>逐条发送</span>
                                  </span>
                                ),
                                value: "sequential",
                              },
                            ]}
                            onChange={() => undefined}
                          />
                        </div>
                        <span />
                        <div className="command-sender-head-actions">
                          <span className="command-last-sent">{commandSenderLastSentLabel}</span>
                          <button
                            className="command-console-toggle command-sender-close"
                            type="button"
                            aria-label="关闭命令操作台"
                            onClick={() => setCommandSenderOpen(false)}
                          >
                            <X className="ui-icon" aria-hidden="true" />
                            <span className="command-close-text">关闭</span>
                          </button>
                        </div>
                      </header>

                      <div className="command-sender-console-body">
                        <aside className="command-sender-block command-target-pane" aria-label="投递目标">
                          <div className="command-sender-label">
                            <span className="command-target-title">
                              <span>目标</span>
                              <span className="command-target-count">
                                已选 {commandSenderSelectedCount.toString()} / {commandSenderTargets.length.toString()}
                              </span>
                            </span>
                            <span className="command-target-tools">
                              <label
                                className="command-target-select-all"
                                data-state={
                                  commandSenderAllSelected
                                    ? "checked"
                                    : commandSenderPartiallySelected
                                      ? "mixed"
                                      : "unchecked"
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={commandSenderAllSelected}
                                  onChange={toggleCommandSenderAllTargets}
                                />
                                <span>{commandSenderAllSelected ? "取消全选" : "全选"}</span>
                              </label>
                            </span>
                          </div>

                          <div className="command-target-list">
                            {commandSenderTargets.length === 0 ? (
                              <p className="command-sender-empty">暂无可写入的终端。</p>
                            ) : (
                              commandSenderTargets.map((target) => {
                                const selected = selectedCommandTargetKeySet.has(target.key);
                                const hasDelivery = target.deliveryStatus !== "idle";
                                return (
                                  <div
                                    className={`command-target command-sender-target ${
                                      selected ? "selected" : ""
                                    } ${hasDelivery ? "has-delivery" : ""} ${
                                      target.deliveryStatus === "failed" ? "has-failed-delivery" : ""
                                    }`}
                                    data-delivery={target.deliveryStatus}
                                    key={target.connectionId}
                                  >
                                    <label className="command-target-select">
                                      <input
                                        className="command-target-checkbox"
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggleCommandSenderTarget(target)}
                                      />
                                      <span className="command-target-copy">
                                        <strong>{target.label}</strong>
                                        <span>{target.description}</span>
                                      </span>
                                    </label>
                                    <span className="command-target-meta">
                                      <span className="command-target-terminal-shell">
                                        <SquareTerminal className="ui-icon" aria-hidden="true" />
                                        <AppSelect
                                          ariaLabel={`${target.label} 子 tab`}
                                          className="command-target-terminal-select"
                                          menuMinWidth={176}
                                          value={target.tabId}
                                          options={target.tabs.map((tab) => ({
                                            label: tab.label,
                                            value: tab.tabId,
                                          }))}
                                          onChange={(tabId) => selectCommandSenderTargetTab(target, tabId)}
                                        />
                                      </span>
                                      <span className="command-target-state">在线</span>
                                      <button
                                        className={`command-target-delivery command-sender-status ${target.deliveryStatus}`}
                                        type="button"
                                        title={target.deliveryMessage || "点击查看对应终端"}
                                        onClick={() => activateCommandSenderTarget(target)}
                                      >
                                        {commandSenderDeliveryLabel(target.deliveryStatus)}
                                      </button>
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </aside>

                        <section className="command-sender-block command-compose-pane" aria-label="命令编辑">
                          <div className="command-compose-label">命令</div>
                          <textarea
                            className="command-input command-sender-input"
                            value={commandSenderInput}
                            placeholder="输入要投递到目标终端的命令"
                            spellCheck={false}
                            onChange={(event) =>
                              handleCommandSenderInputChange(event.currentTarget.value)
                            }
                            onKeyDown={handleCommandSenderInputKeyDown}
                          />
                          {commandLibraryError ? (
                            <div className="command-library-error" role="status">
                              {commandLibraryError}
                            </div>
                          ) : null}
                          {commandLibraryUnavailableReason ? (
                            <div className="command-library-notice" role="status">
                              {commandLibraryUnavailableReason}
                            </div>
                          ) : null}
                          {commandSenderRisky ? (
                            <div className="command-risk-warning command-sender-risk-warning show" role="status">
                              检测到高风险片段，请确认目标机器和命令内容。
                            </div>
                          ) : null}
                          <div className="command-compose-footer command-sender-actions">
                            <div className="command-send-result">
                              {commandSenderInput.trim()
                                ? commandSenderSelectedCount > 0
                                  ? `${commandSenderSelectedCount.toString()} 个目标待发送。`
                                  : "请选择至少一个目标。"
                                : "等待输入命令。"}
                            </div>
                            <div className="command-actions">
                              <button
                                className="primary-button command-sender-primary"
                                type="button"
                                disabled={!commandSenderCanSend}
                                onClick={() => void sendCommandToTargets(true)}
                              >
                                <CornerDownLeft className="ui-icon" aria-hidden="true" />
                                <span>发送并回车</span>
                              </button>
                              <button
                                className="secondary-button command-sender-secondary"
                                type="button"
                                disabled={!commandSenderCanSend}
                                onClick={() => void sendCommandToTargets(false)}
                              >
                                发送不回车
                              </button>
                              <button
                                className="secondary-button clear-command-button command-sender-secondary"
                                type="button"
                                disabled={!commandSenderInput}
                                onClick={clearCommandSenderInput}
                              >
                                <Trash2 className="ui-icon" aria-hidden="true" />
                                <span>清空</span>
                              </button>
                            </div>
                          </div>
                        </section>
                      </div>
                    </div>
                  </section>
                ) : null}
              </section>

              {workbenchTabMouseDrag?.active ? (
                <div
                  className="workbench-tab-drag-preview"
                  style={{
                    left: `${Math.max(8, workbenchTabMouseDrag.currentX - workbenchTabMouseDrag.grabOffsetX)}px`,
                    top: `${Math.max(8, workbenchTabMouseDrag.currentY - workbenchTabMouseDrag.grabOffsetY)}px`,
                    width: `${Math.min(Math.max(workbenchTabMouseDrag.previewWidth, 96), 220)}px`,
                  }}
                >
                  <span>{getWorkbenchTabDragLabel(workbenchTabMouseDrag.payload)}</span>
                </div>
              ) : null}

              <section
                className={`terminal-workbench-pane rdp-workbench-pane ${
                  showRdpWorkspace ? "" : "is-hidden"
                }`}
                data-workbench-surface="panel"
                aria-label="RDP 会话区"
                aria-hidden={!showRdpWorkspace}
              >
                <nav className="terminal-subtabs rdp-subtabs" aria-label="RDP 会话标签">
                  {activeRdpSessions.map((session, index) => (
                    <TabContextMenu
                      key={session.id}
                      actions={[
                        {
                          hint: "Ctrl+F4",
                          label: "关闭",
                          onSelect: () => closeRdpSession(session.id),
                        },
                        {
                          disabled: activeRdpSessions.length <= 1,
                          label: "关闭其他",
                          onSelect: () => closeOtherRdpSessions(session.id),
                        },
                        {
                          disabled: index >= activeRdpSessions.length - 1,
                          label: "关闭右侧标签页",
                          onSelect: () => closeRdpSessionsToRight(session.id),
                        },
                        {
                          disabled: activeRdpSessions.length === 0,
                          hint: "Ctrl+K W",
                          label: "全部关闭",
                          onSelect: () => closeAllRdpSessionsForConnection(session.connectionId),
                        },
                      ]}
                    >
                      <div
                        className={`subtab-shell ${session.id === activeRdpSession?.id ? "active" : ""}`}
                      >
                        <button
                          className="subtab rdp-subtab"
                          type="button"
                          title={`${session.title} · ${rdpStatusLabel(session.status)}`}
                          onClick={() => activateRdpSession(session)}
                        >
                          <MonitorPlay className="ui-icon" aria-hidden="true" />
                          <span>{session.title}</span>
                        </button>
                        <button
                          className="subtab-close"
                          type="button"
                          aria-label={`关闭 ${session.title}`}
                          onClick={() => closeRdpSession(session.id)}
                        >
                          <X className="ui-icon" aria-hidden="true" />
                        </button>
                      </div>
                    </TabContextMenu>
                  ))}
                  <div className="terminal-subtab-actions">
                    <Tooltip label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}>
                      <button
                        className="add-subtab terminal-subtab-panel-toggle"
                        type="button"
                        aria-label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}
                        aria-expanded={!rightPaneCollapsed}
                        onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
                      >
                        {rightPaneCollapsed ? (
                          <PanelRightOpen className="ui-icon" aria-hidden="true" />
                        ) : (
                          <PanelRightClose className="ui-icon" aria-hidden="true" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </nav>

                <section className="rdp-stack" aria-label="RDP 会话状态">
                  {rdpSessions.map((session) => (
                    <RdpSessionStatusPanel
                      active={showRdpWorkspace && session.id === activeRdpSession?.id}
                      connection={connectionById.get(session.connectionId) || null}
                      key={session.id}
                      session={session}
                      onEmbeddedViewportRef={setRdpEmbeddedViewportRef}
                      onEmbeddedViewportResize={syncRdpEmbeddedBounds}
                      onClose={() => closeRdpSession(session.id)}
                      onCopyCommand={() => void copyText(rdpSessionCommandText(session))}
                      onCopyRdpFile={() => void copyText(rdpSessionFileText(session))}
                      onPreview={() => void previewRdpSessionLaunch(session.id)}
                      onRetry={() => retryRdpSession(session.id)}
                    />
                  ))}
                </section>
              </section>

              <section
                className={`terminal-workbench-pane rdp-workbench-pane vnc-workbench-pane ${
                  showVncWorkspace ? "" : "is-hidden"
                }`}
                data-workbench-surface="panel"
                aria-label="VNC 会话区"
                aria-hidden={!showVncWorkspace}
              >
                <nav className="terminal-subtabs rdp-subtabs vnc-subtabs" aria-label="VNC 会话标签">
                  {activeVncSessions.map((session, index) => (
                    <TabContextMenu
                      key={session.id}
                      actions={[
                        {
                          hint: "Ctrl+F4",
                          label: "关闭",
                          onSelect: () => closeVncSession(session.id),
                        },
                        {
                          disabled: activeVncSessions.length <= 1,
                          label: "关闭其他",
                          onSelect: () => closeOtherVncSessions(session.id),
                        },
                        {
                          disabled: index >= activeVncSessions.length - 1,
                          label: "关闭右侧标签页",
                          onSelect: () => closeVncSessionsToRight(session.id),
                        },
                        {
                          disabled: activeVncSessions.length === 0,
                          hint: "Ctrl+K W",
                          label: "全部关闭",
                          onSelect: () => closeAllVncSessionsForConnection(session.connectionId),
                        },
                      ]}
                    >
                      <div
                        className={`subtab-shell ${session.id === activeVncSession?.id ? "active" : ""}`}
                      >
                        <button
                          className="subtab rdp-subtab vnc-subtab"
                          type="button"
                          title={`${session.title} · ${vncStatusLabel(session.status)}`}
                          onClick={() => activateVncSession(session)}
                        >
                          <MonitorPlay className="ui-icon" aria-hidden="true" />
                          <span>{session.title}</span>
                        </button>
                        <button
                          className="subtab-close"
                          type="button"
                          aria-label={`关闭 ${session.title}`}
                          onClick={() => closeVncSession(session.id)}
                        >
                          <X className="ui-icon" aria-hidden="true" />
                        </button>
                      </div>
                    </TabContextMenu>
                  ))}
                  <div className="terminal-subtab-actions">
                    <Tooltip label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}>
                      <button
                        className="add-subtab terminal-subtab-panel-toggle"
                        type="button"
                        aria-label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}
                        aria-expanded={!rightPaneCollapsed}
                        onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
                      >
                        {rightPaneCollapsed ? (
                          <PanelRightOpen className="ui-icon" aria-hidden="true" />
                        ) : (
                          <PanelRightClose className="ui-icon" aria-hidden="true" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </nav>

                <section className="rdp-stack vnc-stack" aria-label="VNC 会话状态">
                  {vncSessions.map((session) => (
                    <VncSessionStatusPanel
                      active={showVncWorkspace && session.id === activeVncSession?.id}
                      connection={connectionById.get(session.connectionId) || null}
                      key={session.id}
                      session={session}
                      onClose={() => closeVncSession(session.id)}
                      onCopyCommand={() => void copyText(vncSessionCommandText(session))}
                      onMessage={(message) =>
                        updateVncSession(session.id, (current) => ({
                          ...current,
                          message,
                        }))
                      }
                      onError={(message) => {
                        if (session.result?.session_id) {
                          void vncCloseSession(session.result.session_id).catch(() => undefined);
                        }
                        updateVncSession(session.id, (current) => ({
                          ...current,
                          error: message,
                          message: null,
                          status: "error",
                        }));
                      }}
                      onPreview={() => void previewVncSessionLaunch(session.id)}
                      onRetry={() => retryVncSession(session.id)}
                    />
                  ))}
                </section>
              </section>

              <section
                className={`terminal-workbench-pane ${commandSenderOpen ? "command-sender-open" : ""} ${
                  showingLocalTerminal ? "" : "is-hidden"
                }`}
                data-terminal-tone={terminalTone}
                aria-label="本地终端区"
                aria-hidden={!showingLocalTerminal}
              >
                <nav className="terminal-subtabs" aria-label="本地终端标签">
                  {localTerminalTabs.map((tab, index) => (
                    <TabContextMenu
                      key={tab.id}
                      actions={[
                        {
                          hint: "Ctrl+F4",
                          label: "关闭",
                          onSelect: () => closeLocalTerminalSession(tab),
                        },
                        {
                          disabled: localTerminalTabs.length <= 1,
                          label: "关闭其他",
                          onSelect: () => closeOtherLocalTerminalTabs(tab.id),
                        },
                        {
                          disabled: index >= localTerminalTabs.length - 1,
                          label: "关闭右侧标签页",
                          onSelect: () => closeLocalTerminalTabsToRight(tab.id),
                        },
                        {
                          disabled: localTerminalTabs.length === 0,
                          hint: "Ctrl+K W",
                          label: "全部关闭",
                          onSelect: () => closeLocalTerminalTabs(localTerminalTabs.map((item) => item.id)),
                        },
                      ]}
                    >
                      <div
                        className={`subtab-shell ${tab.id === activeLocalTerminalTabId ? "active" : ""}`}
                      >
                        <button
                          className="subtab local-terminal-subtab"
                          type="button"
                          title={`${tab.title} · ${tab.status}`}
                          onClick={() => activateLocalTerminalTab(tab)}
                        >
                          <LocalTerminalIcon className="ui-icon" kind={tab.profileKind} title={tab.title} />
                          <span>{tab.title}</span>
                        </button>
                        <button
                          className="subtab-close"
                          type="button"
                          aria-label={`关闭 ${tab.title}`}
                          onClick={() => closeLocalTerminalSession(tab)}
                        >
                          <X className="ui-icon" aria-hidden="true" />
                        </button>
                      </div>
                    </TabContextMenu>
                  ))}
                  <Tooltip label="新建默认终端">
                    <button
                      className="add-subtab"
                      type="button"
                      aria-label="新建默认终端"
                      disabled={!defaultLocalTerminalProfile}
                      onClick={() => void openLocalTerminalByProfile(resolveDefaultLocalTerminalProfile())}
                    >
                      <Plus className="ui-icon" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <LocalTerminalLauncher
                    disabled={localTerminalProfiles.length === 0}
                    loading={localTerminalProfilesLoading}
                    profiles={localTerminalProfiles}
                    onOpenProfile={(profile) => void openLocalTerminalByProfile(profile)}
                  />
                  {localTerminalProfilesError ? (
                    <div className="local-terminal-subtabs-meta">
                      <button
                        className="local-terminal-inline-action"
                        type="button"
                        onClick={openLocalTerminalSettings}
                      >
                        {localTerminalProfilesError}
                      </button>
                    </div>
                  ) : null}
                  <div className="terminal-subtab-actions">
                    {activeLocalTerminalTab?.sessionId ? (
                      <Tooltip label={activeLocalTerminalSearch?.open ? "关闭终端搜索" : "搜索终端输出"}>
                        <button
                          className={`add-subtab terminal-search-toggle ${
                            activeLocalTerminalSearch?.open ? "active" : ""
                          }`}
                          type="button"
                          aria-label="搜索终端输出"
                          aria-expanded={Boolean(activeLocalTerminalSearch?.open)}
                          onClick={() => toggleTerminalSearch(activeLocalTerminalTab.id)}
                        >
                          <Search className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {commandSenderTargets.length > 0 ? (
                      <Tooltip label="Command Sender">
                        <button
                          className={`add-subtab command-sender-toggle ${commandSenderOpen ? "active" : ""}`}
                          type="button"
                          aria-label="打开命令操作台 Command Sender"
                          aria-expanded={commandSenderOpen}
                          onClick={openCommandSender}
                        >
                          <Send className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    <Tooltip label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}>
                      <button
                        className="add-subtab terminal-subtab-panel-toggle"
                        type="button"
                        aria-label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}
                        aria-expanded={!rightPaneCollapsed}
                        onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
                      >
                        {rightPaneCollapsed ? (
                          <PanelRightOpen className="ui-icon" aria-hidden="true" />
                        ) : (
                          <PanelRightClose className="ui-icon" aria-hidden="true" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </nav>

                <section className="terminal-stack" aria-label="本地终端">
                  {localTerminalTabs.length === 0 ? (
                    <LocalTerminalEmptyPanel
                      active={showingLocalTerminal}
                      error={localTerminalProfilesError}
                      loading={localTerminalProfilesLoading}
                      profileName={defaultLocalTerminalProfile?.name || null}
                      onOpenDefault={() => void openLocalTerminalByProfile(resolveDefaultLocalTerminalProfile())}
                      onOpenSettings={openLocalTerminalSettings}
                    />
                  ) : (
                    localTerminalTabs.map((tab) =>
                      tab.sessionId ? (
                        <Suspense
                          key={tab.id}
                          fallback={
                            <LocalTerminalStatusPanel
                              active={showingLocalTerminal && tab.id === activeLocalTerminalTabId}
                              error={null}
                              profile={
                                tab.source === "local"
                                  ? localTerminalProfiles.find((profile) => profile.id === tab.profileId) || null
                                  : null
                              }
                              source={tab.source || "local"}
                              status="正在加载终端"
                              title={tab.title}
                              onOpenSettings={openLocalTerminalSettings}
                            />
                          }
                        >
                          <TerminalPanel
                            active={showingLocalTerminal && tab.id === activeLocalTerminalTabId}
                            autoConnect={false}
                            connection={null}
                            ctrlVPaste={settings.localTerminal.ctrlVPaste}
                            cursorBlink={settings.appearance.cursorBlink}
                            cursorStyle={settings.appearance.cursorStyle}
                            fontFamily={terminalFontFamily}
                            fontSize={settings.appearance.terminalFontSize}
                            initialSessionId={tab.sessionId}
                            initialOutput={tab.warmupOutput}
                            initialRequestId={tab.requestId}
                            onRecentOutput={appendTerminalRecentOutput}
                            onSearchClose={closeTerminalSearch}
                            onSearchCaseSensitiveToggle={toggleTerminalSearchCaseSensitive}
                            onSearchQueryChange={updateTerminalSearchQuery}
                            onSendSelectionToAi={sendTerminalSelectionToAi}
                            onStatusChange={updateLocalTerminalTabStatus}
                            onTerminalInputCommand={
                              settings.command.recordTerminalInputHistory
                                ? (tabId, command) => void recordTerminalInputHistoryCommand(tabId, command)
                                : undefined
                            }
                            onWarmupCaptureReady={stopTerminalWarmupCapture}
                            searchCaseSensitive={Boolean(terminalSearchByTabId[tab.id]?.caseSensitive)}
                            searchNavigationRequest={terminalSearchNavigationRequest}
                            searchOpen={Boolean(terminalSearchByTabId[tab.id]?.open)}
                            searchQuery={terminalSearchByTabId[tab.id]?.query || ""}
                            tabId={tab.id}
                            theme={terminalColorScheme.theme}
                            title={tab.title}
                            windowsPty={windowsPtyInfo}
                          />
                        </Suspense>
                      ) : (
                        <LocalTerminalStatusPanel
                          active={showingLocalTerminal && tab.id === activeLocalTerminalTabId}
                          error={tab.error || null}
                          profile={
                            tab.source === "local"
                              ? localTerminalProfiles.find((profile) => profile.id === tab.profileId) || null
                              : null
                          }
                          source={tab.source || "local"}
                          status={tab.status}
                          title={tab.title}
                          key={tab.id}
                          onOpenSettings={openLocalTerminalSettings}
                          onRetry={
                            tab.source === "local" || !tab.source
                              ? () =>
                                  void openLocalTerminalByProfile(
                                    localTerminalProfiles.find((profile) => profile.id === tab.profileId) || null,
                                  )
                              : undefined
                          }
                        />
                      ),
                    )
                  )}
                </section>
                {showingLocalTerminal ? renderCommandSenderPanel() : null}
              </section>
            </section>
          ) : null}
        </section>

        {showWorkspaceToolPane && !rightPaneCollapsed ? (
          <div
            className="pane-resizer right-pane-resizer"
            role="separator"
            aria-label="拖拽调整右侧工具面板宽度，双击恢复默认"
            aria-orientation="vertical"
            aria-valuemin={minRightPaneWidth}
            aria-valuemax={maxRightPaneWidth}
            aria-valuenow={rightPaneWidth}
            tabIndex={0}
            onDoubleClick={() => setRightPaneWidth(defaultRightPaneWidth)}
            onKeyDown={(event) => handlePaneResizeKeyDown("right", event)}
            onPointerDown={(event) => handlePaneResizeStart("right", event)}
          />
        ) : null}

        {showWorkspaceToolPane ? (
          <Suspense
            fallback={
              <aside className="tool-pane" aria-label="右侧工具面板">
                <p className="file-panel-empty">正在加载工具面板...</p>
              </aside>
            }
          >
            {showingRdp || showingVnc ? (
              <RemoteFilePanel
                active={!rightPaneCollapsed}
                activeTool={rightTool}
                availableTools={["tools"]}
                connection={remoteFileConnection}
                key={remoteFilePanelKey}
                nativeDropTargetPath={nativeFileDropTargetPath}
                onToolChange={setRightTool}
                toolsPanel={
                  showingRdp ? (
                    <RdpSessionToolPanel
                      connection={activeConnection}
                      session={activeRdpSession}
                      onCopyCommand={(session) => void copyText(rdpSessionCommandText(session))}
                      onCopyRdpFile={(session) => void copyText(rdpSessionFileText(session))}
                      onPreview={(session) => void previewRdpSessionLaunch(session.id)}
                      onRetry={(session) => retryRdpSession(session.id)}
                    />
                  ) : (
                    <VncSessionToolPanel
                      connection={activeConnection}
                      session={activeVncSession}
                      onCopyCommand={(session) => void copyText(vncSessionCommandText(session))}
                      onPreview={(session) => void previewVncSessionLaunch(session.id)}
                      onRetry={(session) => retryVncSession(session.id)}
                    />
                  )
                }
              />
            ) : showingLocalTerminal ? (
              <RemoteFilePanel
                active={!rightPaneCollapsed}
                activeTool={rightTool}
                availableTools={["commands", "ai"]}
                connection={null}
                commandPanel={renderCommandLibraryPanel()}
                aiPanel={aiAssistantPanelNode}
                onToolChange={setRightTool}
              />
            ) : (
              <div className="remote-file-panel-stack">
                {sshRemoteFilePanelStack.length > 0 ? (
                  sshRemoteFilePanelStack.map((panel) => {
                    const panelConnection = connectionById.get(panel.connectionId) || null;
                    const panelTerminalPath = terminalDirectories[panel.tabId] || null;

                    return (
                      <RemoteFilePanel
                        active={panel.active}
                        activeTool={rightTool}
                        availableTools={undefined}
                        connection={panelConnection}
                        key={panel.key}
                        locateRequest={remoteFileLocateRequest}
                        refreshRequest={remoteFileRefreshRequest}
                        nativeDropTargetPath={nativeFileDropTargetPath}
                        stateKey={panel.key}
                        monitorPanel={
                          panel.active && rightTool === "monitor" ? (
                            <Suspense fallback={<p className="file-panel-empty">正在加载监控...</p>}>
                              <MonitorPanel active connection={panelConnection} />
                            </Suspense>
                          ) : null
                        }
                        aiPanel={panel.active ? aiAssistantPanelNode : null}
                        commandPanel={panel.active && rightTool === "commands" ? renderCommandLibraryPanel() : null}
                        toolsPanel={
                          panel.renderDockerTools ? (
                            <Suspense fallback={<p className="file-panel-empty">正在加载 Docker 面板...</p>}>
                              <DockerToolPanel
                                active={panel.active && rightTool === "tools"}
                                activeConnectionId={panel.connectionId}
                                connection={panelConnection}
                                connections={connections}
                                onCopyText={copyText}
                                onOpenContainerTerminal={openDockerContainerTerminal}
                              />
                            </Suspense>
                          ) : null
                        }
                        transferPanel={
                          panel.active && rightTool === "files" ? (
                            <RemoteFileTransferPanel
                              transfers={remoteFileTransfers}
                              onCancel={requestCancelTransfer}
                              onClearFinished={clearFinishedTransfers}
                              onCopyPath={copyRemotePath}
                              onRemove={removeRemoteFileTransfer}
                              onRetry={retryRemoteFileTransfer}
                              onOpenLocalPath={openLocalTransferPath}
                              onRevealLocalPath={revealLocalTransferPath}
                            />
                          ) : null
                        }
                        onCopyPath={copyRemotePath}
                        onCreateDirectory={requestCreateRemoteDirectory}
                        onCreateFile={requestCreateRemoteFile}
                        onDeleteEntries={requestDeleteRemoteEntries}
                        onDeleteEntry={requestDeleteRemoteEntry}
                        onDownloadEntries={downloadRemoteFiles}
                        onDownloadEntry={downloadRemoteFile}
                        onOpenFile={openRemoteFile}
                        onRenameEntry={requestRenameRemoteEntry}
                        onShowProperties={showRemoteFileProperties}
                        onToolChange={setRightTool}
                        onUploadDirectory={uploadRemoteDirectory}
                        onUploadFile={uploadRemoteFile}
                        onUploadItems={uploadRemoteItems}
                        resolveTerminalPath={() => resolveTerminalLocatePath(panel.tabId)}
                        terminalPath={panelTerminalPath}
                      />
                    );
                  })
                ) : (
                  <RemoteFilePanel
                    active={!rightPaneCollapsed}
                    activeTool={rightTool}
                    availableTools={undefined}
                    connection={remoteFileConnection}
                    locateRequest={remoteFileLocateRequest}
                    refreshRequest={remoteFileRefreshRequest}
                    nativeDropTargetPath={nativeFileDropTargetPath}
                    aiPanel={aiAssistantPanelNode}
                    onToolChange={setRightTool}
                    resolveTerminalPath={
                      activeConnectedTerminalTab
                        ? () => resolveTerminalLocatePath(activeConnectedTerminalTab.id)
                        : undefined
                    }
                    terminalPath={activeTerminalDirectory}
                  />
                )}
              </div>
            )}
          </Suspense>
        ) : null}

        {dialogOpen && LoadedConnectionDialog ? (
          <LoadedConnectionDialog
            allowPasswordReveal={effectiveAllowPasswordReveal}
            connection={editingConnection}
            connections={connections}
            credentials={credentials}
            defaultGroup={pendingConnectionGroupName}
            groups={connectionGroupCatalog.groups}
            onClose={closeConnectionDialog}
            onDelete={deleteConnection}
            onManageCredentials={openCredentialSettings}
            onSave={saveConnectionFromDialog}
            onTest={testConnectionFromDialog}
            onTrustHostKey={knownHostTrust}
            open={dialogOpen}
          />
        ) : dialogOpen ? (
          <Suspense fallback={null}>
            <ConnectionDialog
              allowPasswordReveal={effectiveAllowPasswordReveal}
              connection={editingConnection}
              connections={connections}
              credentials={credentials}
              defaultGroup={pendingConnectionGroupName}
              groups={connectionGroupCatalog.groups}
              onClose={closeConnectionDialog}
              onDelete={deleteConnection}
              onManageCredentials={openCredentialSettings}
              onSave={saveConnectionFromDialog}
              onTest={testConnectionFromDialog}
              onTrustHostKey={knownHostTrust}
              open={dialogOpen}
            />
          </Suspense>
        ) : null}
      </main>

      {connectionSearchOpen ? (
        <Suspense fallback={<ConnectionSearchDialogFallback />}>
          <ConnectionSearchDialog
            activeConnectionId={activeConnectionId}
            connections={connections}
            open={connectionSearchOpen}
            query={connectionSearchQuery}
            onOpenChange={setConnectionSearchOpen}
            onQueryChange={setConnectionSearchQuery}
            onSelectConnection={openConnectionSession}
          />
        </Suspense>
      ) : null}

      <Dialog.Root
        open={commandSnippetDialogOpen}
        onOpenChange={(open) => {
          setCommandSnippetDialogOpen(open);
          if (!open) {
            setCommandSnippetFormError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content
            className="command-snippet-dialog"
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <header className="command-snippet-dialog-head">
              <div>
                <Dialog.Title asChild>
                  <h2>{commandSnippetDraft.id ? "编辑命令片段" : "保存命令片段"}</h2>
                </Dialog.Title>
                <Dialog.Description className="dialog-subtitle">
                  保存后可在右侧命令面板快速复制、插入或发送。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button" type="button" aria-label="关闭命令片段">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>

            <div className="command-snippet-dialog-body">
              <form className="command-snippet-form" onSubmit={(event) => void saveCommandSnippetDraft(event)}>
                <label className="command-snippet-field">
                  <span>文件夹</span>
                  <div className="command-snippet-group-control">
                    <AppSelect
                      ariaLabel="命令片段文件夹"
                      className="command-snippet-group-select"
                      menuMinWidth={180}
                      options={commandSnippetGroupOptions}
                      value={commandSnippetDraft.group}
                      onChange={(group) =>
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          group,
                        }))
                      }
                    />
                    <Tooltip label="新增分组">
                      <button
                        className="command-snippet-group-add"
                        type="button"
                        aria-label="新增命令片段分组"
                        onClick={() => openCommandSnippetGroupCreateDialog(true)}
                      >
                        <Plus className="ui-icon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                </label>
                <label className="command-snippet-field">
                  <span>标题</span>
                  <input
                    value={commandSnippetDraft.title}
                    onChange={(event) => {
                      const value = event.target?.value;
                      if (value !== undefined) {
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          title: value,
                        }));
                      }
                    }}
                  />
                </label>
                <label className="command-snippet-field command-snippet-command-field">
                  <span>命令</span>
                  <textarea
                    value={commandSnippetDraft.command}
                    spellCheck={false}
                    onChange={(event) => {
                      const value = event.target?.value;
                      if (value !== undefined) {
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          command: value,
                        }));
                      }
                    }}
                  />
                </label>
                <label className="command-snippet-field">
                  <span>说明</span>
                  <input
                    value={commandSnippetDraft.description}
                    onChange={(event) => {
                      const value = event.target?.value;
                      if (value !== undefined) {
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          description: value,
                        }));
                      }
                    }}
                  />
                </label>
                <label className="command-snippet-field">
                  <span>标签</span>
                  <input
                    value={commandSnippetDraft.tagsText}
                    placeholder="多个标签用逗号分隔"
                    onChange={(event) => {
                      const value = event.target?.value;
                      if (value !== undefined) {
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          tagsText: value,
                        }));
                      }
                    }}
                  />
                </label>
                <label className="command-snippet-favorite">
                  <input
                    type="checkbox"
                    checked={commandSnippetDraft.favorite}
                    onChange={(event) => {
                      const checked = event.target?.checked;
                      if (checked !== undefined) {
                        setCommandSnippetDraft((draft) => ({
                          ...draft,
                          favorite: checked,
                        }));
                      }
                    }}
                  />
                  <Star className="ui-icon" aria-hidden="true" />
                  <span>收藏置顶</span>
                </label>
                {commandSnippetFormError ? (
                  <p className="command-snippet-form-error">{commandSnippetFormError}</p>
                ) : null}
                <footer className="command-snippet-form-actions">
                  <Dialog.Close asChild>
                    <button className="secondary-button" type="button">取消</button>
                  </Dialog.Close>
                  <button className="primary-button" type="submit">
                    <CheckCircle2 className="ui-icon" aria-hidden="true" />
                    <span>保存片段</span>
                  </button>
                </footer>
              </form>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(commandSnippetGroupDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setCommandSnippetGroupDialog(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content
            className="command-snippet-group-dialog"
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <header className="command-snippet-dialog-head">
              <div>
                <Dialog.Title asChild>
                  <h2>
                    {commandSnippetGroupDialog?.mode === "rename"
                      ? "重命名片段分组"
                      : "新增片段分组"}
                  </h2>
                </Dialog.Title>
                <Dialog.Description className="dialog-subtitle">
                  分组只保留一层，用来整理右侧命令片段。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button" type="button" aria-label="关闭片段分组">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>

            <form className="command-snippet-group-form" onSubmit={(event) => void saveCommandSnippetGroupDialog(event)}>
              <label className="command-snippet-field">
                <span>分组名称</span>
                <input
                  autoFocus
                  value={commandSnippetGroupDialog?.value || ""}
                  onChange={(event) => {
                    const value = event.target?.value;
                    if (value !== undefined) {
                      setCommandSnippetGroupDialog((state) =>
                        state ? { ...state, error: null, value } : state,
                      );
                    }
                  }}
                />
              </label>
              {commandSnippetGroupDialog?.error ? (
                <p className="command-snippet-form-error">{commandSnippetGroupDialog.error}</p>
              ) : null}
              <footer className="command-snippet-form-actions">
                <Dialog.Close asChild>
                  <button className="secondary-button" type="button">取消</button>
                </Dialog.Close>
                <button className="primary-button" type="submit">
                  <CheckCircle2 className="ui-icon" aria-hidden="true" />
                  <span>保存</span>
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        confirmLabel="删除"
        description={
          pendingCommandSnippetDelete
            ? `删除“${pendingCommandSnippetDelete.title}”后，命令操作台将不再展示这个片段。`
            : ""
        }
        open={Boolean(pendingCommandSnippetDelete)}
        title="删除命令片段"
        onConfirm={confirmDeleteCommandSnippet}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCommandSnippetDelete(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="删除"
        description={
          pendingCommandSnippetGroupDelete
            ? `将删除“${pendingCommandSnippetGroupDelete}”分组，以及其中 ${commandSnippets
                .filter(
                  (snippet) =>
                    normalizeCommandSnippetGroupValue(snippet.group) ===
                    normalizeCommandSnippetGroupValue(pendingCommandSnippetGroupDelete),
                )
                .length.toString()} 条命令片段。此操作不可撤销。`
            : ""
        }
        open={Boolean(pendingCommandSnippetGroupDelete)}
        title="删除片段分组"
        onConfirm={confirmDeleteCommandSnippetGroup}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCommandSnippetGroupDelete(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="删除"
        description={
          pendingCommandHistoryDelete
            ? `删除历史命令“${truncateCommandLabel(pendingCommandHistoryDelete.command, 48)}”。`
            : ""
        }
        open={Boolean(pendingCommandHistoryDelete)}
        title="删除历史命令"
        onConfirm={confirmDeleteCommandHistory}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCommandHistoryDelete(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="清空"
        description="清空后，命令操作台不再展示任何历史命令；命令片段不受影响。"
        open={commandHistoryClearOpen}
        title="清空历史命令"
        onConfirm={confirmClearCommandHistory}
        onOpenChange={setCommandHistoryClearOpen}
      />

      <ConfirmDialog
        confirmLabel="放弃"
        description={
          pendingRemoteFileCloseTab
            ? `关闭“${pendingRemoteFileCloseTab.name}”会丢弃尚未保存的修改。`
            : ""
        }
        open={Boolean(pendingRemoteFileCloseTab)}
        title="关闭已修改文件"
        onConfirm={() => {
          if (pendingRemoteFileCloseTab) {
            closeRemoteFileTabNow(pendingRemoteFileCloseTab.id);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemoteFileCloseId(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="放弃并关闭"
        description={
          pendingConnectionSessionDirtyTabs.length > 1
            ? `关闭会话会丢弃 ${pendingConnectionSessionDirtyTabs.length.toString()} 个已修改文件。`
            : pendingConnectionSessionDirtyTabs[0]
              ? `关闭会话会丢弃“${pendingConnectionSessionDirtyTabs[0].name}”尚未保存的修改。`
              : "关闭会话会丢弃尚未保存的文件修改。"
        }
        open={Boolean(pendingConnectionSessionCloseIds)}
        title="关闭包含已修改文件的会话"
        onConfirm={() => {
          if (pendingConnectionSessionCloseIds) {
            closeConnectionSessions(pendingConnectionSessionCloseIds, {
              discardDirtyRemoteFiles: true,
            });
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConnectionSessionCloseIds(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="删除"
        description={
          remoteFileDeleteTarget
            ? remoteFileDeleteDescription(
                remoteFileDeleteEntries,
                remoteFileDeleteAffectedTabs.length,
                remoteFileDeleteDirtyCount,
              )
            : ""
        }
        open={Boolean(remoteFileDeleteTarget)}
        title={remoteFileDeleteEntries.length > 1 ? "删除所选远程文件" : "删除远程文件"}
        onConfirm={confirmRemoteFileDelete}
        onOpenChange={(open) => {
          if (!open) {
            setRemoteFileDeleteTarget(null);
          }
        }}
      />

      <Dialog.Root
        open={Boolean(pendingRemoteFileConflictTab)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemoteFileConflictId(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop confirm-backdrop" />
          <Dialog.Content
            className="confirm-dialog remote-file-conflict"
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <div className="confirm-dialog-icon" aria-hidden="true">
              <RefreshCw className="ui-icon" />
            </div>
            <div className="confirm-dialog-copy">
              <Dialog.Title className="confirm-dialog-title">远端文件已变化</Dialog.Title>
              <Dialog.Description className="confirm-dialog-description">
                {pendingRemoteFileConflictTab
                  ? `“${pendingRemoteFileConflictTab.name}”在打开后被远端修改。你可以重新加载远端版本，或覆盖保存当前编辑内容。`
                  : ""}
              </Dialog.Description>
              {pendingRemoteFileConflictTab?.error ? (
                <p className="remote-file-dialog-error">{pendingRemoteFileConflictTab.error}</p>
              ) : null}
            </div>
            <footer className="confirm-dialog-actions remote-file-conflict-actions">
              <button
                type="button"
                onClick={() => {
                  if (pendingRemoteFileConflictTab) {
                    reloadRemoteFile(pendingRemoteFileConflictTab.id);
                  }
                  setPendingRemoteFileConflictId(null);
                }}
              >
                重新加载
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  if (pendingRemoteFileConflictTab) {
                    saveRemoteFile(pendingRemoteFileConflictTab.id, true);
                  }
                  setPendingRemoteFileConflictId(null);
                }}
              >
                覆盖保存
              </button>
              <Dialog.Close asChild>
                <button type="button">取消</button>
              </Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(remoteFileTextAction)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoteFileTextAction(null);
            setRemoteFileTextValue("");
            setRemoteFileTextError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content
            asChild
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <form className="remote-file-text-dialog" onSubmit={submitRemoteFileTextAction}>
              <header className="dialog-head">
                <div className="dialog-title-group">
                  <Dialog.Title asChild>
                    <strong>{remoteFileTextAction ? remoteFileActionTitle(remoteFileTextAction) : "远程文件"}</strong>
                  </Dialog.Title>
                  <Dialog.Description className="dialog-subtitle">
                    {remoteFileTextAction ? remoteFileActionDescription(remoteFileTextAction) : ""}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>
              <div className="dialog-body">
                <label className="remote-file-name-field">
                  <span>名称</span>
                  <input
                    autoFocus
                    spellCheck={false}
                    value={remoteFileTextValue}
                    onChange={(event) => setRemoteFileTextValue(event.target.value)}
                  />
                </label>
                {remoteFileTextError ? (
                  <p className="remote-file-dialog-error">{remoteFileTextError}</p>
                ) : null}
              </div>
              <footer className="dialog-actions remote-file-text-actions">
                <span />
                <Dialog.Close asChild>
                  <button type="button">取消</button>
                </Dialog.Close>
                <button className="primary-button" type="submit">
                  确认
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(remoteFileProperties)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoteFileProperties(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content className="remote-file-properties-dialog">
            <header className="dialog-head">
              <div className="dialog-title-group">
                <Dialog.Title asChild>
                  <strong>查看属性</strong>
                </Dialog.Title>
                <Dialog.Description className="dialog-subtitle">
                  {remoteFileProperties?.entry.path || ""}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>
            <div className="dialog-body">
              {remoteFileProperties?.loading ? (
                <p className="file-panel-empty">读取属性中...</p>
              ) : remoteFileProperties?.error ? (
                <p className="remote-file-dialog-error">{remoteFileProperties.error}</p>
              ) : remoteFileProperties?.metadata ? (
                <RemoteFilePropertiesTable metadata={remoteFileProperties.metadata} />
              ) : null}
            </div>
            <footer className="dialog-actions remote-file-text-actions">
              <span />
              <button
                type="button"
                onClick={() => {
                  if (remoteFileProperties?.entry.path) {
                    copyRemotePath(remoteFileProperties.entry.path);
                  }
                }}
              >
                复制路径
              </button>
              <Dialog.Close asChild>
                <button className="primary-button" type="button">关闭</button>
              </Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(transferConflictPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            settleTransferConflictPrompt(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop confirm-backdrop" />
          <Dialog.Content
            className="confirm-dialog transfer-conflict-dialog"
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <div className="confirm-dialog-icon" aria-hidden="true">
              <RefreshCw className="ui-icon" />
            </div>
            <div className="confirm-dialog-copy">
              <Dialog.Title className="confirm-dialog-title">同名目标策略</Dialog.Title>
              <Dialog.Description className="confirm-dialog-description">
                {transferConflictPrompt ? transferConflictPrompt.description : ""}
              </Dialog.Description>
            </div>
            <footer className="confirm-dialog-actions transfer-conflict-actions">
              <button type="button" onClick={() => settleTransferConflictPrompt("rename")}>
                重命名
              </button>
              <button type="button" onClick={() => settleTransferConflictPrompt("skip")}>
                跳过
              </button>
              <button className="danger-button" type="button" onClick={() => settleTransferConflictPrompt("overwrite")}>
                覆盖
              </button>
              <button type="button" onClick={() => settleTransferConflictPrompt(null)}>
                取消
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {shouldRenderSettingsView ? (
        <Suspense fallback={<SettingsViewFallback hidden={activeView !== "settings"} />}>
          <SettingsView
            appUpdate={appUpdate}
            activeSection={settingsSectionRequest}
            activeSectionRequestKey={settingsSectionRequestKey}
            connections={connections}
            credentials={credentials}
            credentialError={credentialError}
            credentialLoading={credentialLoading}
            effectiveWindowMaterial={effectiveWindowMaterial}
            hidden={activeView !== "settings"}
            secretVaultBusy={secretVault.unlocking}
            secretVaultError={secretVault.error}
            settings={settings}
            supportedWindowMaterials={supportedWindowMaterials}
            onDeleteCredential={deleteCredentialFromSettings}
            onDisableMasterPassword={async () => {
              const nextStatus = await secretVault.disableMasterPassword();
              return Boolean(nextStatus?.unlocked);
            }}
            onEnableMasterPassword={async (masterPassword) => {
              const nextStatus = await secretVault.enableMasterPassword(masterPassword);
              return Boolean(nextStatus?.unlocked);
            }}
            onUnlockSecuritySettings={async (masterPassword) => {
              const nextStatus = await secretVault.unlock(masterPassword);
              return Boolean(nextStatus?.unlocked);
            }}
            onReset={reset}
            onReturnWorkspace={returnFromSettings}
            onSaveCredential={saveCredentialFromSettings}
            onUpdateAppearance={updateAppearance}
            onUpdateBasic={updateBasic}
            onUpdateCommand={updateCommand}
            onUpdateFileTransfer={updateFileTransfer}
            onUpdateLocalTerminal={updateLocalTerminal}
            onUpdateSecurity={updateSecurity}
            onUpdateShortcuts={updateShortcuts}
            onUpdateTerminalTheme={updateTerminalTheme}
          />
        </Suspense>
      ) : null}
    </div>
  );

  function closeConnectionDialog() {
    setDialogOpen(false);
    setPendingConnectionGroupName(null);
  }
}

function ConnectionSearchDialogFallback() {
  return (
    <Dialog.Root open>
      <Dialog.Overlay className="dialog-backdrop connection-search-backdrop" />
      <Dialog.Content className="connection-search-dialog" aria-label="加载连接搜索">
        <header className="connection-search-head">
          <div>
            <Dialog.Title className="connection-search-title">快速打开连接</Dialog.Title>
            <Dialog.Description className="sr-only">正在加载连接搜索</Dialog.Description>
          </div>
        </header>
        <p className="file-panel-empty">正在加载连接搜索...</p>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SettingsViewFallback({ hidden }: { hidden: boolean }) {
  return (
    <section className="settings-view" hidden={hidden} aria-label="设置" aria-hidden={hidden}>
      <aside className="settings-sidebar app-sidebar" aria-label="设置分类" />
      <main className="settings-content">
        <section className="settings-page-section">
          <p className="file-panel-empty">正在加载设置...</p>
        </section>
      </main>
    </section>
  );
}

function RemoteEditorLoadingFallback() {
  return (
    <div className="remote-editor-loading" aria-live="polite" aria-label="正在加载文件编辑器">
      <div>
        <Loader2 className="ui-icon spin" aria-hidden="true" />
        <span>正在加载编辑器...</span>
      </div>
    </div>
  );
}

function removeConnectionRecordEntries<T>(
  records: Record<string, T>,
  closingConnectionIds: Set<string>,
) {
  let changed = false;
  const nextRecords: Record<string, T> = {};

  Object.entries(records).forEach(([connectionId, value]) => {
    if (closingConnectionIds.has(connectionId)) {
      changed = true;
      return;
    }
    nextRecords[connectionId] = value;
  });

  return changed ? nextRecords : records;
}

function RemoteFileTransferPanel({
  transfers,
  onCancel,
  onClearFinished,
  onCopyPath,
  onRemove,
  onRetry,
  onOpenLocalPath,
  onRevealLocalPath,
}: {
  transfers: RemoteFileTransferItem[];
  onCancel: (transferId: string) => void;
  onClearFinished: () => void;
  onCopyPath: (path: string) => void;
  onRemove: (transferId: string) => void;
  onRetry: (transferId: string) => void;
  onOpenLocalPath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const runningCount = transfers.filter((item) => item.status === "running").length;
  const queuedCount = transfers.filter((item) => item.status === "queued").length;
  const errorCount = transfers.filter((item) => item.status === "error").length;
  const finishedCount = transfers.filter((item) =>
    ["success", "skipped", "canceled"].includes(item.status),
  ).length;
  const summaryTransfer =
    transfers.find((item) => ["running", "queued"].includes(item.status)) ||
    transfers.find((item) => item.status === "error") ||
    transfers[0] ||
    null;
  const summaryProgress = summaryTransfer ? clampTransferProgress(summaryTransfer.progress) : 0;
  const summaryProgressText = summaryTransfer
    ? `${Math.round(summaryProgress).toString()}%`
    : "空闲";

  return (
    <section className={`transfer-panel ${expanded ? "open" : ""}`} aria-label="文件传输">
      <header className="transfer-panel-bar">
        <div className="transfer-panel-summary transfer-progress-summary">
          <strong>传输</strong>
          {runningCount > 0 ? <span className="transfer-chip running">{runningCount.toString()} 进行中</span> : null}
          {queuedCount > 0 ? <span className="transfer-chip">{queuedCount.toString()} 排队</span> : null}
          {errorCount > 0 ? <span className="transfer-chip error">{errorCount.toString()} 失败</span> : null}
          {transfers.length === 0 ? <span className="transfer-chip">无任务</span> : null}
        </div>
        <div className="transfer-progress-mini" aria-hidden="true">
          <span style={{ width: `${summaryProgress.toString()}%` }} />
        </div>
        <span className="transfer-panel-percent">{summaryProgressText}</span>
        <button
          className="transfer-panel-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "收起" : "展开"}
          <ChevronDown className="ui-icon" aria-hidden="true" />
        </button>
      </header>

      <div className="transfer-drawer">
        <div className="transfer-drawer-head">
          <strong>传输队列</strong>
          <button type="button" disabled={finishedCount === 0} onClick={onClearFinished}>
            清理完成项
          </button>
        </div>

        <div className="transfer-list">
          {transfers.length === 0 ? (
            <p className="file-panel-empty">上传和下载任务会显示在这里。</p>
          ) : (
            transfers.map((item) => {
              const progressValue = clampTransferProgress(item.progress);
              const progressLabel = `${Math.round(progressValue).toString()}%`;
              const canRemove = item.status !== "queued" && item.status !== "running";
              const typeLabel = transferFileTypeLabel(item);
              const sizeText = transferItemSizeText(item);
              const statusText = transferDisplayStatusLabel(item);
              const detailText = [
                `状态：${statusText}`,
                `阶段：${item.stage}`,
                `方向：${transferDirectionLabel(item.direction)}`,
                `类型：${transferKindLabel(item.kind)}`,
                `进度：${progressLabel}`,
                `大小：${sizeText}`,
                item.speedText ? `速度：${item.speedText}` : null,
                `创建时间：${formatTransferDetailTime(item.createdAt)}`,
                item.error ? `错误：${item.error}` : null,
                `来源：${transferSourcePath(item)}`,
                `目标：${transferTargetPath(item)}`,
              ].filter(Boolean).join("\n");

              return (
                <article className={`transfer-item ${item.status}`} key={item.id}>
                  <Tooltip label={detailText}>
                    <div className={`transfer-type-icon ${transferFileTypeClass(item)}`}>
                      {item.kind === "directory" ? (
                        <Folder className="ui-icon" aria-hidden="true" />
                      ) : transferFileTypeClass(item) === "archive" ? (
                        <Archive className="ui-icon" aria-hidden="true" />
                      ) : (
                        <FileText className="ui-icon" aria-hidden="true" />
                      )}
                      {typeLabel ? <span>{typeLabel}</span> : null}
                    </div>
                  </Tooltip>

                  <div className="transfer-item-main">
                    <div className="transfer-item-title">
                      <strong title={item.name}>{item.name}</strong>
                    </div>
                    <div className="transfer-item-meta">
                      <span className="transfer-tag direction">
                        {item.direction === "upload" ? "上传" : "下载"}
                      </span>
                      <span className={`transfer-status-dot ${item.status}`} aria-hidden="true" />
                      <span className="transfer-size-text" title={sizeText}>
                        {sizeText}
                      </span>
                      {item.speedText ? <span className="transfer-speed-text">{item.speedText}</span> : null}
                      <span className="transfer-status">{statusText}</span>
                    </div>
                    {item.status === "error" && item.error ? (
                      <p className="transfer-item-error" title={item.error}>
                        {transferInlineErrorText(item.error)}
                      </p>
                    ) : null}
                  </div>

                  <div className="transfer-item-actions">
                    <Tooltip label="复制路径">
                      <button
                        type="button"
                        aria-label={`复制 ${item.name} 路径`}
                        onClick={() => onCopyPath(item.localPath || item.remotePath)}
                      >
                        <Clipboard className="ui-icon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                    {item.localPath && item.kind !== "directory" ? (
                      <Tooltip label="打开">
                        <button
                          type="button"
                          aria-label={`打开 ${item.name}`}
                          onClick={() => onOpenLocalPath(item.localPath || "")}
                        >
                          <ExternalLink className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {item.localPath ? (
                      <Tooltip label="定位">
                        <button
                          type="button"
                          aria-label={`定位 ${item.name}`}
                          onClick={() => onRevealLocalPath(item.localPath || "")}
                        >
                          <FolderOpen className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {item.status === "error" && item.retry ? (
                      <Tooltip label="重试">
                        <button type="button" aria-label={`重试 ${item.name}`} onClick={() => onRetry(item.id)}>
                          <RefreshCw className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {item.status === "queued" || item.status === "running" ? (
                      <Tooltip label="取消">
                        <button type="button" aria-label={`取消 ${item.name}`} onClick={() => onCancel(item.id)}>
                          <X className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                    {canRemove ? (
                      <Tooltip label="移除任务">
                        <button
                          type="button"
                          aria-label={`删除任务 ${item.name}`}
                          onClick={() => onRemove(item.id)}
                        >
                          <Trash2 className="ui-icon" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>

                  <div className="transfer-progress-line">
                    <div
                      className={`transfer-progress ${item.progressIndeterminate ? "indeterminate" : ""}`}
                      role="progressbar"
                      aria-label={`${item.name} ${item.stage}`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={Math.round(progressValue)}
                    >
                      <span style={{ width: `${progressValue.toString()}%` }} />
                    </div>
                    <span className="transfer-progress-text">{progressLabel}</span>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function RdpSessionStatusPanel({
  active,
  connection,
  session,
  onEmbeddedViewportRef,
  onEmbeddedViewportResize,
  onClose,
  onCopyCommand,
  onCopyRdpFile,
  onPreview,
  onRetry,
}: {
  active: boolean;
  connection: ConnectionProfile | null;
  session: RdpSessionTab;
  onEmbeddedViewportRef: (sessionId: string, node: HTMLDivElement | null) => void;
  onEmbeddedViewportResize: (
    session: RdpSessionTab,
    bounds: RdpEmbeddedBounds | null,
    active: boolean,
  ) => void;
  onClose: () => void;
  onCopyCommand: () => void;
  onCopyRdpFile: () => void;
  onPreview: () => void;
  onRetry: () => void;
}) {
  const embeddedViewportRef = useRef<HTMLDivElement | null>(null);
  const hasCommand = rdpSessionHasCommandText(session);
  const hasRdpFile = rdpSessionHasRdpFileText(session);
  const runner = session.result?.runner || session.preview?.runner || connection?.rdp?.runner.preferred_runner || null;
  const primaryDetail = rdpSessionPrimaryDetail(session);
  const showEmbeddedViewport = session.status === "embedded";
  const setEmbeddedViewport = useCallback(
    (node: HTMLDivElement | null) => {
      embeddedViewportRef.current = node;
      onEmbeddedViewportRef(session.id, node);
    },
    [onEmbeddedViewportRef, session.id],
  );

  useLayoutEffect(() => {
    if (!session.result?.embedded) {
      return undefined;
    }

    const emitBounds = () => {
      const bounds = active
        ? measureRdpEmbeddedViewport(embeddedViewportRef.current)
        : null;
      onEmbeddedViewportResize(session, bounds, active);
    };
    const viewport = embeddedViewportRef.current;
    const observer =
      viewport && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(emitBounds)
        : null;
    if (observer && viewport) {
      observer.observe(viewport);
    }
    window.addEventListener("resize", emitBounds);
    const frameId = window.requestAnimationFrame(emitBounds);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", emitBounds);
      window.cancelAnimationFrame(frameId);
    };
  }, [active, onEmbeddedViewportResize, session]);

  return (
    <section
      className={`rdp-session-status ${session.status} ${active ? "" : "is-hidden"}`}
      aria-label={`${session.title} RDP 状态`}
      aria-hidden={!active}
    >
      <div className="rdp-session-shell">
        <header className="rdp-session-head">
          <div className="rdp-session-heading">
            <span className="rdp-session-icon" aria-hidden="true">
              {session.status === "launching" ? (
                <Loader2 className="ui-icon spin" />
              ) : session.status === "error" ? (
                <CircleAlert className="ui-icon" />
              ) : session.status === "embedded" || session.status === "native" ? (
                <MonitorPlay className="ui-icon" />
              ) : (
                <ExternalLink className="ui-icon" />
              )}
            </span>
            <span>
              <strong>{connection?.name || session.title}</strong>
              <small>
                {connection ? `RDP · ${formatConnectionAddress(connection)}` : "连接已不可用"}
              </small>
            </span>
          </div>
          <div className="rdp-session-actions">
            <button type="button" onClick={onPreview}>
              <FileText className="ui-icon" aria-hidden="true" />
              <span>预览</span>
            </button>
            <button type="button" disabled={!hasCommand} onClick={onCopyCommand}>
              <Clipboard className="ui-icon" aria-hidden="true" />
              <span>命令</span>
            </button>
            <button type="button" disabled={!hasRdpFile} onClick={onCopyRdpFile}>
              <FileText className="ui-icon" aria-hidden="true" />
              <span>RDP</span>
            </button>
            <button type="button" onClick={onRetry}>
              <RefreshCw className="ui-icon" aria-hidden="true" />
              <span>重试</span>
            </button>
            <button type="button" aria-label={`关闭 ${session.title}`} onClick={onClose}>
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="rdp-session-summary">
          <span className={`rdp-session-badge ${session.status}`}>
            {rdpStatusLabel(session.status)}
          </span>
          <span>{formatRdpRunnerKind(runner)}</span>
          {session.result?.process_id ? <span>PID {session.result.process_id.toString()}</span> : null}
          {session.result?.rdp_file_path ? <span title={session.result.rdp_file_path}>临时 .rdp</span> : null}
        </div>

        {session.message ? (
          <p className="rdp-session-message">{session.message}</p>
        ) : null}

        {session.error ? (
          <pre className="rdp-session-error" role="alert">{session.error}</pre>
        ) : null}

        {showEmbeddedViewport ? (
          <div className="rdp-embedded-placeholder" ref={setEmbeddedViewport}>
            <MonitorPlay className="ui-icon" aria-hidden="true" />
            <span>
              <strong>
                {session.status === "embedded" ? "嵌入式 RDP 会话区域" : "正在准备嵌入式会话"}
              </strong>
              <small>
                {session.status === "embedded"
                  ? "Windows 原生宿主已接管该区域，切换标签或调整窗口时会同步尺寸。"
                  : "RDP 客户端启动后会自动挂载到这里；不可嵌入时会回退到外部窗口。"}
              </small>
            </span>
          </div>
        ) : (
          <div className="rdp-session-preview-grid">
            <section className="rdp-session-preview-card">
              <strong>{primaryDetail.title}</strong>
              <code>{primaryDetail.value}</code>
            </section>
            {session.preview?.rdp_file_content ? (
              <section className="rdp-session-preview-card">
                <strong>生成的 .rdp</strong>
                <pre>{session.preview.rdp_file_content}</pre>
              </section>
            ) : null}
            {session.preview?.warnings.length ? (
              <section className="rdp-session-preview-card subtle">
                <strong>提示</strong>
                {session.preview.warnings.map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function RdpSessionToolPanel({
  connection,
  session,
  onCopyCommand,
  onCopyRdpFile,
  onPreview,
  onRetry,
}: {
  connection: ConnectionProfile | null;
  session: RdpSessionTab | null;
  onCopyCommand: (session: RdpSessionTab) => void;
  onCopyRdpFile: (session: RdpSessionTab) => void;
  onPreview: (session: RdpSessionTab) => void;
  onRetry: (session: RdpSessionTab) => void;
}) {
  if (!connection || !session) {
    return (
      <section className="rdp-tool-panel">
        <p className="file-panel-empty">打开一个 RDP 会话后显示 runner 状态。</p>
      </section>
    );
  }

  const hasCommand = rdpSessionHasCommandText(session);
  const hasRdpFile = rdpSessionHasRdpFileText(session);
  const runner = session.result?.runner || session.preview?.runner || connection.rdp?.runner.preferred_runner || null;
  const display = connection.rdp?.display;
  const resources = connection.rdp?.resources;

  return (
    <section className="rdp-tool-panel" aria-label="RDP 工具">
      <header className="rdp-tool-head">
        <span>
          <strong>{connection.name}</strong>
          <small>{formatConnectionAddress(connection)}</small>
        </span>
        <span className={`rdp-session-badge ${session.status}`}>{rdpStatusLabel(session.status)}</span>
      </header>

      <div className="rdp-tool-actions">
        <button type="button" onClick={() => onPreview(session)}>
          <FileText className="ui-icon" aria-hidden="true" />
          预览
        </button>
        <button type="button" disabled={!hasCommand} onClick={() => onCopyCommand(session)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制命令
        </button>
        <button type="button" disabled={!hasRdpFile} onClick={() => onCopyRdpFile(session)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制 .rdp
        </button>
        <button type="button" onClick={() => onRetry(session)}>
          <RefreshCw className="ui-icon" aria-hidden="true" />
          重试
        </button>
      </div>

      <dl className="rdp-tool-facts">
        <div>
          <dt>Runner</dt>
          <dd>{formatRdpRunnerKind(runner)}</dd>
        </div>
        <div>
          <dt>模式</dt>
          <dd>{rdpRenderModeLabel(connection.rdp?.runner.render_mode || "embedded")}</dd>
        </div>
        <div>
          <dt>显示</dt>
          <dd>{rdpDisplaySummary(display)}</dd>
        </div>
        <div>
          <dt>资源</dt>
          <dd>{rdpResourceSummary(resources)}</dd>
        </div>
      </dl>

      {session.error ? (
        <pre className="rdp-tool-error">{session.error}</pre>
      ) : null}

      {session.preview || session.result ? (
        <section className="rdp-tool-preview">
          <strong>启动材料</strong>
          <code>{rdpSessionCommandText(session) || "嵌入式 runner 不需要外部命令。"}</code>
          {session.preview?.setup_hint || session.result?.setup_hint ? (
            <small>{session.preview?.setup_hint || session.result?.setup_hint}</small>
          ) : null}
          {session.preview?.fallback_reason || session.result?.fallback_reason ? (
            <small>{session.preview?.fallback_reason || session.result?.fallback_reason}</small>
          ) : null}
        </section>
      ) : (
        <p className="rdp-tool-note">启动后可在这里查看 runner、生成命令和脱敏 `.rdp` 预览。</p>
      )}
    </section>
  );
}

function VncSessionStatusPanel({
  active,
  connection,
  session,
  onClose,
  onCopyCommand,
  onError,
  onMessage,
  onPreview,
  onRetry,
}: {
  active: boolean;
  connection: ConnectionProfile | null;
  session: VncSessionTab;
  onClose: () => void;
  onCopyCommand: () => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
  onPreview: () => void;
  onRetry: () => void;
}) {
  const hasCommand = vncSessionHasCommandText(session);
  const runner = session.result?.runner || session.preview?.runner || connection?.vnc?.runner.preferred_runner || null;
  const primaryDetail = vncSessionPrimaryDetail(session);
  const config = connection?.vnc || defaultVncConfig;
  const showEmbeddedViewer =
    session.status === "embedded" &&
    Boolean(session.result?.embedded && session.result.websocket_url);

  return (
    <section
      className={`rdp-session-status vnc-session-status ${session.status} ${active ? "" : "is-hidden"}`}
      aria-label={`${session.title} VNC 状态`}
      aria-hidden={!active}
    >
      <div className="rdp-session-shell vnc-session-shell">
        <header className="rdp-session-head">
          <div className="rdp-session-heading">
            <span className="rdp-session-icon" aria-hidden="true">
              {session.status === "launching" ? (
                <Loader2 className="ui-icon spin" />
              ) : session.status === "error" ? (
                <CircleAlert className="ui-icon" />
              ) : session.status === "embedded" || session.status === "windowed" ? (
                <MonitorPlay className="ui-icon" />
              ) : (
                <ExternalLink className="ui-icon" />
              )}
            </span>
            <span>
              <strong>{connection?.name || session.title}</strong>
              <small>
                {connection ? `VNC · ${formatConnectionAddress(connection)}` : "连接已不可用"}
              </small>
            </span>
          </div>
          <div className="rdp-session-actions">
            <button type="button" onClick={onPreview}>
              <FileText className="ui-icon" aria-hidden="true" />
              <span>预览</span>
            </button>
            <button type="button" disabled={!hasCommand} onClick={onCopyCommand}>
              <Clipboard className="ui-icon" aria-hidden="true" />
              <span>命令</span>
            </button>
            <button type="button" onClick={onRetry}>
              <RefreshCw className="ui-icon" aria-hidden="true" />
              <span>重试</span>
            </button>
            <button type="button" aria-label={`关闭 ${session.title}`} onClick={onClose}>
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="rdp-session-summary">
          <span className={`rdp-session-badge ${session.status}`}>
            {vncStatusLabel(session.status)}
          </span>
          <span>{formatVncRunnerKind(runner)}</span>
          {session.result?.process_id ? <span>PID {session.result.process_id.toString()}</span> : null}
          {session.result?.embedded ? <span>本地桥接</span> : null}
        </div>

        {session.message ? (
          <p className="rdp-session-message">{session.message}</p>
        ) : null}

        {session.error ? (
          <pre className="rdp-session-error" role="alert">{session.error}</pre>
        ) : null}

        {showEmbeddedViewer && session.result ? (
          <Suspense fallback={<p className="file-panel-empty">正在加载 VNC 画面...</p>}>
            <VncViewerSurface
              active={active}
              config={config}
              connection={connectionInfoFromVncProfile(connection)}
              result={session.result}
              onError={onError}
              onMessage={onMessage}
            />
          </Suspense>
        ) : (
          <div className="rdp-session-preview-grid">
            <section className="rdp-session-preview-card">
              <strong>{primaryDetail.title}</strong>
              <code>{primaryDetail.value}</code>
            </section>
            {session.preview?.warnings.length || session.result?.warnings.length ? (
              <section className="rdp-session-preview-card subtle">
                <strong>提示</strong>
                {(session.preview?.warnings || session.result?.warnings || []).map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function VncSessionToolPanel({
  connection,
  session,
  onCopyCommand,
  onPreview,
  onRetry,
}: {
  connection: ConnectionProfile | null;
  session: VncSessionTab | null;
  onCopyCommand: (session: VncSessionTab) => void;
  onPreview: (session: VncSessionTab) => void;
  onRetry: (session: VncSessionTab) => void;
}) {
  if (!connection || !session) {
    return (
      <section className="rdp-tool-panel vnc-tool-panel">
        <p className="file-panel-empty">打开一个 VNC 会话后显示 runner 状态。</p>
      </section>
    );
  }

  const hasCommand = vncSessionHasCommandText(session);
  const runner = session.result?.runner || session.preview?.runner || connection.vnc?.runner.preferred_runner || null;
  const display = connection.vnc?.display;
  const input = connection.vnc?.input;

  return (
    <section className="rdp-tool-panel vnc-tool-panel" aria-label="VNC 工具">
      <header className="rdp-tool-head">
        <span>
          <strong>{connection.name}</strong>
          <small>{formatConnectionAddress(connection)}</small>
        </span>
        <span className={`rdp-session-badge ${session.status}`}>{vncStatusLabel(session.status)}</span>
      </header>

      <div className="rdp-tool-actions">
        <button type="button" onClick={() => onPreview(session)}>
          <FileText className="ui-icon" aria-hidden="true" />
          预览
        </button>
        <button type="button" disabled={!hasCommand} onClick={() => onCopyCommand(session)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制命令
        </button>
        <button type="button" onClick={() => onRetry(session)}>
          <RefreshCw className="ui-icon" aria-hidden="true" />
          重试
        </button>
      </div>

      <dl className="rdp-tool-facts">
        <div>
          <dt>Runner</dt>
          <dd>{formatVncRunnerKind(runner)}</dd>
        </div>
        <div>
          <dt>模式</dt>
          <dd>{vncRenderModeLabel(connection.vnc?.runner.render_mode || "embedded")}</dd>
        </div>
        <div>
          <dt>显示</dt>
          <dd>{vncDisplaySummary(display)}</dd>
        </div>
        <div>
          <dt>输入</dt>
          <dd>{vncInputSummary(input)}</dd>
        </div>
      </dl>

      {session.error ? (
        <pre className="rdp-tool-error">{session.error}</pre>
      ) : null}

      {session.preview || session.result ? (
        <section className="rdp-tool-preview">
          <strong>启动材料</strong>
          <code>{vncSessionCommandText(session) || "noVNC 模式不需要外部命令。"}</code>
          {session.preview?.setup_hint || session.result?.setup_hint ? (
            <small>{session.preview?.setup_hint || session.result?.setup_hint}</small>
          ) : null}
          {session.preview?.fallback_reason || session.result?.fallback_reason ? (
            <small>{session.preview?.fallback_reason || session.result?.fallback_reason}</small>
          ) : null}
        </section>
      ) : (
        <p className="rdp-tool-note">启动后可在这里查看 bridge、runner 和脱敏命令预览。</p>
      )}
    </section>
  );
}

function LocalTerminalEmptyPanel({
  active,
  error,
  loading,
  profileName,
  onOpenDefault,
  onOpenSettings,
}: {
  active: boolean;
  error: string | null;
  loading: boolean;
  profileName: string | null;
  onOpenDefault: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <section
      className={`terminal-direct-status local-terminal-empty ${active ? "" : "is-hidden"}`}
      aria-label="本地终端空状态"
      aria-hidden={!active}
    >
      <div>
        {loading ? (
          <Loader2 className="ui-icon spin" aria-hidden="true" />
        ) : error ? (
          <CircleAlert className="ui-icon" aria-hidden="true" />
        ) : (
          <LocalTerminalIcon className="ui-icon" kind={profileName ? "powershell_core" : "custom"} />
        )}
        <strong>{loading ? "探测本地终端中" : "打开本地终端"}</strong>
        <span>
          {error
            ? error
            : profileName
              ? `默认会打开 ${profileName}，也可以在上方下拉中切换其他类型。`
              : "还没有可用的本地终端类型，请先检查设置或补充自定义 profile。"}
        </span>
        <div className="local-terminal-status-actions">
          <button className="primary-button" type="button" disabled={!profileName || loading} onClick={onOpenDefault}>
            <Play className="ui-icon" aria-hidden="true" />
            打开默认终端
          </button>
          <button type="button" onClick={onOpenSettings}>
            打开设置
          </button>
        </div>
      </div>
    </section>
  );
}

function LocalTerminalStatusPanel({
  active,
  error,
  profile,
  source,
  status,
  title,
  onOpenSettings,
  onRetry,
}: {
  active: boolean;
  error: string | null;
  profile: LocalTerminalProfile | null;
  source: "local" | "telnet" | "serial";
  status: string;
  title: string;
  onOpenSettings: () => void;
  onRetry?: () => void;
}) {
  const failed = status === "连接失败";
  const subject = source === "telnet" ? "Telnet 会话" : source === "serial" ? "串口会话" : "本地终端";
  const description = profile ? `${profile.name} · ${profile.command}` : title;

  return (
    <section
      className={`terminal-direct-status local-terminal-status ${failed ? "is-error" : "is-loading"} ${
        active ? "" : "is-hidden"
      }`}
      aria-label={`${title} 状态`}
      aria-hidden={!active}
    >
      <div>
        {failed ? (
          <CircleAlert className="ui-icon" aria-hidden="true" />
        ) : (
          <Loader2 className="ui-icon spin" aria-hidden="true" />
        )}
        <strong>{failed ? `${subject}打开失败` : status}</strong>
        <span>{description}</span>
        {error ? <small>{error}</small> : null}
        {failed && source === "local" && onRetry ? (
          <div className="local-terminal-status-actions">
            <button className="primary-button" type="button" onClick={onRetry}>
              <RefreshCw className="ui-icon" aria-hidden="true" />
              重试
            </button>
            <button type="button" onClick={onOpenSettings}>
              打开设置
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LocalTerminalLauncher({
  disabled,
  loading,
  profiles,
  onOpenProfile,
}: {
  disabled: boolean;
  loading: boolean;
  profiles: LocalTerminalProfile[];
  onOpenProfile: (profile: LocalTerminalProfile) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const menuDisabled = disabled || loading;

  function chooseProfile(profile: LocalTerminalProfile) {
    setOpen(false);
    onOpenProfile(profile);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="local-terminal-launcher">
      <Tooltip label={loading ? "正在探测终端类型" : "选择终端类型"}>
        <button
          ref={triggerRef}
          className="add-subtab local-terminal-launch-button"
          type="button"
          aria-label={loading ? "正在探测终端类型" : "选择终端类型"}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={menuDisabled}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <ChevronDown className="ui-icon" aria-hidden="true" />
        </button>
      </Tooltip>
      <AnchoredSurfacePortal
        anchorRef={triggerRef}
        ariaLabel="选择终端类型"
        className="local-terminal-profile-menu dropdown-menu-content"
        desiredHeight={420}
        minHeight={180}
        open={open}
        role="menu"
        width={320}
        onOpenChange={setOpen}
      >
        {profiles.map((profile, index) => (
          <button
            className="local-terminal-profile-menu-item dropdown-menu-item"
            key={profile.id}
            type="button"
            role="menuitem"
            onClick={() => chooseProfile(profile)}
          >
            <span className="local-terminal-menu-label">
              <LocalTerminalIcon className="ui-icon" kind={profile.kind} title={profile.name} />
              <span>{profile.name}</span>
            </span>
            {index < 9 ? (
              <span className="local-terminal-menu-shortcut">
                Ctrl+Shift+{(index + 1).toString()}
              </span>
            ) : null}
          </button>
        ))}
      </AnchoredSurfacePortal>
    </div>
  );
}

function DirectTerminalStatusPanel({
  active,
  connection,
  error,
  status,
  title,
}: {
  active: boolean;
  connection: ConnectionProfile | null;
  error: string | null;
  status: string;
  title: string;
}) {
  const failed = status === "连接失败";

  return (
    <section
      className={`terminal-direct-status ${failed ? "is-error" : "is-loading"} ${
        active ? "" : "is-hidden"
      }`}
      aria-label={`${title} 状态`}
      aria-hidden={!active}
    >
      <div>
        {failed ? (
          <CircleAlert className="ui-icon" aria-hidden="true" />
        ) : (
          <Loader2 className="ui-icon spin" aria-hidden="true" />
        )}
        <strong>{failed ? "连接失败" : "正在添加终端"}</strong>
        <span>
          {connection
            ? `${connection.username}@${connection.host}:${connection.port.toString()}`
            : "当前连接"}
        </span>
        {error ? <small>{error}</small> : null}
      </div>
    </section>
  );
}

function ConnectionStepPanel({
  active,
  step,
  onCancel,
  onEdit,
  onPromptAuthKindChange,
  onPromptPasswordChange,
  onPromptPrivateKeyPathChange,
  onPromptPrivateKeyPassphraseChange,
  onRetry,
  onSubmitPrompt,
  onTrustHostKey,
}: {
  active: boolean;
  step: ConnectionStepState;
  onCancel: () => void;
  onEdit: (connection: ConnectionProfile) => void;
  onPromptAuthKindChange: (authKind: ConnectionAuthKind) => void;
  onPromptPasswordChange: (password: string) => void;
  onPromptPrivateKeyPathChange: (path: string) => void;
  onPromptPrivateKeyPassphraseChange: (passphrase: string) => void;
  onRetry: () => void;
  onSubmitPrompt: (event: FormEvent<HTMLFormElement>) => void;
  onTrustHostKey: () => void;
}) {
  const hostKeyChanged = step.hostKeyDecision === "changed";
  const activeStepIndex = currentConnectionStepIndex(step);
  const closeLabel = step.status === "running" ? "取消" : "关闭";
  const progressPercent = Math.max(8, Math.min(100, ((activeStepIndex + 1) / 5) * 100));
  const showStepDetail = step.status !== "idle" && step.status !== "running";
  const stepItems = [
    {
      description: "加载连接参数和认证材料",
      label: "读取配置",
    },
    {
      description: `TCP 握手 ${step.connection.host}:${step.connection.port.toString()}`,
      label: "网络连接",
    },
    {
      description: "校验服务器指纹和 known_hosts",
      label: "主机密钥验证",
    },
    {
      description: connectionStepAuthDescription(step),
      label: "用户认证",
    },
    {
      description:
        step.mode === "terminal" ? "启动交互式 Shell 会话" : "完成连接测试流程",
      label: step.mode === "terminal" ? "打开终端" : "完成测试",
    },
  ];

  return (
    <section
      className={`connection-step-page ${active ? "" : "is-hidden"}`}
      data-step-status={step.status}
      aria-label="连接步骤"
      aria-hidden={!active}
    >
      <div className="connection-step-body">
        <section className="connection-step-shell">
          <div className="connection-step-actions">
            {step.status === "success" ? (
              <button
                type="button"
                aria-label="编辑连接"
                onClick={() => onEdit(step.connection)}
              >
                <Pencil className="ui-icon" aria-hidden="true" />
                <span>编辑</span>
              </button>
            ) : null}
            <button type="button" aria-label={closeLabel} onClick={onCancel}>
              <X className="ui-icon" aria-hidden="true" />
              <span>{closeLabel}</span>
            </button>
          </div>

          <header className="connection-step-hero">
            <div className={`connection-step-orb ${step.status}`} aria-hidden="true">
              {step.status === "error" ? (
                <AlertTriangle className="ui-icon" />
              ) : step.status === "success" ? (
                <CheckCircle2 className="ui-icon" />
              ) : (
                <List className="ui-icon" />
              )}
            </div>
            <h2>{step.connection.name}</h2>
            <p>{formatConnectionAddress(step.connection)}</p>
            <span className={`connection-step-state ${step.status}`} aria-live="polite">
              {connectionStepStatusTitle(step)}
            </span>
          </header>

          <ol className="connection-step-list" aria-label="连接阶段">
            {stepItems.map((item, index) => {
              const state = connectionStepItemState(step, index, activeStepIndex);
              return (
                <li className={state} key={item.label}>
                  <span className="connection-step-marker">
                    {state === "active" && step.status === "running" ? (
                      <Loader2 className="ui-icon spin" aria-hidden="true" />
                    ) : state === "done" ? (
                      <CheckCircle2 className="ui-icon" aria-hidden="true" />
                    ) : state === "error" ? (
                      <AlertTriangle className="ui-icon" aria-hidden="true" />
                    ) : (
                      <i aria-hidden="true">{(index + 1).toString()}</i>
                    )}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <em>{connectionStepItemLabel(state, step.status)}</em>
                </li>
              );
            })}
          </ol>

          <div
            className="connection-step-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            style={
              {
                "--connection-step-progress": `${progressPercent.toString()}%`,
              } as CSSProperties
            }
          >
            <span />
          </div>

          {showStepDetail ? (
            <section
              className={`connection-step-detail ${step.status === "error" ? "is-error" : ""}`}
            >
              {step.status !== "error" ? (
                <div className="connection-step-detail-head">
                  <span>
                    <strong>{connectionStepPanelTitle(step)}</strong>
                    <small>{connectionStepPanelDescription(step)}</small>
                  </span>
                </div>
              ) : null}

              {step.status === "prompt" ? (
                <form className="connection-prompt-form" onSubmit={onSubmitPrompt}>
                  <header>
                    <KeyRound className="ui-icon" aria-hidden="true" />
                    <span>
                      <strong>输入本次凭据</strong>
                      <small>这部分不会保存到连接配置。</small>
                    </span>
                  </header>
                  <label>
                    <span>认证方式</span>
                    <AppSelect
                      ariaLabel="认证方式"
                      value={step.authKind}
                      options={connectionPromptAuthKindOptions}
                      onChange={onPromptAuthKindChange}
                    />
                  </label>
                  {step.authKind === "password" ? (
                    <label>
                      <span>密码</span>
                      <input
                        type="password"
                        value={step.password}
                        onChange={(event) => onPromptPasswordChange(event.currentTarget.value)}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        <span>私钥路径</span>
                        <input
                          value={step.privateKeyPath}
                          placeholder="~/.ssh/id_ed25519"
                          onChange={(event) =>
                            onPromptPrivateKeyPathChange(event.currentTarget.value)
                          }
                        />
                      </label>
                      <label>
                        <span>私钥口令</span>
                        <input
                          type="password"
                          value={step.privateKeyPassphrase}
                          onChange={(event) =>
                            onPromptPrivateKeyPassphraseChange(event.currentTarget.value)
                          }
                        />
                      </label>
                    </>
                  )}
                  <button className="primary-button" type="submit">
                    继续连接
                  </button>
                </form>
              ) : null}

              {step.status === "waiting_host_key" && step.hostKey ? (
                <div className="host-key-confirm">
                  <header>
                    <LockKeyhole className="ui-icon" aria-hidden="true" />
                    <span>
                      <strong>确认主机密钥</strong>
                      <small>
                        {hostKeyChanged ? "主机密钥已变化" : step.hostKey.key_algorithm}
                      </small>
                    </span>
                  </header>
                  {hostKeyChanged && step.oldHostKeyFingerprint ? (
                    <code>旧指纹：{step.oldHostKeyFingerprint}</code>
                  ) : null}
                  <code>{step.hostKey.fingerprint_sha256}</code>
                  {step.error ? <p className="form-error">{step.error}</p> : null}
                  <button className="primary-button" type="button" onClick={onTrustHostKey}>
                    {hostKeyChanged ? "更新信任并继续" : "信任并继续"}
                  </button>
                </div>
              ) : null}

              {step.status === "success" && step.mode === "test" ? (
                <div className="connection-step-success">
                  <CheckCircle2 className="ui-icon" aria-hidden="true" />
                  <span>连接测试通过。</span>
                </div>
              ) : null}

              {step.status === "error" ? (
                <div className="connection-step-error" role="alert">
                  <header>
                    <AlertTriangle className="ui-icon" aria-hidden="true" />
                    <strong>
                      {step.errorDetail?.rawMessage || step.errorDetail?.message || step.error || "连接失败"}
                    </strong>
                  </header>
                  {step.errorDetail?.suggestion ? (
                    <p className="connection-step-error-tip">{step.errorDetail.suggestion}</p>
                  ) : null}
                  <div className="connection-step-error-actions">
                    <button
                      className="connection-step-retry-button"
                      type="button"
                      onClick={onRetry}
                    >
                      <RefreshCw className="ui-icon" aria-hidden="true" />
                      <span>重试</span>
                    </button>
                    <button
                      className="connection-step-secondary-button"
                      type="button"
                      onClick={() => onEdit(step.connection)}
                    >
                      <Pencil className="ui-icon" aria-hidden="true" />
                      <span>编辑连接</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <details className="connection-step-log">
            <summary>
              <span>
                <ChevronLeft className="ui-icon" aria-hidden="true" />
                连接日志
              </span>
              <small>{step.logs.length.toString()} 条</small>
            </summary>
            <div aria-label="连接日志">
              <div>
                {step.logs.map((line, index) => (
                  <code key={`${line}-${index.toString()}`}>{line}</code>
                ))}
              </div>
            </div>
          </details>
        </section>
      </div>
    </section>
  );
}

function currentConnectionStepIndex(step: ConnectionStepState) {
  if (step.status === "success") {
    return 4;
  }
  if (step.status === "waiting_host_key") {
    return 2;
  }
  if (step.status === "prompt") {
    return 3;
  }
  if (step.status === "error") {
    return connectionStepErrorIndex(step.errorDetail?.code || "");
  }
  if (step.status === "running" && typeof step.activeStepIndex === "number") {
    return clampConnectionStepIndex(step.activeStepIndex);
  }
  return Math.min(Math.max(step.logs.length - 1, 1), 4);
}

function clampConnectionStepIndex(index: number) {
  return Math.min(Math.max(Math.round(index), 0), 4);
}

function resetConnectionStepForRetry(step: ConnectionStepState): ConnectionStepState {
  return {
    ...step,
    activeStepIndex: 1,
    error: null,
    errorDetail: null,
    hostKey: null,
    hostKeyDecision: null,
    logs: step.logs[0] ? [step.logs[0]] : [],
    oldHostKeyFingerprint: null,
    sessionId: null,
    status: "idle",
  };
}

function connectionStepErrorIndex(code: string) {
  if (
    code === "terminal_tcp_connect_failed" ||
    code === "terminal_connect_failed" ||
    code === "terminal_connect_timeout" ||
    code.startsWith("proxy_")
  ) {
    return 1;
  }
  if (code === "host_key_unknown" || code === "host_key_changed") {
    return 2;
  }
  if (
    code === "terminal_auth_failed" ||
    code === "terminal_auth_rejected" ||
    code === "terminal_auth_timeout" ||
    code === "terminal_auth_missing" ||
    code === "terminal_private_key_invalid" ||
    code.startsWith("credential_") ||
    code.startsWith("connection_credential_")
  ) {
    return 3;
  }
  if (
    code === "terminal_channel_open_failed" ||
    code === "terminal_pty_failed" ||
    code === "terminal_shell_failed"
  ) {
    return 4;
  }
  return 1;
}

type ConnectionStepItemState = "active" | "done" | "error" | "pending";

function connectionStepItemState(
  step: ConnectionStepState,
  index: number,
  activeStepIndex: number,
): ConnectionStepItemState {
  if (step.status === "success" || index < activeStepIndex) {
    return "done";
  }
  if (step.status === "error" && index === activeStepIndex) {
    return "error";
  }
  if (index === activeStepIndex) {
    return "active";
  }
  return "pending";
}

function connectionStepAuthDescription(step: ConnectionStepState) {
  const authKind =
    step.connection.credential_mode === "prompt"
      ? step.authKind
      : step.connection.inline_auth_kind || step.connection.auth_kind || step.authKind;

  if (step.connection.credential_mode === "prompt") {
    return authKind === "private_key" ? "使用本次输入的 SSH 密钥" : "使用本次输入的 SSH 密码";
  }

  return authKind === "private_key" ? "使用 SSH 密钥认证" : "使用密码认证";
}

function connectionStepItemLabel(
  state: ConnectionStepItemState,
  status: ConnectionStepStatus,
) {
  if (state === "done") {
    return "完成";
  }
  if (state === "error") {
    return "失败";
  }
  if (state === "active") {
    if (status === "prompt") {
      return "等待输入";
    }
    if (status === "waiting_host_key") {
      return "待确认";
    }
    if (status === "idle") {
      return "准备中";
    }
    return "进行中";
  }
  return "待处理";
}

function connectionStepStatusTitle(step: ConnectionStepState) {
  if (step.status === "success") {
    return "测试通过";
  }
  if (step.status === "error") {
    return "连接失败";
  }
  if (step.status === "waiting_host_key") {
    return "等待确认";
  }
  if (step.status === "prompt") {
    return "需要凭据";
  }
  return "正在检查";
}

function connectionStepPanelTitle(step: ConnectionStepState) {
  if (step.status === "success") {
    return "连接检查完成";
  }
  if (step.status === "error") {
    return "连接未完成";
  }
  if (step.status === "waiting_host_key") {
    return "主机密钥确认";
  }
  if (step.status === "prompt") {
    return "补充认证信息";
  }
  return "执行连接检查";
}

function connectionStepPanelDescription(step: ConnectionStepState) {
  if (step.status === "success") {
    return "本次测试没有创建终端会话。";
  }
  if (step.status === "error") {
    return "错误保留在当前页面，不会写入终端。";
  }
  if (step.status === "waiting_host_key") {
    return "首次连接或指纹变化时需要显式信任。";
  }
  if (step.status === "prompt") {
    return "临时凭据只用于这一次连接。";
  }
  return "连接步骤会在这里实时更新。";
}

function RemoteFilePropertiesTable({ metadata }: { metadata: RemoteFileEntryMetadata }) {
  return (
    <dl className="remote-file-properties">
      <div>
        <dt>名称</dt>
        <dd>{metadata.name}</dd>
      </div>
      <div>
        <dt>类型</dt>
        <dd>{remoteKindLabel(metadata.type)}</dd>
      </div>
      <div>
        <dt>大小</dt>
        <dd>{formatFileSize(metadata.size)}</dd>
      </div>
      <div>
        <dt>权限</dt>
        <dd>{metadata.mode || "未知"}</dd>
      </div>
      <div>
        <dt>修改时间</dt>
        <dd>{formatRemoteMtime(metadata.mtime)}</dd>
      </div>
      <div>
        <dt>绝对路径</dt>
        <dd title={metadata.path}>{metadata.path}</dd>
      </div>
    </dl>
  );
}

function ConnectionHome({
  connections,
  error,
  groups,
  hidden = false,
  loading,
  onConnect,
  onCreateConnection,
  onDelete,
  onEdit,
  onPreloadCreateConnection,
  onRefresh,
}: {
  connections: ConnectionProfile[];
  error: string | null;
  groups: ConnectionGroupCatalog;
  hidden?: boolean;
  loading: boolean;
  onConnect: (connection: ConnectionProfile) => void;
  onCreateConnection: () => void;
  onDelete: (connection: ConnectionProfile) => void | Promise<void>;
  onEdit: (connection: ConnectionProfile) => void;
  onPreloadCreateConnection?: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState<ConnectionFilter>("recent");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConnectionProfile | null>(null);
  const [latencyByConnectionId, setLatencyByConnectionId] = useState<Record<string, LatencyProbeState>>({});
  const latencyProbeRunRef = useRef(0);
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...connections].sort(sortConnectionsByRecent);
    const filteredByTab = sorted.filter((connection) => {
      if (filter === "all") {
        return true;
      }

      if (filter === "favorites") {
        return connection.is_favorite;
      }

      return connectionTimestampOf(connection.last_connected_at) > 0;
    });

    return filteredByTab.filter((connection) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        connection.name,
        connection.host,
        connection.username,
        connection.notes || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [connections, filter, query]);
  const favoriteCount = useMemo(
    () => connections.filter((connection) => connection.is_favorite).length,
    [connections],
  );
  const weekCount = useMemo(() => countConnectedWithinWeek(connections), [connections]);
  const activityConnections = useMemo(
    () =>
      [...connections]
        .filter((connection) => connectionTimestampOf(connection.last_connected_at) > 0)
        .sort(sortConnectionsByRecent)
        .slice(0, 2),
    [connections],
  );
  const isProbingLatency = useMemo(
    () => Object.values(latencyByConnectionId).some((state) => state.status === "checking"),
    [latencyByConnectionId],
  );
  const probeLatencies = useCallback((targets: ConnectionProfile[]) => {
    const uniqueTargets = targets.filter(
      (connection, index, items) =>
        items.findIndex((item) => item.id === connection.id) === index,
    );
    if (uniqueTargets.length === 0) {
      return;
    }

    const runId = latencyProbeRunRef.current;
    setLatencyByConnectionId((states) => {
      const nextStates = { ...states };
      uniqueTargets.forEach((connection) => {
        nextStates[connection.id] = { status: "checking" };
      });
      return nextStates;
    });

    uniqueTargets.forEach((connection) => {
      void measureConnectionLatency(connection).then((nextState) => {
        if (latencyProbeRunRef.current !== runId) {
          return;
        }

        setLatencyByConnectionId((states) => ({
          ...states,
          [connection.id]: nextState,
        }));
      });
    });
  }, []);

  useEffect(() => {
    if (hidden || loading || rows.length === 0) {
      return;
    }

    const pendingConnections = rows.filter((connection) => !latencyByConnectionId[connection.id]);
    if (pendingConnections.length > 0) {
      probeLatencies(pendingConnections);
    }
  }, [hidden, latencyByConnectionId, loading, probeLatencies, rows]);

  return (
    <section className={`connection-home ${hidden ? "is-hidden" : ""}`} aria-label="连接首页" aria-hidden={hidden}>
      <header className="repository-toolbar">
        <div className="toolbar-left">
          <div className="filter-tabs" aria-label="连接筛选">
            <button
              className={`filter-tab ${filter === "recent" ? "active" : ""}`}
              type="button"
              onClick={() => setFilter("recent")}
            >
              <Clock3 className="ui-icon" aria-hidden="true" />
              <span>最近</span>
            </button>
            <button
              className={`filter-tab ${filter === "all" ? "active" : ""}`}
              type="button"
              onClick={() => setFilter("all")}
            >
              <List className="ui-icon" aria-hidden="true" />
              <span>全部</span>
            </button>
            <button
              className={`filter-tab ${filter === "favorites" ? "active" : ""}`}
              type="button"
              onClick={() => setFilter("favorites")}
            >
              <Star className="ui-icon" aria-hidden="true" />
              <span>收藏</span>
            </button>
          </div>
          <label className="repository-search">
            <Search className="ui-icon" aria-hidden="true" />
            <input
              aria-label="搜索连接"
              placeholder="搜索名称、地址、备注"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="toolbar-right">
          <Tooltip label="刷新连接并探测延迟">
            <button
              className="repository-icon-button"
              type="button"
              aria-label="刷新连接并探测延迟"
              disabled={loading}
              onClick={() => void refreshConnectionsAndLatency()}
            >
              <RefreshCw className={`ui-icon ${loading || isProbingLatency ? "spin" : ""}`} aria-hidden="true" />
            </button>
          </Tooltip>
          <button
            className="repository-primary-button"
            type="button"
            onFocus={onPreloadCreateConnection}
            onClick={onCreateConnection}
            onPointerDown={onPreloadCreateConnection}
            onPointerEnter={onPreloadCreateConnection}
          >
            <Plus className="ui-icon" aria-hidden="true" />
            <span>新建连接</span>
          </button>
        </div>
      </header>

      <div className="connection-home-body">
        <section className="connection-board" aria-label="连接表格">
          <div className="connection-head" role="row">
            <span>系统</span>
            <span>最后连接</span>
            <span>延迟</span>
            <span>名称</span>
            <span>备注</span>
            <span className="action-head">操作</span>
          </div>
          <div className="connection-board-body">
            {loading ? <p className="connection-board-note">加载连接中...</p> : null}
            {error ? <p className="connection-board-error">{error}</p> : null}
            {!loading && rows.length === 0 ? (
              <p className="connection-board-note">暂无匹配连接</p>
            ) : null}

            {rows.map((connection) => {
              const latencyState = latencyByConnectionId[connection.id];
              const lastConnectedAt = connection.last_connected_at;
              const hasLastConnectedAt = Boolean(lastConnectedAt);

              return (
                <div className="connection-row" role="row" key={connection.id}>
                  <span className="system-cell">
                    <ConnectionSystemLogo connection={connection} />
                  </span>
                  <span className="last-cell">
                    <strong>{hasLastConnectedAt ? formatRelativeTime(lastConnectedAt) : "未连接"}</strong>
                    <span>
                      {lastConnectedAt === "demo"
                        ? "最近使用"
                        : hasLastConnectedAt
                          ? "最近连接"
                          : "等待首次连接"}
                    </span>
                  </span>
                  <span className="latency-cell">
                    <LatencyIndicator state={latencyState} />
                  </span>
                  <span className="name-cell">
                    <button
                      className="connection-name-link"
                      type="button"
                      aria-label={`打开连接 ${connection.name}`}
                      title={`打开连接 ${connection.name}`}
                      onClick={() => onConnect(connection)}
                    >
                      <span className="connection-name">{connection.name}</span>
                      <span className="connection-user">{connection.username}@{connection.host}:{connection.port.toString()}</span>
                    </button>
                  </span>
                  <span className="remark-cell">
                    <span className="remark-main">{primaryNote(connection)}</span>
                  </span>
                  <span className="action-cell">
                    <button
                      className="connection-action-icon connect"
                      type="button"
                      aria-label={`连接 ${connection.name}`}
                      title="连接"
                      onClick={() => onConnect(connection)}
                    >
                      <Play className="ui-icon" aria-hidden="true" />
                    </button>
                    <button
                      className="connection-action-icon"
                      type="button"
                      aria-label={`编辑 ${connection.name}`}
                      title="编辑"
                      onClick={() => onEdit(connection)}
                    >
                      <Pencil className="ui-icon" aria-hidden="true" />
                    </button>
                    <button
                      className="connection-action-icon"
                      type="button"
                      aria-label={`删除 ${connection.name}`}
                      title="删除"
                      onClick={() => setDeleteTarget(connection)}
                    >
                      <Trash2 className="ui-icon" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="side-summary" aria-label="连接概览和仓库维护">
          <section className="summary-block">
            <p className="summary-title">仓库概览</p>
            <div className="summary-grid">
              <div className="summary-item">
                <strong>{connections.length.toString()}</strong>
                <span>连接</span>
              </div>
              <div className="summary-item">
                <strong>{groups.groups.length.toString()}</strong>
                <span>分组</span>
              </div>
              <div className="summary-item">
                <strong>{favoriteCount.toString()}</strong>
                <span>收藏</span>
              </div>
              <div className="summary-item">
                <strong>{weekCount.toString()}</strong>
                <span>本周连接</span>
              </div>
            </div>
          </section>

          <section className="summary-block">
            <p className="summary-title">仓库维护</p>
            <div className="quick-links">
              <button className="quick-link" type="button" onClick={onRefresh}>
                <Upload className="ui-icon" aria-hidden="true" />
                <span>
                  <strong>导入连接</strong>
                  <small>批量迁移时使用</small>
                </span>
              </button>
            </div>
          </section>

          <section className="summary-block">
            <p className="summary-title">最近活动</p>
            <div className="activity-list">
              {activityConnections.length > 0 ? (
                activityConnections.map((connection) => (
                  <button
                    className="activity-row"
                    key={connection.id}
                    type="button"
                    onClick={() => onConnect(connection)}
                  >
                    <span className="latency-dot" />
                    <span>
                      <strong>{connection.name}</strong>
                      <span>{formatRelativeTime(connection.last_connected_at)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="connection-board-note">暂无最近活动</p>
              )}
            </div>
          </section>
        </aside>
      </div>
      <ConfirmDialog
        confirmLabel="删除"
        description={
          deleteTarget ? `确认删除连接“${deleteTarget.name}”吗？这个操作无法撤销。` : ""
        }
        open={Boolean(deleteTarget)}
        title="删除连接"
        onConfirm={async () => {
          if (deleteTarget) {
            await onDelete(deleteTarget);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </section>
  );

  async function refreshConnectionsAndLatency() {
    latencyProbeRunRef.current += 1;
    setLatencyByConnectionId({});
    await onRefresh();
  }
}

function LatencyIndicator({ state }: { state?: LatencyProbeState }) {
  if (!state) {
    return (
      <>
        <span className="latency-dot idle" />
        <span>未测</span>
      </>
    );
  }

  if (state.status === "checking") {
    return (
      <>
        <Loader2 className="ui-icon latency-spinner spin" aria-hidden="true" />
        <span>探测中</span>
      </>
    );
  }

  if (state.status === "failed") {
    return (
      <>
        <span className="latency-dot fail" />
        <span>超时</span>
      </>
    );
  }

  return (
    <>
      <span className={`latency-dot ${state.latencyMs > 60 ? "warn" : ""}`} />
      <span>{state.latencyMs.toString()} ms</span>
    </>
  );
}

async function measureConnectionLatency(connection: ConnectionProfile): Promise<LatencyProbeState> {
  if (!hasTauriRuntime() || connection.created_at === "demo" || connection.created_at === "preview") {
    await wait(120 + (latencySeed(connection) % 180));
    return { latencyMs: estimateLatency(connection), status: "ok" };
  }

  try {
    const result = await connectionProbeLatency(connection.id);
    if (result.reachable && typeof result.latency_ms === "number") {
      return { latencyMs: result.latency_ms, status: "ok" };
    }
  } catch {
    return { status: "failed" };
  }

  return { status: "failed" };
}

function primaryNote(connection: ConnectionProfile) {
  const note = connection.notes?.trim();
  if (!note) {
    return "";
  }

  return note.split(/[;；,，]/)[0]?.trim() || note;
}

function estimateLatency(connection: ConnectionProfile) {
  return 4 + (latencySeed(connection) % 66);
}

function latencySeed(connection: ConnectionProfile) {
  return Array.from(`${connection.host}:${connection.port.toString()}`).reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function vncRunnerWindowUrl() {
  const url = new URL(window.location.href);
  url.search = "view=vnc-runner";
  url.hash = "";
  return url.toString();
}

function waitForWebviewWindowCreation(
  windowRef: import("@tauri-apps/api/webviewWindow").WebviewWindow,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    void windowRef.once("tauri://created", () => {
      finish(resolve);
    });
    void windowRef.once("tauri://error", (event) => {
      finish(() => reject(event.payload));
    });
  });
}

function formatRelativeTime(value?: string | null) {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "demo" || normalized === "preview") {
    return "最近";
  }

  const timestamp = connectionTimestampOf(value);

  if (!timestamp) {
    return "最近";
  }

  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute).toString()} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour).toString()} 小时前`;
  if (diffMs < 2 * day) return "昨天";
  return `${Math.floor(diffMs / day).toString()} 天前`;
}

function countConnectedWithinWeek(connections: ConnectionProfile[]) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const dated = connections.filter((connection) => connectionTimestampOf(connection.last_connected_at) > 0);

  return dated.filter((connection) => now - connectionTimestampOf(connection.last_connected_at) <= week).length;
}

function getWorkspaceWidth(element: HTMLElement | null) {
  return Math.max(element?.getBoundingClientRect().width || window.innerWidth, 0);
}

function getElementHeight(element: HTMLElement | null) {
  return Math.max(element?.getBoundingClientRect().height || 0, 0);
}

function clampEditorTerminalSplitPercent(percent: number) {
  return Math.round(
    Math.min(
      maxEditorTerminalSplitPercent,
      Math.max(minEditorTerminalSplitPercent, percent),
    ),
  );
}

function clampPaneWidth(
  side: ResizablePaneSide,
  width: number,
  containerWidth: number,
  oppositeWidth: number,
) {
  const minimumWidth = side === "left" ? minLeftPaneWidth : minRightPaneWidth;
  const maximumPresetWidth = side === "left" ? maxLeftPaneWidth : maxRightPaneWidth;
  const maximumLayoutWidth = Math.max(
    minimumWidth,
    containerWidth - oppositeWidth - minCenterPaneWidth,
  );

  return Math.round(
    Math.min(maximumPresetWidth, maximumLayoutWidth, Math.max(minimumWidth, width)),
  );
}

function removeDirectoryState<T>(
  directories: Record<string, T>,
  tabIds: string[],
): Record<string, T> {
  if (tabIds.length === 0) {
    return directories;
  }

  const next = { ...directories };
  tabIds.forEach((tabId) => {
    delete next[tabId];
  });
  return next;
}

function nextTerminalIndexForConnection(tabs: TerminalTab[], connectionId: string) {
  return (
    Math.max(
      -1,
      ...tabs.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.index),
    ) + 1
  );
}

function terminalTabTitle(index: number) {
  return index === 0 ? "终端" : `终端 ${index.toString()}`;
}

function shortDockerRuntimeId(id: string) {
  return id.replace(/^sha256:/, "").slice(0, 12) || id;
}

function quotePosixShellForTerminal(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function formatDetailedError(error: unknown) {
  const message = formatError(error);
  const rawMessage =
    typeof error === "object" && error !== null && "raw_message" in error
      ? normalizeErrorText((error as { raw_message: unknown }).raw_message)
      : "";
  if (rawMessage && rawMessage !== normalizeErrorText(message)) {
    return `${message}\n${rawMessage}`;
  }
  return message;
}

function isTransferCanceledError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code) === "remote_file_transfer_canceled"
  );
}

function extractTransferErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  ) {
    return String((error as { code: unknown }).code);
  }
  return null;
}

function transferErrorStage(code: string): string | null {
  if (code === "remote_file_upload_confirm_timeout") {
    return "远程写入确认超时";
  }
  if (code === "remote_file_upload_confirm_failed") {
    return "远程写入确认失败";
  }
  if (
    code === "remote_sftp_subsystem_failed" ||
    code === "remote_sftp_subsystem_timeout"
  ) {
    return "SFTP 子系统不可用";
  }
  if (
    code === "remote_sftp_connect_failed" ||
    code === "remote_sftp_connect_timeout"
  ) {
    return "SFTP 连接失败";
  }
  if (
    code === "remote_sftp_channel_failed" ||
    code === "remote_sftp_init_failed" ||
    code === "remote_sftp_channel_timeout"
  ) {
    return "SFTP 通道建立失败";
  }
  if (code === "remote_sftp_auth_timeout") {
    return "SFTP 认证超时";
  }
  return null;
}

function transferErrorSuggestion(code: string): string | null {
  if (code === "remote_file_upload_confirm_timeout") {
    return "远端写入响应或关闭确认超时，临时 .mxpart 文件会保留用于重试。请检查网络、远端 SFTP 服务或目录负载后重试。";
  }
  if (code === "remote_file_upload_confirm_failed") {
    return "远端写入确认失败，临时 .mxpart 文件可能保留在目标目录；请检查目录权限、磁盘空间和远端文件系统状态。";
  }
  if (
    code === "remote_sftp_subsystem_failed" ||
    code === "remote_sftp_subsystem_timeout"
  ) {
    return "该服务器可能未启用 SFTP 子系统，请联系管理员检查 sshd_config 中的 'Subsystem sftp' 配置，或在设置中关闭相关压缩选项。";
  }
  if (
    code === "remote_sftp_connect_failed" ||
    code === "remote_sftp_connect_timeout"
  ) {
    return "SFTP 连接无法建立，请检查网络连通性、防火墙规则或代理设置。";
  }
  if (
    code === "remote_sftp_channel_failed" ||
    code === "remote_sftp_init_failed" ||
    code === "remote_sftp_channel_timeout"
  ) {
    return "SFTP 通道无法建立，服务器可能限制了 SFTP 会话数或子系统异常，请稍后重试或联系管理员。";
  }
  if (code === "remote_sftp_auth_timeout") {
    return "SFTP 认证超时，请确认凭据有效或检查网络延迟。";
  }
  return null;
}

function appendUniqueLogs(logs: string[], nextLines: string[]) {
  const next = [...logs];
  nextLines
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (next[next.length - 1] !== line) {
        next.push(line);
      }
    });
  return next;
}

function describeConnectionStepError(error: unknown): ConnectionStepErrorDetail {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown_error";
  const message = formatError(error);
  const rawMessage =
    typeof error === "object" && error !== null && "raw_message" in error
      ? normalizeErrorText((error as { raw_message: unknown }).raw_message)
      : normalizeErrorText(error);
  const recoverable =
    typeof error === "object" && error !== null && "recoverable" in error
      ? Boolean((error as { recoverable: unknown }).recoverable)
      : true;

  return {
    code,
    message: connectionErrorSummary(code, rawMessage, message),
    rawMessage: rawMessage || message,
    recoverable,
    stage: connectionErrorStage(code, rawMessage),
    suggestion: connectionErrorSuggestion(code, rawMessage),
  };
}

function normalizeErrorText(value: unknown) {
  return String(value ?? "")
    .replace(/^Error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function connectionErrorStage(code: string, rawMessage: string) {
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "网络连接超时";
  }
  if (
    code === "terminal_connect_failed" ||
    code === "terminal_tcp_connect_failed" ||
    code === "remote_exec_connect_failed" ||
    code.startsWith("proxy_") ||
    raw.includes("connection refused") ||
    raw.includes("actively refused") ||
    raw.includes("no route") ||
    raw.includes("unreachable") ||
    raw.includes("reset")
  ) {
    return "网络连接阶段";
  }
  if (code === "host_key_unknown" || code === "host_key_changed") {
    return "主机密钥阶段";
  }
  if (
    code === "terminal_auth_failed" ||
    code === "terminal_auth_rejected" ||
    code === "terminal_auth_timeout" ||
    code === "terminal_private_key_invalid" ||
    code.startsWith("credential_")
  ) {
    return "用户认证阶段";
  }
  if (
    code === "terminal_channel_open_failed" ||
    code === "terminal_pty_failed" ||
    code === "terminal_shell_failed"
  ) {
    return "远程终端初始化阶段";
  }
  return "连接阶段";
}

function connectionErrorSuggestion(code: string, rawMessage: string) {
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "检查主机 IP、端口、防火墙和网络连通性；确认目标 SSH 服务可以从本机访问。";
  }
  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return "目标主机可达但端口拒绝连接，确认 SSH 服务已启动、端口填写正确，或安全组允许访问。";
  }
  if (raw.includes("no route") || raw.includes("unreachable")) {
    return "本机到目标主机没有可用路由，检查 VPN、网段、网关或代理配置。";
  }
  if (raw.includes("reset")) {
    return "连接被对端重置，检查 SSH 服务策略、代理链路或中间防火墙。";
  }
  if (code.startsWith("proxy_")) {
    return "检查代理类型、代理地址端口以及代理用户名密码。";
  }
  if (code === "terminal_auth_rejected") {
    return "主机已响应但认证被拒绝，检查用户名、密码或私钥是否匹配。";
  }
  if (code === "terminal_private_key_invalid") {
    return "检查私钥路径、文件格式和私钥口令。";
  }
  if (code === "terminal_auth_failed" || code === "terminal_auth_timeout") {
    return "检查认证方式、用户名、密码或私钥；如果服务器禁用该方式，需要换用允许的认证方式。";
  }
  if (code === "host_key_changed") {
    return "确认目标主机是否重装或变更过；只有确认安全后再更新信任。";
  }
  if (code === "host_key_unknown") {
    return "核对主机指纹，确认无误后信任并继续连接。";
  }
  if (code === "terminal_pty_failed" || code === "terminal_shell_failed") {
    return "SSH 已登录但远程终端初始化失败，检查服务器是否允许分配 PTY 和启动默认 Shell。";
  }
  return "查看底层原因后重试；如果配置有误，点击编辑连接调整主机、端口、代理或认证信息。";
}

function connectionErrorSummary(code: string, rawMessage: string, fallback: string) {
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "连接超时";
  }
  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return "端口无法连接";
  }
  if (raw.includes("no route") || raw.includes("unreachable")) {
    return "主机不可达";
  }
  return fallback;
}

function isConnectionTimeoutError(code: string, raw: string) {
  return (
    code.includes("connect_timeout") ||
    code === "terminal_tcp_connect_timeout" ||
    raw.includes("timeout") ||
    raw.includes("timed out") ||
    raw.includes("operation timed out")
  );
}

function connectionToInput(connection: ConnectionProfile): ConnectionProfileInput {
  return {
    advanced: connection.advanced,
    credential_id: connection.credential_id || undefined,
    credential_mode: connection.credential_mode,
    group: connection.group || undefined,
    host: connection.host,
    id: connection.id,
    inline_auth_kind: connection.inline_auth_kind || undefined,
    inline_password: connection.inline_password || undefined,
    inline_private_key_passphrase: connection.inline_private_key_passphrase || undefined,
    inline_private_key_path: connection.inline_private_key_path || undefined,
    is_favorite: connection.is_favorite,
    jump: connection.jump || defaultJumpConfig,
    last_connected_at: connection.last_connected_at || undefined,
    name: connection.name,
    notes: connection.notes || undefined,
    port: connection.port,
    prompt_auth_kind: connection.prompt_auth_kind || undefined,
    protocol: connection.protocol || "ssh",
    proxy: connection.proxy,
    rdp: connection.rdp || undefined,
    vnc: connection.vnc || undefined,
    remote_os_id: connection.remote_os_id || undefined,
    remote_os_name: connection.remote_os_name || undefined,
    remote_os_version: connection.remote_os_version || undefined,
    username: connection.username,
  };
}

function runtimeCredentialRequest(step: ConnectionStepState): ConnectionRuntimeCredentialRequest {
  return {
    auth_kind: step.connection.credential_mode === "prompt" ? step.authKind : undefined,
    connection_id: step.connection.id,
    password: step.authKind === "password" ? step.password || undefined : undefined,
    private_key_passphrase:
      step.authKind === "private_key" ? step.privateKeyPassphrase || undefined : undefined,
    private_key_path: step.authKind === "private_key" ? step.privateKeyPath || undefined : undefined,
  };
}

function toWindowsPtyOption(
  info: WindowsPtyInfo | null,
  platform: string,
): IWindowsPty | undefined {
  if (platform !== "windows") {
    return undefined;
  }

  return {
    backend: info?.backend || "conpty",
    buildNumber:
      typeof info?.build_number === "number" ? info.build_number : undefined,
  };
}

function previewLocalTerminalProfiles(platform: string): LocalTerminalProfile[] {
  if (platform === "windows") {
    return [
      buildPreviewLocalTerminalProfile({
        args: ["-NoLogo", "-NoProfile"],
        command: "pwsh.exe",
        icon: "terminal-powershell",
        id: "pwsh",
        kind: "powershell_core",
        name: "PowerShell 7",
        platform,
      }),
      buildPreviewLocalTerminalProfile({
        args: ["-NoLogo", "-NoProfile"],
        command: "powershell.exe",
        icon: "terminal-powershell",
        id: "powershell",
        kind: "powershell",
        name: "Windows PowerShell",
        platform,
      }),
      buildPreviewLocalTerminalProfile({
        args: [],
        command: "cmd.exe",
        icon: "terminal-cmd",
        id: "cmd",
        kind: "cmd",
        name: "命令提示符",
        platform,
      }),
      buildPreviewLocalTerminalProfile({
        args: ["--login", "-i"],
        command: "bash.exe",
        icon: "terminal-git-bash",
        id: "git-bash",
        kind: "git_bash",
        name: "Git Bash",
        platform,
      }),
    ];
  }

  const unixPlatform = platform === "macos" ? "macos" : "linux";
  return [
    buildPreviewLocalTerminalProfile({
      args: [],
      command: "zsh",
      icon: "terminal-zsh",
      id: "zsh",
      kind: "zsh",
      name: "zsh",
      platform: unixPlatform,
    }),
    buildPreviewLocalTerminalProfile({
      args: [],
      command: "bash",
      icon: "terminal-bash",
      id: "bash",
      kind: "bash",
      name: "bash",
      platform: unixPlatform,
    }),
    buildPreviewLocalTerminalProfile({
      args: [],
      command: "pwsh",
      icon: "terminal-powershell",
      id: "pwsh",
      kind: "pwsh",
      name: "PowerShell 7",
      platform: unixPlatform,
    }),
  ];
}

function buildPreviewLocalTerminalProfile(
  input: Omit<LocalTerminalProfile, "cwd" | "detected" | "env" | "hidden" | "source">,
): LocalTerminalProfile {
  return {
    ...input,
    cwd: null,
    detected: true,
    env: {},
    hidden: false,
    source: "detected",
  };
}

function mergeLocalTerminalProfiles(
  detectedProfiles: LocalTerminalProfile[],
  customProfiles: LocalTerminalProfileInput[],
  hiddenProfileIds: string[],
) {
  const hiddenIdSet = new Set(hiddenProfileIds);
  const byId = new Map<string, LocalTerminalProfile>();

  detectedProfiles.forEach((profile) => {
    if (!hiddenIdSet.has(profile.id) && !profile.hidden) {
      byId.set(profile.id, profile);
    }
  });

  customProfiles.forEach((profile, index) => {
    const normalized = normalizeLocalTerminalProfileInput(profile, index);
    if (normalized && !normalized.hidden && !hiddenIdSet.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  });

  return Array.from(byId.values()).sort((left, right) =>
    localTerminalProfileSortKey(left).localeCompare(localTerminalProfileSortKey(right), "zh-Hans"),
  );
}

function normalizeLocalTerminalProfileInput(
  profile: LocalTerminalProfileInput,
  index = 0,
): LocalTerminalProfile | null {
  const id = (profile.id || "").trim() || `custom-${index.toString()}`;
  const name = profile.name.trim();
  const kind = profile.kind.trim();
  const command = profile.command.trim();
  if (!name || !kind || !command) {
    return null;
  }

  return {
    args: profile.args.filter((item) => item.trim().length > 0),
    command,
    cwd: profile.cwd?.trim() || null,
    detected: profile.detected,
    env: Object.fromEntries(
      Object.entries(profile.env).map(([key, value]) => [key.trim(), value.trim()]),
    ),
    hidden: profile.hidden,
    icon: profile.icon || `terminal-${kind}`,
    id,
    kind,
    name,
    platform: profile.platform || "all",
    source: profile.source || "custom",
  };
}

function localTerminalProfileSortKey(profile: LocalTerminalProfile) {
  return `${localTerminalProfileRank(profile.kind).toString().padStart(2, "0")}:${profile.name}:${profile.id}`;
}

function localTerminalProfileRank(kind: string) {
  switch (kind) {
    case "powershell_core":
    case "pwsh":
      return 0;
    case "powershell":
      return 1;
    case "cmd":
      return 2;
    case "wsl":
      return 3;
    case "git_bash":
      return 4;
    case "bash":
      return 5;
    case "zsh":
      return 6;
    case "fish":
      return 7;
    default:
      return 20;
  }
}

function toLocalTerminalProfileInput(profile: LocalTerminalProfile): LocalTerminalProfileInput {
  return {
    args: [...profile.args],
    command: profile.command,
    cwd: profile.cwd || null,
    detected: profile.detected,
    env: { ...profile.env },
    hidden: profile.hidden,
    icon: profile.icon,
    id: profile.id,
    kind: profile.kind,
    name: profile.name,
    platform: profile.platform,
    source: profile.source,
  };
}

function buildCommandSnippetDraft(
  command: string,
  group = commandSnippetRootGroup,
): CommandSnippetDraft {
  const normalizedCommand = command.trim();
  return {
    command: normalizedCommand,
    description: "",
    favorite: false,
    group: normalizeCommandSnippetGroupValue(group),
    tagsText: "",
    title: commandSnippetTitleFromCommand(normalizedCommand),
  };
}

function commandSnippetToDraft(snippet: CommandSnippet): CommandSnippetDraft {
  return {
    command: snippet.command,
    description: snippet.description || "",
    favorite: snippet.favorite,
    group: normalizeCommandSnippetGroupValue(snippet.group),
    id: snippet.id,
    tagsText: snippet.tags.join(", "),
    title: snippet.title,
  };
}

function commandSnippetToInput(snippet: CommandSnippet, group: string) {
  return {
    command: snippet.command,
    description: snippet.description || null,
    favorite: snippet.favorite,
    group: normalizeCommandSnippetGroupValue(group) || null,
    id: snippet.id,
    tags: snippet.tags,
    title: snippet.title,
  };
}

function normalizeCommandSnippetGroupValue(group?: string | null) {
  const normalizedGroup = group?.trim() || commandSnippetRootGroup;
  return normalizedGroup === legacyCommandSnippetGroup ? commandSnippetRootGroup : normalizedGroup;
}

function buildCommandSnippetGroupCatalog(
  snippets: CommandSnippet[],
  localGroups: string[],
) {
  const groups = new Set<string>();
  snippets.forEach((snippet) => {
    const group = normalizeCommandSnippetGroupValue(snippet.group);
    if (group) {
      groups.add(group);
    }
  });
  localGroups.forEach((groupName) => {
    const group = normalizeCommandSnippetGroupValue(groupName);
    if (group) {
      groups.add(group);
    }
  });
  return Array.from(groups).sort((left, right) => left.localeCompare(right, "zh-Hans"));
}

function appendCommandSnippetLocalGroup(groups: string[], groupName: string) {
  const normalizedGroup = normalizeCommandSnippetGroupValue(groupName);
  if (!normalizedGroup || groups.includes(normalizedGroup)) {
    return groups;
  }
  return [...groups, normalizedGroup].sort((left, right) => left.localeCompare(right, "zh-Hans"));
}

function commandSnippetTitleFromCommand(command: string) {
  const firstLine = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? truncateCommandLabel(firstLine, 32) : "";
}

function parseCommandSnippetTags(value: string) {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function truncateCommandLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function upsertCommandSnippet(
  snippets: CommandSnippet[],
  snippet: CommandSnippet,
): CommandSnippet[] {
  return [
    snippet,
    ...snippets.filter((item) => item.id !== snippet.id),
  ].sort(compareCommandSnippets);
}

function compareCommandSnippets(left: CommandSnippet, right: CommandSnippet) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }
  return (
    compareCommandLibraryTimestampsDesc(left.last_used_at, right.last_used_at) ||
    compareCommandLibraryTimestampsDesc(left.updated_at, right.updated_at) ||
    left.title.localeCompare(right.title, "zh-Hans")
  );
}

function commandLibraryRestartMessage() {
  return "刚更新命令片段功能后需要重启应用，重启后这里会加载片段和历史命令。";
}

function isCommandLibraryCommandMissingError(error: unknown) {
  return (
    isTauriCommandMissingError(error, "command_snippet_list") ||
    isTauriCommandMissingError(error, "command_history_list") ||
    isTauriCommandMissingError(error, "command_snippet_upsert") ||
    isTauriCommandMissingError(error, "command_snippet_delete") ||
    isTauriCommandMissingError(error, "command_snippet_mark_used") ||
    isTauriCommandMissingError(error, "command_history_record") ||
    isTauriCommandMissingError(error, "command_history_delete") ||
    isTauriCommandMissingError(error, "command_history_clear")
  );
}

function isTauriCommandMissingError(error: unknown, commandName: string) {
  const message = formatError(error).toLowerCase();
  const normalizedCommandName = commandName.toLowerCase();
  const singleQuote = String.fromCharCode(39);
  return (
    message.includes(`command ${normalizedCommandName} not found`) ||
    message.includes(`command ${singleQuote}${normalizedCommandName}${singleQuote} not found`) ||
    message.includes(`command "${normalizedCommandName}" not found`)
  );
}

function formatConnectionAddress(connection: ConnectionProfile) {
  if ((connection.protocol || "ssh") === "telnet") {
    return `${connection.host}:${connection.port.toString()}`;
  }
  if ((connection.protocol || "ssh") === "serial") {
    return connection.serial?.port_name || connection.host;
  }
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}

function isRdpConnection(
  connection?: ConnectionProfile | null,
): connection is RdpConnectionProfile {
  return (connection?.protocol || "ssh") === "rdp";
}

function isVncConnection(
  connection?: ConnectionProfile | null,
): connection is VncConnectionProfile {
  return (connection?.protocol || "ssh") === "vnc";
}

function isTelnetConnection(
  connection?: ConnectionProfile | null,
): connection is TelnetConnectionProfile {
  return (connection?.protocol || "ssh") === "telnet";
}

function isSerialConnection(
  connection?: ConnectionProfile | null,
): connection is SerialConnectionProfile {
  return (connection?.protocol || "ssh") === "serial";
}

function measureRdpEmbeddedViewport(element: HTMLElement | null): RdpEmbeddedBounds | null {
  if (!element || !element.isConnected) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  if (width < 120 || height < 90) {
    return null;
  }
  return {
    x: Math.round(rect.left * scale),
    y: Math.round(rect.top * scale),
    width,
    height,
  };
}

function hiddenRdpEmbeddedBounds(): RdpEmbeddedBounds {
  return {
    x: -32000,
    y: -32000,
    width: 120,
    height: 90,
  };
}

function isSshConnection(
  connection?: ConnectionProfile | null,
): connection is SshConnectionProfile {
  return (connection?.protocol || "ssh") === "ssh";
}

function rdpStatusLabel(status: RdpSessionStatus) {
  switch (status) {
    case "launching":
      return "启动中";
    case "embedded":
      return "嵌入式";
    case "native":
      return "原生窗口";
    case "external":
      return "外部客户端";
    case "error":
      return "失败";
    default:
      return "RDP";
  }
}

function rdpRenderModeLabel(mode: string) {
  switch (mode) {
    case "embedded":
      return "嵌入式优先";
    case "external":
      return "外部客户端";
    case "custom":
      return "自定义 runner";
    default:
      return "自动";
  }
}

function rdpDisplaySummary(
  display?: NonNullable<ConnectionProfile["rdp"]>["display"] | null,
) {
  if (!display) {
    return "默认显示";
  }
  const size =
    display.mode === "fullscreen" || display.mode === "all_monitors"
      ? rdpDisplayModeLabel(display.mode)
      : `${(display.width || 1440).toString()} x ${(display.height || 900).toString()}`;
  const flags = [
    display.dynamic_resize ? "动态尺寸" : null,
    display.use_multimon ? "多显示器" : null,
  ].filter(Boolean);
  return [size, ...flags].join(" · ");
}

function rdpDisplayModeLabel(mode: string) {
  switch (mode) {
    case "embedded":
      return "嵌入";
    case "windowed":
      return "窗口";
    case "fullscreen":
      return "全屏";
    case "all_monitors":
      return "全屏多屏";
    default:
      return "默认";
  }
}

function rdpResourceSummary(
  resources?: NonNullable<ConnectionProfile["rdp"]>["resources"] | null,
) {
  if (!resources) {
    return "默认资源";
  }
  const enabled = [
    resources.clipboard ? "剪贴板" : null,
    resources.drives ? "磁盘" : null,
    resources.printers ? "打印机" : null,
    resources.smart_cards ? "智能卡" : null,
    resources.audio !== "disabled" ? `音频${rdpAudioLabel(resources.audio)}` : null,
  ].filter(Boolean);
  return enabled.length ? enabled.join(" · ") : "无重定向";
}

function rdpAudioLabel(mode: string) {
  if (mode === "remote") {
    return "远端";
  }
  if (mode === "disabled") {
    return "关闭";
  }
  return "本机";
}

function previewRdpLaunchForBrowser(
  connection: ConnectionProfile,
  platform: DesktopPlatform = resolveDesktopPlatform(),
): RdpLaunchPreview {
  const config = connection.rdp;
  const renderMode = config?.runner.render_mode || "embedded";
  const externalRunner = defaultRdpExternalRunnerForPlatform(platform);
  const runner: RdpRunnerKind =
    config?.runner.preferred_runner ||
    (renderMode === "custom"
      ? "custom"
      : renderMode === "embedded" && platform === "windows"
        ? "mstsc_activex"
        : externalRunner);
  const executable =
    runner === "custom"
      ? config?.runner.custom_executable || "custom-rdp-client"
      : runner === "freerdp"
        ? "xfreerdp"
        : runner === "macos_app"
          ? "/usr/bin/open"
        : runner === "mstsc_activex"
          ? "mstscax.dll"
          : "mstsc.exe";
  const args =
    runner === "freerdp"
      ? [
          `/v:${connection.host}:${connection.port.toString()}`,
          `/u:${connection.username}`,
          ...(config?.domain ? [`/d:${config.domain}`] : []),
          "/dynamic-resolution",
          "/clipboard",
        ]
      : runner === "custom"
        ? [config?.runner.custom_args_template || "{rdp_file}"]
        : runner === "macos_app"
          ? ["<generated.rdp>"]
        : runner === "mstsc_activex"
          ? []
          : ["<generated.rdp>"];
  const warnings = [
    "浏览器预览模式不会启动桌面 RDP 客户端。",
    "预览内容不会包含密码，真实启动也不会通过命令行传递明文密码。",
    config?.raw_rdp_settings?.trim()
      ? "高级 .rdp 设置会在桌面运行时由后端校验后合并。"
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    args,
    connection_id: connection.id,
    executable,
    fallback_reason:
      runner === "mstsc"
        ? "浏览器预览按 Windows 外部 runner 展示。"
        : runner === "macos_app"
          ? "浏览器预览按 macOS 系统 RDP 客户端展示。"
          : null,
    rdp_file_content:
      runner === "mstsc" || runner === "macos_app" || runner === "custom"
        ? previewRdpFileContent(connection)
        : null,
    render_mode: renderMode,
    runner,
    setup_hint: null,
    warnings,
  };
}

function previewRdpFileContent(connection: ConnectionProfile) {
  const rdp = connection.rdp;
  const display = rdp?.display;
  const resources = rdp?.resources;
  const gateway = rdp?.gateway;
  const lines = [
    `full address:s:${connection.host}:${connection.port.toString()}`,
    `username:s:${connection.username}`,
    rdp?.domain ? `domain:s:${rdp.domain}` : null,
    `screen mode id:i:${display?.mode === "fullscreen" || display?.mode === "all_monitors" ? "2" : "1"}`,
    `desktopwidth:i:${(display?.width || 1440).toString()}`,
    `desktopheight:i:${(display?.height || 900).toString()}`,
    `use multimon:i:${display?.use_multimon ? "1" : "0"}`,
    `redirectclipboard:i:${resources?.clipboard === false ? "0" : "1"}`,
    `audiomode:i:${resources?.audio === "disabled" ? "2" : resources?.audio === "remote" ? "1" : "0"}`,
    `redirectdrives:i:${resources?.drives ? "1" : "0"}`,
    `redirectprinters:i:${resources?.printers ? "1" : "0"}`,
    `redirectsmartcards:i:${resources?.smart_cards ? "1" : "0"}`,
    `authentication level:i:${rdpCertificateAuthenticationLevel(rdp?.security.certificate_policy)}`,
    gateway?.mode === "explicit" && gateway.host ? `gatewayhostname:s:${gateway.host}` : null,
    gateway?.mode && gateway.mode !== "disabled"
      ? `gatewayusagemethod:i:${gateway.mode === "explicit" ? "1" : "2"}`
      : null,
    "prompt for credentials:i:1",
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function rdpCertificateAuthenticationLevel(policy?: RdpCertificatePolicy | null) {
  switch (policy) {
    case "trust":
      return "0";
    case "strict":
      return "1";
    case "prompt":
    default:
      return "2";
  }
}

function rdpSessionHasCommandText(session: RdpSessionTab) {
  const material = session.result || session.preview;
  if (material?.runner === "mstsc_activex" && material.args.length === 0) {
    return false;
  }
  return Boolean(material?.executable || material?.args.length);
}

function rdpSessionHasRdpFileText(session: RdpSessionTab) {
  return Boolean(session.preview?.rdp_file_content || session.result?.rdp_file_path);
}

function rdpSessionCommandText(session: RdpSessionTab) {
  const material = session.result || session.preview;
  if (!material) {
    return "";
  }
  if (material.runner === "mstsc_activex" && material.args.length === 0) {
    return "";
  }
  const executable = material.executable || "";
  const args = material.args.map(quoteCommandArgForDisplay).join(" ");
  return [executable, args].filter(Boolean).join(" ");
}

function rdpSessionFileText(session: RdpSessionTab) {
  if (session.preview?.rdp_file_content) {
    return session.preview.rdp_file_content;
  }
  return session.result?.rdp_file_path || "";
}

function rdpSessionPrimaryDetail(session: RdpSessionTab) {
  if (session.status === "embedded") {
    return { title: "启动方式", value: "Windows embedded RDP host" };
  }
  if (session.status === "native") {
    return { title: "启动方式", value: "Windows ActiveX 原生子窗口" };
  }
  const command = rdpSessionCommandText(session);
  if (command) {
    return { title: "启动命令", value: command };
  }
  return { title: "启动状态", value: session.message || rdpStatusLabel(session.status) };
}

function vncStatusLabel(status: VncSessionStatus) {
  switch (status) {
    case "launching":
      return "启动中";
    case "embedded":
      return "内嵌画面";
    case "windowed":
      return "runner 窗口";
    case "external":
      return "外部客户端";
    case "error":
      return "失败";
    default:
      return "VNC";
  }
}

function vncRenderModeLabel(mode: string) {
  switch (mode) {
    case "embedded":
      return "noVNC 内嵌";
    case "windowed":
      return "RDP 窗口 noVNC";
    case "external":
      return "外部客户端";
    case "custom":
      return "自定义 runner";
    default:
      return "自动";
  }
}

function vncDisplaySummary(
  display?: NonNullable<ConnectionProfile["vnc"]>["display"] | null,
) {
  if (!display) {
    return "默认显示";
  }
  const scale =
    display.scale_mode === "actual"
      ? "原始尺寸"
      : display.scale_mode === "stretch"
        ? "拉伸适配"
        : "适应窗口";
  const flags = [
    display.resize_session ? "远端自适应" : null,
    display.clip_viewport ? "裁剪视口" : null,
  ].filter(Boolean);
  return [scale, ...flags].join(" · ");
}

function vncInputSummary(
  input?: NonNullable<ConnectionProfile["vnc"]>["input"] | null,
) {
  if (!input) {
    return "默认输入";
  }
  const enabled = [
    input.view_only ? "只看" : "键鼠",
    input.clipboard ? "剪贴板" : null,
    input.shared ? "共享会话" : null,
  ].filter(Boolean);
  return enabled.join(" · ");
}

function previewVncLaunchForBrowser(connection: ConnectionProfile): VncLaunchPreview {
  const config = connection.vnc || defaultVncConfig;
  const renderMode = config.runner.render_mode || "embedded";
  const runner: VncRunnerKind =
    config.runner.preferred_runner ||
    (renderMode === "custom"
      ? "custom"
      : renderMode === "embedded" || renderMode === "windowed"
        ? "novnc"
        : "vncviewer");
  const executable =
    runner === "novnc"
      ? null
      : runner === "custom"
        ? config.runner.custom_executable || "custom-vnc-client"
        : runner === "realvnc"
          ? "vncviewer.exe"
          : "vncviewer";
  const args =
    runner === "novnc"
      ? []
      : runner === "custom"
        ? [config.runner.custom_args_template || "{host}::{port}"]
        : [`${connection.host}::${connection.port.toString()}`];
  const warnings = [
    "浏览器预览模式不会创建本地 VNC 桥接。",
    "预览内容不会包含密码，外部 VNC 客户端也不会通过命令行接收明文密码。",
    config.raw_runner_args?.trim()
      ? "高级 runner 参数会在桌面运行时由后端校验后合并。"
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    args,
    connection_id: connection.id,
    embedded: runner === "novnc",
    executable,
    fallback_reason: runner === "novnc" ? null : "浏览器预览按外部 VNC runner 展示。",
    render_mode: renderMode,
    runner,
    setup_hint: null,
    warnings,
    websocket_url: runner === "novnc" ? "ws://127.0.0.1:<port>/vnc/<session>/<token>" : null,
  };
}

function vncSessionHasCommandText(session: VncSessionTab) {
  const material = session.result || session.preview;
  if (!material || material.runner === "novnc") {
    return false;
  }
  return Boolean(material.executable || material.args.length);
}

function vncSessionCommandText(session: VncSessionTab) {
  const material = session.result || session.preview;
  if (!material || material.runner === "novnc") {
    return "";
  }
  const executable = material.executable || "";
  const args = material.args.map(quoteCommandArgForDisplay).join(" ");
  return [executable, args].filter(Boolean).join(" ");
}

function vncSessionPrimaryDetail(session: VncSessionTab) {
  if (session.status === "embedded") {
    return { title: "启动方式", value: "noVNC 本地桥接" };
  }
  if (session.status === "windowed") {
    return { title: "启动方式", value: "RDP 风格 runner host" };
  }
  const command = vncSessionCommandText(session);
  if (command) {
    return { title: "启动命令", value: command };
  }
  return { title: "启动状态", value: session.message || vncStatusLabel(session.status) };
}

function quoteCommandArgForDisplay(value: string) {
  if (!value) {
    return "\"\"";
  }
  return /\s/.test(value) ? `"${value.replace(/"/g, "\\\"")}"` : value;
}

function commandHistoryKeyForScope(scope: CommandHistoryScope | null) {
  if (!scope) {
    return commandHistoryAllScopeKey;
  }
  return scope.scope_kind === "ssh_connection"
    ? `${commandHistorySshScopePrefix}${scope.scope_id}`
    : `${commandHistoryLocalScopePrefix}${scope.scope_id}`;
}

function commandHistoryScopeFromKey(key: string): CommandHistoryScope | null {
  if (key.startsWith(commandHistorySshScopePrefix)) {
    return {
      scope_kind: "ssh_connection",
      scope_id: key.slice(commandHistorySshScopePrefix.length),
    };
  }

  if (key.startsWith(commandHistoryLocalScopePrefix)) {
    return {
      scope_kind: "local_profile",
      scope_id: key.slice(commandHistoryLocalScopePrefix.length),
    };
  }

  return null;
}

function commandHistoryDefaultScopeKey({
  activeConnectionId,
  activeLocalTerminalTab,
  activeWorkspaceMode,
}: {
  activeConnectionId: string | null;
  activeLocalTerminalTab: LocalTerminalTab | null;
  activeWorkspaceMode: WorkspaceMode;
}) {
  if (activeWorkspaceMode === "local" && activeLocalTerminalTab?.profileId) {
    return commandHistoryKeyForScope({
      scope_kind: "local_profile",
      scope_id: activeLocalTerminalTab.profileId,
    });
  }

  if (activeWorkspaceMode === "ssh" && activeConnectionId) {
    return commandHistoryKeyForScope({
      scope_kind: "ssh_connection",
      scope_id: activeConnectionId,
    });
  }

  return commandHistoryAllScopeKey;
}

function buildCommandHistoryScopeOptions({
  activeConnection,
  activeLocalTerminalTab,
  activeWorkspaceMode,
  connections,
  defaultScopeKey,
  localTerminalProfiles,
}: {
  activeConnection: ConnectionProfile | null;
  activeLocalTerminalTab: LocalTerminalTab | null;
  activeWorkspaceMode: WorkspaceMode;
  connections: ConnectionProfile[];
  defaultScopeKey: string;
  localTerminalProfiles: LocalTerminalProfile[];
}): CommandHistoryScopeOption[] {
  const options: CommandHistoryScopeOption[] = [];
  const seen = new Set<string>();

  const addOption = (option: CommandHistoryScopeOption) => {
    if (seen.has(option.value)) {
      return;
    }
    seen.add(option.value);
    options.push(option);
  };

  if (activeWorkspaceMode === "local" && activeLocalTerminalTab) {
    const activeProfile = localTerminalProfiles.find(
      (profile) => profile.id === activeLocalTerminalTab.profileId,
    );
    addOption({
      badge: "本地",
      label: `当前终端（${activeProfile?.name || activeLocalTerminalTab.title}）`,
      value: defaultScopeKey,
    });
  } else if (activeWorkspaceMode === "ssh" && isSshConnection(activeConnection)) {
    addOption({
      badge: "SSH",
      label: `当前连接（${activeConnection.name}）`,
      value: defaultScopeKey,
    });
  }

  connections.filter(isSshConnection).forEach((connection) => {
    addOption({
      badge: "SSH",
      label: connection.name,
      value: commandHistoryKeyForScope({
        scope_kind: "ssh_connection",
        scope_id: connection.id,
      }),
    });
  });

  localTerminalProfiles
    .filter((profile) => !profile.hidden || profile.id === activeLocalTerminalTab?.profileId)
    .forEach((profile) => {
      addOption({
        badge: "本地",
        label: profile.name,
        value: commandHistoryKeyForScope({
          scope_kind: "local_profile",
          scope_id: profile.id,
        }),
      });
    });

  addOption({
    label: "全部历史",
    value: commandHistoryAllScopeKey,
  });

  return options;
}

function uniqueCommandHistoryScopes(scopes: CommandHistoryScope[]) {
  const unique = new Map<string, CommandHistoryScope>();
  scopes.forEach((scope) => {
    unique.set(commandHistoryKeyForScope(scope), scope);
  });
  return Array.from(unique.values());
}

function buildCommandSenderTargets({
  activeTabByConnectionId,
  activeLocalTerminalTabId,
  connectionById,
  deliveryByKey,
  localTerminalProfiles,
  localTerminalTabs,
  selectedTabByConnectionId,
  terminalTabs,
}: {
  activeTabByConnectionId: Record<string, string>;
  activeLocalTerminalTabId: string | null;
  connectionById: Map<string, ConnectionProfile>;
  deliveryByKey: Record<string, { message?: string; status: CommandSenderDeliveryStatus }>;
  localTerminalProfiles: LocalTerminalProfile[];
  localTerminalTabs: LocalTerminalTab[];
  selectedTabByConnectionId: Record<string, string>;
  terminalTabs: TerminalTab[];
}): CommandSenderTarget[] {
  const tabsByConnection = new Map<string, ConnectedTerminalTab[]>();

  terminalTabs.forEach((tab) => {
    if (tab.type !== "terminal" || !tab.sessionId) {
      return;
    }

    const connectedTab = tab as ConnectedTerminalTab;
    const tabs = tabsByConnection.get(tab.connectionId) || [];
    tabs.push(connectedTab);
    tabsByConnection.set(tab.connectionId, tabs);
  });

  const targets = Array.from(tabsByConnection.entries()).flatMap(([connectionId, tabs]) => {
    const selectedTabId =
      selectedTabByConnectionId[connectionId] || activeTabByConnectionId[connectionId];
    const selectedTab = tabs.find((tab) => tab.id === selectedTabId) || tabs[0];
    const connection = connectionById.get(connectionId) || null;
    if (connection && !isSshConnection(connection)) {
      return [];
    }
    const key = commandSenderTargetKey(connectionId, selectedTab.id);
    const delivery = deliveryByKey[key];
    const tabCountText = tabs.length > 1 ? `${tabs.length.toString()} 个子 tab` : "1 个子 tab";

    return [{
      connectionId,
      deliveryMessage: delivery?.message,
      deliveryStatus: delivery?.status || "idle",
      description: connection
        ? `${formatConnectionAddress(connection)} · ${tabCountText}`
        : `当前连接 · ${tabCountText}`,
      key,
      kind: "ssh" as const,
      label: connection?.name || selectedTab.title,
      historyScope: {
        scope_kind: "ssh_connection" as const,
        scope_id: connectionId,
      },
      sessionId: selectedTab.sessionId,
      tabId: selectedTab.id,
      tabs: tabs.map((tab) => ({
        label: tab.title,
        sessionId: tab.sessionId,
        tabId: tab.id,
      })),
      tabTitle: selectedTab.title,
    }];
  });

  const connectedLocalTabs = localTerminalTabs.filter(
    (tab): tab is LocalTerminalTab & { sessionId: string } => Boolean(tab.sessionId),
  );
  if (connectedLocalTabs.length === 0) {
    return targets;
  }

  const selectedLocalTabId =
    selectedTabByConnectionId[localCommandSenderTargetId] || activeLocalTerminalTabId;
  const selectedLocalTab =
    connectedLocalTabs.find((tab) => tab.id === selectedLocalTabId) || connectedLocalTabs[0];
  const profile = localTerminalProfiles.find((item) => item.id === selectedLocalTab.profileId) || null;
  const localTargetLabel = connectedLocalTabs.some((tab) => tab.source && tab.source !== "local")
    ? "字符终端"
    : "本地终端";
  const key = commandSenderTargetKey(localCommandSenderTargetId, selectedLocalTab.id);
  const delivery = deliveryByKey[key];
  const tabCountText =
    connectedLocalTabs.length > 1
      ? `${connectedLocalTabs.length.toString()} 个本地 tab`
      : "1 个本地 tab";

  return [
    ...targets,
    {
      connectionId: localCommandSenderTargetId,
      deliveryMessage: delivery?.message,
      deliveryStatus: delivery?.status || "idle",
      description: `${profile?.name || selectedLocalTab.title} · ${tabCountText}`,
      key,
      kind: "local" as const,
      label: localTargetLabel,
      historyScope: {
        scope_kind: "local_profile" as const,
        scope_id: selectedLocalTab.profileId,
      },
      sessionId: selectedLocalTab.sessionId,
      tabId: selectedLocalTab.id,
      tabs: connectedLocalTabs.map((tab) => ({
        label: tab.title,
        sessionId: tab.sessionId,
        tabId: tab.id,
      })),
      tabTitle: selectedLocalTab.title,
    },
  ];
}

function commandSenderTargetKey(connectionId: string, tabId: string) {
  return `${connectionId}:${tabId}`;
}

function commandSenderDeliveryLabel(status: CommandSenderDeliveryStatus) {
  if (status === "sent") {
    return "已写入";
  }
  if (status === "failed") {
    return "发送失败";
  }
  return "未发送";
}

function buildAiContextBlock({
  kind,
  title,
  source,
  content,
}: {
  kind: string;
  title: string;
  source: string;
  content: string;
}): AiContextBlock {
  const normalized = content.trim();
  return {
    id: `${kind}-${Date.now().toString()}`,
    kind,
    title,
    source,
    content: normalized,
    line_count: normalized ? normalized.split(/\r?\n/).length : 0,
    char_count: Array.from(normalized).length,
  };
}

function tailStringByChars(value: string, maxChars: number) {
  const chars = Array.from(value);
  return chars.length <= maxChars ? value : chars.slice(chars.length - maxChars).join("");
}

function stripTerminalControlText(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function mouseDragDistance(drag: WorkbenchTabMouseDrag, currentX: number, currentY: number) {
  return Math.hypot(currentX - drag.startX, currentY - drag.startY);
}

function getWorkbenchTabDropZoneFromPoint(x: number, y: number): WorkbenchTabDropZone | null {
  const target = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-workbench-tab-drop-zone]");
  const zone = target?.dataset.workbenchTabDropZone;
  return zone === "terminal" ||
    zone === "file" ||
    zone === "split-file" ||
    zone === "split-terminal"
    ? zone
    : null;
}

function isCommandSenderRisky(command: string) {
  return (
    /\b(?:sudo|mkfs|shutdown|reboot)\b/i.test(command) ||
    /\brm\s+-[^\n\r]*r[^\n\r]*f/i.test(command) ||
    /\b(?:curl|wget)\b[^\n\r|]*\|\s*(?:sh|bash)\b/i.test(command)
  );
}

function isRemoteFileConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "remote_file_conflict"
  );
}

function isRemoteFileTabUnderEntry(
  tab: RemoteFileEditorTab,
  connectionId: string,
  entryPath: string,
) {
  const normalizedEntryPath = normalizeRemotePath(entryPath);
  return (
    tab.connectionId === connectionId &&
    (tab.path === normalizedEntryPath ||
      isRemotePathStrictDescendant(tab.path, normalizedEntryPath))
  );
}

function collapseRemoteFileDeleteEntries(entries: RemoteFileEntry[]) {
  const byPath = new Map<string, RemoteFileEntry>();
  for (const entry of entries) {
    const path = normalizeRemotePath(entry.path);
    byPath.set(path, { ...entry, path });
  }

  const orderedEntries = Array.from(byPath.values()).sort(
    (left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path),
  );
  const collapsed: RemoteFileEntry[] = [];
  for (const entry of orderedEntries) {
    const coveredByDirectory = collapsed.some(
      (selected) =>
        selected.type === "directory" &&
        isRemotePathStrictDescendant(entry.path, selected.path),
    );
    if (!coveredByDirectory) {
      collapsed.push(entry);
    }
  }
  return collapsed;
}

function uniqueRemoteParentPaths(entries: RemoteFileEntry[]) {
  return Array.from(new Set(entries.map((entry) => remotePathParent(entry.path))));
}

function remoteFileDeleteDescription(entries: RemoteFileEntry[], affectedTabs: number, dirtyTabs: number) {
  const base =
    entries.length === 1
      ? `确认删除“${entries[0].path}”吗？这个操作无法撤销。`
      : `确认删除选中的 ${entries.length.toString()} 个远程条目吗？这个操作无法撤销。`;
  if (dirtyTabs > 0) {
    return `${base} 将同时关闭 ${affectedTabs.toString()} 个已打开文件，其中 ${dirtyTabs.toString()} 个有未保存修改。`;
  }
  if (affectedTabs > 0) {
    return `${base} 将同时关闭 ${affectedTabs.toString()} 个已打开文件。`;
  }
  return base;
}

function joinRemotePath(parentPath: string, name: string) {
  const normalizedParent = normalizeRemotePath(parentPath);
  const cleanName = name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleanName) {
    return normalizedParent;
  }
  return normalizeRemotePath(
    normalizedParent === "/" ? `/${cleanName}` : `${normalizedParent}/${cleanName}`,
  );
}

function remoteFileName(path: string) {
  const normalizedPath = normalizeRemotePath(path);
  if (normalizedPath === "/") {
    return "/";
  }
  const parts = normalizedPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalizedPath;
}

function localPathName(path: string) {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.split("/").filter(Boolean).pop() || "upload";
}

function previewRemoteFileMetadata(path: string): RemoteFileMetadata {
  const normalizedPath = normalizeRemotePath(path);
  const content = previewRemoteFileContent(normalizedPath);
  return {
    mtime: Date.now(),
    name: remoteFileName(normalizedPath),
    path: normalizedPath,
    size: new TextEncoder().encode(content).length,
    mode: "-rw-r--r--",
  };
}

function previewRemoteFileRead(
  connection: ConnectionProfile,
  path: string,
): RemoteFileReadResult {
  const normalizedPath = normalizeRemotePath(path);
  const content = previewRemoteFileContent(normalizedPath, connection.name);
  const metadata: RemoteFileMetadata = {
    mtime: Date.now(),
    name: remoteFileName(normalizedPath),
    path: normalizedPath,
    size: new TextEncoder().encode(content).length,
    mode: "-rw-r--r--",
  };

  return {
    content,
    editable: true,
    encoding: "utf-8",
    is_binary: false,
    metadata,
    mode: metadata.mode,
    mtime: metadata.mtime,
    name: metadata.name,
    path: metadata.path,
    size: metadata.size,
  };
}

function previewRemoteFileContent(path: string, connectionName = "preview") {
  const name = remoteFileName(path);
  if (name.endsWith(".json")) {
    return `{\n  "name": "${connectionName}",\n  "path": "${path}",\n  "enabled": true\n}\n`;
  }
  if (name.endsWith(".sh")) {
    return "#!/usr/bin/env sh\nset -eu\n\necho \"deploy preview\"\n";
  }
  if (name.endsWith(".md")) {
    return `# ${name}\n\nRemote preview file for ${connectionName}.\n`;
  }
  if (name.endsWith(".conf")) {
    return "server {\n  listen 80;\n  server_name example.local;\n}\n";
  }
  return `# ${name}\n# ${connectionName}:${path}\n\n编辑这里的内容后可看到 dirty 状态和保存入口。\n`;
}

function remoteFileActionTitle(action: RemoteFileTextAction) {
  if (action.action === "create-file") return "新建文件";
  if (action.action === "create-directory") return "新建文件夹";
  return "重命名";
}

function remoteFileActionDescription(action: RemoteFileTextAction) {
  if (action.action === "rename") {
    return `父目录：${remotePathParent(action.entry.path)}`;
  }
  return `父目录：${action.parentPath}`;
}

function toRemoteFileConflictPolicy(
  policy: RemoteFileTransferConflictPolicy,
): RemoteFileTransferConflictPolicy {
  return policy === "ask" ? "rename" : policy;
}

function isClosableSavedRemoteFileTab(tab: RemoteFileEditorTab) {
  return !tab.dirty && (tab.saveState === "ready" || tab.saveState === "saved");
}

async function copyText(text: string) {
  await copyTextToClipboard(text);
}

function isValidRemoteBaseName(name: string) {
  const trimmed = name.trim();
  return Boolean(trimmed) && trimmed !== "." && trimmed !== ".." && !/[\\/]/.test(trimmed);
}

function remoteFileNameValidationMessage(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "请输入名称。";
  }
  if (trimmed === "." || trimmed === "..") {
    return "名称不能是 . 或 ..。";
  }
  if (/[\\/]/.test(trimmed)) {
    return "这里只能填写名称，不能包含路径。";
  }
  return "请输入有效名称。";
}

function getFileRelativePath(file: File) {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return normalizeUploadRelativePath(withRelativePath.webkitRelativePath || file.name);
}

function normalizeUploadRelativePath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function totalUploadBytes(items: RemoteFileUploadItem[]) {
  return items.reduce((total, item) => {
    return normalizeUploadRelativePath(item.relativePath) ? total + item.file.size : total;
  }, 0);
}

function groupUploadDirectories(items: RemoteFileUploadItem[]) {
  const groups = new Map<string, RemoteFileUploadItem[]>();

  items.forEach((item) => {
    const relativePath = normalizeUploadRelativePath(item.relativePath);
    const [rootName] = relativePath.split("/");
    if (!rootName || !relativePath.includes("/")) {
      return;
    }
    const group = groups.get(rootName) || [];
    group.push({
      file: item.file,
      relativePath,
    });
    groups.set(rootName, group);
  });

  return groups;
}

async function buildTarGzArchiveToTemp(
  localPath: string,
  items: RemoteFileUploadItem[],
  onProgress?: (progress: ArchiveBuildProgress) => void,
) {
  const totalBytes = totalUploadBytes(items);
  const compression = new CompressionStream("gzip");
  const writer = compression.writable.getWriter();
  const reader = compression.readable.getReader();
  const encoder = new TextEncoder();
  const directories = collectTarDirectories(items);
  let loadedBytes = 0;
  let archiveBytes = 0;
  let pendingGzipBytes = 0;
  const pendingGzipChunks: Uint8Array[] = [];

  const flushGzipChunks = async () => {
    if (pendingGzipBytes <= 0) {
      return;
    }
    const chunk =
      pendingGzipChunks.length === 1
        ? pendingGzipChunks[0]
        : concatenateUint8Arrays(pendingGzipChunks, pendingGzipBytes);
    pendingGzipChunks.length = 0;
    pendingGzipBytes = 0;
    await remoteFileAppendUploadTemp(localPath, chunk);
    archiveBytes += chunk.byteLength;
    onProgress?.({
      archiveBytes,
      loadedBytes,
      phase: "compress",
      totalBytes,
    });
    await yieldToBrowser();
  };

  const persistGzip = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.byteLength === 0) {
        continue;
      }
      pendingGzipChunks.push(value);
      pendingGzipBytes += value.byteLength;
      if (pendingGzipBytes >= uploadTempAppendChunkBytes) {
        await flushGzipChunks();
      }
    }
    await flushGzipChunks();
  })();

  try {
    for (const directory of directories) {
      await writer.write(buildTarHeader(`${directory}/`, 0, true, encoder));
      await yieldToBrowser();
    }

    for (const item of items) {
      const relativePath = normalizeUploadRelativePath(item.relativePath);
      if (!relativePath) {
        continue;
      }
      await writer.write(buildTarHeader(relativePath, item.file.size, false, encoder));
      await writeFileToTarGzipStream(item.file, writer, loadedBytes, totalBytes, onProgress);
      loadedBytes += item.file.size;
      await writer.write(new Uint8Array(paddingForTarBlock(item.file.size)));
      await yieldToBrowser();
    }

    loadedBytes = totalBytes;
    onProgress?.({
      archiveBytes,
      loadedBytes,
      phase: "compress",
      totalBytes,
    });
    await writer.write(new Uint8Array(1024));
    await writer.close();
    await persistGzip;
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await persistGzip.catch(() => undefined);
    throw error;
  }

  onProgress?.({
    archiveBytes,
    loadedBytes: totalBytes,
    phase: "compress",
    totalBytes,
  });
  return archiveBytes;
}

async function writeFileToTarGzipStream(
  file: File,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  loadedBeforeFile: number,
  totalBytes: number,
  onProgress?: (progress: ArchiveBuildProgress) => void,
) {
  if (file.size === 0) {
    onProgress?.({
      archiveBytes: 0,
      loadedBytes: loadedBeforeFile,
      phase: "read",
      totalBytes,
    });
    return;
  }

  let loadedInFile = 0;
  while (loadedInFile < file.size) {
    const nextOffset = Math.min(file.size, loadedInFile + fileReadChunkBytes);
    const chunk = new Uint8Array(await file.slice(loadedInFile, nextOffset).arrayBuffer());
    await writer.write(chunk);
    loadedInFile = nextOffset;
    onProgress?.({
      archiveBytes: 0,
      loadedBytes: loadedBeforeFile + loadedInFile,
      phase: "read",
      totalBytes,
    });
    await yieldToBrowser();
  }
}

async function writeFileToUploadTemp(
  localPath: string,
  file: File,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
) {
  if (file.size === 0) {
    onProgress?.(0, 0);
    return;
  }

  let loadedBytes = 0;
  while (loadedBytes < file.size) {
    const nextOffset = Math.min(file.size, loadedBytes + fileReadChunkBytes);
    const chunk = new Uint8Array(await file.slice(loadedBytes, nextOffset).arrayBuffer());
    await remoteFileAppendUploadTemp(localPath, chunk);
    loadedBytes = nextOffset;
    onProgress?.(loadedBytes, file.size);
    await yieldToBrowser();
  }
}


function collectTarDirectories(items: RemoteFileUploadItem[]) {
  const directories = new Set<string>();
  items.forEach((item) => {
    const parts = normalizeUploadRelativePath(item.relativePath).split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  });
  return Array.from(directories).sort((left, right) => left.localeCompare(right));
}

function buildTarHeader(
  path: string,
  size: number,
  directory: boolean,
  encoder: TextEncoder,
) {
  const header = new Uint8Array(512);
  const normalizedPath = normalizeUploadRelativePath(path).slice(0, 255);
  const splitPath = splitTarPath(normalizedPath);

  writeTarString(header, 0, 100, splitPath.name, encoder);
  writeTarOctal(header, 100, 8, directory ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, directory ? 0 : size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(32, 148, 156);
  header[156] = directory ? "5".charCodeAt(0) : "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar", encoder);
  writeTarString(header, 263, 2, "00", encoder);
  writeTarString(header, 345, 155, splitPath.prefix, encoder);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarOctal(header, 148, 8, checksum);
  return header;
}

function splitTarPath(path: string) {
  if (path.length <= 100) {
    return { name: path, prefix: "" };
  }

  const segments = path.split("/");
  let name = segments.pop() || path.slice(-100);
  let prefix = segments.join("/");
  if (name.length > 100) {
    name = name.slice(-100);
  }
  if (prefix.length > 155) {
    prefix = prefix.slice(-155);
  }
  return { name, prefix };
}

function writeTarString(
  header: Uint8Array,
  offset: number,
  length: number,
  value: string,
  encoder: TextEncoder,
) {
  header.set(encoder.encode(value).slice(0, length), offset);
}

function writeTarOctal(header: Uint8Array, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, "0").slice(0, length - 1);
  for (let index = 0; index < text.length; index += 1) {
    header[offset + index] = text.charCodeAt(index);
  }
  header[offset + length - 1] = 0;
}

function paddingForTarBlock(size: number) {
  return (512 - (size % 512)) % 512;
}

function concatenateUint8Arrays(chunks: Uint8Array[], totalBytes: number) {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function scheduleIdleTask(callback: () => void, timeoutMs: number): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => callback(), { timeout: timeoutMs });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const timer = window.setTimeout(callback, timeoutMs);
  return () => window.clearTimeout(timer);
}

function scheduleWorkspaceModulePrewarm(): () => void {
  let canceled = false;
  const cancelBatchTasks = WORKSPACE_IDLE_PREWARM_BATCHES.map((batch) =>
    scheduleIdleTask(() => {
      void prewarmLazyModuleBatch(batch.loaders, () => canceled);
    }, batch.timeoutMs),
  );

  return () => {
    canceled = true;
    for (const cancelBatchTask of cancelBatchTasks) {
      cancelBatchTask();
    }
  };
}

async function prewarmLazyModuleBatch(
  loaders: LazyModuleLoader[],
  isCanceled: () => boolean,
) {
  for (const loader of loaders) {
    if (isCanceled()) {
      return;
    }
    await loader().catch(() => undefined);
    await yieldToBrowser();
  }
}

function clampTransferProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

function transferProgressPercent(loadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) {
    return 0;
  }
  return (Math.max(0, loadedBytes) / totalBytes) * 100;
}

function interpolateTransferProgress(
  start: number,
  end: number,
  loadedBytes: number,
  totalBytes: number,
) {
  if (totalBytes <= 0) {
    return end;
  }
  const ratio = Math.max(0, Math.min(1, loadedBytes / totalBytes));
  return start + (end - start) * ratio;
}

function formatTransferProgressBytes(loadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) {
    return formatFileSize(loadedBytes);
  }
  return `${formatFileSize(loadedBytes)} / ${formatFileSize(totalBytes)}`;
}

function createTransferSpeedTracker() {
  const startedAt = performance.now();
  let lastSampleAt = startedAt;
  let lastLoadedBytes = 0;
  let lastSpeedBytesPerSecond: number | null = null;

  return {
    sample(loadedBytes: number) {
      const now = performance.now();
      const elapsedMs = now - lastSampleAt;
      const totalElapsedMs = now - startedAt;
      if (elapsedMs >= 250 || loadedBytes === 0 || lastSpeedBytesPerSecond === null) {
        const deltaBytes = Math.max(0, loadedBytes - lastLoadedBytes);
        lastSpeedBytesPerSecond =
          elapsedMs > 0
            ? (deltaBytes / elapsedMs) * 1000
            : totalElapsedMs > 0
              ? (loadedBytes / totalElapsedMs) * 1000
              : 0;
        lastLoadedBytes = loadedBytes;
        lastSampleAt = now;
      }
      return formatTransferSpeed(
        lastSpeedBytesPerSecond ??
          (totalElapsedMs > 0 ? (loadedBytes / totalElapsedMs) * 1000 : 0),
      );
    },
  };
}

function calculateTransferAverageSpeed(loadedBytes: number, startedAt: number) {
  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  return Math.max(0, loadedBytes / elapsedSeconds);
}

function formatTransferSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null;
  }
  return `${formatFileSize(bytesPerSecond)}/s`;
}

function transferSessionName(connection: ConnectionProfile) {
  return sanitizeLocalSegment(connection.name || connection.host || "mxterm-session");
}

function formatTransferTimestamp(date: Date, format: FileTransferTimestampFormat) {
  const year = date.getFullYear().toString();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());

  if (format === "yyyy-MM-dd-HHmm") {
    return `${year}-${month}-${day}-${hour}${minute}`;
  }
  if (format === "yyyyMMdd-HHmm") {
    return `${year}${month}${day}-${hour}${minute}`;
  }
  return `${year}${month}${day}${hour}${minute}`;
}

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

function sanitizeLocalSegment(value: string) {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized || "mxterm-session";
}

function previewRemoteFileUploadResult(path: string, size: number): RemoteFileUploadResult {
  const metadata = {
    ...previewRemoteFileMetadata(path),
    size,
  };
  return {
    metadata,
    name: metadata.name,
    path: metadata.path,
    skipped: false,
  };
}

function previewRemoteFileArchiveUploadResult(path: string): RemoteFileArchiveUploadResult {
  const normalizedPath = normalizeRemotePath(path);
  return {
    archive_path: null,
    name: remoteFileName(normalizedPath),
    path: normalizedPath,
    skipped: false,
  };
}

function previewRemoteFileDownloadToLocalResult(
  entry: RemoteFileEntry,
  directory: boolean,
): RemoteFileDownloadToLocalResult {
  const localDirectory = `Downloads\\${sanitizeLocalSegment(entry.name)}\\preview`;
  return {
    archive_path: null,
    directory,
    local_directory: localDirectory,
    local_path: `${localDirectory}\\${entry.name}`,
    name: entry.name,
    remote_path: entry.path,
    skipped: false,
  };
}

function resolveNativeFileDropTargetPath(position: NativeFileDropPosition) {
  const scaleFactor = window.devicePixelRatio || 1;
  const element = document.elementFromPoint(position.x / scaleFactor, position.y / scaleFactor);
  const target = element?.closest<HTMLElement>(`[${remoteFileDropTargetAttribute}]`);
  return target?.dataset.remoteFileDropTarget || null;
}

function previewRemoteFileEntryMetadata(entry: RemoteFileEntry): RemoteFileEntryMetadata {
  return {
    mode: entry.type === "directory" ? "755" : "644",
    mtime: Date.now() / 1000,
    name: entry.name,
    path: entry.path,
    size: entry.type === "directory" ? 0 : previewRemoteFileMetadata(entry.path).size,
    type: entry.type,
  };
}

function transferFileTypeClass(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return "directory";
  }
  const name = item.name.toLowerCase();
  if (
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz") ||
    name.endsWith(".zip") ||
    name.endsWith(".gz") ||
    name.endsWith(".7z") ||
    name.endsWith(".rar")
  ) {
    return "archive";
  }
  if (name.endsWith(".log")) {
    return "log";
  }
  return "file";
}

function transferFileTypeLabel(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return null;
  }
  const name = item.name.toLowerCase();
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "TGZ";
  if (name.endsWith(".zip")) return "ZIP";
  if (name.endsWith(".gz")) return "GZ";
  if (name.endsWith(".7z")) return "7Z";
  if (name.endsWith(".rar")) return "RAR";
  if (name.endsWith(".log")) return "LOG";
  const extension = item.name.includes(".") ? item.name.split(".").pop() || "" : "";
  return extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : null;
}

function transferItemSizeText(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return item.progressDetail?.includes(" / ") || item.progressDetail?.startsWith("压缩包 ")
      ? item.progressDetail
      : "目录";
  }
  if (item.progressDetail?.includes(" / ")) {
    return item.progressDetail;
  }
  if (item.progressDetail?.startsWith("压缩包 ")) {
    return item.progressDetail;
  }
  return "文件";
}

function transferDirectionLabel(direction: TransferDirection) {
  return direction === "upload" ? "上传" : "下载";
}

function transferKindLabel(kind: TransferKind) {
  return kind === "directory" ? "目录" : "文件";
}

function transferSourcePath(item: RemoteFileTransferItem) {
  if (item.direction === "upload") {
    return item.localPath || "本地选择的文件";
  }
  return item.remotePath;
}

function transferTargetPath(item: RemoteFileTransferItem) {
  if (item.direction === "upload") {
    return item.remotePath;
  }
  return item.localPath || "本地下载目录";
}

function formatTransferDetailTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

function transferStatusLabel(status: TransferStatus) {
  const labels: Record<TransferStatus, string> = {
    canceled: "已取消",
    error: "失败",
    queued: "等待",
    running: "进行中",
    skipped: "已跳过",
    success: "完成",
  };
  return labels[status];
}

function transferInlineErrorText(error: string) {
  return error
    .split(/\r?\n/)
    .map((line) => normalizeErrorText(line))
    .filter(Boolean)
    .join("；");
}

function transferDisplayStatusLabel(item: RemoteFileTransferItem) {
  if (item.status !== "running" && item.status !== "queued") {
    return transferStatusLabel(item.status);
  }

  const stage = item.stage.trim();
  if (!stage) {
    return transferStatusLabel(item.status);
  }
  if (stage.includes("等待")) {
    return "等待";
  }
  if (stage.includes("压缩") || stage.includes("打包") || stage.includes("tar.gz")) {
    return "压缩中";
  }
  if (stage.includes("扫描")) {
    return "扫描中";
  }
  if (stage.includes("检查") || stage.includes("准备")) {
    return "准备中";
  }
  if (stage.includes("下载")) {
    return "下载中";
  }
  if (stage.includes("上传")) {
    return "上传中";
  }
  if (stage.includes("解压")) {
    return "解压中";
  }
  return transferStatusLabel(item.status);
}

function remoteKindLabel(kind: RemoteFileEntry["type"]) {
  const labels: Record<RemoteFileEntry["type"], string> = {
    directory: "目录",
    file: "文件",
    other: "其他",
    symlink: "符号链接",
  };
  return labels[kind];
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size.toString()} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatRemoteMtime(mtime: number) {
  const milliseconds = mtime > 10_000_000_000 ? mtime : mtime * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return date.toLocaleString();
}
