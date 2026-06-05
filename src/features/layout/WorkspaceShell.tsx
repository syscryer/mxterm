import { useCallback, useMemo, useState } from "react";

import { ConnectionDialog } from "../connections/ConnectionDialog";
import { ConnectionPane } from "../connections/ConnectionPane";
import type { ConnectionProfile, ConnectionProfileInput } from "../connections/connectionTypes";
import { useConnections } from "../connections/useConnections";
import { TerminalPanel } from "../terminal/TerminalPanel";

const files = ["logs", "config", "app.log", "nginx.conf"];

interface TerminalTab {
  id: string;
  connectionId: string;
  index: number;
  status: string;
  title: string;
}

export function WorkspaceShell() {
  const { connections, error, loading, reload, remove, upsert } = useConnections();
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);

  const connectionById = useMemo(() => {
    return new Map(connections.map((connection) => [connection.id, connection]));
  }, [connections]);
  const selectedConnection = selectedConnectionId
    ? connectionById.get(selectedConnectionId) || null
    : null;
  const visibleTerminalTabs = selectedConnectionId
    ? terminalTabs.filter((tab) => tab.connectionId === selectedConnectionId)
    : [];

  const updateTabStatus = useCallback((tabId: string, status: string) => {
    setTerminalTabs((tabs) =>
      tabs.map((tab) => (tab.id === tabId && tab.status !== status ? { ...tab, status } : tab)),
    );
  }, []);

  function createConnection() {
    setEditingConnection(null);
    setDialogOpen(true);
  }

  function editConnection(connection: ConnectionProfile) {
    setEditingConnection(connection);
    setDialogOpen(true);
  }

  async function saveConnection(input: ConnectionProfileInput) {
    const saved = await upsert(input);
    setSelectedConnectionId(saved.id);
  }

  async function deleteConnection(connection: ConnectionProfile) {
    await remove(connection.id);
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id);
      if (!nextTabs.some((tab) => tab.id === activeTabId)) {
        setActiveTabId(nextTabs[0]?.id || null);
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
      status: "待连接",
      title: nextIndex === 0 ? "终端" : `终端 ${nextIndex.toString()}`,
    };
  }

  function selectConnection(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);
    setTerminalTabs((tabs) => {
      const existingTab = tabs.find((tab) => tab.connectionId === connection.id);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return tabs;
      }

      const tab = buildTerminalTab(tabs, connection);
      setActiveTabId(tab.id);
      return [...tabs, tab];
    });
  }

  function openTerminal(connection: ConnectionProfile) {
    setSelectedConnectionId(connection.id);
    setTerminalTabs((tabs) => {
      const tab = buildTerminalTab(tabs, connection);
      setActiveTabId(tab.id);
      return [...tabs, tab];
    });
  }

  function closeTerminal(tabId: string) {
    setTerminalTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const nextConnectionTab =
          selectedConnectionId === null
            ? null
            : nextTabs.find((tab) => tab.connectionId === selectedConnectionId);
        setActiveTabId(nextConnectionTab?.id || null);
      }
      return nextTabs;
    });
  }

  function openSelectedConnection() {
    if (selectedConnection) {
      openTerminal(selectedConnection);
      return;
    }
    createConnection();
  }

  return (
    <main className="workspace-shell">
      <ConnectionPane
        connections={connections}
        error={error}
        loading={loading}
        onCreate={createConnection}
        onEdit={editConnection}
        onOpen={selectConnection}
        onRefresh={reload}
        selectedId={selectedConnectionId}
      />

      <section className="main-workbench" aria-label="编辑器和终端">
        <nav className="top-tabs" aria-label="终端连接标签">
          {visibleTerminalTabs.map((tab) => (
            <div className={`tab-shell ${tab.id === activeTabId ? "active" : ""}`} key={tab.id}>
              <button className="tab" type="button" onClick={() => setActiveTabId(tab.id)}>
                <span>{tab.title}</span>
              </button>
              <button
                className="tab-close"
                type="button"
                aria-label={`关闭 ${tab.title}`}
                onClick={() => closeTerminal(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
          <button className="add-tab" type="button" aria-label="新建终端" onClick={openSelectedConnection}>
            +
          </button>
        </nav>

        <section className="terminal-stack" aria-label="终端会话">
          {visibleTerminalTabs.length === 0 ? (
            <div className="terminal-empty">
              {selectedConnection ? "点击 + 新开终端。" : "从左侧连接仓库选择连接。"}
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
          {files.map((file) => (
            <button className="file-row" type="button" key={file}>
              <span aria-hidden="true">{file.includes(".") ? "□" : "▣"}</span>
              <span>{file}</span>
            </button>
          ))}
        </section>
      </aside>

      <ConnectionDialog
        connection={editingConnection}
        onClose={() => setDialogOpen(false)}
        onDelete={deleteConnection}
        onSave={saveConnection}
        open={dialogOpen}
      />
    </main>
  );
}
