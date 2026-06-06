import type { MouseEvent, PointerEvent, ReactNode } from "react";

import { Tooltip } from "../../shared/ui/Tooltip";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type { ConnectionProfile } from "../connections/connectionTypes";

const windowDragThresholdPx = 4;

interface TitlebarTerminalTab {
  id: string;
}

interface TitlebarConnectionSession {
  connectionId: string;
  tabs: TitlebarTerminalTab[];
}

interface AppTitlebarProps {
  activeConnectionId: string | null;
  connectionById: Map<string, ConnectionProfile>;
  connectionSessions: TitlebarConnectionSession[];
  leftPaneCollapsed: boolean;
  onCloseConnectionSession: (connectionId: string) => void;
  onCreateConnection: () => void;
  onCreateGroup: () => void;
  onRefreshConnections: () => void;
  onSelectConnectionSession: (connectionId: string, tabId: string | null) => void;
  onToggleLeftPane: () => void;
}

export function AppTitlebar({
  activeConnectionId,
  connectionById,
  connectionSessions,
  leftPaneCollapsed,
  onCloseConnectionSession,
  onCreateConnection,
  onCreateGroup,
  onRefreshConnections,
  onSelectConnectionSession,
  onToggleLeftPane,
}: AppTitlebarProps) {
  return (
    <header
      className="custom-titlebar"
      onDoubleClick={handleTitlebarDoubleClick}
      onPointerDown={handleDragStart}
    >
      <div className="title-leading">
        <Tooltip label={leftPaneCollapsed ? "展开侧边栏" : "收起侧边栏"}>
          <button
            className="title-tool-button title-pane-toggle"
            type="button"
            aria-label={leftPaneCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!leftPaneCollapsed}
            onClick={onToggleLeftPane}
          >
            <SidebarToggleGlyph collapsed={leftPaneCollapsed} />
          </button>
        </Tooltip>

        <div className="title-sidebar-tools" aria-label="连接快捷操作">
          <Tooltip label="刷新连接">
            <button
              className="title-tool-button"
              type="button"
              aria-label="刷新连接"
              onClick={onRefreshConnections}
            >
              <RefreshGlyph />
            </button>
          </Tooltip>
          <Tooltip label="新建分组">
            <button
              className="title-tool-button"
              type="button"
              aria-label="新建分组"
              onClick={onCreateGroup}
            >
              <GroupGlyph />
            </button>
          </Tooltip>
          <Tooltip label="新建 SSH 连接">
            <button
              className="title-tool-button"
              type="button"
              aria-label="新建 SSH 连接"
              onClick={onCreateConnection}
            >
              <SshGlyph />
            </button>
          </Tooltip>
        </div>
      </div>

      <nav className="title-session-tabs" aria-label="连接会话列表">
        {connectionSessions.map((session) => (
          <div
            className={`tab-shell ${session.connectionId === activeConnectionId ? "active" : ""}`}
            key={session.connectionId}
          >
            <button
              className="tab"
              type="button"
              onClick={() => {
                const nextTab = session.tabs[0];
                onSelectConnectionSession(session.connectionId, nextTab?.id || null);
              }}
            >
              <span className="tab-label">
                {connectionName(session.connectionId, connectionById)}
              </span>
            </button>
            <button
              className="tab-close"
              type="button"
              aria-label={`关闭 ${connectionName(session.connectionId, connectionById)}`}
              onClick={() => onCloseConnectionSession(session.connectionId)}
            >
              <CloseGlyph />
            </button>
          </div>
        ))}
      </nav>

      <div className="window-controls" aria-label="窗口控制">
        <button
          className="window-control"
          type="button"
          aria-label="最小化"
          onClick={() => void runTauriWindowAction("minimize")}
        >
          <MinimizeGlyph />
        </button>
        <button
          className="window-control"
          type="button"
          aria-label="最大化或还原"
          onClick={() => void runTauriWindowAction("toggleMaximize")}
        >
          <MaximizeGlyph />
        </button>
        <button
          className="window-control close"
          type="button"
          aria-label="关闭窗口"
          onClick={() => void runTauriWindowAction("close")}
        >
          <CloseGlyph />
        </button>
      </div>
    </header>
  );

  function handleDragStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1 || isInteractiveDragTarget(event.target)) {
      return;
    }

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;

    function cleanup() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    }

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      const distanceX = Math.abs(moveEvent.clientX - startX);
      const distanceY = Math.abs(moveEvent.clientY - startY);
      if (distanceX < windowDragThresholdPx && distanceY < windowDragThresholdPx) {
        return;
      }

      cleanup();
      void startWindowDrag();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  function handleTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void runTauriWindowAction("toggleMaximize");
  }
}

function connectionName(
  connectionId: string,
  connectionById: Map<string, ConnectionProfile>,
) {
  return connectionById.get(connectionId)?.name || "连接已删除";
}

function isInteractiveDragTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a"));
}

async function startWindowDrag() {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch {
    return;
  }
}

async function runTauriWindowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();

    if (action === "minimize") {
      await currentWindow.minimize();
    } else if (action === "toggleMaximize") {
      await currentWindow.toggleMaximize();
    } else {
      await currentWindow.close();
    }
  } catch {
    return;
  }
}

function GlyphShell({ children }: { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

function SidebarToggleGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <GlyphShell>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M6 3v10" />
      <path d={collapsed ? "M9 6.2 11 8l-2 1.8" : "M11 6.2 9 8l2 1.8"} />
    </GlyphShell>
  );
}

function RefreshGlyph() {
  return (
    <GlyphShell>
      <path d="M12.8 5.1A5 5 0 0 0 4.1 4" />
      <path d="M12.8 2.8v2.3h-2.3" />
      <path d="M3.2 10.9A5 5 0 0 0 11.9 12" />
      <path d="M3.2 13.2v-2.3h2.3" />
    </GlyphShell>
  );
}

function GroupGlyph() {
  return (
    <GlyphShell>
      <rect x="2.6" y="3.2" width="4.2" height="3.4" rx="1" />
      <rect x="9.2" y="3.2" width="4.2" height="3.4" rx="1" />
      <rect x="5.9" y="9.4" width="4.2" height="3.4" rx="1" />
      <path d="M4.7 6.6v1.3h3.3v1.5" />
      <path d="M11.3 6.6v1.3H8v1.5" />
    </GlyphShell>
  );
}

function SshGlyph() {
  return (
    <GlyphShell>
      <rect x="2.5" y="3.2" width="11" height="9.6" rx="2" />
      <path d="m5.2 6.2 2 1.8-2 1.8" />
      <path d="M8.6 10h2.2" />
    </GlyphShell>
  );
}

function MinimizeGlyph() {
  return (
    <GlyphShell>
      <path d="M4.5 10.5h7" />
    </GlyphShell>
  );
}

function MaximizeGlyph() {
  return (
    <GlyphShell>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
    </GlyphShell>
  );
}

function CloseGlyph() {
  return (
    <GlyphShell>
      <path d="m5 5 6 6" />
      <path d="m11 5-6 6" />
    </GlyphShell>
  );
}
