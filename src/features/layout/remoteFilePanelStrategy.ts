export interface SshRemoteFilePanelTab {
  connectionId: string;
  id: string;
  sessionId?: string;
  type: string;
}

export interface SshRemoteFilePanelStackInput {
  activeTabId: string | null;
  activeWorkspaceMode: string;
  rightPaneCollapsed: boolean;
  rightTool: string;
  tabs: SshRemoteFilePanelTab[];
}

export interface SshRemoteFilePanelDescriptor {
  active: boolean;
  connectionId: string;
  key: string;
  renderDockerTools: boolean;
  tabId: string;
}

export function buildSshRemoteFilePanelStack({
  activeTabId,
  activeWorkspaceMode,
  rightPaneCollapsed,
  rightTool,
  tabs,
}: SshRemoteFilePanelStackInput): SshRemoteFilePanelDescriptor[] {
  if (activeWorkspaceMode !== "ssh") {
    return [];
  }

  return tabs
    .filter((tab) => tab.type === "terminal" && Boolean(tab.sessionId) && tab.id === activeTabId)
    .map((tab) => {
      const active = !rightPaneCollapsed && tab.id === activeTabId;

      return {
        active,
        connectionId: tab.connectionId,
        key: `ssh-file-panel:${tab.id}`,
        renderDockerTools: active && rightTool === "tools",
        tabId: tab.id,
      };
    });
}
