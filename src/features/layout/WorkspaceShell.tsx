import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import {
  AlertTriangle,
  ChevronLeft,
  Clock3,
  Clipboard,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  List,
  Loader2,
  LockKeyhole,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ConnectionDialog } from "../connections/ConnectionDialog";
import { ConnectionPane } from "../connections/ConnectionPane";
import { ConnectionSystemLogo } from "../connections/ConnectionSystemLogo";
import type {
  ConnectionAuthKind,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionRuntimeCredentialRequest,
  CredentialProfile,
  CredentialProfileInput,
  HostKeyInfo,
} from "../connections/connectionTypes";
import { defaultJumpConfig } from "../connections/connectionTypes";
import { RemoteFileEditor } from "../editor/RemoteFileEditor";
import type { RemoteFileEditorTab } from "../editor/remoteFileEditorTypes";
import {
  RemoteFilePanel,
  type RemoteFileTool,
  type RemoteFileUploadItem,
} from "../files/RemoteFilePanel";
import { MonitorPanel } from "../monitor/MonitorPanel";
import {
  isRemotePathStrictDescendant,
  normalizeRemotePath,
  remotePathParent,
} from "../files/remoteFilePaths";
import type {
  RemoteFileArchiveUploadResult,
  RemoteFileDownloadToLocalResult,
  RemoteFileEntry,
  RemoteFileEntryMetadata,
  RemoteFileMetadata,
  RemoteFileReadResult,
  RemoteFileTransferConflictPolicy,
  RemoteFileTransferProgressEvent,
  RemoteFileUploadResult,
} from "../files/remoteFileTypes";
import { SettingsView } from "../settings/SettingsView";
import {
  getTerminalColorScheme,
  getTerminalColorSchemeTone,
} from "../settings/terminalColorSchemes";
import {
  resolveSettingsStyle,
  resolveTerminalFontFamily,
  type FileTransferTimestampFormat,
  type WindowMaterialMode,
} from "../settings/settingsTypes";
import { useSettings } from "../settings/useSettings";
import { useConnections } from "../connections/useConnections";
import { useCredentials } from "../connections/useCredentials";
import {
  parseHostKeyError,
  type HostKeyDecision,
} from "../connections/hostKeyErrors";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { TerminalOutputEvent } from "../terminal/terminalTypes";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { AppSelect } from "../../shared/ui/AppSelect";
import {
  connectionTest,
  connectionTestProfile,
  knownHostTrust,
  connectionProbeLatency,
  remoteFileCheckPath,
  localPathMetadata,
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
  terminalClose,
  terminalConnect,
} from "../../shared/tauri/commands";
import { selectLocalUploadDirectories, selectLocalUploadFiles } from "../../shared/tauri/dialog";
import {
  listenRemoteFileTransferProgress,
  listenTerminalOutput,
} from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import {
  getPlatformWindowMaterials,
  getSupportedWindowMaterials,
  normalizeWindowMaterial,
  resolveDesktopPlatform,
  setWindowMaterial,
} from "../../shared/tauri/windowMaterial";
import { Tooltip } from "../../shared/ui/Tooltip";
import { AppTitlebar } from "./AppTitlebar";

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
  id: number;
  path: string;
}

type RemoteFileTextAction =
  | { action: "create-directory"; connectionId: string; parentPath: string }
  | { action: "create-file"; connectionId: string; parentPath: string }
  | { action: "rename"; connectionId: string; entry: RemoteFileEntry };

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
  remotePath: string;
  speedText?: string | null;
  stage: string;
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

const defaultLeftPaneWidth = 336;
const minLeftPaneWidth = 248;
const maxLeftPaneWidth = 520;
const defaultRightPaneWidth = 360;
const minRightPaneWidth = 300;
const maxRightPaneWidth = 560;
const minCenterPaneWidth = 520;
const paneKeyboardResizeStep = 16;
const defaultEditorTerminalSplitPercent = 44;
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
    connections,
    error,
    loading,
    markConnected,
    probeSystem,
    reload,
    remove,
    setFavorite,
    upsert,
  } = useConnections();
  const {
    credentials,
    error: credentialError,
    loading: credentialLoading,
    remove: removeCredential,
    upsert: upsertCredential,
  } = useCredentials();
  const {
    reset,
    settings,
    updateAppearance,
    updateBasic,
    updateFileTransfer,
    updateTerminalTheme,
  } = useSettings();
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeTabByConnectionId, setActiveTabByConnectionId] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<"workspace" | "settings">("workspace");
  const [settingsSectionRequest, setSettingsSectionRequest] =
    useState<"basic" | "credentials" | "appearance" | "terminalTheme" | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const terminalTabsRef = useRef<TerminalTab[]>([]);
  const terminalWarmupCaptureStopsRef = useRef(new Map<string, () => void>());
  const [terminalDirectories, setTerminalDirectories] = useState<Record<string, string>>({});
  const [remoteFileTabs, setRemoteFileTabs] = useState<RemoteFileEditorTab[]>([]);
  const [activeRemoteFileTabId, setActiveRemoteFileTabId] = useState<string | null>(null);
  const [remoteFileRefreshRequest, setRemoteFileRefreshRequest] =
    useState<RemoteFileRefreshRequest | null>(null);
  const [pendingRemoteFileCloseId, setPendingRemoteFileCloseId] = useState<string | null>(null);
  const [pendingRemoteFileConflictId, setPendingRemoteFileConflictId] = useState<string | null>(null);
  const [remoteFileDeleteTarget, setRemoteFileDeleteTarget] =
    useState<{ connectionId: string; entry: RemoteFileEntry } | null>(null);
  const [remoteFileTextAction, setRemoteFileTextAction] = useState<RemoteFileTextAction | null>(null);
  const [remoteFileTextValue, setRemoteFileTextValue] = useState("");
  const [remoteFileTextError, setRemoteFileTextError] = useState<string | null>(null);
  const [rightTool, setRightTool] = useState<RemoteFileTool>("files");
  const [remoteFileTransfers, setRemoteFileTransfers] = useState<RemoteFileTransferItem[]>([]);
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
  const [pendingConnectionGroupId, setPendingConnectionGroupId] = useState<string | null>(null);
  const [connectionGroupCatalog, setConnectionGroupCatalog] =
    useState<ConnectionGroupCatalog>({ assignments: {}, groups: [] });
  const desktopPlatform = useMemo(() => resolveDesktopPlatform(), []);
  const [supportedWindowMaterials, setSupportedWindowMaterials] = useState<WindowMaterialMode[]>(
    () => getPlatformWindowMaterials(desktopPlatform),
  );
  const workspaceShellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

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
  const connectionSessions = useMemo(
    () =>
      Array.from(terminalTabsByConnection.entries()).map(([connectionId, tabs]) => ({
        connectionId,
        tabs,
      })),
    [terminalTabsByConnection],
  );
  const activeConnectionTabs = activeConnectionId
    ? terminalTabsByConnection.get(activeConnectionId) || []
    : [];
  const activeTerminalTab = activeTabId
    ? terminalTabs.find((tab) => tab.id === activeTabId) || null
    : null;
  const activeConnectedTerminalTab =
    activeTerminalTab?.type === "terminal" && activeTerminalTab.sessionId
      ? activeTerminalTab
      : null;
  const activeRemoteFileTabs = activeConnectionId && activeConnectedTerminalTab
    ? remoteFileTabs.filter((tab) => tab.connectionId === activeConnectionId)
    : [];
  const activeRemoteFileTab =
    (activeRemoteFileTabId
      ? activeRemoteFileTabs.find((tab) => tab.id === activeRemoteFileTabId) || null
      : null) ||
    activeRemoteFileTabs[0] ||
    null;
  const hasSessionWorkspace = terminalTabs.length > 0 || remoteFileTabs.length > 0;
  const showingHome = homeActive || !hasSessionWorkspace;
  const showSessionWorkspace = !showingHome && hasSessionWorkspace;
  const activeTerminalDirectory = activeConnectedTerminalTab
    ? terminalDirectories[activeConnectedTerminalTab.id] || null
    : null;
  const remoteFileConnection = activeConnectedTerminalTab ? activeConnection : null;
  const remoteFilePanelKey = remoteFileConnection?.id || "no-active-connection";
  const terminalColorScheme = getTerminalColorScheme(settings.terminalTheme.scheme);
  const terminalTone = getTerminalColorSchemeTone(terminalColorScheme);
  const terminalFontFamily = resolveTerminalFontFamily(settings.appearance);
  const pendingRemoteFileCloseTab = pendingRemoteFileCloseId
    ? remoteFileTabs.find((tab) => tab.id === pendingRemoteFileCloseId) || null
    : null;
  const pendingRemoteFileConflictTab = pendingRemoteFileConflictId
    ? remoteFileTabs.find((tab) => tab.id === pendingRemoteFileConflictId) || null
    : null;
  const remoteFileDeleteAffectedTabs = remoteFileDeleteTarget
    ? remoteFileTabs.filter((tab) =>
        isRemoteFileTabUnderEntry(tab, remoteFileDeleteTarget.connectionId, remoteFileDeleteTarget.entry.path),
      )
    : [];
  const remoteFileDeleteDirtyCount = remoteFileDeleteAffectedTabs.filter((tab) => tab.dirty).length;
  const transferBadgeCount = remoteFileTransfers.filter((item) =>
    ["queued", "running", "error"].includes(item.status),
  ).length;
  const transferAttention = remoteFileTransfers.some((item) => item.status === "error");
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
    void setWindowMaterial(effectiveWindowMaterial);
  }, [effectiveWindowMaterial]);

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
  ]);

  const updateTabStatus = useCallback((tabId: string, status: string) => {
    setTerminalTabs((tabs) =>
      tabs.map((tab) => (tab.id === tabId && tab.status !== status ? { ...tab, status } : tab)),
    );
  }, []);

  const updateTerminalDirectory = useCallback((tabId: string, path: string) => {
    setTerminalDirectories((directories) =>
      directories[tabId] === path ? directories : { ...directories, [tabId]: path },
    );
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

  function triggerRemoteFileRefresh(path: string) {
    setRemoteFileRefreshRequest((request) => ({
      id: (request?.id || 0) + 1,
      path: normalizeRemotePath(path),
    }));
  }

  function applyRemoteTransferProgress(event: RemoteFileTransferProgressEvent) {
    setRemoteFileTransfers((items) =>
      items.map((item) => {
        if (item.id !== event.transfer_id || item.status !== "running") {
          return item;
        }

        const totalBytes = event.total_bytes || 0;
        const progress =
          totalBytes > 0
            ? interpolateTransferProgress(38, 92, event.loaded_bytes, totalBytes)
            : item.progress;

        return {
          ...item,
          progress: clampTransferProgress(progress),
          progressDetail: formatTransferProgressBytes(event.loaded_bytes, totalBytes),
          progressIndeterminate: totalBytes <= 0,
          speedText: formatTransferSpeed(
            calculateTransferAverageSpeed(event.loaded_bytes, item.createdAt),
          ),
        };
      }),
    );
  }

  function addRemoteFileTransfer(input: {
    direction: TransferDirection;
    kind: TransferKind;
    name: string;
    progress?: number;
    progressDetail?: string | null;
    progressIndeterminate?: boolean;
    remotePath: string;
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
      speedText: input.speedText ?? null,
      stage: input.stage,
      status: "queued",
    };
    setRemoteFileTransfers((items) => [item, ...items]);
    return id;
  }

  function updateRemoteFileTransfer(
    transferId: string,
    update: Partial<Omit<RemoteFileTransferItem, "id" | "createdAt">>,
  ) {
    setRemoteFileTransfers((items) =>
      items.map((item) => (item.id === transferId ? { ...item, ...update } : item)),
    );
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

  function cancelQueuedTransfer(transferId: string) {
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
    setRemoteFileTransfers((items) =>
      items.filter((item) => item.status === "queued" || item.status === "running"),
    );
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

  function failTransfer(transferId: string, stage: string, error: unknown) {
    updateRemoteFileTransfer(transferId, {
      error: formatError(error),
      progress: 100,
      progressDetail: null,
      progressIndeterminate: false,
      speedText: null,
      stage,
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
    entry: RemoteFileEntry,
    transferId: string,
  ): Promise<RemoteFileTransferConflictPolicy | "failed" | null> {
    const defaultPolicy = settings.fileTransfer.conflictPolicyDefault;
    if (defaultPolicy !== "ask") {
      return toRemoteFileConflictPolicy(defaultPolicy);
    }

    if (!hasTauriRuntime() || !activeConnection) {
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
      check = await remoteFileCheckDownloadTarget(downloadTargetOptions(activeConnection, entry));
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
    remotePath: string,
    transferId: string,
  ): Promise<RemoteFileTransferConflictPolicy | "failed" | null> {
    const defaultPolicy = settings.fileTransfer.conflictPolicyDefault;
    if (defaultPolicy !== "ask") {
      return toRemoteFileConflictPolicy(defaultPolicy);
    }

    if (!hasTauriRuntime() || !activeConnection) {
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
      check = await remoteFileCheckPath(activeConnection.id, remotePath);
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
    setActiveConnectionId(tab.connectionId);
    setActiveRemoteFileTabId(tab.id);

    const sameConnectionActiveTerminal = activeTabId
      ? terminalTabs.find((item) => item.id === activeTabId && item.connectionId === tab.connectionId)
      : null;
    const terminalTab = sameConnectionActiveTerminal || preferredTabForConnection(tab.connectionId);
    if (terminalTab) {
      setActiveTabId(terminalTab.id);
      rememberActiveTab(terminalTab);
    }
  }

  function nextRemoteFileTabAfterClose(closedTabId: string) {
    const closedTab = remoteFileTabs.find((tab) => tab.id === closedTabId) || null;

    return (
      (closedTab
        ? remoteFileTabs.find((tab) => tab.id !== closedTabId && tab.connectionId === closedTab.connectionId)
        : null) ||
      activeRemoteFileTabs.find((tab) => tab.id !== closedTabId) ||
      remoteFileTabs.find((tab) => tab.id !== closedTabId) ||
      null
    );
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

    setActiveConnectionId(null);
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
        triggerRemoteFileRefresh(remotePathParent(tab.path));
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

  function closeRemoteFileTab(tabId: string) {
    const tab = remoteFileTabs.find((item) => item.id === tabId);
    if (tab?.dirty) {
      setPendingRemoteFileCloseId(tabId);
      return;
    }
    closeRemoteFileTabNow(tabId);
  }

  function closeRemoteFileTabNow(tabId: string) {
    setRemoteFileTabs((tabs) => tabs.filter((tab) => tab.id !== tabId));
    if (activeRemoteFileTabId === tabId) {
      const nextTab = nextRemoteFileTabAfterClose(tabId);
      if (nextTab) {
        activateRemoteFileTab(nextTab);
      } else {
        setActiveRemoteFileTabId(null);
        activateTerminalFallbackAfterFilesClose();
      }
    }
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
    if (!activeConnection) {
      return;
    }
    setRemoteFileDeleteTarget({ connectionId: activeConnection.id, entry });
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
        triggerRemoteFileRefresh(remotePathParent(metadata.path));
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
        triggerRemoteFileRefresh(action.parentPath);
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
        triggerRemoteFileRefresh(remotePathParent(action.entry.path));
        triggerRemoteFileRefresh(remotePathParent(newPath));
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

    if (hasTauriRuntime()) {
      await remoteFileDelete({
        connectionId: target.connectionId,
        path: target.entry.path,
        recursive: target.entry.type === "directory",
      });
    }
    triggerRemoteFileRefresh(remotePathParent(target.entry.path));
    const nextRemoteFileTabs = remoteFileTabs.filter(
      (tab) => !isRemoteFileTabUnderEntry(tab, target.connectionId, target.entry.path),
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

  async function runLocalFileUpload(parentPath: string, localPath: string) {
    if (!activeConnection) {
      return;
    }
    const localName = localPathName(localPath);
    const uploadPath = joinRemotePath(parentPath, localName);
    const transferId = addRemoteFileTransfer({
      direction: "upload",
      kind: "file",
      name: localName,
      progress: 0,
      remotePath: uploadPath,
      stage: "等待上传",
    });

    let stopPulse: (() => void) | null = null;
    try {
      const conflictPolicy = await resolveUploadConflictPolicy(uploadPath, transferId);
      if (conflictPolicy === "failed") {
        return;
      }
      if (!conflictPolicy) {
        cancelTransfer(transferId);
        return;
      }

      stopPulse = startTransferProgressPulse(transferId, {
        cap: 92,
        detail: null,
        start: 8,
        stage: "上传中",
      });
      const result = await remoteFileUploadLocalFile({
        connectionId: activeConnection.id,
        conflictPolicy,
        localPath,
        path: uploadPath,
        transferId,
      }).finally(() => stopPulse?.());
      finishUploadTransfer(transferId, result);
    } catch (error) {
      stopPulse?.();
      failTransfer(transferId, "上传失败", error);
    }
  }

  async function runLocalDirectoryUpload(parentPath: string, localPath: string) {
    if (!activeConnection) {
      return;
    }
    const rootName = localPathName(localPath);
    const remotePath = joinRemotePath(parentPath, rootName);
    const transferId = addRemoteFileTransfer({
      direction: "upload",
      kind: "directory",
      name: rootName,
      progress: 0,
      remotePath,
      stage: "等待打包",
    });

    let stopPulse: (() => void) | null = null;
    try {
      const conflictPolicy = await resolveUploadConflictPolicy(remotePath, transferId);
      if (conflictPolicy === "failed") {
        return;
      }
      if (!conflictPolicy) {
        cancelTransfer(transferId);
        return;
      }

      stopPulse = startTransferProgressPulse(transferId, {
        cap: 92,
        detail: null,
        start: 8,
        stage: "本地打包并上传",
      });
      const result = await remoteFileUploadLocalArchive({
        connectionId: activeConnection.id,
        conflictPolicy,
        keepArchive: settings.fileTransfer.keepArchives,
        localPath,
        rootName,
        targetDir: parentPath,
        transferId,
      }).finally(() => stopPulse?.());
      finishArchiveUploadTransfer(transferId, result);
    } catch (error) {
      stopPulse?.();
      failTransfer(transferId, "目录上传失败", error);
    }
  }

  async function runSingleFileUpload(parentPath: string, item: RemoteFileUploadItem) {
    if (!activeConnection) {
      return;
    }
    const uploadPath = joinRemotePath(parentPath, item.file.name);
    const transferId = addRemoteFileTransfer({
      direction: "upload",
      kind: "file",
      name: item.file.name,
      progress: 0,
      remotePath: uploadPath,
      stage: "等待上传",
    });

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
      finishUploadTransfer(transferId, result);
      return;
    }

    let localPath: string | null = null;
    try {
      const conflictPolicy = await resolveUploadConflictPolicy(uploadPath, transferId);
      if (conflictPolicy === "failed") {
        return;
      }
      if (!conflictPolicy) {
        cancelTransfer(transferId);
        return;
      }

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
      const stopPulse = startTransferProgressPulse(transferId, {
        cap: 92,
        detail: formatTransferProgressBytes(item.file.size, item.file.size),
        start: 36,
        stage: "上传中",
      });
      const result = await remoteFileUploadLocalFile({
        connectionId: activeConnection.id,
        conflictPolicy,
        localPath,
        path: uploadPath,
        transferId,
      }).finally(stopPulse);
      finishUploadTransfer(transferId, result);
    } catch (error) {
      failTransfer(transferId, "上传失败", error);
    } finally {
      if (localPath) {
        void remoteFileDeleteUploadTemp(localPath).catch(() => undefined);
      }
    }
  }

  async function runDirectoryUpload(
    parentPath: string,
    rootName: string,
    items: RemoteFileUploadItem[],
  ) {
    if (!activeConnection) {
      return;
    }
    const remotePath = joinRemotePath(parentPath, rootName);
    const transferId = addRemoteFileTransfer({
      direction: "upload",
      kind: "directory",
      name: rootName,
      progress: 0,
      remotePath,
      stage: "等待打包",
    });

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
      finishArchiveUploadTransfer(transferId, result);
      return;
    }

    let localPath: string | null = null;
    try {
      const conflictPolicy = await resolveUploadConflictPolicy(remotePath, transferId);
      if (conflictPolicy === "failed") {
        return;
      }
      if (!conflictPolicy) {
        cancelTransfer(transferId);
        return;
      }

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
        connectionId: activeConnection.id,
        conflictPolicy,
        keepArchive: settings.fileTransfer.keepArchives,
        localPath,
        rootName,
        targetDir: parentPath,
        transferId,
      }).finally(stopPulse);
      finishArchiveUploadTransfer(transferId, result);
    } catch (error) {
      failTransfer(transferId, "目录上传失败", error);
    } finally {
      if (localPath) {
        void remoteFileDeleteUploadTemp(localPath).catch(() => undefined);
      }
    }
  }

  function finishUploadTransfer(transferId: string, result: RemoteFileUploadResult) {
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
    triggerRemoteFileRefresh(remotePathParent(result.path));
  }

  function finishArchiveUploadTransfer(transferId: string, result: RemoteFileArchiveUploadResult) {
    updateRemoteFileTransfer(transferId, {
      name: result.name,
      progress: 100,
      progressDetail: result.skipped ? null : "100%",
      progressIndeterminate: false,
      remotePath: result.path,
      speedText: null,
      stage: result.skipped ? "已跳过" : "远端解压完成",
      status: result.skipped ? "skipped" : "success",
    });
    triggerRemoteFileRefresh(remotePathParent(result.path));
  }

  function downloadRemoteFile(entry: RemoteFileEntry) {
    if (!activeConnection) {
      return;
    }
    void runRemoteFileDownload(entry);
  }

  async function runRemoteFileDownload(entry: RemoteFileEntry) {
    if (!activeConnection) {
      return;
    }
    const connection = activeConnection;
    const isDirectory = entry.type === "directory";
    const transferId = addRemoteFileTransfer({
      direction: "download",
      kind: isDirectory ? "directory" : "file",
      name: entry.name,
      progress: 0,
      remotePath: entry.path,
      stage: isDirectory ? "等待远端打包" : "等待下载",
    });

    let stopPulse: (() => void) | null = null;
    try {
      const downloadOptions = downloadTargetOptions(connection, entry);
      const conflictPolicy = await resolveDownloadConflictPolicy(entry, transferId);
      if (conflictPolicy === "failed") {
        return;
      }
      if (!conflictPolicy) {
        cancelTransfer(transferId);
        return;
      }

      stopPulse = startTransferProgressPulse(transferId, {
        cap: 92,
        detail: null,
        start: 8,
        stage: isDirectory ? "远端打包并下载" : "下载到本地",
      });
      const result = hasTauriRuntime()
        ? await remoteFileDownloadToLocal({
            ...downloadOptions,
            conflictPolicy,
            keepArchives: settings.fileTransfer.keepArchives,
            transferId,
          }).finally(() => stopPulse?.())
        : await wait(300).then(() => {
            stopPulse?.();
            return previewRemoteFileDownloadToLocalResult(entry, isDirectory);
          });
      finishDownloadTransfer(transferId, result);
    } catch (error) {
      stopPulse?.();
      failTransfer(transferId, "下载失败", error);
    }
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
      stage: result.skipped ? "已跳过" : result.directory ? "本地解压完成" : "下载完成",
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

  function createConnection(groupId?: string) {
    setLeftPaneCollapsed(false);
    setPendingConnectionGroupId(groupId || null);
    setEditingConnection(null);
    setDialogOpen(true);
  }

  function openHome() {
    setHomeActive(true);
  }

  function editConnection(connection: ConnectionProfile) {
    setPendingConnectionGroupId(null);
    setEditingConnection(connection);
    setDialogOpen(true);
  }

  async function saveConnection(input: ConnectionProfileInput) {
    const saved = await upsert({
      ...input,
      group: input.group || pendingConnectionGroupId || undefined,
    });
    setSelectedConnectionId(saved.id);
    setPendingConnectionGroupId(null);
    return saved;
  }

  async function deleteConnection(connection: ConnectionProfile) {
    await remove(connection.id);
    const closingTabIds = terminalTabs.filter((tab) => tab.connectionId === connection.id).map((tab) => tab.id);
    closingTabIds.forEach(stopTerminalWarmupCapture);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs([connection.id]);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id);
      terminalTabsRef.current = nextTabs;
      if (nextTabs.length === 0) {
        setHomeActive(true);
      }
      if (!nextTabs.some((tab) => tab.id === activeTabId)) {
        setActiveTabId(nextTabs[0]?.id || null);
      }
      if (!nextTabs.some((tab) => tab.connectionId === activeConnectionId)) {
        setActiveConnectionId(nextTabs[0]?.connectionId || null);
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

  function buildDirectTerminalTab(tabs: TerminalTab[], connection: ConnectionProfile): TerminalTab {
    const now = Date.now();
    const nextIndex = nextTerminalIndexForConnection(tabs, connection.id);

    return {
      connectionId: connection.id,
      connectionStep: null,
      id: `terminal-${connection.id}-${now.toString()}`,
      index: nextIndex,
      requestId: `terminal-${connection.id}-${now.toString()}`,
      status: "正在连接",
      title: terminalTabTitle(nextIndex),
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

  function rememberActiveTab(tab: TerminalTab) {
    setActiveTabByConnectionId((activeTabs) =>
      activeTabs[tab.connectionId] === tab.id
        ? activeTabs
        : { ...activeTabs, [tab.connectionId]: tab.id },
    );
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
    setHomeActive(false);
    setActiveConnectionId(tab.connectionId);
    setActiveTabId(tab.id);
    rememberActiveTab(tab);
  }

  function selectConnection(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);
  }

  function openConnectionSession(connection: ConnectionProfile) {
    const pendingTab = pendingTabForConnection(connection.id);
    if (pendingTab) {
      activateTerminalTab(pendingTab);
      return;
    }

    startConnectionStep(connection, "terminal");
  }

  function openTerminal(connection: ConnectionProfile) {
    startConnectionStep(connection, "terminal");
  }

  function closeTerminal(tabId: string) {
    stopTerminalWarmupCapture(tabId);
    setTerminalDirectories((directories) => removeDirectoryState(directories, [tabId]));
    setTerminalTabs((tabs) => {
      const closingTab = tabs.find((tab) => tab.id === tabId);
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      terminalTabsRef.current = nextTabs;
      if (nextTabs.length === 0 && remoteFileTabs.length === 0) {
        setHomeActive(true);
      }
      if (activeTabId === tabId) {
        const nextActiveTab =
          (closingTab
            ? nextTabs.find((tab) => tab.connectionId === closingTab.connectionId)
            : null) ||
          nextTabs[0] ||
          null;
        const nextActiveFile =
          (closingTab
            ? remoteFileTabs.find((tab) => tab.connectionId === closingTab.connectionId)
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
        } else if (closingTab) {
          forgetActiveConnectionTabs([closingTab.connectionId]);
        }
      } else if (
        closingTab &&
        activeConnectionId === closingTab.connectionId &&
        !nextTabs.some((tab) => tab.connectionId === closingTab.connectionId)
      ) {
        const nextActiveFile =
          remoteFileTabs.find((tab) => tab.connectionId === closingTab.connectionId) ||
          remoteFileTabs[0] ||
          null;
        setActiveConnectionId(nextTabs[0]?.connectionId || nextActiveFile?.connectionId || null);
        forgetActiveConnectionTabs([closingTab.connectionId]);
      }
      return nextTabs;
    });
  }

  function closeConnectionSession(connectionId: string) {
    const closingTabIds = terminalTabs.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.id);
    closingTabIds.forEach(stopTerminalWarmupCapture);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs([connectionId]);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connectionId);
      terminalTabsRef.current = nextTabs;
      if (nextTabs.length === 0 && remoteFileTabs.length === 0) {
        setHomeActive(true);
      }

      if (activeConnectionId === connectionId) {
        const nextActiveTab = nextTabs[0] || null;
        const nextActiveFile =
          remoteFileTabs.find((tab) => tab.connectionId === connectionId) ||
          remoteFileTabs[0] ||
          null;
        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
        if (nextActiveFile) {
          setActiveRemoteFileTabId(nextActiveFile.id);
        }
      }

      return nextTabs;
    });
  }

  function openTerminalInActiveConnection() {    if (activeConnection) {
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

  async function runDirectTerminalTab(tab: TerminalTab, connection: ConnectionProfile) {
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

  async function moveConnectionToGroup(connection: ConnectionProfile, groupId: string | null) {
    await upsert(connectionToInput({ ...connection, group: groupId || undefined }));
  }

  async function toggleConnectionFavorite(connection: ConnectionProfile) {
    await setFavorite(connection.id, !connection.is_favorite);
  }

  function openCredentialSettings() {
    closeConnectionDialog();
    setSettingsSectionRequest("credentials");
    setActiveView("settings");
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
    if (side === "right" && (rightPaneCollapsed || !showSessionWorkspace)) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftPaneWidth : rightPaneWidth;
    const oppositeWidth = side === "left"
      ? (showSessionWorkspace && !rightPaneCollapsed ? rightPaneWidth : 0)
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
      const oppositeWidth = showSessionWorkspace && !rightPaneCollapsed ? rightPaneWidth : 0;
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

  return (
    <div
      className="app-shell"
      data-home-active={showingHome}
      data-density={settings.appearance.density}
      data-left-collapsed={leftPaneCollapsed}
      data-pane-resizing={resizingPane || undefined}
      data-platform={desktopPlatform}
      data-right-collapsed={rightPaneCollapsed}
      data-theme-mode={settings.appearance.themeMode}
      data-window-material={effectiveWindowMaterial}
      style={appShellStyle}
    >
      <AppTitlebar
        activeConnectionId={activeConnectionId}
        connectionById={connectionById}
        connectionSessions={connectionSessions}
        homeActive={showingHome}
        leftPaneCollapsed={leftPaneCollapsed}
        onCloseConnectionSession={closeConnectionSession}
        onOpenHome={openHome}
        onSelectConnectionSession={(connectionId) => {
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
          onOpenSettings={() => setActiveView("settings")}
          onRefresh={reload}
          onSelect={selectConnection}
          onToggleFavorite={toggleConnectionFavorite}
          selectedId={selectedConnectionId}
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
            onRefresh={reload}
            hidden={!showingHome}
          />

          {hasSessionWorkspace ? (
            <section
              className={`session-workbench ${showingHome ? "is-hidden" : ""}`}
              data-editor-open={activeRemoteFileTabs.length > 0 ? "true" : "false"}
              aria-label="编辑器和终端"
              aria-hidden={showingHome}
            >
              {activeRemoteFileTabs.length > 0 ? (
                <section className="remote-editor-pane" aria-label="远程文件编辑区">
                  <nav className="remote-editor-tabs" aria-label="远程文件标签">
                    {activeRemoteFileTabs.map((tab) => (
                      <div
                        className={`subtab-shell file-tab ${tab.id === activeRemoteFileTab?.id ? "active" : ""}`}
                        key={tab.id}
                      >
                        <button
                          className="subtab"
                          type="button"
                          title={tab.path}
                          onClick={() => activateRemoteFileTab(tab)}
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
                    ))}
                  </nav>

                  <section className="remote-editor-stack" aria-label="文件编辑器">
                    {remoteFileTabs.map((tab) => (
                      <RemoteFileEditor
                        active={!showingHome && tab.id === activeRemoteFileTab?.id}
                        fontFamily={terminalFontFamily}
                        fontSize={settings.appearance.terminalFontSize}
                        key={tab.id}
                        tab={tab}
                        onChange={handleRemoteFileChange}
                        onClose={closeRemoteFileTab}
                        onDiscard={discardRemoteFileChanges}
                        onReload={reloadRemoteFile}
                        onSave={saveRemoteFile}
                      />
                    ))}
                  </section>
                </section>
              ) : null}

              {activeRemoteFileTabs.length > 0 ? (
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
                className="terminal-workbench-pane"
                data-terminal-tone={terminalTone}
                aria-label="终端区"
              >
                <nav className="terminal-subtabs" aria-label="当前连接终端标签">
                  {activeConnectionTabs.map((tab) => (
                    <div
                      className={`subtab-shell ${tab.id === activeTabId ? "active" : ""}`}
                      key={tab.id}
                    >
                      <button
                        className="subtab"
                        type="button"
                        onClick={() => activateTerminalTab(tab)}
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
                  ))}
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
                </nav>

                <section className="terminal-stack" aria-label="终端">
                  {terminalTabs.map((tab) => {
                    const tabStep = tab.type === "connecting" ? tab.connectionStep : null;
                    return tabStep ? (
                      <ConnectionStepPanel
                        key={tab.id}
                        step={tabStep}
                        active={!showingHome && tab.id === activeTabId}
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
                      <TerminalPanel
                        active={!showingHome && tab.id === activeTabId}
                        connection={connectionById.get(tab.connectionId) || null}
                        fontFamily={terminalFontFamily}
                        fontSize={settings.appearance.terminalFontSize}
                        initialSessionId={tab.sessionId}
                        initialOutput={tab.warmupOutput}
                        initialRequestId={tab.requestId}
                        key={tab.id}
                        onCurrentDirectoryChange={updateTerminalDirectory}
                        onStatusChange={updateTabStatus}
                        onWarmupCaptureReady={stopTerminalWarmupCapture}
                        tabId={tab.id}
                        theme={terminalColorScheme.theme}
                        title={tab.title}
                      />
                    ) : tab.type === "terminal" ? (
                      <DirectTerminalStatusPanel
                        active={!showingHome && tab.id === activeTabId}
                        connection={connectionById.get(tab.connectionId) || null}
                        error={tab.error || null}
                        status={tab.status}
                        title={tab.title}
                      />
                    ) : null;
                  })}
                </section>
              </section>
            </section>
          ) : null}
        </section>

        {showSessionWorkspace && rightPaneCollapsed ? (
          <Tooltip label="展开右侧面板">
            <button
              className="right-collapse-button right-collapse-button-floating"
              type="button"
              aria-label="展开右侧面板"
              aria-expanded={false}
              onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
            >
              <ChevronLeft className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}

        {showSessionWorkspace && !rightPaneCollapsed ? (
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

        {hasSessionWorkspace ? (
          <RemoteFilePanel
            activeTool={rightTool}
            connection={remoteFileConnection}
            key={remoteFilePanelKey}
            refreshRequest={remoteFileRefreshRequest}
            transferAttention={transferAttention}
            transferCount={transferBadgeCount}
            nativeDropTargetPath={nativeFileDropTargetPath}
            monitorPanel={
              <MonitorPanel
                active={showSessionWorkspace && !rightPaneCollapsed && rightTool === "monitor"}
                connection={remoteFileConnection}
              />
            }
            transferPanel={
              <RemoteFileTransferPanel
                transfers={remoteFileTransfers}
                onCancel={cancelQueuedTransfer}
                onClearFinished={clearFinishedTransfers}
                onCopyPath={copyRemotePath}
                onOpenLocalPath={openLocalTransferPath}
                onRevealLocalPath={revealLocalTransferPath}
              />
            }
            onCopyPath={copyRemotePath}
            onCreateDirectory={requestCreateRemoteDirectory}
            onCreateFile={requestCreateRemoteFile}
            onDeleteEntry={requestDeleteRemoteEntry}
            onDownloadEntry={downloadRemoteFile}
            onOpenFile={openRemoteFile}
            onRenameEntry={requestRenameRemoteEntry}
            onShowProperties={showRemoteFileProperties}
            onToolChange={setRightTool}
            onToggleRightPane={() => setRightPaneCollapsed((collapsed) => !collapsed)}
            onUploadDirectory={uploadRemoteDirectory}
            onUploadFile={uploadRemoteFile}
            onUploadItems={uploadRemoteItems}
            terminalPath={activeTerminalDirectory}
          />
        ) : null}

        <ConnectionDialog
          connection={editingConnection}
          connections={connections}
          credentials={credentials}
          defaultGroup={pendingConnectionGroupId}
          groups={connectionGroupCatalog.groups}
          onClose={closeConnectionDialog}
          onDelete={deleteConnection}
          onManageCredentials={openCredentialSettings}
          onSave={saveConnectionFromDialog}
          onTest={testConnectionFromDialog}
          onTrustHostKey={knownHostTrust}
          open={dialogOpen}
        />
      </main>

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
        confirmLabel="删除"
        description={
          remoteFileDeleteTarget
            ? remoteFileDeleteDescription(
                remoteFileDeleteTarget.entry.path,
                remoteFileDeleteAffectedTabs.length,
                remoteFileDeleteDirtyCount,
              )
            : ""
        }
        open={Boolean(remoteFileDeleteTarget)}
        title="删除远程文件"
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

      <SettingsView
        activeSection={settingsSectionRequest}
        credentials={credentials}
        credentialError={credentialError}
        credentialLoading={credentialLoading}
        effectiveWindowMaterial={effectiveWindowMaterial}
        hidden={activeView !== "settings"}
        settings={settings}
        supportedWindowMaterials={supportedWindowMaterials}
        onDeleteCredential={deleteCredentialFromSettings}
        onReset={reset}
        onReturnWorkspace={() => setActiveView("workspace")}
        onSaveCredential={saveCredentialFromSettings}
        onUpdateAppearance={updateAppearance}
        onUpdateBasic={updateBasic}
        onUpdateFileTransfer={updateFileTransfer}
        onUpdateTerminalTheme={updateTerminalTheme}
      />
    </div>
  );

  function closeConnectionDialog() {
    setDialogOpen(false);
    setPendingConnectionGroupId(null);
  }
}

function RemoteFileTransferPanel({
  transfers,
  onCancel,
  onClearFinished,
  onCopyPath,
  onOpenLocalPath,
  onRevealLocalPath,
}: {
  transfers: RemoteFileTransferItem[];
  onCancel: (transferId: string) => void;
  onClearFinished: () => void;
  onCopyPath: (path: string) => void;
  onOpenLocalPath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
}) {
  const finishedCount = transfers.filter((item) =>
    ["success", "skipped", "canceled"].includes(item.status),
  ).length;

  return (
    <section className="transfer-panel" aria-label="文件传输">
      <header className="transfer-panel-head">
        <span>
          <strong>传输</strong>
          <small>{transfers.length === 0 ? "无任务" : `${transfers.length.toString()} 项任务`}</small>
        </span>
        <button type="button" disabled={finishedCount === 0} onClick={onClearFinished}>
          清理完成项
        </button>
      </header>

      <div className="transfer-list">
        {transfers.length === 0 ? (
          <p className="file-panel-empty">上传和下载任务会显示在这里。</p>
        ) : (
          transfers.map((item) => {
            const progressValue = clampTransferProgress(item.progress);
            const progressLabel = `${Math.round(progressValue).toString()}%`;
            const progressText = item.progressDetail || progressLabel;

            return (
              <article className={`transfer-item ${item.status}`} key={item.id}>
                <header>
                  <span className="transfer-kind">
                    {item.direction === "upload" ? "上传" : "下载"}
                    {" / "}
                    {item.kind === "directory" ? "目录" : "文件"}
                  </span>
                  <span className="transfer-status">{transferStatusLabel(item.status)}</span>
                </header>
                <strong title={item.name}>{item.name}</strong>
                <div className="transfer-progress-summary">
                  <small>{item.stage}</small>
                  <span>
                    {progressText}
                    {item.speedText ? <em>{item.speedText}</em> : null}
                  </span>
                </div>
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
                <code title={item.remotePath}>{item.remotePath}</code>
                {item.localPath ? <code title={item.localPath}>{item.localPath}</code> : null}
                {item.error ? <p className="transfer-error">{item.error}</p> : null}
                <footer>
                  <button type="button" onClick={() => onCopyPath(item.localPath || item.remotePath)}>
                    <Clipboard className="ui-icon" aria-hidden="true" />
                    复制路径
                  </button>
                  {item.localPath ? (
                    <>
                      <button type="button" onClick={() => onOpenLocalPath(item.localPath || "")}>
                        打开
                      </button>
                      <button type="button" onClick={() => onRevealLocalPath(item.localPath || "")}>
                        定位
                      </button>
                    </>
                  ) : null}
                  {item.status === "queued" ? (
                    <button type="button" onClick={() => onCancel(item.id)}>
                      <X className="ui-icon" aria-hidden="true" />
                      取消
                    </button>
                  ) : null}
                </footer>
              </article>
            );
          })
        )}
      </div>
    </section>
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

      return true;
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
    () => [...connections].sort(sortConnectionsByRecent).slice(0, 2),
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
          <button className="repository-primary-button" type="button" onClick={onCreateConnection}>
            <Plus className="ui-icon" aria-hidden="true" />
            <span>新建 SSH</span>
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
                  <span className="connection-name">{connection.name}</span>
                  <span className="connection-user">{connection.username}@{connection.host}:{connection.port.toString()}</span>
                </span>
                <span className="remark-cell">
                  <span className="remark-main">{primaryNote(connection)}</span>
                  <span className="remark-sub">{credentialLabel(connection)}</span>
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
              {activityConnections.map((connection) => (
                <button
                  className="activity-row"
                  key={connection.id}
                  type="button"
                  onClick={() => onConnect(connection)}
                >
                  <span className="latency-dot" />
                  <span>
                    <strong>{connection.name}</strong>
                    <span>
                      {connection.last_connected_at
                        ? formatRelativeTime(connection.last_connected_at)
                        : "未连接"}
                    </span>
                  </span>
                </button>
              ))}
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

function sortConnectionsByRecent(left: ConnectionProfile, right: ConnectionProfile) {
  const rightConnectedAt = timestampOf(right.last_connected_at);
  const leftConnectedAt = timestampOf(left.last_connected_at);

  if (rightConnectedAt !== leftConnectedAt) {
    return rightConnectedAt - leftConnectedAt;
  }

  const createdDiff = timestampOf(right.created_at) - timestampOf(left.created_at);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return left.name.localeCompare(right.name, "zh-Hans");
}

function timestampOf(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function primaryNote(connection: ConnectionProfile) {
  const note = connection.notes?.trim();
  if (!note) {
    return "无备注";
  }

  return note.split(/[;；,，]/)[0]?.trim() || note;
}

function credentialLabel(connection: ConnectionProfile) {
  if (connection.credential_mode === "saved") {
    return "保存凭据";
  }
  if (connection.credential_mode === "prompt") {
    return "每次询问";
  }
  const authKind = connection.inline_auth_kind || connection.auth_kind;
  return authKind === "private_key" ? "密钥登录" : "密码登录";
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

function formatRelativeTime(value?: string | null) {
  const timestamp = timestampOf(value);

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
  const dated = connections.filter((connection) => timestampOf(connection.last_connected_at) > 0);

  return dated.filter((connection) => now - timestampOf(connection.last_connected_at) <= week).length;
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

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
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
    proxy: connection.proxy,
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

function formatConnectionAddress(connection: ConnectionProfile) {
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
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

function remoteFileDeleteDescription(path: string, affectedTabs: number, dirtyTabs: number) {
  const base = `确认删除“${path}”吗？这个操作无法撤销。`;
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

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
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

function clampTransferProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
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
