import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Crosshair,
  Eye,
  EyeOff,
  FileText,
  Folder,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import { remoteFileList } from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { Tooltip } from "../../shared/ui/Tooltip";
import { resolveRemoteFileIcon, remoteFileIconKind } from "./remoteFileIcons";
import { normalizeRemotePath, sortRemoteFileEntries } from "./remoteFilePaths";
import type { RemoteFileEntry } from "./remoteFileTypes";

interface RemoteFilePanelProps {
  connection: ConnectionProfile | null;
  terminalPath?: string | null;
}

const previewEntries: RemoteFileEntry[] = [
  { name: "logs", path: "/opt/app/logs", type: "directory" },
  { name: "config", path: "/opt/app/config", type: "directory" },
  { name: "app.log", path: "/opt/app/app.log", type: "file" },
  { name: "nginx.conf", path: "/opt/app/nginx.conf", type: "file" },
];

const defaultRemotePath = "/";

export function RemoteFilePanel({
  connection,
  terminalPath,
}: RemoteFilePanelProps) {
  const terminalDirectory = terminalPath ? normalizeRemotePath(terminalPath) : null;
  const [currentPath, setCurrentPath] = useState(defaultRemotePath);
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, RemoteFileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(
    () => visibleEntries(directoryEntries[currentPath] || [], showHidden),
    [currentPath, directoryEntries, showHidden],
  );
  const hasExpandedDirectories = useMemo(
    () => Object.values(expandedDirectories).some(Boolean),
    [expandedDirectories],
  );

  useEffect(() => {
    setDirectoryEntries({});
    setExpandedDirectories({});
    setUploadMenuOpen(false);
    setCurrentPath(defaultRemotePath);
  }, [connection?.id]);

  useEffect(() => {
    void loadDirectory(currentPath);
  }, [connection?.id, currentPath]);

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
          canLocateTerminalDirectory={false}
          uploadMenuOpen={false}
          onLocateTerminalDirectory={() => {}}
          onPathSubmit={() => {}}
          onRefresh={() => {}}
          onCollapseExpandedDirectories={() => {}}
          onToggleHidden={() => {}}
          onToggleUploadMenu={() => {}}
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
        loading={Boolean(loadingPath)}
        path={currentPath}
        showHidden={showHidden}
        terminalPath={terminalDirectory}
        canLocateTerminalDirectory={Boolean(terminalDirectory)}
        uploadMenuOpen={uploadMenuOpen}
        onLocateTerminalDirectory={locateTerminalDirectory}
        onPathSubmit={navigateToPath}
        onRefresh={() => void loadDirectory(currentPath, true)}
        onCollapseExpandedDirectories={collapseExpandedDirectories}
        onToggleHidden={() => setShowHidden((value) => !value)}
        onToggleUploadMenu={() => setUploadMenuOpen((open) => !open)}
      >
        {error ? <p className="file-panel-error">{error}</p> : null}
        <section className="remote-file-tree" aria-label="远程文件树">
          {entries.length ? (
            renderRows(entries, 0)
          ) : loadingPath === currentPath ? (
            <p className="file-panel-empty">读取目录中...</p>
          ) : (
            <p className="file-panel-empty">当前目录为空。</p>
          )}
        </section>
      </FilePanelShell>
    </aside>
  );

  function navigateToPath(path: string) {
    const normalizedPath = normalizeRemotePath(path);
    setCurrentPath(normalizedPath);
    setUploadMenuOpen(false);
    if (directoryEntries[normalizedPath]) {
      setError(null);
    }
  }

  function locateTerminalDirectory() {
    if (terminalDirectory) {
      navigateToPath(terminalDirectory);
    }
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

    setLoadingPath(normalizedPath);
    setError(null);

    try {
      const nextEntries = hasTauriRuntime()
        ? await remoteFileList(connection.id, normalizedPath)
        : previewEntries;

      setDirectoryEntries((current) => ({
        ...current,
        [normalizedPath]: sortRemoteFileEntries(nextEntries),
      }));
    } catch (error) {
      setError(formatError(error));
    } finally {
      setLoadingPath((path) => (path === normalizedPath ? null : path));
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
      const row = (
        <button
          className="remote-file-row"
          key={entry.path}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          type="button"
          title={entry.path}
          onClick={() => {
            if (isDirectory) {
              toggleDirectory(entry);
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
          {loadingPath === entry.path ? <RefreshCw className="ui-icon spin" aria-hidden="true" /> : null}
        </button>
      );

      if (!isDirectory || !expanded) {
        return [row];
      }

      const children = visibleEntries(directoryEntries[entry.path] || [], showHidden);
      return [
        row,
        ...(children.length
          ? renderRows(children, depth + 1)
          : [
              <div className="remote-file-empty-row" key={`${entry.path}:empty`} style={{ paddingLeft: `${38 + depth * 16}px` }}>
                空文件夹
              </div>,
            ]),
      ];
    });
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
  canLocateTerminalDirectory,
  uploadMenuOpen,
  onLocateTerminalDirectory,
  onPathSubmit,
  onRefresh,
  onCollapseExpandedDirectories,
  onToggleHidden,
  onToggleUploadMenu,
}: {
  children: ReactNode;
  disabled?: boolean;
  hasExpandedDirectories: boolean;
  loading?: boolean;
  path: string;
  showHidden: boolean;
  terminalPath: string | null;
  canLocateTerminalDirectory: boolean;
  uploadMenuOpen: boolean;
  onLocateTerminalDirectory: () => void;
  onPathSubmit: (path: string) => void;
  onRefresh: () => void;
  onCollapseExpandedDirectories: () => void;
  onToggleHidden: () => void;
  onToggleUploadMenu: () => void;
}) {
  const [pathInput, setPathInput] = useState(path);
  const isAtTerminalPath = Boolean(terminalPath && path === terminalPath);
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
          文件
        </button>
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
                  <button className="upload-menu-item" type="button" disabled role="menuitem">
                    上传文件
                  </button>
                  <button className="upload-menu-item" type="button" disabled role="menuitem">
                    上传文件夹
                  </button>
                  <span className="upload-menu-note">传输能力后续接入</span>
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
