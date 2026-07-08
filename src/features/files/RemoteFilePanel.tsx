import {
  Activity,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Clipboard,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Info,
  ListTree,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  memo,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import { remoteFileList } from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { Tooltip } from "../../shared/ui/Tooltip";
import { RemoteFileIcon } from "./RemoteFileIcon";
import {
  isRemotePathStrictDescendant,
  normalizeRemotePath,
  remotePathAncestors,
  remotePathParent,
  shouldShowRemoteDirectoryEmptyRow,
  sortRemoteFileEntries,
} from "./remoteFilePaths";
import type { RemoteFileEntry } from "./remoteFileTypes";

export type RemoteFileTool = "files" | "monitor" | "commands" | "tools" | "ai";

export interface RemoteFileUploadItem {
  file: File;
  relativePath: string;
}

interface RemoteFilePanelProps {
  active: boolean;
  activeTool: RemoteFileTool;
  availableTools?: RemoteFileTool[];
  connection: ConnectionProfile | null;
  locateRequest?: RemoteFileLocateRequest | null;
  refreshRequest?: RemoteFileRefreshRequest | null;
  resolveTerminalPath?: () => string | null;
  transferPanel?: ReactNode;
  nativeDropTargetPath?: string | null;
  monitorPanel?: ReactNode;
  aiPanel?: ReactNode;
  commandPanel?: ReactNode;
  onCopyPath?: (path: string) => void;
  onCreateDirectory?: (parentPath: string) => void;
  onCreateFile?: (parentPath: string) => void;
  onDeleteEntries?: (entries: RemoteFileEntry[]) => void;
  onDeleteEntry?: (entry: RemoteFileEntry) => void;
  onDownloadEntries?: (entries: RemoteFileEntry[]) => void;
  onDownloadEntry?: (entry: RemoteFileEntry) => void;
  onOpenFile?: (entry: RemoteFileEntry) => void;
  onRenameEntry?: (entry: RemoteFileEntry) => void;
  onShowProperties?: (entry: RemoteFileEntry) => void;
  onToolChange?: (tool: RemoteFileTool) => void;
  onToggleRightPane?: () => void;
  onUploadDirectory?: (parentPath: string) => void;
  onUploadFile?: (parentPath: string) => void;
  onUploadItems?: (parentPath: string, items: RemoteFileUploadItem[]) => void;
  stateKey?: string;
  terminalPath?: string | null;
  toolsPanel?: ReactNode;
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

interface FileSystemEntryLike {
  isDirectory: boolean;
  isFile: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (error: DOMException) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

interface DataTransferItemWithEntry {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
}

interface RemoteFileVisibleRow {
  depth: number;
  entry: RemoteFileEntry;
}

const previewDirectoryEntries: Record<string, RemoteFileEntry[]> = {
  "/": [
    { name: "logs", path: "/opt/app/logs", type: "directory" },
    { name: "config", path: "/opt/app/config", type: "directory" },
    { name: "app.log", path: "/opt/app/app.log", type: "file" },
    { name: "nginx.conf", path: "/opt/app/nginx.conf", type: "file" },
  ],
  "/opt/app/config": [
    { name: "app.conf", path: "/opt/app/config/app.conf", type: "file" },
    { name: "sites-enabled", path: "/opt/app/config/sites-enabled", type: "directory" },
  ],
  "/opt/app/config/sites-enabled": [
    { name: "default.conf", path: "/opt/app/config/sites-enabled/default.conf", type: "file" },
  ],
  "/opt/app/logs": [
    { name: "app.log", path: "/opt/app/logs/app.log", type: "file" },
    { name: "deploy.log", path: "/opt/app/logs/deploy.log", type: "file" },
  ],
};

const defaultRemotePath = "/";
const loadingIndicatorDelayMs = 180;
const defaultRemoteFileTools: RemoteFileTool[] = ["files", "monitor", "commands", "tools", "ai"];

interface RemoteFilePanelStateSnapshot {
  activeDirectoryPath: string;
  currentPath: string;
  directoryEntries: Record<string, RemoteFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  locatedDirectoryPath: string | null;
  showHidden: boolean;
}

const remoteFilePanelStateCache = new Map<string, RemoteFilePanelStateSnapshot>();

function RemoteFilePanelComponent({
  active = true,
  activeTool,
  availableTools,
  connection,
  locateRequest,
  refreshRequest,
  resolveTerminalPath,
  transferPanel,
  nativeDropTargetPath = null,
  monitorPanel,
  aiPanel,
  commandPanel,
  onCopyPath,
  onCreateDirectory,
  onCreateFile,
  onDeleteEntries,
  onDeleteEntry,
  onDownloadEntries,
  onDownloadEntry,
  onOpenFile,
  onRenameEntry,
  onShowProperties,
  onToolChange,
  onToggleRightPane,
  onUploadDirectory,
  onUploadFile,
  onUploadItems,
  stateKey,
  terminalPath,
  toolsPanel,
}: RemoteFilePanelProps) {
  const connectionId = connection?.id || null;
  const terminalDirectory = terminalPath ? normalizeRemotePath(terminalPath) : null;
  const initialStateRef = useRef<RemoteFilePanelStateSnapshot | null>(
    stateKey ? remoteFilePanelStateCache.get(stateKey) || null : null,
  );
  const initialState = initialStateRef.current;
  const [currentPath, setCurrentPath] = useState(defaultRemotePath);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState(
    initialState?.activeDirectoryPath || defaultRemotePath,
  );
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, RemoteFileEntry[]>>(
    initialState?.directoryEntries || {},
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(
    initialState?.expandedDirectories || {},
  );
  const [locatedDirectoryPath, setLocatedDirectoryPath] = useState<string | null>(
    initialState?.locatedDirectoryPath || null,
  );
  const [showHidden, setShowHidden] = useState(initialState?.showHidden || false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [visibleLoadingPath, setVisibleLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevealScrollPath, setPendingRevealScrollPath] = useState<string | null>(null);
  const [selectedEntriesByPath, setSelectedEntriesByPath] = useState<Record<string, RemoteFileEntry>>({});
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const loadingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const remoteFileRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const connectionLoadScopeRef = useRef(0);
  const directoryLoadRequestRef = useRef(0);
  const directoryEntriesRef = useRef<Record<string, RemoteFileEntry[]>>(initialState?.directoryEntries || {});
  const lastConnectionIdRef = useRef(connectionId);
  const mountedRef = useRef(true);
  const visibleTools = availableTools?.length ? availableTools : defaultRemoteFileTools;
  const effectiveActiveTool = visibleTools.includes(activeTool) ? activeTool : visibleTools[0] || "commands";
  const filePanelRenderKey = `${stateKey || connectionId || "preview"}:${effectiveActiveTool}:${currentPath}`;
  const [readyFilePanelRenderKey, setReadyFilePanelRenderKey] = useState("");
  const fileTreeReady = active && readyFilePanelRenderKey === filePanelRenderKey;

  const entries = useMemo(
    () => (fileTreeReady ? visibleEntries(directoryEntries[currentPath] || [], showHidden) : []),
    [currentPath, directoryEntries, fileTreeReady, showHidden],
  );
  const hasExpandedDirectories = useMemo(
    () => fileTreeReady && Object.values(expandedDirectories).some(Boolean),
    [expandedDirectories, fileTreeReady],
  );
  const visibleRows = useMemo(
    () => (fileTreeReady ? flattenVisibleRows(entries, directoryEntries, expandedDirectories, showHidden, 0) : []),
    [directoryEntries, entries, expandedDirectories, fileTreeReady, showHidden],
  );
  const selectedEntries = useMemo(
    () => (fileTreeReady ? selectedEntriesInVisibleOrder(selectedEntriesByPath, visibleRows) : []),
    [fileTreeReady, selectedEntriesByPath, visibleRows],
  );

  useEffect(() => {
    const nextConnectionId = connectionId;
    if (lastConnectionIdRef.current === nextConnectionId) {
      return;
    }
    lastConnectionIdRef.current = nextConnectionId;
    connectionLoadScopeRef.current += 1;
    directoryLoadRequestRef.current += 1;
    directoryEntriesRef.current = {};
    setDirectoryEntries({});
    setExpandedDirectories({});
    setLocatedDirectoryPath(null);
    setUploadMenuOpen(false);
    setDropTargetPath(null);
    clearSelection();
    setCurrentPath(defaultRemotePath);
    setActiveDirectoryPath(defaultRemotePath);
    setLoadingPath(null);
    setVisibleLoadingPath(null);
    setPendingRevealScrollPath(null);
    setError(null);
    clearLoadingIndicatorTimer();
  }, [connectionId]);

  useLayoutEffect(() => {
    if (!stateKey) {
      return;
    }
    remoteFilePanelStateCache.set(stateKey, {
      activeDirectoryPath,
      currentPath,
      directoryEntries,
      expandedDirectories,
      locatedDirectoryPath,
      showHidden,
    });
  }, [
    activeDirectoryPath,
    currentPath,
    directoryEntries,
    expandedDirectories,
    locatedDirectoryPath,
    showHidden,
    stateKey,
  ]);

  useLayoutEffect(() => {
    if (active && effectiveActiveTool === "files" && connectionId) {
      return;
    }
    setReadyFilePanelRenderKey("");
  }, [active, connectionId, effectiveActiveTool]);

  useEffect(() => {
    if (!active || effectiveActiveTool !== "files" || !connectionId) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      if (mountedRef.current) {
        startTransition(() => {
          setReadyFilePanelRenderKey(filePanelRenderKey);
        });
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [active, connectionId, effectiveActiveTool, filePanelRenderKey]);

  useLayoutEffect(() => {
    if (!fileTreeReady || !pendingRevealScrollPath) {
      return;
    }

    const targetPath = pendingRevealScrollPath;
    if (targetPath === defaultRemotePath) {
      fileListRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      setPendingRevealScrollPath(null);
      return;
    }

    const targetRow = remoteFileRowRefs.current.get(targetPath);
    if (!targetRow) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      targetRow.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      setPendingRevealScrollPath(null);
    });
    return () => cancelAnimationFrame(frameId);
  }, [fileTreeReady, pendingRevealScrollPath, visibleRows]);

  useEffect(() => {
    // 隐藏的常驻面板不发起远程请求；切回后复用已缓存的路径和展开状态。
    if (!active) {
      return;
    }
    void loadDirectory(currentPath);
  }, [active, connectionId, currentPath]);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (!refreshRequest || !connection || refreshRequest.connectionId !== connection.id) {
      return;
    }
    void loadDirectory(refreshRequest.path, true);
  }, [active, connectionId, refreshRequest?.connectionId, refreshRequest?.id, refreshRequest?.path]);

  useEffect(() => {
    if (!active || effectiveActiveTool !== "files") {
      return;
    }
    if (!locateRequest || !connection || locateRequest.connectionId !== connection.id) {
      return;
    }

    const path = normalizeRemotePath(locateRequest.path);
    navigateToPath(path);
  }, [active, connectionId, effectiveActiveTool, locateRequest?.connectionId, locateRequest?.id, locateRequest?.path]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      connectionLoadScopeRef.current += 1;
      directoryLoadRequestRef.current += 1;
      clearLoadingIndicatorTimer();
    },
    [],
  );

  const isCurrentPathLoading = loadingPath === currentPath;
  const showCurrentPathLoading = visibleLoadingPath === currentPath;
  const disabled = !connection;
  const effectiveDropTargetPath = dropTargetPath || nativeDropTargetPath;

  if (!active) {
    return (
      <aside
        className="tool-pane is-hidden"
        aria-label="右侧工具面板"
        aria-hidden="true"
        data-remote-file-panel-placeholder="true"
      />
    );
  }

  return (
    <aside className={`tool-pane ${active ? "" : "is-hidden"}`} aria-label="右侧工具面板" aria-hidden={!active}>
      <FilePanelTabs
        activeTool={effectiveActiveTool}
        availableTools={visibleTools}
        onToolChange={onToolChange}
        onToggleRightPane={onToggleRightPane}
      />
      <div className="tool-panel-slot" hidden={effectiveActiveTool !== "tools"}>
        {toolsPanel || <p className="file-panel-empty">打开一个 SSH 会话后显示工具。</p>}
      </div>
      <div className="tool-panel-slot" hidden={effectiveActiveTool !== "ai"}>
        {aiPanel || <p className="file-panel-empty">正在加载 AI 面板...</p>}
      </div>
      {effectiveActiveTool === "monitor" ? (
        <div className="monitor-tool-body">
          {monitorPanel || <p className="file-panel-empty">打开一个 SSH 会话后显示监控。</p>}
        </div>
      ) : effectiveActiveTool === "commands" ? (
        commandPanel || <p className="file-panel-empty">还没有命令片段。</p>
      ) : effectiveActiveTool === "files" ? (
        <FilePanelShell
          disabled={disabled}
          hasExpandedDirectories={hasExpandedDirectories}
          loading={Boolean(visibleLoadingPath)}
          path={activeDirectoryPath}
          showHidden={showHidden}
          terminalPath={terminalDirectory}
          locatedDirectoryPath={locatedDirectoryPath}
          canLocateTerminalDirectory={Boolean(terminalDirectory || resolveTerminalPath)}
          uploadMenuOpen={uploadMenuOpen}
          onLocateTerminalDirectory={revealTerminalDirectory}
          onPathSubmit={navigateToPath}
          onRefresh={() => void loadDirectory(activeDirectoryPath, true)}
          onCollapseExpandedDirectories={collapseExpandedDirectories}
          onToggleHidden={() => setShowHidden((value) => !value)}
          onToggleUploadMenu={() => setUploadMenuOpen((open) => !open)}
          onCreateDirectory={connection ? onCreateDirectory : undefined}
          onCreateFile={connection ? onCreateFile : undefined}
          onCopyCurrentPath={connection ? () => onCopyPath?.(activeDirectoryPath) : undefined}
          onUploadDirectory={connection ? onUploadDirectory : undefined}
          onUploadFile={connection ? onUploadFile : undefined}
        >
          {!connection ? (
            <p className="file-panel-empty">打开一个 SSH 会话后显示远程文件。</p>
          ) : (
            <>
              {error ? <p className="file-panel-error">{error}</p> : null}
              {!fileTreeReady ? (
                <div
                  className={`file-list ${effectiveDropTargetPath === activeDirectoryPath ? "is-drop-target" : ""}`}
                  data-remote-file-drop-target={activeDirectoryPath}
                >
                  <section className="remote-file-tree" aria-label="远程文件树">
                    <p className="file-panel-empty">正在恢复文件视图...</p>
                  </section>
                </div>
              ) : (
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <div
                      ref={fileListRef}
                      className={`file-list ${effectiveDropTargetPath === activeDirectoryPath ? "is-drop-target" : ""}`}
                      data-remote-file-drop-target={activeDirectoryPath}
                      onDragEnter={(event) => handleLocalDragEnter(event, activeDirectoryPath)}
                      onDragLeave={(event) => handleLocalDragLeave(event, activeDirectoryPath)}
                      onDragOver={(event) => handleLocalDragOver(event, activeDirectoryPath)}
                      onDrop={(event) => handleDropUpload(event, activeDirectoryPath)}
                    >
                      <section className="remote-file-tree" aria-label="远程文件树">
                        {entries.length ? (
                          renderRows(entries, 0)
                        ) : showCurrentPathLoading ? (
                          <p className="file-panel-empty">读取目录中...</p>
                        ) : isCurrentPathLoading ? null : (
                          <p className="file-panel-empty">当前目录为空。</p>
                        )}
                      </section>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="context-menu-content">
                      {renderBlankMenu()}
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              )}
            </>
          )}
          {transferPanel ? <div className="file-transfer-dock-wrap">{transferPanel}</div> : null}
        </FilePanelShell>
      ) : null}
    </aside>
  );

  function currentDirectoryEntry(): RemoteFileEntry {
    return {
      name: remotePathName(activeDirectoryPath),
      path: activeDirectoryPath,
      type: "directory",
    };
  }

  function navigateToPath(path: string) {
    const normalizedPath = normalizeRemotePath(path);
    revealDirectoryPath(normalizedPath, false);
  }

  function revealTerminalDirectory() {
    const resolvedTerminalDirectory = resolveTerminalPath?.() || terminalDirectory;
    if (!resolvedTerminalDirectory) {
      return;
    }

    revealDirectoryPath(resolvedTerminalDirectory, true);
  }

  function revealDirectoryPath(path: string, markLocated: boolean) {
    const normalizedPath = normalizeRemotePath(path);
    const ancestorPaths = remotePathAncestors(normalizedPath);
    const expandablePaths = [...ancestorPaths, normalizedPath].filter(
      (path) => path !== defaultRemotePath && isRemotePathStrictDescendant(path, defaultRemotePath),
    );

    setCurrentPath(defaultRemotePath);
    setActiveDirectoryPath(normalizedPath);
    setLocatedDirectoryPath(markLocated ? normalizedPath : null);
    setPendingRevealScrollPath(normalizedPath);
    clearSelection();
    setUploadMenuOpen(false);
    setExpandedDirectories((current) => {
      const next = { ...current };
      for (const path of expandablePaths) {
        next[path] = true;
      }
      return next;
    });

    void loadRevealPath([defaultRemotePath, ...expandablePaths]);
  }

  function collapseExpandedDirectories() {
    if (hasExpandedDirectories) {
      setPendingRevealScrollPath(null);
      setExpandedDirectories({});
      setActiveDirectoryPath(currentPath);
    }
  }

  async function loadDirectory(path: string, force = false) {
    const normalizedPath = normalizeRemotePath(path);
    if (!connection) {
      return;
    }
    if (!force && directoryEntriesRef.current[normalizedPath]) {
      setError(null);
      return;
    }

    const requestLoadScope = connectionLoadScopeRef.current;
    const requestId = directoryLoadRequestRef.current + 1;
    directoryLoadRequestRef.current = requestId;
    clearLoadingIndicatorTimer();
    setLoadingPath(normalizedPath);
    setVisibleLoadingPath(null);
    setError(null);
    loadingIndicatorTimerRef.current = setTimeout(() => {
      if (!isLatestDirectoryLoadRequest(requestLoadScope, requestId)) {
        return;
      }
      setVisibleLoadingPath((current) => current ?? normalizedPath);
    }, loadingIndicatorDelayMs);

    try {
      const nextEntries = hasTauriRuntime()
        ? await remoteFileList(connection.id, normalizedPath)
        : previewEntriesForPath(normalizedPath);

      if (connectionLoadScopeRef.current !== requestLoadScope) {
        return;
      }

      setDirectoryEntries((current) => {
        const next = {
          ...current,
          [normalizedPath]: sortRemoteFileEntries(nextEntries),
        };
        directoryEntriesRef.current = next;
        return next;
      });
      if (isLatestDirectoryLoadRequest(requestLoadScope, requestId)) {
        setError(null);
      }
    } catch (error) {
      if (!isLatestDirectoryLoadRequest(requestLoadScope, requestId)) {
        return;
      }
      setError(formatError(error));
    } finally {
      if (!isLatestDirectoryLoadRequest(requestLoadScope, requestId)) {
        return;
      }
      clearLoadingIndicatorTimer();
      setLoadingPath((path) => (path === normalizedPath ? null : path));
      setVisibleLoadingPath((path) => (path === normalizedPath ? null : path));
    }
  }

  function isLatestDirectoryLoadRequest(scope: number, requestId: number) {
    return mountedRef.current &&
      connectionLoadScopeRef.current === scope &&
      directoryLoadRequestRef.current === requestId;
  }

  async function loadRevealPath(paths: string[]) {
    for (const path of paths) {
      await loadDirectory(path);
    }
  }

  function toggleDirectory(entry: RemoteFileEntry) {
    setPendingRevealScrollPath(null);
    setActiveDirectoryPath(entry.path);
    setLocatedDirectoryPath(null);
    setExpandedDirectories((current) => ({
      ...current,
      [entry.path]: !current[entry.path],
    }));
    if (!expandedDirectories[entry.path]) {
      void loadDirectory(entry.path);
    }
  }

  function clearSelection() {
    setSelectedEntriesByPath({});
    setSelectionAnchorPath(null);
  }

  function selectSingleEntry(entry: RemoteFileEntry) {
    const path = normalizeRemotePath(entry.path);
    setSelectedEntriesByPath({ [path]: { ...entry, path } });
    setSelectionAnchorPath(path);
  }

  function toggleEntrySelection(entry: RemoteFileEntry) {
    const path = normalizeRemotePath(entry.path);
    setSelectedEntriesByPath((current) => {
      const next = { ...current };
      if (next[path]) {
        delete next[path];
      } else {
        next[path] = { ...entry, path };
      }
      return next;
    });
    setSelectionAnchorPath(path);
  }

  function selectEntryRange(entry: RemoteFileEntry, append: boolean) {
    const path = normalizeRemotePath(entry.path);
    const anchorPath = selectionAnchorPath || path;
    const anchorIndex = visibleRows.findIndex((row) => normalizeRemotePath(row.entry.path) === anchorPath);
    const targetIndex = visibleRows.findIndex((row) => normalizeRemotePath(row.entry.path) === path);
    if (anchorIndex < 0 || targetIndex < 0) {
      selectSingleEntry(entry);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    setSelectedEntriesByPath((current) => {
      const next = append ? { ...current } : {};
      for (const row of visibleRows.slice(start, end + 1)) {
        const rowPath = normalizeRemotePath(row.entry.path);
        next[rowPath] = { ...row.entry, path: rowPath };
      }
      return next;
    });
    setSelectionAnchorPath(path);
  }

  function handleEntryClick(
    event: MouseEvent<HTMLButtonElement>,
    entry: RemoteFileEntry,
    isDirectory: boolean,
  ) {
    if (event.shiftKey) {
      event.preventDefault();
      selectEntryRange(entry, event.ctrlKey || event.metaKey);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggleEntrySelection(entry);
      return;
    }

    if (isDirectory) {
      toggleDirectory(entry);
      return;
    }

    selectSingleEntry(entry);
  }

  function handleEntryContextMenu(entry: RemoteFileEntry) {
    const path = normalizeRemotePath(entry.path);
    if (!selectedEntriesByPath[path]) {
      selectSingleEntry(entry);
    }
  }

  function isEntrySelected(entry: RemoteFileEntry) {
    return Boolean(selectedEntriesByPath[normalizeRemotePath(entry.path)]);
  }

  function selectionMenuEntries(entry: RemoteFileEntry) {
    if (!isEntrySelected(entry)) {
      return [];
    }
    return selectedEntries.length > 1 ? selectedEntries : [];
  }

  function renderRows(rows: RemoteFileEntry[], depth: number): ReactNode[] {
    return rows.flatMap((entry) => {
      const isDirectory = entry.type === "directory";
      const expanded = Boolean(expandedDirectories[entry.path]);
      const isActiveDirectory = isDirectory && entry.path === activeDirectoryPath;
      const isLocatedDirectory = entry.path === locatedDirectoryPath;
      const isSelected = isEntrySelected(entry);
      const row = (
        <ContextMenu.Root key={entry.path}>
          <ContextMenu.Trigger asChild>
            <button
              className={`remote-file-row ${isSelected ? "is-selected" : ""} ${
                isActiveDirectory ? "is-active-directory" : ""
              } ${
                isLocatedDirectory ? "is-located" : ""
              } ${
                effectiveDropTargetPath === entry.path ? "is-drop-target" : ""
              }`}
              data-remote-file-drop-target={isDirectory ? entry.path : undefined}
              draggable
              ref={(element) => {
                if (element) {
                  remoteFileRowRefs.current.set(entry.path, element);
                } else {
                  remoteFileRowRefs.current.delete(entry.path);
                }
              }}
              style={{
                paddingLeft: `${8 + depth * 16}px`,
                ...(isLocatedDirectory ? { background: "var(--mx-active)", color: "var(--mx-text)" } : {}),
              }}
              type="button"
              title={entry.path}
              aria-pressed={isSelected}
              aria-current={isLocatedDirectory ? "location" : isActiveDirectory ? "page" : undefined}
              onClick={(event) => handleEntryClick(event, entry, isDirectory)}
              onContextMenu={() => handleEntryContextMenu(entry)}
              onDoubleClick={() => {
                if (!isDirectory) {
                  onOpenFile?.(entry);
                }
              }}
              onDragEnd={() => {
                onDownloadEntry?.(entry);
              }}
              onDragEnter={(event) => {
                if (isDirectory) {
                  handleLocalDragEnter(event, entry.path);
                }
              }}
              onDragLeave={(event) => {
                if (isDirectory) {
                  handleLocalDragLeave(event, entry.path);
                }
              }}
              onDragOver={(event) => {
                if (isDirectory) {
                  handleLocalDragOver(event, entry.path);
                }
              }}
              onDragStart={(event) => handleRemoteDragStart(event, entry)}
              onDrop={(event) => {
                if (isDirectory) {
                  handleDropUpload(event, entry.path);
                }
              }}
            >
              {isDirectory ? (
                expanded ? <ChevronDown className="ui-icon" aria-hidden="true" /> : <ChevronRight className="ui-icon" aria-hidden="true" />
              ) : (
                <span className="remote-file-spacer" />
              )}
              <RemoteFileIcon entry={entry} expanded={expanded} />
              <span className="remote-file-name">{entry.name}</span>
              {visibleLoadingPath === entry.path ? <RefreshCw className="ui-icon spin" aria-hidden="true" /> : null}
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="context-menu-content">
              {isDirectory ? renderDirectoryMenu(entry) : renderFileMenu(entry)}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      );

      if (!isDirectory || !expanded) {
        return [row];
      }

      const loaded = Object.prototype.hasOwnProperty.call(directoryEntries, entry.path);
      const loading = visibleLoadingPath === entry.path;
      const children = visibleEntries(directoryEntries[entry.path] || [], showHidden);
      return [
        row,
        ...(children.length
          ? renderRows(children, depth + 1)
          : shouldShowRemoteDirectoryEmptyRow({
                childCount: children.length,
                loaded,
                loading,
              })
            ? [
              <div className="remote-file-empty-row" key={`${entry.path}:empty`} style={{ paddingLeft: `${38 + depth * 16}px` }}>
                空文件夹
              </div>,
              ]
            : []),
      ];
    });
  }

  function renderFileMenu(entry: RemoteFileEntry) {
    const parentPath = remotePathParent(entry.path);
    const menuEntries = selectionMenuEntries(entry);
    if (menuEntries.length > 0) {
      return renderSelectionMenu(menuEntries);
    }

    return (
      <>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onOpenFile?.(entry)}>
          <FileText className="ui-icon" aria-hidden="true" />
          打开
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onDownloadEntry?.(entry)}>
          <Download className="ui-icon" aria-hidden="true" />
          下载
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onUploadFile?.(parentPath)}>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item className="context-menu-item" onSelect={() => onRenameEntry?.(entry)}>
          <Pencil className="ui-icon" aria-hidden="true" />
          重命名
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCopyPath?.(entry.path)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制绝对路径
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onShowProperties?.(entry)}>
          <Info className="ui-icon" aria-hidden="true" />
          查看属性
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item className="context-menu-item danger" onSelect={() => onDeleteEntry?.(entry)}>
          <Trash2 className="ui-icon" aria-hidden="true" />
          删除
        </ContextMenu.Item>
      </>
    );
  }

  function renderDirectoryMenu(entry: RemoteFileEntry) {
    const menuEntries = selectionMenuEntries(entry);
    if (menuEntries.length > 0) {
      return renderSelectionMenu(menuEntries);
    }

    return (
      <>
        <ContextMenu.Item
          className="context-menu-item"
          onSelect={() => {
            setExpandedDirectories((current) => ({ ...current, [entry.path]: true }));
            void loadDirectory(entry.path, true);
          }}
        >
          <RefreshCw className="ui-icon" aria-hidden="true" />
          刷新
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onUploadFile?.(entry.path)}>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onUploadDirectory?.(entry.path)}>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件夹
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCreateFile?.(entry.path)}>
          <FilePlus className="ui-icon" aria-hidden="true" />
          新建文件
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCreateDirectory?.(entry.path)}>
          <FolderPlus className="ui-icon" aria-hidden="true" />
          新建文件夹
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onDownloadEntry?.(entry)}>
          <Download className="ui-icon" aria-hidden="true" />
          下载目录
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item className="context-menu-item" onSelect={() => onRenameEntry?.(entry)}>
          <Pencil className="ui-icon" aria-hidden="true" />
          重命名
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCopyPath?.(entry.path)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制绝对路径
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onShowProperties?.(entry)}>
          <Info className="ui-icon" aria-hidden="true" />
          查看属性
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item className="context-menu-item danger" onSelect={() => onDeleteEntry?.(entry)}>
          <Trash2 className="ui-icon" aria-hidden="true" />
          删除
        </ContextMenu.Item>
      </>
    );
  }

  function renderSelectionMenu(entries: RemoteFileEntry[]) {
    if (entries.length === 0) {
      return null;
    }
    return (
      <>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onDownloadEntries?.(entries)}>
          <Download className="ui-icon" aria-hidden="true" />
          下载所选 {entries.length.toString()} 项
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item danger" onSelect={() => onDeleteEntries?.(entries)}>
          <Trash2 className="ui-icon" aria-hidden="true" />
          删除所选 {entries.length.toString()} 项
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={clearSelection}>
          <X className="ui-icon" aria-hidden="true" />
          清空选择
        </ContextMenu.Item>
      </>
    );
  }

  function renderBlankMenu() {
    return (
      <>
        <ContextMenu.Item className="context-menu-item" onSelect={() => void loadDirectory(activeDirectoryPath, true)}>
          <RefreshCw className="ui-icon" aria-hidden="true" />
          刷新当前目录
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onUploadFile?.(activeDirectoryPath)}>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onUploadDirectory?.(activeDirectoryPath)}>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件夹
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCreateFile?.(activeDirectoryPath)}>
          <FilePlus className="ui-icon" aria-hidden="true" />
          新建文件
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCreateDirectory?.(activeDirectoryPath)}>
          <FolderPlus className="ui-icon" aria-hidden="true" />
          新建文件夹
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onDownloadEntry?.(currentDirectoryEntry())}>
          <Download className="ui-icon" aria-hidden="true" />
          下载当前目录
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item className="context-menu-item" onSelect={() => onCopyPath?.(activeDirectoryPath)}>
          <Clipboard className="ui-icon" aria-hidden="true" />
          复制当前路径
        </ContextMenu.Item>
      </>
    );
  }

  function handleLocalDragEnter(event: DragEvent<HTMLElement>, path: string) {
    if (!hasLocalFileDrop(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDropTargetPath(path);
  }

  function handleLocalDragLeave(event: DragEvent<HTMLElement>, path: string) {
    if (!hasLocalFileDrop(event.dataTransfer)) {
      return;
    }
    event.stopPropagation();
    if (dropTargetPath !== path) {
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setDropTargetPath(null);
  }

  function handleLocalDragOver(event: DragEvent<HTMLElement>, path: string) {
    if (!hasLocalFileDrop(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (dropTargetPath !== path) {
      setDropTargetPath(path);
    }
  }

  function handleRemoteDragStart(event: DragEvent<HTMLElement>, entry: RemoteFileEntry) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", entry.path);
    event.dataTransfer.setData("application/x-mxterm-remote-file", JSON.stringify(entry));
  }

  function handleDropUpload(event: DragEvent<HTMLElement>, path: string) {
    if (!hasLocalFileDrop(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDropTargetPath(null);
    void extractUploadItems(event.dataTransfer)
      .then((items) => {
        if (items.length > 0) {
          onUploadItems?.(path, items);
        }
      })
      .catch((error: unknown) => {
        setError(formatError(error));
      });
  }

  function clearLoadingIndicatorTimer() {
    if (loadingIndicatorTimerRef.current) {
      clearTimeout(loadingIndicatorTimerRef.current);
      loadingIndicatorTimerRef.current = null;
    }
  }
}

export const RemoteFilePanel = memo(RemoteFilePanelComponent, areRemoteFilePanelPropsEqual);

function areRemoteFilePanelPropsEqual(previous: RemoteFilePanelProps, next: RemoteFilePanelProps) {
  if (!previous.active && !next.active) {
    return previous.connection?.id === next.connection?.id && previous.stateKey === next.stateKey;
  }
  return false;
}

function FilePanelTabs({
  activeTool,
  availableTools,
  onToolChange,
  onToggleRightPane,
}: {
  activeTool: RemoteFileTool;
  availableTools: RemoteFileTool[];
  onToolChange?: (tool: RemoteFileTool) => void;
  onToggleRightPane?: () => void;
}) {
  return (
    <nav className="tool-tabs" aria-label="工具标签">
      {availableTools.includes("files") ? (
        <button className={activeTool === "files" ? "active" : ""} type="button" onClick={() => onToolChange?.("files")}>
          <Folder className="ui-icon" aria-hidden="true" />
          文件
        </button>
      ) : null}
      {availableTools.includes("monitor") ? (
        <button className={activeTool === "monitor" ? "active" : ""} type="button" onClick={() => onToolChange?.("monitor")}>
          <Activity className="ui-icon" aria-hidden="true" />
          监控
        </button>
      ) : null}
      {availableTools.includes("commands") ? (
        <button className={activeTool === "commands" ? "active" : ""} type="button" onClick={() => onToolChange?.("commands")}>
          <ListTree className="ui-icon" aria-hidden="true" />
          命令
        </button>
      ) : null}
      {availableTools.includes("tools") ? (
        <button className={activeTool === "tools" ? "active" : ""} type="button" onClick={() => onToolChange?.("tools")}>
          <Wrench className="ui-icon" aria-hidden="true" />
          工具
        </button>
      ) : null}
      {availableTools.includes("ai") ? (
        <button className={activeTool === "ai" ? "active" : ""} type="button" onClick={() => onToolChange?.("ai")}>
          <Bot className="ui-icon" aria-hidden="true" />
          AI
        </button>
      ) : null}
      {onToggleRightPane ? (
        <Tooltip label="收起右侧面板">
          <button
            className="right-collapse-button"
            type="button"
            aria-label="收起右侧面板"
            aria-expanded
            onClick={onToggleRightPane}
          >
            <PanelRightClose className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </nav>
  );
}

function FilePanelShell({
  children,
  disabled = false,
  hasExpandedDirectories,
  loading = false,
  path,
  showHidden,
  terminalPath,
  locatedDirectoryPath,
  canLocateTerminalDirectory,
  uploadMenuOpen,
  onLocateTerminalDirectory,
  onPathSubmit,
  onRefresh,
  onCollapseExpandedDirectories,
  onCreateDirectory,
  onCreateFile,
  onCopyCurrentPath,
  onToggleHidden,
  onToggleUploadMenu,
  onUploadDirectory,
  onUploadFile,
}: {
  children: ReactNode;
  disabled?: boolean;
  hasExpandedDirectories: boolean;
  loading?: boolean;
  onCreateDirectory?: (parentPath: string) => void;
  onCreateFile?: (parentPath: string) => void;
  onCopyCurrentPath?: () => void;
  path: string;
  showHidden: boolean;
  terminalPath: string | null;
  locatedDirectoryPath: string | null;
  canLocateTerminalDirectory: boolean;
  uploadMenuOpen: boolean;
  onLocateTerminalDirectory: () => void;
  onPathSubmit: (path: string) => void;
  onRefresh: () => void;
  onCollapseExpandedDirectories: () => void;
  onToggleHidden: () => void;
  onToggleUploadMenu: () => void;
  onUploadDirectory?: (parentPath: string) => void;
  onUploadFile?: (parentPath: string) => void;
}) {
  const [pathInput, setPathInput] = useState(path);
  const isAtTerminalPath = Boolean(
    terminalPath && (terminalPath === "/" ? path === terminalPath : locatedDirectoryPath === terminalPath),
  );
  const terminalLocateLabel = locateTooltipLabel(terminalPath, canLocateTerminalDirectory);
  const parentPath = remotePathParent(path);
  const canNavigateToParent = parentPath !== path;

  useEffect(() => {
    setPathInput(path);
  }, [path]);

  function submitPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPathSubmit(pathInput);
  }

  return (
    <>
      <div className="file-panel-toolbar">
        <div className="file-panel-path-row">
          <Tooltip label={canNavigateToParent ? "上一级" : "已在根目录"}>
            <button
              className="mini-action"
              type="button"
              aria-label="打开上一级文件夹"
              disabled={disabled || !canNavigateToParent}
              onClick={() => onPathSubmit(parentPath)}
            >
              <ArrowUp className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <form className="path-form" onSubmit={submitPath}>
            <input
              className="path-input"
              disabled={disabled}
              spellCheck={false}
              title={path}
              value={pathInput}
              aria-label="远程路径"
              onChange={(event) => setPathInput(event.target.value)}
            />
          </form>
        </div>
        <div className="file-panel-actions" aria-label="文件工具栏">
          <div className="file-panel-action-group">
            <Tooltip label={terminalLocateLabel}>
              <button
                className={`mini-action ${isAtTerminalPath ? "active" : ""}`}
                type="button"
                aria-label="定位到当前终端目录"
                disabled={disabled || !canLocateTerminalDirectory}
                title={terminalLocateLabel}
                onClick={onLocateTerminalDirectory}
              >
                <Crosshair className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label={showHidden ? "隐藏点文件" : "显示点文件"}>
              <button
                className={`mini-action ${showHidden ? "active" : ""}`}
                type="button"
                aria-label={showHidden ? "隐藏点文件" : "显示点文件"}
                disabled={disabled}
                aria-pressed={showHidden}
                onClick={onToggleHidden}
              >
                {showHidden ? (
                  <EyeOff className="ui-icon" aria-hidden="true" />
                ) : (
                  <Eye className="ui-icon" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
            <Tooltip label={hasExpandedDirectories ? "收起已展开目录" : "没有可收起的目录"}>
              <button
                className="mini-action"
                type="button"
                aria-label="收起已展开目录"
                disabled={disabled || !hasExpandedDirectories}
                onClick={onCollapseExpandedDirectories}
              >
                <ChevronUp className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="file-panel-action-group">
            <Tooltip label="复制当前路径">
              <button className="mini-action" type="button" aria-label="复制当前路径" disabled={disabled} onClick={onCopyCurrentPath}>
                <Clipboard className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="新建文件">
              <button
                className="mini-action"
                type="button"
                aria-label="新建文件"
                disabled={disabled || !onCreateFile}
                onClick={() => onCreateFile?.(path)}
              >
                <FilePlus className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="新建文件夹">
              <button
                className="mini-action"
                type="button"
                aria-label="新建文件夹"
                disabled={disabled || !onCreateDirectory}
                onClick={() => onCreateDirectory?.(path)}
              >
                <FolderPlus className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="刷新目录">
              <button className="mini-action" type="button" aria-label="刷新目录" disabled={disabled} onClick={onRefresh}>
                <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
              </button>
            </Tooltip>
            <div className="upload-action-wrap">
              <Tooltip label="上传">
                <button
                  className={`mini-action upload-trigger ${uploadMenuOpen ? "active" : ""}`}
                  type="button"
                  aria-label="上传"
                  aria-expanded={uploadMenuOpen}
                  disabled={disabled}
                  onClick={onToggleUploadMenu}
                >
                  <Upload className="ui-icon" aria-hidden="true" />
                  <ChevronDown className="ui-icon chevron" aria-hidden="true" />
                </button>
              </Tooltip>
              {uploadMenuOpen ? (
                <div className="upload-menu" role="menu" aria-label="上传选项">
                  <button
                    className="upload-menu-item"
                    type="button"
                    disabled={disabled || !onUploadFile}
                    role="menuitem"
                    onClick={() => {
                      onUploadFile?.(path);
                      onToggleUploadMenu();
                    }}
                  >
                    上传文件
                  </button>
                  <button
                    className="upload-menu-item"
                    type="button"
                    disabled={disabled || !onUploadDirectory}
                    role="menuitem"
                    onClick={() => {
                      onUploadDirectory?.(path);
                      onToggleUploadMenu();
                    }}
                  >
                    上传文件夹
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {children}
    </>
  );
}

function locateTooltipLabel(terminalPath: string | null, canLocateTerminalDirectory: boolean) {
  if (terminalPath) {
    return `定位到: ${terminalPath}`;
  }
  if (canLocateTerminalDirectory) {
    return "读取当前终端提示符并定位";
  }
  return "当前终端目录未记录";
}

async function extractUploadItems(dataTransfer: DataTransfer): Promise<RemoteFileUploadItem[]> {
  const items = Array.from(dataTransfer.items || []);
  if (items.length > 0) {
    const collected = await Promise.all(
      items
        .filter((item) => item.kind === "file")
        .map(async (item) => {
          const entry = (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.();
          if (entry) {
            return collectEntryUploadItems(entry, "");
          }
          const file = item.getAsFile();
          return file ? [{ file, relativePath: file.name }] : [];
        }),
    );
    return collected.flat();
  }

  return Array.from(dataTransfer.files || []).map((file) => ({
    file,
    relativePath: relativePathForFile(file),
  }));
}

async function collectEntryUploadItems(
  entry: FileSystemEntryLike,
  prefix: string,
): Promise<RemoteFileUploadItem[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike);
    return [{ file, relativePath: `${prefix}${file.name}` }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const directory = entry as FileSystemDirectoryEntryLike;
  const entries = await readAllDirectoryEntries(directory);
  const nextPrefix = `${prefix}${directory.name}/`;
  const nested = await Promise.all(entries.map((item) => collectEntryUploadItems(item, nextPrefix)));
  return nested.flat();
}

function readFileEntry(entry: FileSystemFileEntryLike) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readAllDirectoryEntries(entry: FileSystemDirectoryEntryLike) {
  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  return new Promise<FileSystemEntryLike[]>((resolve, reject) => {
    function readNextBatch() {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readNextBatch();
      }, reject);
    }

    readNextBatch();
  });
}

function relativePathForFile(file: File) {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath || file.name;
}

function hasLocalFileDrop(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types || []).map((type) => type.toLowerCase());
  if (types.includes("application/x-mxterm-remote-file")) {
    return false;
  }
  if (types.includes("files")) {
    return true;
  }
  if (Array.from(dataTransfer.items || []).some((item) => item.kind === "file")) {
    return true;
  }
  return (dataTransfer.files?.length || 0) > 0;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function visibleEntries(entries: RemoteFileEntry[], showHidden: boolean) {
  return sortRemoteFileEntries(
    showHidden ? entries : entries.filter((entry) => !entry.name.startsWith(".")),
  );
}

function flattenVisibleRows(
  rows: RemoteFileEntry[],
  directoryEntries: Record<string, RemoteFileEntry[]>,
  expandedDirectories: Record<string, boolean>,
  showHidden: boolean,
  depth: number,
): RemoteFileVisibleRow[] {
  return rows.flatMap((entry) => {
    const current = [{ depth, entry }];
    if (entry.type !== "directory" || !expandedDirectories[entry.path]) {
      return current;
    }
    const children = visibleEntries(directoryEntries[entry.path] || [], showHidden);
    return [
      ...current,
      ...flattenVisibleRows(children, directoryEntries, expandedDirectories, showHidden, depth + 1),
    ];
  });
}

function selectedEntriesInVisibleOrder(
  selectedEntriesByPath: Record<string, RemoteFileEntry>,
  visibleRows: RemoteFileVisibleRow[],
) {
  const selectedPaths = new Set(Object.keys(selectedEntriesByPath));
  const visibleEntries = visibleRows
    .map((row) => selectedEntriesByPath[normalizeRemotePath(row.entry.path)])
    .filter((entry): entry is RemoteFileEntry => Boolean(entry));
  const visiblePaths = new Set(visibleEntries.map((entry) => normalizeRemotePath(entry.path)));
  const hiddenEntries = Array.from(selectedPaths)
    .filter((path) => !visiblePaths.has(path))
    .sort()
    .map((path) => selectedEntriesByPath[path])
    .filter((entry): entry is RemoteFileEntry => Boolean(entry));

  return [...visibleEntries, ...hiddenEntries];
}

function previewEntriesForPath(path: string) {
  return [...(previewDirectoryEntries[path] || [])];
}

function remotePathName(path: string) {
  const normalizedPath = normalizeRemotePath(path);
  if (normalizedPath === "/") {
    return "/";
  }
  const parts = normalizedPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalizedPath;
}
