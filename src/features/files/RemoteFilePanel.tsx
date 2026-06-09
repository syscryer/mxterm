import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
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
  PanelRightClose,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import { remoteFileList } from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { Tooltip } from "../../shared/ui/Tooltip";
import { resolveRemoteFileIcon, remoteFileIconKind } from "./remoteFileIcons";
import {
  isRemotePathStrictDescendant,
  normalizeRemotePath,
  remotePathAncestors,
  remotePathParent,
  shouldShowRemoteDirectoryEmptyRow,
  sortRemoteFileEntries,
} from "./remoteFilePaths";
import type { RemoteFileEntry } from "./remoteFileTypes";

export type RemoteFileTool = "files" | "transfers";

export interface RemoteFileUploadItem {
  file: File;
  relativePath: string;
}

interface RemoteFilePanelProps {
  activeTool: RemoteFileTool;
  connection: ConnectionProfile | null;
  refreshRequest?: RemoteFileRefreshRequest | null;
  transferAttention?: boolean;
  transferCount?: number;
  transferPanel?: ReactNode;
  nativeDropTargetPath?: string | null;
  onCopyPath?: (path: string) => void;
  onCreateDirectory?: (parentPath: string) => void;
  onCreateFile?: (parentPath: string) => void;
  onDeleteEntry?: (entry: RemoteFileEntry) => void;
  onDownloadEntry?: (entry: RemoteFileEntry) => void;
  onOpenFile?: (entry: RemoteFileEntry) => void;
  onRenameEntry?: (entry: RemoteFileEntry) => void;
  onShowProperties?: (entry: RemoteFileEntry) => void;
  onToolChange?: (tool: RemoteFileTool) => void;
  onToggleRightPane?: () => void;
  onUploadDirectory?: (parentPath: string) => void;
  onUploadFile?: (parentPath: string) => void;
  onUploadItems?: (parentPath: string, items: RemoteFileUploadItem[]) => void;
  terminalPath?: string | null;
}

interface RemoteFileRefreshRequest {
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

export function RemoteFilePanel({
  activeTool,
  connection,
  refreshRequest,
  transferAttention = false,
  transferCount = 0,
  transferPanel,
  nativeDropTargetPath = null,
  onCopyPath,
  onCreateDirectory,
  onCreateFile,
  onDeleteEntry,
  onDownloadEntry,
  onOpenFile,
  onRenameEntry,
  onShowProperties,
  onToolChange,
  onToggleRightPane,
  onUploadDirectory,
  onUploadFile,
  onUploadItems,
  terminalPath,
}: RemoteFilePanelProps) {
  const terminalDirectory = terminalPath ? normalizeRemotePath(terminalPath) : null;
  const [currentPath, setCurrentPath] = useState(defaultRemotePath);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState(defaultRemotePath);
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, RemoteFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [locatedDirectoryPath, setLocatedDirectoryPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [visibleLoadingPath, setVisibleLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLoadScopeRef = useRef(0);

  const entries = useMemo(
    () => visibleEntries(directoryEntries[currentPath] || [], showHidden),
    [currentPath, directoryEntries, showHidden],
  );
  const hasExpandedDirectories = useMemo(
    () => Object.values(expandedDirectories).some(Boolean),
    [expandedDirectories],
  );

  useEffect(() => {
    connectionLoadScopeRef.current += 1;
    setDirectoryEntries({});
    setExpandedDirectories({});
    setLocatedDirectoryPath(null);
    setUploadMenuOpen(false);
    setDropTargetPath(null);
    setCurrentPath(defaultRemotePath);
    setActiveDirectoryPath(defaultRemotePath);
    setLoadingPath(null);
    setVisibleLoadingPath(null);
    clearLoadingIndicatorTimer();
  }, [connection?.id]);

  useEffect(() => {
    void loadDirectory(currentPath);
  }, [connection?.id, currentPath]);

  useEffect(() => {
    if (!refreshRequest || !connection) {
      return;
    }
    void loadDirectory(refreshRequest.path, true);
  }, [connection?.id, refreshRequest?.id, refreshRequest?.path]);

  useEffect(
    () => () => {
      clearLoadingIndicatorTimer();
    },
    [],
  );

  const isCurrentPathLoading = loadingPath === currentPath;
  const showCurrentPathLoading = visibleLoadingPath === currentPath;
  const disabled = !connection;
  const effectiveDropTargetPath = dropTargetPath || nativeDropTargetPath;

  return (
    <aside className="tool-pane" aria-label="右侧工具面板">
      <FilePanelTabs
        activeTool={activeTool}
        transferAttention={transferAttention}
        transferCount={transferCount}
        onToolChange={onToolChange}
        onToggleRightPane={onToggleRightPane}
      />
      {activeTool === "transfers" ? (
        <div className="transfer-tool-body">
          {transferPanel || <p className="file-panel-empty">还没有传输任务。</p>}
        </div>
      ) : (
        <FilePanelShell
          disabled={disabled}
          hasExpandedDirectories={hasExpandedDirectories}
          loading={Boolean(visibleLoadingPath)}
          path={activeDirectoryPath}
          showHidden={showHidden}
          terminalPath={terminalDirectory}
          locatedDirectoryPath={locatedDirectoryPath}
          canLocateTerminalDirectory={Boolean(terminalDirectory)}
          uploadMenuOpen={uploadMenuOpen}
          onLocateTerminalDirectory={revealTerminalDirectory}
          onPathSubmit={navigateToPath}
          onRefresh={() => void loadDirectory(activeDirectoryPath, true)}
          onCollapseExpandedDirectories={collapseExpandedDirectories}
          onToggleHidden={() => setShowHidden((value) => !value)}
          onToggleUploadMenu={() => setUploadMenuOpen((open) => !open)}
          onCreateDirectory={connection ? onCreateDirectory : undefined}
          onCreateFile={connection ? onCreateFile : undefined}
          onDownloadCurrentDirectory={connection ? () => onDownloadEntry?.(currentDirectoryEntry()) : undefined}
          onCopyCurrentPath={connection ? () => onCopyPath?.(activeDirectoryPath) : undefined}
          onUploadDirectory={connection ? onUploadDirectory : undefined}
          onUploadFile={connection ? onUploadFile : undefined}
        >
          {!connection ? (
            <p className="file-panel-empty">打开一个 SSH 会话后显示远程文件。</p>
          ) : (
            <>
              {error ? <p className="file-panel-error">{error}</p> : null}
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
                  <div
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
            </>
          )}
        </FilePanelShell>
      )}
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
    setCurrentPath(normalizedPath);
    setActiveDirectoryPath(normalizedPath);
    setLocatedDirectoryPath(null);
    setUploadMenuOpen(false);
    if (directoryEntries[normalizedPath]) {
      setError(null);
    }
  }

  function revealTerminalDirectory() {
    if (!terminalDirectory) {
      return;
    }

    const revealRootPath = isRemotePathStrictDescendant(terminalDirectory, currentPath)
      ? currentPath
      : defaultRemotePath;
    const ancestorPaths = remotePathAncestors(terminalDirectory);
    const expandableAncestorPaths = ancestorPaths.filter(
      (path) => path !== "/" && path !== revealRootPath && isRemotePathStrictDescendant(path, revealRootPath),
    );

    setCurrentPath(revealRootPath);
    setActiveDirectoryPath(terminalDirectory);
    setLocatedDirectoryPath(terminalDirectory);
    setUploadMenuOpen(false);
    setExpandedDirectories((current) => {
      const next = { ...current };
      for (const path of expandableAncestorPaths) {
        next[path] = true;
      }
      return next;
    });

    void loadRevealPath([revealRootPath, ...expandableAncestorPaths]);
  }

  function collapseExpandedDirectories() {
    if (hasExpandedDirectories) {
      setExpandedDirectories({});
      setActiveDirectoryPath(currentPath);
    }
  }

  async function loadDirectory(path: string, force = false) {
    const normalizedPath = normalizeRemotePath(path);
    if (!connection || (!force && directoryEntries[normalizedPath])) {
      return;
    }

    const requestLoadScope = connectionLoadScopeRef.current;
    clearLoadingIndicatorTimer();
    setLoadingPath(normalizedPath);
    setVisibleLoadingPath(null);
    setError(null);
    loadingIndicatorTimerRef.current = setTimeout(() => {
      if (connectionLoadScopeRef.current !== requestLoadScope) {
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

      setDirectoryEntries((current) => ({
        ...current,
        [normalizedPath]: sortRemoteFileEntries(nextEntries),
      }));
    } catch (error) {
      if (connectionLoadScopeRef.current !== requestLoadScope) {
        return;
      }
      setError(formatError(error));
    } finally {
      if (connectionLoadScopeRef.current !== requestLoadScope) {
        return;
      }
      clearLoadingIndicatorTimer();
      setLoadingPath((path) => (path === normalizedPath ? null : path));
      setVisibleLoadingPath((path) => (path === normalizedPath ? null : path));
    }
  }

  async function loadRevealPath(paths: string[]) {
    for (const path of paths) {
      await loadDirectory(path);
    }
  }

  function toggleDirectory(entry: RemoteFileEntry) {
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

  function renderRows(rows: RemoteFileEntry[], depth: number): ReactNode[] {
    return rows.flatMap((entry) => {
      const isDirectory = entry.type === "directory";
      const expanded = Boolean(expandedDirectories[entry.path]);
      const isActiveDirectory = isDirectory && entry.path === activeDirectoryPath;
      const isLocatedDirectory = entry.path === locatedDirectoryPath;
      const row = (
        <ContextMenu.Root key={entry.path}>
          <ContextMenu.Trigger asChild>
            <button
              className={`remote-file-row ${isActiveDirectory ? "is-active-directory" : ""} ${
                isLocatedDirectory ? "is-located" : ""
              } ${
                effectiveDropTargetPath === entry.path ? "is-drop-target" : ""
              }`}
              data-remote-file-drop-target={isDirectory ? entry.path : undefined}
              draggable
              style={{
                paddingLeft: `${8 + depth * 16}px`,
                ...(isLocatedDirectory ? { background: "var(--mx-active)", color: "var(--mx-text)" } : {}),
              }}
              type="button"
              title={entry.path}
              aria-current={isLocatedDirectory ? "location" : isActiveDirectory ? "page" : undefined}
              onClick={() => {
                if (isDirectory) {
                  toggleDirectory(entry);
                }
              }}
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

function FilePanelTabs({
  activeTool,
  transferAttention,
  transferCount,
  onToolChange,
  onToggleRightPane,
}: {
  activeTool: RemoteFileTool;
  transferAttention: boolean;
  transferCount: number;
  onToolChange?: (tool: RemoteFileTool) => void;
  onToggleRightPane?: () => void;
}) {
  return (
    <nav className="tool-tabs" aria-label="工具标签">
      <button className={activeTool === "files" ? "active" : ""} type="button" onClick={() => onToolChange?.("files")}>
        <Folder className="ui-icon" aria-hidden="true" />
        文件
      </button>
      <button
        className={`${activeTool === "transfers" ? "active" : ""} ${transferAttention ? "attention" : ""}`}
        type="button"
        onClick={() => onToolChange?.("transfers")}
      >
        <Upload className="ui-icon" aria-hidden="true" />
        传输
        {transferCount > 0 ? <span className="tool-tab-badge">{transferCount.toString()}</span> : null}
      </button>
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
  onDownloadCurrentDirectory,
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
  onDownloadCurrentDirectory?: () => void;
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
  const terminalLocateLabel = locateTooltipLabel(terminalPath);

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
                className={`mini-action ${hasExpandedDirectories ? "active" : ""}`}
                type="button"
                aria-label="收起已展开目录"
                disabled={disabled || !hasExpandedDirectories}
                onClick={onCollapseExpandedDirectories}
              >
                <ChevronsUp className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="file-panel-action-group">
            <Tooltip label="复制当前路径">
              <button className="mini-action" type="button" aria-label="复制当前路径" disabled={disabled} onClick={onCopyCurrentPath}>
                <Clipboard className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="下载当前目录">
              <button className="mini-action" type="button" aria-label="下载当前目录" disabled={disabled} onClick={onDownloadCurrentDirectory}>
                <Download className="ui-icon" aria-hidden="true" />
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

function locateTooltipLabel(terminalPath: string | null) {
  if (terminalPath) {
    return `定位到: ${terminalPath}`;
  }
  return "当前终端目录未记录";
}

function RemoteFileIcon({ entry, expanded }: { entry: RemoteFileEntry; expanded: boolean }) {
  const [iconFailed, setIconFailed] = useState(false);
  const iconKind = remoteFileIconKind(entry);
  const iconSrc = resolveRemoteFileIcon(entry, expanded);

  if (!iconFailed) {
    return (
      <img
        className="remote-file-icon"
        src={iconSrc}
        alt=""
        aria-hidden="true"
        onError={() => setIconFailed(true)}
      />
    );
  }

  if (entry.type === "directory") {
    return <Folder className="ui-icon remote-file-fallback folder" aria-hidden="true" />;
  }

  if (iconKind === "file") {
    return <FileText className="ui-icon remote-file-fallback" aria-hidden="true" />;
  }

  return (
    <span className={`remote-file-badge ${iconKind}`} aria-hidden="true">
      {fileBadgeLabel(iconKind)}
    </span>
  );
}

function fileBadgeLabel(iconKind: string) {
  if (iconKind === "react") return "R";
  if (iconKind === "html") return "H";
  if (iconKind === "style") return "S";
  if (iconKind === "md") return "M";
  if (iconKind === "json") return "{}";
  if (iconKind === "config") return "C";
  if (iconKind === "log") return "L";
  if (iconKind === "script") return ">";
  if (iconKind === "link") return "@";
  return ".";
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
