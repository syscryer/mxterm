import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Check,
  Clock3,
  Folder,
  FolderPlus,
  Menu,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Tooltip } from "../../shared/ui/Tooltip";
import type { ConnectionProfile } from "./connectionTypes";

interface ConnectionPaneProps {
  connections: ConnectionProfile[];
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onConnect: (connection: ConnectionProfile) => void;
  onDelete: (connection: ConnectionProfile) => void | Promise<void>;
  onEdit: (connection: ConnectionProfile) => void;
  onOpen: (connection: ConnectionProfile) => void;
  onRefresh: () => void;
  onSelect: (connection: ConnectionProfile) => void;
  selectedId: string | null;
}

type SystemFolderId = "favorites" | "recent" | "common";
type FolderId = SystemFolderId | `group-${string}`;
type DropTargetId = "root" | `group-${string}`;
type ConnectionGroupAssignments = Record<string, string>;

interface MouseDragState {
  active: boolean;
  connectionId: string;
  currentX: number;
  currentY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  previewWidth: number;
  startX: number;
  startY: number;
}

interface SystemFolder {
  id: SystemFolderId;
  color: string;
  icon: LucideIcon;
  label: string;
}

interface CustomGroup {
  id: string;
  color: string;
  name: string;
}

const systemFolders: SystemFolder[] = [
  { id: "favorites", color: "#e0b341", icon: Star, label: "收藏" },
  { id: "recent", color: "#64748b", icon: Clock3, label: "最近" },
  { id: "common", color: "#4f7d63", icon: Folder, label: "常用" },
];

const customGroupStorageKey = "mxterm.connectionGroups.v2";
const groupAssignmentStorageKey = "mxterm.connectionGroupAssignments.v1";
const groupPalette = ["#64748b", "#2563eb", "#4f7d63", "#c47c2c", "#8b5cf6", "#d14d72"];
const connectionDragDataType = "application/x-mxterm-connection-id";

export function ConnectionPane({
  connections,
  error,
  loading,
  onCreate,
  onConnect,
  onDelete,
  onEdit,
  onOpen,
  onRefresh,
  onSelect,
  selectedId,
}: ConnectionPaneProps) {
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(readStoredGroups);
  const [connectionGroups, setConnectionGroups] =
    useState<ConnectionGroupAssignments>(readStoredGroupAssignments);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupColorDraft, setGroupColorDraft] = useState(groupPalette[0]);
  const [draggingConnectionId, setDraggingConnectionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<DropTargetId | null>(null);
  const [mouseDrag, setMouseDrag] = useState<MouseDragState | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<FolderId, boolean>>({
    common: true,
    favorites: true,
    recent: true,
  });

  const catalog = useMemo(() => buildCatalog(connections), [connections]);
  const customGroupIds = useMemo(
    () => new Set(customGroups.map((group) => group.id)),
    [customGroups],
  );
  const ungroupedConnections = useMemo(
    () =>
      connections.filter((connection) => !customGroupIds.has(connectionGroups[connection.id] || "")),
    [connections, connectionGroups, customGroupIds],
  );
  const draggedConnection = mouseDrag?.active
    ? connections.find((connection) => connection.id === mouseDrag.connectionId) || null
    : null;

  useEffect(() => {
    writeStoredGroups(customGroups);
  }, [customGroups]);

  useEffect(() => {
    writeStoredGroupAssignments(connectionGroups);
  }, [connectionGroups]);

  useEffect(() => {
    if (!mouseDrag) {
      return;
    }

    const currentDrag = mouseDrag;

    function handleMouseMove(event: MouseEvent) {
      const active = currentDrag.active || mouseDragDistance(currentDrag, event) > 6;

      if (!active) {
        return;
      }

      event.preventDefault();
      setDraggingConnectionId(currentDrag.connectionId);
      setDropTargetId(getDropTargetFromPoint(event.clientX, event.clientY));

      setMouseDrag((drag) =>
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
      const active = currentDrag.active || mouseDragDistance(currentDrag, event) > 6;

      if (active) {
        const targetId = getDropTargetFromPoint(event.clientX, event.clientY);

        if (targetId) {
          moveConnectionToDropTarget(currentDrag.connectionId, targetId);
          return;
        }
      }

      finishConnectionDrag();
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [mouseDrag]);

  return (
    <aside className="connection-pane" aria-label="连接仓库">
      <header className="connection-toolbar">
        <button className="collapse-button" type="button" aria-label="收起连接仓库">
          <Menu className="ui-icon" aria-hidden="true" />
          <span>收起</span>
        </button>
        <div className="toolbar-actions">
          <Tooltip label="刷新连接">
            <button className="icon-button" type="button" aria-label="刷新连接" onClick={onRefresh}>
              <RefreshCw className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <button className="text-tool-button" type="button" onClick={beginCreateGroup}>
            <Plus className="ui-icon" aria-hidden="true" />
            <span>分组</span>
          </button>
          <button className="text-tool-button" type="button" onClick={onCreate}>
            <Plus className="ui-icon" aria-hidden="true" />
            <span>SSH</span>
          </button>
        </div>
      </header>

      <section className="pane-scroll connection-tree" aria-label="连接树">
        <button className="tree-root-row" type="button">
          <span>全部</span>
          <MoreHorizontal className="ui-icon" aria-hidden="true" />
        </button>

        {loading ? <p className="pane-note">加载连接中...</p> : null}
        {error ? <p className="pane-error">{error}</p> : null}

        <div className="tree-block" aria-label="固定分组">
          {systemFolders.map((folder) => (
            <TreeFolder
              color={folder.color}
              connections={catalog[folder.id]}
              expanded={expandedFolders[folder.id]}
              icon={folder.icon}
              key={folder.id}
              label={folder.label}
              onEdit={onEdit}
              onOpen={onOpen}
              onSelect={onSelect}
              onCreateConnection={onCreate}
              onCreateGroup={beginCreateGroup}
              onConnect={onConnect}
              onDeleteConnection={onDelete}
              onConnectionDragEnd={finishConnectionDrag}
              onConnectionDragStart={beginConnectionDrag}
              onMouseConnectionDragStart={beginMouseConnectionDrag}
              onToggle={() => toggleFolder(folder.id)}
              selectedId={selectedId}
            />
          ))}
        </div>

        <div className="tree-section-head">
          <span>分组</span>
          <Tooltip label="新建分组">
            <button
              className="mini-action"
              type="button"
              aria-label="新建分组"
              onClick={beginCreateGroup}
            >
              <FolderPlus className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>

        {creatingGroup ? (
          <form className="group-create-panel" onSubmit={saveGroup}>
            <input
              aria-label="分组名称"
              autoFocus
              placeholder="分组名称"
              value={groupDraft}
              onChange={(event) => setGroupDraft(event.target.value)}
            />
            <div className="group-color-row" aria-label="分组颜色">
              {groupPalette.map((color) => (
                <button
                  className={`color-swatch ${groupColorDraft === color ? "active" : ""}`}
                  key={color}
                  style={{ "--group-color": color } as CSSProperties}
                  type="button"
                  aria-label={`选择颜色 ${color}`}
                  onClick={() => setGroupColorDraft(color)}
                />
              ))}
            </div>
            <div className="group-create-actions">
              <button type="button" onClick={cancelCreateGroup}>
                <X className="ui-icon" aria-hidden="true" />
                <span>取消</span>
              </button>
              <button type="submit">
                <Check className="ui-icon" aria-hidden="true" />
                <span>{editingGroupId ? "更新" : "保存"}</span>
              </button>
            </div>
          </form>
        ) : null}

        {customGroups.length === 0 && !creatingGroup ? (
          <p className="pane-note section-note">暂无分组</p>
        ) : null}

        <div className="tree-block" aria-label="自定义分组">
          {customGroups.map((group) => {
            const folderId: FolderId = `group-${group.id}`;

            return (
              <TreeFolder
                color={group.color}
                expanded={expandedFolders[folderId] ?? true}
                icon={Folder}
                key={group.id}
                label={group.name}
                folderDropTargetId={folderId}
                draggingConnectionId={draggingConnectionId}
                dropTargetId={dropTargetId}
                onEdit={onEdit}
                onOpen={onOpen}
                onSelect={onSelect}
                onCreateConnection={onCreate}
                onCreateGroup={beginCreateGroup}
                onConnect={onConnect}
                onDeleteConnection={onDelete}
                onConnectionDragEnd={finishConnectionDrag}
                onConnectionDragStart={beginConnectionDrag}
                onMouseConnectionDragStart={beginMouseConnectionDrag}
                onDragLeave={clearDropTarget}
                onDragOver={(event) => activateDropTarget(event, `group-${group.id}`)}
                onDropConnection={(connectionId) => assignConnectionToGroup(connectionId, group.id)}
                onEditGroup={() => beginEditGroup(group)}
                onDeleteGroup={() => deleteGroup(group)}
                onToggle={() => toggleFolder(folderId)}
                selectedId={selectedId}
                connections={connections.filter(
                  (connection) => connectionGroups[connection.id] === group.id,
                )}
              />
            );
          })}
        </div>

        {connections.length > 0 ? <div className="tree-section-head standalone-head">未分组</div> : null}
        <div
          className={`tree-block root-connections ${dropTargetId === "root" ? "drop-target" : ""}`}
          aria-label="未分组连接"
          data-drop-target-id="root"
          onDragLeave={clearDropTarget}
          onDragOver={(event) => activateDropTarget(event, "root")}
          onDrop={dropConnectionToRoot}
        >
          {ungroupedConnections.map((connection) => (
            <ConnectionTreeLeaf
              connection={connection}
              key={connection.id}
              dragging={connection.id === draggingConnectionId}
              onDelete={onDelete}
              onDragEnd={finishConnectionDrag}
              onDragStart={beginConnectionDrag}
              onMouseDragStart={beginMouseConnectionDrag}
              onConnect={onConnect}
              onEdit={onEdit}
              onOpen={onOpen}
              onSelect={onSelect}
              selected={connection.id === selectedId}
            />
          ))}
          {ungroupedConnections.length === 0 && draggingConnectionId ? (
            <div className="drop-empty">拖到这里取消分组</div>
          ) : null}
        </div>
      </section>

      <footer className="settings-foot">
        <Tooltip label="设置">
          <button className="icon-button" type="button" aria-label="设置">
            <Settings className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
      </footer>

      {draggedConnection && mouseDrag ? (
        <div
          className="connection-drag-preview"
          style={{
            transform: `translate(${mouseDrag.currentX - mouseDrag.grabOffsetX}px, ${mouseDrag.currentY - mouseDrag.grabOffsetY}px)`,
            width: `${mouseDrag.previewWidth}px`,
          }}
        >
          <Server className="ui-icon connection-server-icon" aria-hidden="true" />
          <span>
            <strong>{draggedConnection.name}</strong>
            <small>{formatAddress(draggedConnection)}</small>
          </span>
        </div>
      ) : null}
    </aside>
  );

  function toggleFolder(id: FolderId) {
    setExpandedFolders((folders) => ({
      ...folders,
      [id]: !(folders[id] ?? true),
    }));
  }

  function beginConnectionDrag(event: DragEvent<HTMLElement>, connection: ConnectionProfile) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(connectionDragDataType, connection.id);
    event.dataTransfer.setData("text/plain", connection.id);
    setDraggingConnectionId(connection.id);
  }

  function beginMouseConnectionDrag(
    event: ReactMouseEvent<HTMLElement>,
    connection: ConnectionProfile,
  ) {
    if (event.button !== 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    setMouseDrag({
      active: false,
      connectionId: connection.id,
      currentX: event.clientX,
      currentY: event.clientY,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      previewWidth: bounds.width,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function finishConnectionDrag() {
    setDraggingConnectionId(null);
    setDropTargetId(null);
    setMouseDrag(null);
  }

  function activateDropTarget(event: DragEvent<HTMLElement>, targetId: DropTargetId) {
    if (!isConnectionDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  }

  function clearDropTarget() {
    setDropTargetId(null);
  }

  function assignConnectionToGroup(connectionId: string, groupId: string) {
    setConnectionGroups((groups) => ({
      ...groups,
      [connectionId]: groupId,
    }));
    finishConnectionDrag();
  }

  function moveConnectionToDropTarget(connectionId: string, targetId: DropTargetId) {
    if (targetId === "root") {
      setConnectionGroups((groups) => {
        const nextGroups = { ...groups };
        delete nextGroups[connectionId];
        return nextGroups;
      });
      finishConnectionDrag();
      return;
    }

    assignConnectionToGroup(connectionId, targetId.slice("group-".length));
  }

  function dropConnectionToRoot(event: DragEvent<HTMLDivElement>) {
    if (!isConnectionDrag(event)) {
      return;
    }

    event.preventDefault();
    const connectionId = getDraggedConnectionId(event) || draggingConnectionId;

    if (!connectionId) {
      finishConnectionDrag();
      return;
    }

    moveConnectionToDropTarget(connectionId, "root");
  }

  function beginCreateGroup() {
    setEditingGroupId(null);
    setGroupDraft("");
    setGroupColorDraft(groupPalette[0]);
    setCreatingGroup(true);
  }

  function beginEditGroup(group: CustomGroup) {
    setEditingGroupId(group.id);
    setGroupDraft(group.name);
    setGroupColorDraft(group.color);
    setCreatingGroup(true);
  }

  function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupDraft.trim();

    if (!name) {
      return;
    }

    setCustomGroups((groups) => {
      if (groups.some((group) => group.name === name && group.id !== editingGroupId)) {
        return groups;
      }

      if (editingGroupId) {
        return groups.map((group) =>
          group.id === editingGroupId ? { ...group, color: groupColorDraft, name } : group,
        );
      }

      return [...groups, { color: groupColorDraft, id: Date.now().toString(), name }];
    });
    resetGroupForm();
  }

  function deleteGroup(group: CustomGroup) {
    if (!window.confirm(`确认删除分组“${group.name}”吗？`)) {
      return;
    }

    setCustomGroups((groups) => groups.filter((item) => item.id !== group.id));
    setConnectionGroups((groups) => {
      const nextGroups = { ...groups };
      Object.entries(nextGroups).forEach(([connectionId, groupId]) => {
        if (groupId === group.id) {
          delete nextGroups[connectionId];
        }
      });
      return nextGroups;
    });
    if (editingGroupId === group.id) {
      resetGroupForm();
    }
  }

  function cancelCreateGroup() {
    resetGroupForm();
  }

  function resetGroupForm() {
    setEditingGroupId(null);
    setGroupDraft("");
    setGroupColorDraft(groupPalette[0]);
    setCreatingGroup(false);
  }
}

function TreeFolder({
  color,
  connections,
  expanded,
  folderDropTargetId,
  icon: Icon,
  label,
  draggingConnectionId,
  dropTargetId,
  onEdit,
  onOpen,
  onSelect,
  onCreateConnection,
  onCreateGroup,
  onConnect,
  onDeleteConnection,
  onConnectionDragEnd,
  onConnectionDragStart,
  onMouseConnectionDragStart,
  onDragLeave,
  onDragOver,
  onDropConnection,
  onEditGroup,
  onDeleteGroup,
  onToggle,
  selectedId,
}: {
  color: string;
  connections: ConnectionProfile[];
  expanded: boolean;
  folderDropTargetId?: DropTargetId;
  icon: LucideIcon;
  label: string;
  draggingConnectionId?: string | null;
  dropTargetId?: DropTargetId | null;
  onEdit: (connection: ConnectionProfile) => void;
  onOpen: (connection: ConnectionProfile) => void;
  onSelect: (connection: ConnectionProfile) => void;
  onCreateConnection: () => void;
  onCreateGroup: () => void;
  onConnect: (connection: ConnectionProfile) => void;
  onDeleteConnection: (connection: ConnectionProfile) => void | Promise<void>;
  onConnectionDragEnd: () => void;
  onConnectionDragStart: (event: DragEvent<HTMLElement>, connection: ConnectionProfile) => void;
  onMouseConnectionDragStart: (
    event: ReactMouseEvent<HTMLElement>,
    connection: ConnectionProfile,
  ) => void;
  onDragLeave?: () => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDropConnection?: (connectionId: string) => void;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
  onToggle: () => void;
  selectedId: string | null;
}) {
  const dropTarget = Boolean(folderDropTargetId && dropTargetId === folderDropTargetId);

  return (
    <div
      className={`tree-folder ${dropTarget ? "drop-target" : ""}`}
      data-drop-target-id={folderDropTargetId}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={dropConnection}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className="tree-folder-row"
            style={{ "--group-color": color } as CSSProperties}
          >
            <button
              className="tree-folder-main"
              type="button"
              onClick={onToggle}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={dropConnection}
            >
              <Icon className="ui-icon group-folder-icon" aria-hidden="true" />
              <span>{label}</span>
              <span className="count">{connections.length.toString()}</span>
            </button>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="context-menu-content">
            <ContextMenu.Item className="context-menu-item" onSelect={onToggle}>
              <Folder className="ui-icon" aria-hidden="true" />
              <span>{expanded ? "收起分组" : "展开分组"}</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={onCreateConnection}>
              <Plus className="ui-icon" aria-hidden="true" />
              <span>新建连接</span>
            </ContextMenu.Item>
            <ContextMenu.Item className="context-menu-item" onSelect={onCreateGroup}>
              <FolderPlus className="ui-icon" aria-hidden="true" />
              <span>新建分组</span>
            </ContextMenu.Item>
            {onEditGroup || onDeleteGroup ? (
              <ContextMenu.Separator className="context-menu-separator" />
            ) : null}
            {onEditGroup ? (
              <ContextMenu.Item className="context-menu-item" onSelect={onEditGroup}>
                <Pencil className="ui-icon" aria-hidden="true" />
                <span>编辑分组</span>
              </ContextMenu.Item>
            ) : null}
            {onDeleteGroup ? (
              <ContextMenu.Item className="context-menu-item danger" onSelect={onDeleteGroup}>
                <Trash2 className="ui-icon" aria-hidden="true" />
                <span>删除分组</span>
              </ContextMenu.Item>
            ) : null}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {expanded ? (
        <div className="tree-children">
          {connections.map((connection) => (
            <ConnectionTreeLeaf
              connection={connection}
              key={connection.id}
              nested
              dragging={connection.id === draggingConnectionId}
              onDelete={onDeleteConnection}
              onDragEnd={onConnectionDragEnd}
              onDragStart={onConnectionDragStart}
              onMouseDragStart={onMouseConnectionDragStart}
              onConnect={onConnect}
              onEdit={onEdit}
              onOpen={onOpen}
              onSelect={onSelect}
              selected={connection.id === selectedId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );

  function dropConnection(event: DragEvent<HTMLElement>) {
    if (!onDropConnection) {
      return;
    }

    event.preventDefault();
    const connectionId = getDraggedConnectionId(event) || draggingConnectionId;

    if (!connectionId) {
      onConnectionDragEnd();
      return;
    }

    onDropConnection(connectionId);
  }
}

function ConnectionTreeLeaf({
  connection,
  dragging = false,
  nested = false,
  onDelete,
  onDragEnd,
  onDragStart,
  onMouseDragStart,
  onConnect,
  onEdit,
  onOpen,
  onSelect,
  selected,
}: {
  connection: ConnectionProfile;
  dragging?: boolean;
  nested?: boolean;
  onDelete: (connection: ConnectionProfile) => void | Promise<void>;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, connection: ConnectionProfile) => void;
  onMouseDragStart: (
    event: ReactMouseEvent<HTMLElement>,
    connection: ConnectionProfile,
  ) => void;
  onConnect: (connection: ConnectionProfile) => void;
  onEdit: (connection: ConnectionProfile) => void;
  onOpen: (connection: ConnectionProfile) => void;
  onSelect: (connection: ConnectionProfile) => void;
  selected: boolean;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className={`tree-connection-row ${nested ? "nested" : ""} ${selected ? "active" : ""} ${dragging ? "dragging" : ""}`}>
          <button
            className="tree-connection-main"
            type="button"
            onClick={() => onSelect(connection)}
            onDoubleClick={() => onConnect(connection)}
            onDragEnd={onDragEnd}
            onDragStart={(event) => onDragStart(event, connection)}
            onMouseDown={(event) => onMouseDragStart(event, connection)}
          >
            <Server className="ui-icon connection-server-icon" aria-hidden="true" />
            <span>
              <strong>{connection.name}</strong>
              <small>{formatAddress(connection)}</small>
            </span>
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-content">
          <ContextMenu.Item className="context-menu-item" onSelect={() => onOpen(connection)}>
            <Play className="ui-icon" aria-hidden="true" />
            <span>打开终端</span>
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={() => onEdit(connection)}>
            <Pencil className="ui-icon" aria-hidden="true" />
            <span>编辑连接</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="context-menu-separator" />
          <ContextMenu.Item className="context-menu-item danger" onSelect={requestDelete}>
            <Trash2 className="ui-icon" aria-hidden="true" />
            <span>删除连接</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );

  function requestDelete() {
    if (!window.confirm(`确认删除连接“${connection.name}”吗？`)) {
      return;
    }

    void onDelete(connection);
  }
}

function formatAddress(connection: ConnectionProfile) {
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}

function buildCatalog(connections: ConnectionProfile[]) {
  const recent = [...connections].sort(sortByRecent);

  return {
    common: recent.filter((connection) => hasKeywords(connection, ["common", "常用"])),
    favorites: recent.filter((connection) =>
      hasKeywords(connection, ["favorite", "fav", "收藏", "star"]),
    ),
    recent,
  } satisfies Record<SystemFolderId, ConnectionProfile[]>;
}

function hasKeywords(connection: ConnectionProfile, keywords: string[]) {
  const haystack = [
    connection.name,
    connection.notes || "",
    connection.host,
    connection.username,
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function sortByRecent(left: ConnectionProfile, right: ConnectionProfile) {
  return timestampOf(right.updated_at) - timestampOf(left.updated_at);
}

function timestampOf(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getDraggedConnectionId(event: DragEvent<HTMLElement>) {
  return (
    event.dataTransfer.getData(connectionDragDataType) ||
    event.dataTransfer.getData("text/plain")
  );
}

function isConnectionDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).some(
    (type) => type.toLowerCase() === connectionDragDataType || type.toLowerCase() === "text/plain",
  );
}

function mouseDragDistance(drag: MouseDragState, event: MouseEvent) {
  return Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
}

function getDropTargetFromPoint(x: number, y: number): DropTargetId | null {
  const target = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-drop-target-id]");
  const targetId = target?.dataset.dropTargetId;

  if (targetId === "root" || targetId?.startsWith("group-")) {
    return targetId as DropTargetId;
  }

  return null;
}

function readStoredGroups() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(customGroupStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isStoredGroup)
      .map((group) => ({
        color: group.color,
        id: group.id,
        name: group.name,
      }));
  } catch {
    return [];
  }
}

function readStoredGroupAssignments(): ConnectionGroupAssignments {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(groupAssignmentStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function isStoredGroup(value: unknown): value is CustomGroup {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const group = value as Partial<CustomGroup>;
  return Boolean(group.id && group.name && group.color);
}

function writeStoredGroups(groups: CustomGroup[]) {
  try {
    window.localStorage.setItem(customGroupStorageKey, JSON.stringify(groups));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}

function writeStoredGroupAssignments(groups: ConnectionGroupAssignments) {
  try {
    window.localStorage.setItem(groupAssignmentStorageKey, JSON.stringify(groups));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}
