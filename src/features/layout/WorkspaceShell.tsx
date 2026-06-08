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
import {
  Clock3,
  Clipboard,
  List,
  Loader2,
  PanelRightOpen,
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
import type { ConnectionProfile, ConnectionProfileInput } from "../connections/connectionTypes";
import { RemoteFileEditor } from "../editor/RemoteFileEditor";
import type { RemoteFileEditorTab } from "../editor/remoteFileEditorTypes";
import {
  RemoteFilePanel,
  type RemoteFileTool,
  type RemoteFileUploadItem,
} from "../files/RemoteFilePanel";
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
} from "../settings/settingsTypes";
import { useSettings } from "../settings/useSettings";
import { useConnections } from "../connections/useConnections";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  connectionProbeLatency,
  remoteFileCheckPath,
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
} from "../../shared/tauri/commands";
import { selectLocalUploadDirectories, selectLocalUploadFiles } from "../../shared/tauri/dialog";
import { listenRemoteFileTransferProgress } from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { Tooltip } from "../../shared/ui/Tooltip";
import { AppTitlebar } from "./AppTitlebar";

interface TerminalTab {
  id: string;
  connectionId: string;
  index: number;
  status: string;
  title: string;
}

interface ConnectionPlacementRequest {
  id: number;
  connectionId: string;
  groupId: string;
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
const minEditorTerminalSplitPercent = 24;
const maxEditorTerminalSplitPercent = 72;
const editorTerminalKeyboardResizeStep = 3;
const fileReadChunkBytes = 4 * 1024 * 1024;
const uploadTempAppendChunkBytes = fileReadChunkBytes;

export function WorkspaceShell() {
  const { connections, error, loading, reload, remove, upsert } = useConnections();
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
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
  const [connectionPlacementRequest, setConnectionPlacementRequest] =
    useState<ConnectionPlacementRequest | null>(null);
  const [connectionGroupCatalog, setConnectionGroupCatalog] =
    useState<ConnectionGroupCatalog>({ assignments: {}, groups: [] });
  const workspaceShellRef = useRef<HTMLElement | null>(null);

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
  const activeRemoteFileTabs = activeConnectionId
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
  const activeTerminalDirectory = activeTabId ? terminalDirectories[activeTabId] || null : null;
  const remoteFilePanelKey = activeConnection?.id || "no-active-connection";
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
  const appShellStyle = {
    ...resolveSettingsStyle(settings),
    "--editor-terminal-split-percent": `${editorTerminalSplitPercent.toString()}%`,
    "--left-pane-custom-width": `${leftPaneWidth.toString()}px`,
    "--right-pane-custom-width": `${rightPaneWidth.toString()}px`,
  } as CSSProperties;

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
    setSelectedConnectionId(tab.connectionId);
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
    setSelectedConnectionId(null);
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
    setRemoteFileTextValue(joinRemotePath(parentPath, "untitled.txt"));
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
    setRemoteFileTextValue(joinRemotePath(parentPath, "new-folder"));
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

    const value =
      action.action === "rename"
        ? remoteFileTextValue.trim()
        : normalizeRemotePath(remoteFileTextValue);
    if (!value || (action.action !== "rename" && value === "/")) {
      setRemoteFileTextError(action.action === "rename" ? "请输入有效名称。" : "请输入有效路径。");
      return;
    }
    if (action.action === "rename" && !isValidRemoteBaseName(value)) {
      setRemoteFileTextError("名称不能为空，不能包含 / 或 \\，也不能是 . 或 ..。");
      return;
    }

    try {
      if (action.action === "create-file") {
        const metadata = hasTauriRuntime()
          ? await remoteFileCreateFile(action.connectionId, value)
          : previewRemoteFileMetadata(value);
        triggerRemoteFileRefresh(remotePathParent(metadata.path));
        if (activeConnection) {
          openRemoteFile({
            name: metadata.name,
            path: metadata.path,
            type: "file",
          });
        }
      } else if (action.action === "create-directory") {
        if (hasTauriRuntime()) {
          await remoteFileCreateDirectory(action.connectionId, value);
        }
        triggerRemoteFileRefresh(remotePathParent(value));
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
    const saved = await upsert(input);
    setSelectedConnectionId(saved.id);
    if (pendingConnectionGroupId) {
      setConnectionPlacementRequest((request) => ({
        id: (request?.id || 0) + 1,
        connectionId: saved.id,
        groupId: pendingConnectionGroupId,
      }));
      setPendingConnectionGroupId(null);
    }
  }

  async function deleteConnection(connection: ConnectionProfile) {
    await remove(connection.id);
    const closingTabIds = terminalTabs.filter((tab) => tab.connectionId === connection.id).map((tab) => tab.id);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs([connection.id]);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id);
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

  function buildTerminalTab(tabs: TerminalTab[], connection: ConnectionProfile): TerminalTab {
    const nextIndex =
      Math.max(
        -1,
        ...tabs.filter((tab) => tab.connectionId === connection.id).map((tab) => tab.index),
      ) + 1;

    return {
      id: `terminal-${connection.id}-${Date.now().toString()}-${nextIndex.toString()}`,
      connectionId: connection.id,
      index: nextIndex,
      status: "等待连接",
      title: nextIndex === 0 ? "终端" : `终端 ${nextIndex.toString()}`,
    };
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

  function activateTerminalTab(tab: TerminalTab) {
    setHomeActive(false);
    setActiveConnectionId(tab.connectionId);
    setActiveTabId(tab.id);
    setSelectedConnectionId(tab.connectionId);
    rememberActiveTab(tab);
  }

  function selectConnection(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);

    const existingTab = preferredTabForConnection(connection.id);
    if (existingTab) {
      activateTerminalTab(existingTab);
    }
  }

  function openConnectionSession(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);

    const existingTab = preferredTabForConnection(connection.id);
    if (existingTab) {
      activateTerminalTab(existingTab);
      return;
    }

    openTerminal(connection);
  }

  function openTerminal(connection: ConnectionProfile) {
    setHomeActive(false);
    setSelectedConnectionId(connection.id);
    setActiveConnectionId(connection.id);
    setTerminalTabs((tabs) => {
      const tab = buildTerminalTab(tabs, connection);
      setActiveTabId(tab.id);
      setActiveTabByConnectionId((activeTabs) => ({
        ...activeTabs,
        [connection.id]: tab.id,
      }));
      return [...tabs, tab];
    });
  }

  function closeTerminal(tabId: string) {
    setTerminalDirectories((directories) => removeDirectoryState(directories, [tabId]));
    setTerminalTabs((tabs) => {
      const closingTab = tabs.find((tab) => tab.id === tabId);
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
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
        setSelectedConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
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
        setSelectedConnectionId(nextTabs[0]?.connectionId || nextActiveFile?.connectionId || null);
        forgetActiveConnectionTabs([closingTab.connectionId]);
      }
      return nextTabs;
    });
  }

  function closeConnectionSession(connectionId: string) {
    const closingTabIds = terminalTabs.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.id);
    setTerminalDirectories((directories) => removeDirectoryState(directories, closingTabIds));
    forgetActiveConnectionTabs([connectionId]);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connectionId);
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
        setSelectedConnectionId(nextActiveTab?.connectionId || nextActiveFile?.connectionId || null);
        if (nextActiveFile) {
          setActiveRemoteFileTabId(nextActiveFile.id);
        }
      }

      return nextTabs;
    });
  }

  function openTerminalInActiveConnection() {
    if (activeConnection) {
      openTerminal(activeConnection);
    }
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
      data-right-collapsed={rightPaneCollapsed}
      data-theme-mode={settings.appearance.themeMode}
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
          connectionPlacementRequest={connectionPlacementRequest}
          error={error}
          loading={loading}
          onConnect={openConnectionSession}
          onCreate={createConnection}
          onDelete={deleteConnection}
          onEdit={editConnection}
          onGroupCatalogChange={setConnectionGroupCatalog}
          onOpen={openTerminal}
          onOpenSettings={() => setActiveView("settings")}
          onRefresh={reload}
          onSelect={selectConnection}
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
                  {activeConnection ? (
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
                  {terminalTabs.map((tab) => (
                    <TerminalPanel
                      active={!showingHome && tab.id === activeTabId}
                      connection={connectionById.get(tab.connectionId) || null}
                      fontFamily={terminalFontFamily}
                      fontSize={settings.appearance.terminalFontSize}
                      key={tab.id}
                      onCurrentDirectoryChange={updateTerminalDirectory}
                      onStatusChange={updateTabStatus}
                      tabId={tab.id}
                      theme={terminalColorScheme.theme}
                      title={tab.title}
                    />
                  ))}
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
              <PanelRightOpen className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}

        {showSessionWorkspace && !rightPaneCollapsed ? (
          <div
            className="pane-resizer right-pane-resizer"
            role="separator"
            aria-label="拖拽调整右侧文件面板宽度，双击恢复默认"
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
            connection={activeConnection}
            key={remoteFilePanelKey}
            refreshRequest={remoteFileRefreshRequest}
            transferAttention={transferAttention}
            transferCount={transferBadgeCount}
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
          onClose={closeConnectionDialog}
          onDelete={deleteConnection}
          onSave={saveConnection}
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
                <label className="remote-file-path-field">
                  <span>{remoteFileTextAction?.action === "rename" ? "名称" : "远程路径"}</span>
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
        hidden={activeView !== "settings"}
        settings={settings}
        onReset={reset}
        onReturnWorkspace={() => setActiveView("workspace")}
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
  const groupById = useMemo(
    () => new Map(groups.groups.map((group) => [group.id, group])),
    [groups.groups],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...connections].sort(sortConnectionsByRecent);
    const filteredByTab = sorted.filter((connection) => {
      if (filter === "all") {
        return true;
      }

      if (filter === "favorites") {
        return isFavoriteConnection(connection);
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
    () => connections.filter(isFavoriteConnection).length,
    [connections],
  );
  const weekCount = useMemo(() => countUpdatedWithinWeek(connections), [connections]);
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
            <span>地址</span>
            <span>备注</span>
            <span>分组</span>
            <span className="action-head">操作</span>
          </div>

          {loading ? <p className="connection-board-note">加载连接中...</p> : null}
          {error ? <p className="connection-board-error">{error}</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="connection-board-note">暂无匹配连接</p>
          ) : null}

          {rows.map((connection) => {
            const group = groupById.get(groups.assignments[connection.id]);
            const latencyState = latencyByConnectionId[connection.id];

            return (
              <div className="connection-row" role="row" key={connection.id}>
                <span className="system-cell">
                  <SystemLogo kind={inferSystemKind(connection)} />
                </span>
                <span className="last-cell">
                  <strong>{formatRelativeTime(connection.updated_at)}</strong>
                  <span>{connection.updated_at === "demo" ? "最近使用" : "已保存"}</span>
                </span>
                <span className="latency-cell">
                  <LatencyIndicator state={latencyState} />
                </span>
                <span className="name-cell">
                  <span className="connection-name">{connection.name}</span>
                  <span className="connection-user">{connection.username}</span>
                </span>
                <span className="address-cell">
                  <span className="address-main">{connection.host}</span>
                  <span className="address-sub">{connection.port.toString()} / SSH</span>
                </span>
                <span className="remark-cell">
                  <span className="remark-main">{primaryNote(connection)}</span>
                  <span className="remark-sub">{connection.auth_kind === "private_key" ? "密钥登录" : "密码登录"}</span>
                </span>
                <span className="group-cell">
                  <span
                    className="group-pill"
                    style={{ "--group-color": group?.color || "#94a3b8" } as CSSProperties}
                  >
                    <span className="group-dot" />
                    {group?.name || "未分组"}
                  </span>
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
              {connections.slice(0, 2).map((connection) => (
                <button
                  className="activity-row"
                  key={connection.id}
                  type="button"
                  onClick={() => onConnect(connection)}
                >
                  <span className="latency-dot" />
                  <span>
                    <strong>{connection.name}</strong>
                    <span>{formatRelativeTime(connection.updated_at)}</span>
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

type SystemKind = "ubuntu" | "debian" | "macos" | "centos" | "alinux" | "linux";

function SystemLogo({ kind }: { kind: SystemKind }) {
  return (
    <span className={`os-logo ${kind}`} aria-label={systemLabel(kind)} title={systemLabel(kind)}>
      {kind === "ubuntu" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M17.61.46a3.41 3.41 0 1 0 0 6.82 3.41 3.41 0 0 0 0-6.82ZM12.92.8C8.92.78 5.14 2.94 3.15 6.45h.26c.94 0 1.83.27 2.58.73A8.32 8.32 0 0 1 12.69 3.6 4.94 4.94 0 0 1 13.72.83 11 11 0 0 0 12.92.8Zm9.23 4.99a4.92 4.92 0 0 1-1.92 2.25 8.36 8.36 0 0 1-.27 8.3 4.9 4.9 0 0 1 1.63 2.54 11.16 11.16 0 0 0 .56-13.09ZM3.41 7.93a3.41 3.41 0 1 0 0 6.82 3.41 3.41 0 0 0 0-6.82Zm2.03 7.87a4.9 4.9 0 0 1-2.92.36 11.1 11.1 0 0 0 10.42 6.95 4.88 4.88 0 0 1-1-2.85 8.3 8.3 0 0 1-6.5-4.46Zm11.4.93a3.41 3.41 0 1 0 0 6.82 3.41 3.41 0 0 0 0-6.82Z" />
        </svg>
      ) : null}
      {kind === "debian" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M13.88 12.69c-.4 0 .08.2.6.28.14-.1.27-.22.39-.33a3 3 0 0 1-.99.05Zm2.14-.53c.23-.33.4-.69.47-1.06-.06.27-.2.5-.33.73-.75.47-.07-.27 0-.56-.8 1.01-.11.6-.14.89ZM12.38.31c.2.04.45.07.42.12.23-.05.28-.1-.43-.12h.01Zm7.06 10.06c.02.64-.2.95-.38 1.5l-.35.18c-.28.54.03.35-.17.78-.44.39-1.34 1.22-1.62 1.3-.2 0 .14-.25.19-.34-.59.4-.48.6-1.37.85l-.03-.06c-2.22 1.04-5.3-1.02-5.25-3.84a3.55 3.55 0 0 1 2-3.5 3.36 3.36 0 0 1 3.73.48 3.34 3.34 0 0 0-2.72-1.3c-1.18.01-2.28.76-2.65 1.57-.6.38-.67 1.47-.93 1.66-.36 2.6.66 3.72 2.38 5.04.27.19.08.21.12.35a4.7 4.7 0 0 1-1.53-1.16c.23.33.47.66.8.91-.55-.18-1.27-1.3-1.48-1.35.93 1.66 3.78 2.92 5.26 2.3a6.2 6.2 0 0 1-2.33-.28c-.33-.16-.77-.51-.7-.57a5.8 5.8 0 0 0 5.9-.84c.44-.35.93-.94 1.07-.95-.2.32.04.16-.12.44.44-.72-.2-.3.46-1.24l.24.33c-.09-.6.74-1.32.66-2.26.19-.3.2.3 0 .97.29-.74.08-.85.15-1.46.08.2.18.42.23.63-.18-.7.2-1.2.28-1.6-.09-.05-.28.3-.32-.53 0-.37.1-.2.14-.28-.08-.05-.26-.32-.38-.86.08-.13.22.33.34.34-.08-.42-.2-.75-.2-1.08-.34-.68-.12.1-.4-.3-.34-1.09.3-.25.34-.74.54.77.84 1.96.98 2.46-.1-.6-.28-1.2-.49-1.76.16.07-.26-1.24.21-.37A7.82 7.82 0 0 0 17.7 1.6c.18.17.42.39.33.42-.75-.45-.62-.48-.73-.67-.61-.25-.65.02-1.06 0C15.08.73 14.86.8 13.8.4l.05.23c-.77-.25-.9.1-1.73 0-.05-.04.27-.14.53-.18-.74.1-.7-.14-1.43.03.17-.13.36-.21.55-.32-.6.04-1.44.35-1.18.07C9.6.68 7.85 1.3 6.87 2.22L6.84 2c-.45.54-1.96 1.61-2.08 2.31l-.13.03c-.23.4-.38.85-.57 1.26-.3.52-.45.2-.4.28-.6 1.22-.9 2.25-1.16 3.1.18.27 0 1.65.07 2.76-.3 5.46 3.84 10.78 8.36 12.01.67.23 1.65.23 2.49.25-.99-.28-1.12-.15-2.08-.49-.7-.32-.85-.7-1.34-1.13l.2.35c-.97-.34-.57-.42-1.36-.67l.21-.27c-.31-.03-.83-.53-.97-.81l-.34.01c-.41-.5-.63-.87-.61-1.16l-.11.2c-.13-.21-1.52-1.9-.8-1.51-.13-.12-.31-.2-.5-.55l.14-.17c-.35-.44-.64-1.02-.62-1.2.2.24.32.3.45.33-.88-2.17-.93-.12-1.6-2.2l.15-.02c-.1-.16-.18-.34-.26-.51l.06-.6c-.63-.74-.18-3.1-.09-4.4.07-.54.53-1.1.88-1.98l-.21-.04c.4-.71 2.34-2.87 3.24-2.76.43-.55-.09 0-.18-.14.96-.99 1.26-.7 1.9-.88.7-.4-.6.16-.27-.15 1.2-.3.85-.7 2.42-.85.16.1-.39.14-.52.26 1-.49 3.15-.37 4.56.27 1.63.77 3.46 3.01 3.53 5.13l.08.02c-.04.85.13 1.82-.17 2.71l.2-.42Z" />
        </svg>
      ) : null}
      {kind === "macos" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.21 3.09 3.79 3.04 1.52-.07 2.09-.99 3.94-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.61 1.09ZM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.81-3.53 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.72-.69 3.56-1.7Z" />
        </svg>
      ) : null}
      {kind === "centos" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12.08.07 8.88 3.28H3.35v5.43L0 12.01l3.35 3.3v5.39h5.37l3.29 3.24 3.28-3.24h5.43v-5.37L24 12.03l-3.23-3.25V3.32h-5.46L12.08.07Zm0 .75 2.49 2.5h-1.69v6.44l-.8.81-.81-.82V3.28H9.63L12.08.82Zm-8.2 2.99h4.48L6.49 5.69l4.25 4.28v.65h-.8L5.67 6.42l-1.8 1.77V3.81Zm5.23 0h1.63v5.41L7.23 5.69l1.88-1.88Zm4.3.04h1.68l1.83 1.84-3.51 3.54V3.85Zm2.43 0h4.4v4.39L18.41 6.4l-4.24 4.27h-.76v-.69l4.26-4.29-1.83-1.84Zm2.57 3.3 1.83 1.84v1.68h-5.33l3.5-3.52Zm-12.74.01 3.52 3.46H3.88v-1.69l1.79-1.77Zm-2.33 2.29v1.7h6.38l.87.86-.78.77H3.35v1.79L.75 12.01l2.59-2.56Zm17.42.07 2.49 2.5-2.53 2.55v-1.8h-6.41l-.75-.75.83-.83h6.37Zm-9.5.98.81.82.8-.81v.69h.77l-.82.83.75.75h-.72v.81l-.84-.83-.74.73v-.71h-.7l.78-.77-.87-.86h.78Zm-7.39 2.81h5.4l-3.6 3.55-1.8-1.77v-1.78Zm6.15 0h.71v.7l-4.4 4.33 1.85 1.83h-4.31v-4.34l1.8 1.77 4.35-4.29Zm3.35 0h.72l4.32 4.34 1.78-1.8v4.32h-4.36l1.85-1.83-4.31-4.24v-.79Zm1.46 0h5.36v1.8l-1.78 1.79-3.58-3.59Zm-2.83.19.84.83v6.37h1.69l-2.53 2.5-2.53-2.5h1.79v-6.47l.74-.73Zm-1.27 1.25v5.42H8.94l-1.85-1.82 3.64-3.6Zm2.64.1 3.55 3.5-1.85 1.82h-1.7v-5.32Z" />
        </svg>
      ) : null}
      {kind === "alinux" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M4 4.52h5.29L8.01 6.32 4.15 7.51a1.67 1.67 0 0 0-1.16 1.6v5.78c0 .72.46 1.37 1.16 1.6l3.86 1.19 1.28 1.8H4A4 4 0 0 1 0 15.49V8.51a4 4 0 0 1 4-4Zm16.01 0h-5.3l1.28 1.8 3.86 1.19c.71.23 1.17.89 1.16 1.6v5.78c0 .72-.46 1.37-1.16 1.6l-3.86 1.19-1.28 1.8h5.3A4 4 0 0 0 24 15.49V8.51a4 4 0 0 0-3.99-4Zm-4.01 8.34H8v-1.8h8v1.8Z" />
        </svg>
      ) : null}
      {kind === "linux" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Zm.8 3.2v8.6h11.4V7.7H6.3Zm2.1 2.4 2.1 1.9-2.1 1.9-.9-1 1.1-.9-1.1-1 .9-.9Zm3.1 3h4.1v1.3h-4.1v-1.3Z" />
        </svg>
      ) : null}
    </span>
  );
}

function inferSystemKind(connection: ConnectionProfile): SystemKind {
  const text = `${connection.name} ${connection.notes || ""} ${connection.username} ${connection.host}`.toLowerCase();

  if (text.includes("ubuntu")) return "ubuntu";
  if (
    ["debian", "armbian", "orangepi", "orange pi", "香橙"].some((keyword) =>
      text.includes(keyword),
    )
  ) {
    return "debian";
  }
  if (text.includes("mac") || text.includes("darwin") || text.includes("m4-")) return "macos";
  if (text.includes("centos") || text.includes("rocky") || text.includes("rhel")) return "centos";
  if (text.includes("aliyun") || text.includes("alibaba") || text.includes("alinux")) return "alinux";
  if (connection.id === "demo-dev-core" || connection.id === "demo-cloud-ubuntu") return "ubuntu";
  if (connection.id === "demo-test-web" || connection.id === "demo-dev-k8s") return "debian";
  if (connection.id === "demo-bastion") return "macos";
  if (connection.id === "demo-stage") return "centos";
  return "linux";
}

function systemLabel(kind: SystemKind) {
  const labels: Record<SystemKind, string> = {
    alinux: "Alibaba Cloud Linux",
    centos: "CentOS",
    debian: "Debian",
    linux: "Linux",
    macos: "macOS",
    ubuntu: "Ubuntu",
  };

  return labels[kind];
}

function sortConnectionsByRecent(left: ConnectionProfile, right: ConnectionProfile) {
  return timestampOf(right.updated_at) - timestampOf(left.updated_at);
}

function timestampOf(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isFavoriteConnection(connection: ConnectionProfile) {
  return ["favorite", "fav", "收藏", "star"].some((keyword) =>
    `${connection.name} ${connection.notes || ""} ${connection.host}`
      .toLowerCase()
      .includes(keyword.toLowerCase()),
  );
}

function primaryNote(connection: ConnectionProfile) {
  const note = connection.notes?.trim();
  if (!note) {
    return "无备注";
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

function formatRelativeTime(value: string) {
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

function countUpdatedWithinWeek(connections: ConnectionProfile[]) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const dated = connections.filter((connection) => timestampOf(connection.updated_at) > 0);

  if (dated.length === 0) {
    return connections.length;
  }

  return dated.filter((connection) => now - timestampOf(connection.updated_at) <= week).length;
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

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
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
