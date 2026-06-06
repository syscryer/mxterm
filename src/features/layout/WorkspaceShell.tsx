import { useCallback, useMemo, useState } from "react";
import { FileText, Folder, Plus, X } from "lucide-react";

import { ConnectionDialog } from "../connections/ConnectionDialog";
import { ConnectionPane } from "../connections/ConnectionPane";
import type { ConnectionProfile, ConnectionProfileInput } from "../connections/connectionTypes";
import { useConnections } from "../connections/useConnections";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { Tooltip } from "../../shared/ui/Tooltip";
import { AppTitlebar } from "./AppTitlebar";

const files = ["logs", "config", "app.log", "nginx.conf"];

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

export function WorkspaceShell() {
  const { connections, error, loading, reload, remove, upsert } = useConnections();
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [createGroupRequest, setCreateGroupRequest] = useState(0);
  const [pendingConnectionGroupId, setPendingConnectionGroupId] = useState<string | null>(null);
  const [connectionPlacementRequest, setConnectionPlacementRequest] =
    useState<ConnectionPlacementRequest | null>(null);

  const connectionById = useMemo(() => {
    return new Map(connections.map((connection) => [connection.id, connection]));
  }, [connections]);

  const selectedConnection = selectedConnectionId
    ? connectionById.get(selectedConnectionId) || null
    : null;
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

  const updateTabStatus = useCallback((tabId: string, status: string) => {
    setTerminalTabs((tabs) =>
      tabs.map((tab) => (tab.id === tabId && tab.status !== status ? { ...tab, status } : tab)),
    );
  }, []);

  function createConnection(groupId?: string) {
    setLeftPaneCollapsed(false);
    setPendingConnectionGroupId(groupId || null);
    setEditingConnection(null);
    setDialogOpen(true);
  }

  function createGroup() {
    setLeftPaneCollapsed(false);
    setCreateGroupRequest((request) => request + 1);
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
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id);
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

  function selectConnection(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);

    const existingTab = terminalTabs.find((tab) => tab.connectionId === connection.id);
    if (existingTab) {
      setActiveConnectionId(connection.id);
      setActiveTabId(existingTab.id);
    }
  }

  function openConnectionSession(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);

    const existingTab = terminalTabs.find((tab) => tab.connectionId === connection.id);
    if (existingTab) {
      setActiveConnectionId(connection.id);
      setActiveTabId(existingTab.id);
      return;
    }

    openTerminal(connection);
  }

  function openTerminal(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);
    setActiveConnectionId(connection.id);
    setTerminalTabs((tabs) => {
      const tab = buildTerminalTab(tabs, connection);
      setActiveTabId(tab.id);
      return [...tabs, tab];
    });
  }

  function closeTerminal(tabId: string) {
    setTerminalTabs((tabs) => {
      const closingTab = tabs.find((tab) => tab.id === tabId);
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const nextActiveTab =
          (closingTab
            ? nextTabs.find((tab) => tab.connectionId === closingTab.connectionId)
            : null) ||
          nextTabs[0] ||
          null;

        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || null);
      } else if (
        closingTab &&
        activeConnectionId === closingTab.connectionId &&
        !nextTabs.some((tab) => tab.connectionId === closingTab.connectionId)
      ) {
        setActiveConnectionId(nextTabs[0]?.connectionId || null);
      }
      return nextTabs;
    });
  }

  function closeConnectionSession(connectionId: string) {
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connectionId);

      if (activeConnectionId === connectionId) {
        const nextActiveTab = nextTabs[0] || null;
        setActiveTabId(nextActiveTab?.id || null);
        setActiveConnectionId(nextActiveTab?.connectionId || null);
      }

      return nextTabs;
    });
  }

  function openTerminalInActiveConnection() {
    if (activeConnection) {
      openTerminal(activeConnection);
    }
  }

  return (
    <div
      className="app-shell"
      data-left-collapsed={leftPaneCollapsed}
      data-right-collapsed={rightPaneCollapsed}
    >
      <AppTitlebar
        activeConnectionId={activeConnectionId}
        connectionById={connectionById}
        connectionSessions={connectionSessions}
        leftPaneCollapsed={leftPaneCollapsed}
        onCloseConnectionSession={closeConnectionSession}
        onCreateConnection={createConnection}
        onCreateGroup={createGroup}
        onRefreshConnections={reload}
        onSelectConnectionSession={(connectionId, tabId) => {
          setActiveConnectionId(connectionId);
          setActiveTabId(tabId);
          setSelectedConnectionId(connectionId);
        }}
        onToggleLeftPane={() => setLeftPaneCollapsed((collapsed) => !collapsed)}
      />

      <main className="workspace-shell">
        <ConnectionPane
          connections={connections}
          connectionPlacementRequest={connectionPlacementRequest}
          createGroupRequest={createGroupRequest}
          error={error}
          loading={loading}
          onConnect={openConnectionSession}
          onCreate={createConnection}
          onDelete={deleteConnection}
          onEdit={editConnection}
          onOpen={openTerminal}
          onSelect={selectConnection}
          selectedId={selectedConnectionId}
        />

        <section className="main-workbench" aria-label="编辑器和终端">
        <nav className="terminal-subtabs" aria-label="当前连接的终端会话">
          {activeConnectionTabs.map((tab) => (
            <div className={`subtab-shell ${tab.id === activeTabId ? "active" : ""}`} key={tab.id}>
              <button
                className="subtab"
                type="button"
                onClick={() => {
                  setActiveTabId(tab.id);
                  setSelectedConnectionId(tab.connectionId);
                }}
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

        <section className="terminal-stack" aria-label="终端会话">
          {terminalTabs.length === 0 ? (
            <div className="terminal-empty">
              {selectedConnection ? "双击左侧连接打开会话。" : "先从左侧连接仓库选择一条连接。"}
            </div>
          ) : null}
          {terminalTabs.map((tab) => (
            <TerminalPanel
              active={tab.id === activeTabId}
              connection={connectionById.get(tab.connectionId) || null}
              key={tab.id}
              onStatusChange={updateTabStatus}
              tabId={tab.id}
              title={tab.title}
            />
          ))}
        </section>
      </section>

        <Tooltip label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}>
          <button
            className="right-collapse-button"
            type="button"
            aria-label={rightPaneCollapsed ? "展开右侧面板" : "收起右侧面板"}
            aria-expanded={!rightPaneCollapsed}
            onClick={() => setRightPaneCollapsed((collapsed) => !collapsed)}
          >
            <RightPaneToggleGlyph collapsed={rightPaneCollapsed} />
          </button>
        </Tooltip>

        <aside className="tool-pane" aria-label="右侧工具面板">
          <nav className="tool-tabs" aria-label="工具标签">
            <button className="active" type="button">
              文件
            </button>
            <button type="button">搜索</button>
            <button type="button">传输</button>
            <button type="button">监控</button>
          </nav>
          <div className="path-bar">/ &gt; root &gt; app</div>
          <section className="file-list" aria-label="远程文件列表">
            {files.map((file) => {
              const FileIcon = file.includes(".") ? FileText : Folder;

              return (
                <button className="file-row" type="button" key={file}>
                  <FileIcon className="ui-icon" aria-hidden="true" />
                  <span>{file}</span>
                </button>
              );
            })}
          </section>
        </aside>

        <ConnectionDialog
          connection={editingConnection}
          onClose={closeConnectionDialog}
          onDelete={deleteConnection}
          onSave={saveConnection}
          open={dialogOpen}
        />
      </main>
    </div>
  );

  function closeConnectionDialog() {
    setDialogOpen(false);
    setPendingConnectionGroupId(null);
  }
}

function RightPaneToggleGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className="title-tool-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={collapsed ? "M6.2 4.2 10 8l-3.8 3.8" : "M9.8 4.2 6 8l3.8 3.8"} />
      <path d={collapsed ? "M3.8 3.5v9" : "M12.2 3.5v9"} />
    </svg>
  );
}
