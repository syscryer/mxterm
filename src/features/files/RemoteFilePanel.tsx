import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import { remoteFileList } from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { Tooltip } from "../../shared/ui/Tooltip";
import { resolveRemoteFileIcon, remoteFileIconKind } from "./remoteFileIcons";
import {
  isRemotePathStrictDescendant,
  normalizeRemotePath,
  remotePathAncestors,
  shouldShowRemoteDirectoryEmptyRow,
  sortRemoteFileEntries,
} from "./remoteFilePaths";
import type { RemoteFileEntry } from "./remoteFileTypes";

interface RemoteFilePanelProps {
  connection: ConnectionProfile | null;
  refreshRequest?: RemoteFileRefreshRequest | null;
  onCreateDirectory?: (parentPath: string) => void;
  onCreateFile?: (parentPath: string) => void;
  onDeleteEntry?: (entry: RemoteFileEntry) => void;
  onDownloadFile?: (entry: RemoteFileEntry) => void;
  onOpenFile?: (entry: RemoteFileEntry) => void;
  onRenameEntry?: (entry: RemoteFileEntry) => void;
  onToggleRightPane?: () => void;
  onUploadFile?: (parentPath: string) => void;
  terminalPath?: string | null;
}

interface RemoteFileRefreshRequest {
  id: number;
  path: string;
}

const previewEntries: RemoteFileEntry[] = [
  { name: "logs", path: "/opt/app/logs", type: "directory" },
  { name: "config", path: "/opt/app/config", type: "directory" },
  { name: "app.log", path: "/opt/app/app.log", type: "file" },
  { name: "nginx.conf", path: "/opt/app/nginx.conf", type: "file" },
];

const defaultRemotePath = "/";
const loadingIndicatorDelayMs = 180;

export function RemoteFilePanel({
  connection,
  refreshRequest,
  onCreateDirectory,
  onCreateFile,
  onDeleteEntry,
  onDownloadFile,
  onOpenFile,
  onRenameEntry,
  onToggleRightPane,
  onUploadFile,
  terminalPath,
}: RemoteFilePanelProps) {
  const terminalDirectory = terminalPath ? normalizeRemotePath(terminalPath) : null;
  const [currentPath, setCurrentPath] = useState(defaultRemotePath);
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, RemoteFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [locatedDirectoryPath, setLocatedDirectoryPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
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
    setCurrentPath(defaultRemotePath);
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

  if (!connection) {
    return (
      <aside className="tool-pane" aria-label="右侧工具面板">
        <FilePanelShell
          disabled
          hasExpandedDirectories={false}
          loading={false}
          path="/"
          showHidden={showHidden}
          terminalPath={null}
          locatedDirectoryPath={null}
          canLocateTerminalDirectory={false}
          uploadMenuOpen={false}
          onLocateTerminalDirectory={() => {}}
          onPathSubmit={() => {}}
          onRefresh={() => {}}
          onCollapseExpandedDirectories={() => {}}
          onToggleHidden={() => {}}
          onToggleUploadMenu={() => {}}
          onToggleRightPane={onToggleRightPane}
          onCreateDirectory={undefined}
          onCreateFile={undefined}
          onUploadFile={undefined}
        >
          <p className="file-panel-empty">打开一个 SSH 会话后显示远程文件。</p>
        </FilePanelShell>
      </aside>
    );
  }

  return (
    <aside className="tool-pane" aria-label="右侧工具面板">
      <FilePanelShell
        hasExpandedDirectories={hasExpandedDirectories}
        loading={Boolean(visibleLoadingPath)}
        path={currentPath}
        showHidden={showHidden}
        terminalPath={terminalDirectory}
        locatedDirectoryPath={locatedDirectoryPath}
        canLocateTerminalDirectory={Boolean(terminalDirectory)}
        uploadMenuOpen={uploadMenuOpen}
        onLocateTerminalDirectory={revealTerminalDirectory}
        onPathSubmit={navigateToPath}
        onRefresh={() => void loadDirectory(currentPath, true)}
        onCollapseExpandedDirectories={collapseExpandedDirectories}
        onToggleHidden={() => setShowHidden((value) => !value)}
        onToggleUploadMenu={() => setUploadMenuOpen((open) => !open)}
        onToggleRightPane={onToggleRightPane}
        onCreateDirectory={onCreateDirectory}
        onCreateFile={onCreateFile}
        onUploadFile={onUploadFile}
      >
        {error ? <p className="file-panel-error">{error}</p> : null}
        <section className="remote-file-tree" aria-label="远程文件树">
          {entries.length ? (
            renderRows(entries, 0)
          ) : showCurrentPathLoading ? (
            <p className="file-panel-empty">读取目录中...</p>
          ) : isCurrentPathLoading ? null : (
            <p className="file-panel-empty">当前目录为空。</p>
          )}
        </section>
      </FilePanelShell>
    </aside>
  );

  function navigateToPath(path: string) {
    const normalizedPath = normalizeRemotePath(path);
    setCurrentPath(normalizedPath);
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
        : previewEntries;

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
      const isLocatedDirectory = entry.path === locatedDirectoryPath;
      const row = (
        <ContextMenu.Root key={entry.path}>
          <ContextMenu.Trigger asChild>
            <button
              className={`remote-file-row ${isLocatedDirectory ? "is-located" : ""}`}
              style={{
                paddingLeft: `${8 + depth * 16}px`,
                ...(isLocatedDirectory ? { background: "var(--mx-active)", color: "var(--mx-text)" } : {}),
              }}
              type="button"
              title={entry.path}
              aria-current={isLocatedDirectory ? "location" : undefined}
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
    return (
      <>
        <ContextMenu.Item className="context-menu-item" onSelect={() => onOpenFile?.(entry)}>
          <FileText className="ui-icon" aria-hidden="true" />
          打开
        </ContextMenu.Item>
        <ContextMenu.Item
          className="context-menu-item"
          disabled={!onDownloadFile}
          onSelect={() => onDownloadFile?.(entry)}
        >
          <Download className="ui-icon" aria-hidden="true" />
          下载
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
        <ContextMenu.Item
          className="context-menu-item"
          disabled={!onRenameEntry}
          onSelect={() => onRenameEntry?.(entry)}
        >
          <Pencil className="ui-icon" aria-hidden="true" />
          重命名
        </ContextMenu.Item>
        <ContextMenu.Item
          className="context-menu-item danger"
          disabled={!onDeleteEntry}
          onSelect={() => onDeleteEntry?.(entry)}
        >
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
          disabled={!onCreateFile}
          onSelect={() => onCreateFile?.(entry.path)}
        >
          <FilePlus className="ui-icon" aria-hidden="true" />
          新建文件
        </ContextMenu.Item>
        <ContextMenu.Item
          className="context-menu-item"
          disabled={!onCreateDirectory}
          onSelect={() => onCreateDirectory?.(entry.path)}
        >
          <FolderPlus className="ui-icon" aria-hidden="true" />
          新建文件夹
        </ContextMenu.Item>
        <ContextMenu.Item
          className="context-menu-item"
          disabled={!onUploadFile}
          onSelect={() => onUploadFile?.(entry.path)}
        >
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件
        </ContextMenu.Item>
        <ContextMenu.Item className="context-menu-item" disabled>
          <Upload className="ui-icon" aria-hidden="true" />
          上传文件夹
        </ContextMenu.Item>
        <ContextMenu.Separator className="context-menu-separator" />
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
        <ContextMenu.Item
          className="context-menu-item"
          disabled={!onRenameEntry}
          onSelect={() => onRenameEntry?.(entry)}
        >
          <Pencil className="ui-icon" aria-hidden="true" />
          重命名
        </ContextMenu.Item>
        <ContextMenu.Item
          className="context-menu-item danger"
          disabled={!onDeleteEntry}
          onSelect={() => onDeleteEntry?.(entry)}
        >
          <Trash2 className="ui-icon" aria-hidden="true" />
          删除
        </ContextMenu.Item>
      </>
    );
  }

  function clearLoadingIndicatorTimer() {
    if (loadingIndicatorTimerRef.current) {
      clearTimeout(loadingIndicatorTimerRef.current);
      loadingIndicatorTimerRef.current = null;
    }
  }
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
  onToggleHidden,
  onToggleUploadMenu,
  onToggleRightPane,
  onUploadFile,
}: {
  children: ReactNode;
  disabled?: boolean;
  hasExpandedDirectories: boolean;
  loading?: boolean;
  onCreateDirectory?: (parentPath: string) => void;
  onCreateFile?: (parentPath: string) => void;
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
  onToggleRightPane?: () => void;
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
      <nav className="tool-tabs" aria-label="工具标签">
        <button className="active" type="button">
          <Folder className="ui-icon" aria-hidden="true" />
          文件
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
                  <button className="upload-menu-item" type="button" disabled role="menuitem">
                    上传文件夹
                  </button>
                  <span className="upload-menu-note">上传文件夹暂未接入递归传输</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="file-list">{children}</div>
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
  return "·";
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
