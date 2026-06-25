import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Check,
  Clock3,
  Folder,
  FolderPlus,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import { ConnectionSystemLogo } from "./ConnectionSystemLogo";
import type { ConnectionProfile } from "./connectionTypes";
import { connectionTimestampOf, sortConnectionsByRecent } from "./connectionSearch";

interface ConnectionPaneProps {
  connections: ConnectionProfile[];
  error: string | null;
  loading: boolean;
  onCreate: (groupName?: string) => void;
  onConnect: (connection: ConnectionProfile) => void;
  onDelete: (connection: ConnectionProfile) => void | Promise<void>;
  onEdit: (connection: ConnectionProfile) => void;
  onGroupCatalogChange?: (catalog: {
    assignments: ConnectionGroupAssignments;
    groups: CustomGroup[];
  }) => void;
  onMoveConnectionToGroup: (connection: ConnectionProfile, groupName: string | null) => void | Promise<void>;
  onOpen: (connection: ConnectionProfile) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSelect: (connection: ConnectionProfile) => void;
  onToggleFavorite: (connection: ConnectionProfile) => void | Promise<void>;
  recentConnectionLimit: number;
  selectedId: string | null;
}

type SystemFolderId = "favorites" | "recent";
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
  parentId?: string | null;
}

type DeleteRequest =
  | { type: "connection"; connection: ConnectionProfile }
  | { type: "group"; group: CustomGroup };

const systemFolders: SystemFolder[] = [
  { id: "favorites", color: "#64748b", icon: Star, label: "收藏" },
  { id: "recent", color: "#64748b", icon: Clock3, label: "最近" },
];

const customGroupStorageKey = "mxterm.connectionGroups.v2";
const expandedFolderStorageKey = "mxterm.connectionExpandedFolders.v1";
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
  onGroupCatalogChange,
  onMoveConnectionToGroup,
  onOpen,
  onOpenSearch,
  onOpenSettings,
  onRefresh,
  onSelect,
  onToggleFavorite,
  recentConnectionLimit,
  selectedId,
}: ConnectionPaneProps) {
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(readStoredGroups);
  const connectionGroups = useMemo(
    () => buildConnectionGroupAssignments(connections, customGroups),
    [connections, customGroups],
  );
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creatingGroupParentId, setCreatingGroupParentId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupColorDraft, setGroupColorDraft] = useState(groupPalette[0]);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [draggingConnectionId, setDraggingConnectionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<DropTargetId | null>(null);
  const [mouseDrag, setMouseDrag] = useState<MouseDragState | null>(null);
  const [quickSelectedId, setQuickSelectedId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<FolderId, boolean>>(
    readStoredExpandedFolders,
  );

  const catalog = useMemo(
    () => buildCatalog(connections, recentConnectionLimit),
    [connections, recentConnectionLimit],
  );
  const customGroupIds = useMemo(
    () => new Set(customGroups.map((group) => group.id)),
    [customGroups],
  );
  const customGroupNames = useMemo(
    () =>
      new Set(
        customGroups
          .map((group) => normalizeGroupName(group.name))
          .filter(Boolean),
      ),
    [customGroups],
  );
  const topLevelCustomGroups = useMemo(
    () =>
      customGroups.filter(
        (group) => !group.parentId || !customGroupIds.has(group.parentId),
      ),
    [customGroups, customGroupIds],
  );
  const ungroupedConnections = useMemo(
    () =>
      connections.filter((connection) => !customGroupNames.has(connectionGroups[connection.id] || "")),
    [connections, connectionGroups, customGroupNames],
  );
  const draggedConnection = mouseDrag?.active
    ? connections.find((connection) => connection.id === mouseDrag.connectionId) || null
    : null;

  useEffect(() => {
    writeStoredGroups(customGroups);
  }, [customGroups]);

  useEffect(() => {
    writeStoredExpandedFolders(expandedFolders);
  }, [expandedFolders]);

  useEffect(() => {
    setCustomGroups((groups) => mergeProfileGroups(groups, connections));
  }, [connections]);

  useEffect(() => {
    onGroupCatalogChange?.({
      assignments: connectionGroups,
      groups: customGroups,
    });
  }, [connectionGroups, customGroups, onGroupCatalogChange]);

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
    <>
      <aside className="connection-pane app-sidebar" aria-label="连接仓库">
        <section className="pane-scroll connection-tree" aria-label="连接树">
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
                onSelect={selectQuickConnection}
                onToggleFavorite={onToggleFavorite}
                onCreateConnection={() => onCreate()}
                onCreateGroup={() => beginCreateGroup(null)}
                onConnect={connectQuickConnection}
                onDeleteConnection={requestDeleteConnection}
                onConnectionDragEnd={finishConnectionDrag}
                onConnectionDragStart={beginConnectionDrag}
                onMouseConnectionDragStart={beginMouseConnectionDrag}
                onToggle={() => toggleFolder(folder.id)}
                selectedId={quickSelectedId}
              />
            ))}
          </div>

          <div className="tree-section-head">
            <span>连接</span>
            <div className="toolbar-actions">
              <Tooltip label="搜索连接">
                <button className="mini-action" type="button" aria-label="搜索连接" onClick={onOpenSearch}>
                  <Search className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="刷新连接">
                <button className="mini-action" type="button" aria-label="刷新连接" onClick={onRefresh}>
                  <RefreshCw className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="新增分组">
                <button
                  className="mini-action"
                  type="button"
                  aria-label="新增分组"
                  onClick={() => beginCreateGroup(null)}
                >
                  <FolderPlus className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="新增连接">
                <button
                  className="mini-action"
                  type="button"
                  aria-label="新增连接"
                  onClick={() => onCreate()}
                >
                  <Plus className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="tree-block" aria-label="自定义分组">
            {topLevelCustomGroups.map((group) => renderCustomGroup(group))}
          </div>

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
                onDelete={requestDeleteConnection}
                onDragEnd={finishConnectionDrag}
                onDragStart={beginConnectionDrag}
                onMouseDragStart={beginMouseConnectionDrag}
                onConnect={onConnect}
                onEdit={onEdit}
                onOpen={onOpen}
                onSelect={selectTreeConnection}
                onToggleFavorite={onToggleFavorite}
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
            <button
              className="icon-button settings-entry-button"
              type="button"
              aria-label="设置"
              onClick={onOpenSettings}
            >
              <Settings className="ui-icon" aria-hidden="true" />
              <span>设置</span>
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
            <ConnectionSystemLogo connection={draggedConnection} compact decorative />
            <span>
              <strong>{draggedConnection.name}</strong>
              <small>{formatAddress(draggedConnection)}</small>
            </span>
          </div>
        ) : null}
      </aside>

      {renderGroupDialog()}
      {renderDeleteConfirmDialog()}
    </>
  );

  function renderGroupDialog() {
    const parentGroup = creatingGroupParentId
      ? customGroups.find((group) => group.id === creatingGroupParentId)
      : null;

    return (
      <Dialog.Root
        open={creatingGroup}
        onOpenChange={(open) => {
          if (!open) {
            resetGroupForm();
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
            <form className="group-dialog" onSubmit={saveGroup}>
              <header className="dialog-head">
                <div className="dialog-title-group">
                  <Dialog.Title asChild>
                    <strong>{editingGroupId ? "编辑分组" : "新增分组"}</strong>
                  </Dialog.Title>
                  <Dialog.Description className={parentGroup ? "dialog-subtitle" : "sr-only"}>
                    {parentGroup ? `归入“${parentGroup.name}”` : "创建连接分组"}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>

              <div className="dialog-body group-dialog-body">
                <label>
                  <span>名称</span>
                  <input
                    aria-label="分组名称"
                    autoFocus
                    placeholder="分组名称"
                    value={groupDraft}
                    onChange={(event) => setGroupDraft(event.target.value)}
                  />
                </label>
                <div className="group-dialog-colors">
                  <span>颜色</span>
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
                </div>
              </div>

              <footer className="dialog-actions group-dialog-actions">
                <span />
                <Dialog.Close asChild>
                  <button type="button">
                    <X className="ui-icon" aria-hidden="true" />
                    <span>取消</span>
                  </button>
                </Dialog.Close>
                <button className="primary-button" type="submit">
                  <Check className="ui-icon" aria-hidden="true" />
                  <span>{editingGroupId ? "更新" : "保存"}</span>
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  function renderDeleteConfirmDialog() {
    return (
      <ConfirmDialog
        confirmLabel="删除"
        description={deleteRequestDescription(deleteRequest)}
        open={Boolean(deleteRequest)}
        title={deleteRequestTitle(deleteRequest)}
        onConfirm={confirmDeleteRequest}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteRequest(null);
          }
        }}
      />
    );
  }

  function renderCustomGroup(group: CustomGroup): ReactNode {
    const folderId: FolderId = `group-${group.id}`;
    const childGroups = customGroups.filter((item) => item.parentId === group.id);

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
        onSelect={selectTreeConnection}
        onToggleFavorite={onToggleFavorite}
        onCreateConnection={() => onCreate(normalizeGroupName(group.name))}
        onCreateGroup={() => beginCreateGroup(group.id)}
        onConnect={onConnect}
        onDeleteConnection={requestDeleteConnection}
        onConnectionDragEnd={finishConnectionDrag}
        onConnectionDragStart={beginConnectionDrag}
        onMouseConnectionDragStart={beginMouseConnectionDrag}
        onDragLeave={clearDropTarget}
        onDragOver={(event) => activateDropTarget(event, `group-${group.id}`)}
        onDropConnection={(connectionId) => assignConnectionToGroup(connectionId, group.id)}
        onEditGroup={() => beginEditGroup(group)}
        onDeleteGroup={() => requestDeleteGroup(group)}
        onToggle={() => toggleFolder(folderId)}
        selectedId={selectedId}
        connections={connections.filter(
          (connection) => connectionGroups[connection.id] === normalizeGroupName(group.name),
        )}
        nestedContent={
          <>
            {childGroups.map((childGroup) => renderCustomGroup(childGroup))}
          </>
        }
      />
    );
  }

  function toggleFolder(id: FolderId) {
    setExpandedFolders((folders) => ({
      ...folders,
      [id]: !(folders[id] ?? true),
    }));
  }

  function selectQuickConnection(connection: ConnectionProfile) {
    setQuickSelectedId(connection.id);
  }

  function connectQuickConnection(connection: ConnectionProfile) {
    setQuickSelectedId(connection.id);
    onConnect(connection);
  }

  function selectTreeConnection(connection: ConnectionProfile) {
    setQuickSelectedId(null);
    onSelect(connection);
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
    const connection = connections.find((item) => item.id === connectionId);
    const group = customGroups.find((item) => item.id === groupId);
    const groupName = normalizeGroupName(group?.name);
    if (connection && groupName) {
      void onMoveConnectionToGroup(connection, groupName);
    }
    finishConnectionDrag();
  }

  function moveConnectionToDropTarget(connectionId: string, targetId: DropTargetId) {
    if (targetId === "root") {
      const connection = connections.find((item) => item.id === connectionId);
      if (connection) {
        void onMoveConnectionToGroup(connection, null);
      }
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

  function beginCreateGroup(parentId: string | null = null) {
    setEditingGroupId(null);
    setCreatingGroupParentId(parentId);
    setGroupDraft("");
    setGroupColorDraft(groupPalette[0]);
    setCreatingGroup(true);
    if (parentId) {
      setExpandedFolders((folders) => ({
        ...folders,
        [`group-${parentId}`]: true,
      }));
    }
  }

  function beginEditGroup(group: CustomGroup) {
    setEditingGroupId(group.id);
    setCreatingGroupParentId(group.parentId || null);
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

    const hasDuplicateName = customGroups.some(
      (group) =>
        normalizeGroupName(group.name) === name &&
        group.id !== editingGroupId,
    );

    if (hasDuplicateName) {
      resetGroupForm();
      return;
    }

    const editingGroup = editingGroupId
      ? customGroups.find((group) => group.id === editingGroupId)
      : null;
    const previousName = normalizeGroupName(editingGroup?.name);

    setCustomGroups((groups) => {
      if (editingGroupId) {
        return groups.map((group) =>
          group.id === editingGroupId ? { ...group, color: groupColorDraft, name } : group,
        );
      }

      return [
        ...groups,
        {
          color: groupColorDraft,
          id: Date.now().toString(),
          name,
          parentId: creatingGroupParentId,
        },
      ];
    });

    if (editingGroup && previousName && previousName !== name) {
      connections.forEach((connection) => {
        if (connectionGroups[connection.id] === previousName) {
          void onMoveConnectionToGroup(connection, name);
        }
      });
    }

    resetGroupForm();
  }

  function requestDeleteConnection(connection: ConnectionProfile) {
    setDeleteRequest({ type: "connection", connection });
  }

  function requestDeleteGroup(group: CustomGroup) {
    setDeleteRequest({ type: "group", group });
  }

  async function confirmDeleteRequest() {
    if (!deleteRequest) {
      return;
    }

    if (deleteRequest.type === "connection") {
      await onDelete(deleteRequest.connection);
      return;
    }

    deleteGroup(deleteRequest.group);
  }

  function deleteGroup(group: CustomGroup) {
    const deletingGroupIds = collectGroupAndDescendantIds(customGroups, group.id);
    const deletingGroupNames = new Set(
      customGroups
        .filter((item) => deletingGroupIds.has(item.id))
        .map((item) => normalizeGroupName(item.name))
        .filter(Boolean),
    );
    setCustomGroups((groups) => groups.filter((item) => !deletingGroupIds.has(item.id)));
    connections.forEach((connection) => {
      const groupName = connectionGroups[connection.id];
      if (groupName && deletingGroupNames.has(groupName)) {
        void onMoveConnectionToGroup(connection, null);
      }
    });
    if (editingGroupId === group.id) {
      resetGroupForm();
    }
  }

  function resetGroupForm() {
    setEditingGroupId(null);
    setCreatingGroupParentId(null);
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
  onToggleFavorite,
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
  nestedContent,
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
  onToggleFavorite: (connection: ConnectionProfile) => void | Promise<void>;
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
  nestedContent?: ReactNode;
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
          {nestedContent}
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
              onToggleFavorite={onToggleFavorite}
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
  onToggleFavorite,
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
  onToggleFavorite: (connection: ConnectionProfile) => void | Promise<void>;
  selected: boolean;
}) {
  const favoriteLabel = connection.is_favorite ? "取消收藏" : "加入收藏";

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
            <ConnectionSystemLogo connection={connection} compact decorative />
            <span>
              <strong>{connection.name}</strong>
              <small>{formatAddress(connection)}</small>
            </span>
          </button>
          <Tooltip label={favoriteLabel}>
            <button
              className={`tree-connection-favorite ${connection.is_favorite ? "active" : ""}`}
              type="button"
              aria-label={`${favoriteLabel} ${connection.name}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void onToggleFavorite(connection);
              }}
            >
              <Star className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-content">
          <ContextMenu.Item className="context-menu-item" onSelect={() => onOpen(connection)}>
            <Play className="ui-icon" aria-hidden="true" />
            <span>{connection.protocol === "rdp" ? "打开 RDP" : "打开终端"}</span>
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={() => onEdit(connection)}>
            <Pencil className="ui-icon" aria-hidden="true" />
            <span>编辑连接</span>
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={() => void onToggleFavorite(connection)}>
            <Star className="ui-icon" aria-hidden="true" />
            <span>{favoriteLabel}</span>
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
    void onDelete(connection);
  }
}

function formatAddress(connection: ConnectionProfile) {
  if (connection.protocol === "rdp") {
    return `RDP · ${connection.username}@${connection.host}:${connection.port.toString()}`;
  }
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}

function deleteRequestTitle(request: DeleteRequest | null) {
  if (!request) {
    return "确认删除";
  }

  return request.type === "group" ? "删除分组" : "删除连接";
}

function deleteRequestDescription(request: DeleteRequest | null) {
  if (!request) {
    return "";
  }

  if (request.type === "group") {
    return `确认删除分组“${request.group.name}”吗？分组内的连接会回到未分组。`;
  }

  return `确认删除连接“${request.connection.name}”吗？这个操作无法撤销。`;
}

function buildCatalog(connections: ConnectionProfile[], recentConnectionLimit: number) {
  const sorted = [...connections].sort(sortConnectionsByRecent);
  const recent = sorted
    .filter((connection) => connectionTimestampOf(connection.last_connected_at) > 0)
    .sort(sortConnectionsByRecent)
    .slice(0, recentConnectionLimit);

  return {
    favorites: sorted.filter((connection) => connection.is_favorite),
    recent,
  } satisfies Record<SystemFolderId, ConnectionProfile[]>;
}

function collectGroupAndDescendantIds(groups: CustomGroup[], groupId: string) {
  const deletingGroupIds = new Set<string>([groupId]);
  let changed = true;

  while (changed) {
    changed = false;
    groups.forEach((group) => {
      if (group.parentId && deletingGroupIds.has(group.parentId) && !deletingGroupIds.has(group.id)) {
        deletingGroupIds.add(group.id);
        changed = true;
      }
    });
  }

  return deletingGroupIds;
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
        parentId: typeof group.parentId === "string" ? group.parentId : null,
      }));
  } catch {
    return [];
  }
}

function readStoredExpandedFolders(): Record<FolderId, boolean> {
  const defaults = {
    favorites: true,
    recent: true,
  } as Record<FolderId, boolean>;

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(expandedFolderStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!isRecord(parsed)) {
      return defaults;
    }

    return Object.entries(parsed).reduce<Record<FolderId, boolean>>((folders, [id, expanded]) => {
      if (isFolderId(id) && typeof expanded === "boolean") {
        folders[id] = expanded;
      }
      return folders;
    }, { ...defaults });
  } catch {
    return defaults;
  }
}

function writeStoredExpandedFolders(folders: Record<FolderId, boolean>) {
  try {
    const serializable = Object.fromEntries(
      Object.entries(folders).filter(
        ([id, expanded]) => isFolderId(id) && typeof expanded === "boolean",
      ),
    );
    window.localStorage.setItem(expandedFolderStorageKey, JSON.stringify(serializable));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}

function isFolderId(value: string): value is FolderId {
  return value === "favorites" || value === "recent" || value.startsWith("group-");
}

function isStoredGroup(value: unknown): value is CustomGroup {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const group = value as Partial<CustomGroup>;
  return Boolean(group.id && group.name && group.color);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeStoredGroups(groups: CustomGroup[]) {
  try {
    window.localStorage.setItem(customGroupStorageKey, JSON.stringify(groups));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}

function buildConnectionGroupAssignments(
  connections: ConnectionProfile[],
  groups: CustomGroup[],
) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupNames = new Set(
    groups
      .map((group) => normalizeGroupName(group.name))
      .filter(Boolean),
  );

  return Object.fromEntries(
    connections
      .map((connection) => {
        const groupName = resolveConnectionGroupName(
          connection.group,
          groupById,
          groupNames,
        );
        return [connection.id, groupName] as const;
      })
      .filter(([, group]) => Boolean(group)),
  );
}

function mergeProfileGroups(groups: CustomGroup[], connections: ConnectionProfile[]) {
  const existingIds = new Set(groups.map((group) => group.id));
  const existingNames = new Set(groups.map((group) => normalizeGroupName(group.name)));
  const nextGroups = [...groups];

  connections.forEach((connection) => {
    const name = normalizeGroupName(connection.group);
    if (!name || existingNames.has(name) || existingIds.has(name)) {
      return;
    }
    const id = uniqueGroupId(name, existingIds);
    nextGroups.push({
      color: groupPalette[nextGroups.length % groupPalette.length],
      id,
      name,
      parentId: null,
    });
    existingIds.add(id);
    existingNames.add(name);
  });

  return nextGroups.length === groups.length ? groups : nextGroups;
}

function resolveConnectionGroupName(
  value: string | null | undefined,
  groupById: Map<string, CustomGroup>,
  groupNames: Set<string>,
) {
  const groupName = normalizeGroupName(value);
  if (!groupName || groupNames.has(groupName)) {
    return groupName;
  }

  return normalizeGroupName(groupById.get(groupName)?.name) || groupName;
}

function uniqueGroupId(name: string, existingIds: Set<string>) {
  if (!existingIds.has(name)) {
    return name;
  }

  let index = 1;
  let nextId = `${name}-${index.toString()}`;
  while (existingIds.has(nextId)) {
    index += 1;
    nextId = `${name}-${index.toString()}`;
  }
  return nextId;
}

function normalizeGroupName(value: string | null | undefined) {
  return value?.trim() || "";
}
