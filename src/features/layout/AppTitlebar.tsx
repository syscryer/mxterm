import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { House } from "lucide-react";

import { Tooltip } from "../../shared/ui/Tooltip";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type { ConnectionProfile } from "../connections/connectionTypes";
import { LocalTerminalWorkspaceIcon } from "../terminal/LocalTerminalIcons";

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
  homeActive: boolean;
  localTerminalActive: boolean;
  leftPaneCollapsed: boolean;
  onCloseConnectionSession: (connectionId: string) => void;
  onOpenHome: () => void;
  onOpenLocalTerminal: () => void;
  onSelectConnectionSession: (connectionId: string) => void;
  onToggleLeftPane: () => void;
}

export function AppTitlebar({
  activeConnectionId,
  connectionById,
  connectionSessions,
  homeActive,
  localTerminalActive,
  leftPaneCollapsed,
  onCloseConnectionSession,
  onOpenHome,
  onOpenLocalTerminal,
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

        <div className="title-sidebar-tools">
          <Tooltip label="首页">
            <button
              className={`title-sidebar-home ${homeActive ? "active" : ""}`}
              type="button"
              aria-label="首页"
              aria-current={homeActive ? "page" : undefined}
              onClick={onOpenHome}
            >
              <HomeGlyph />
              <span>首页</span>
            </button>
          </Tooltip>
          <Tooltip label="终端">
            <button
              className={`title-sidebar-home ${localTerminalActive ? "active" : ""}`}
              type="button"
              aria-label="终端"
              aria-current={localTerminalActive ? "page" : undefined}
              onClick={onOpenLocalTerminal}
            >
              <LocalTerminalWorkspaceIcon className="title-tool-icon" />
              <span>终端</span>
            </button>
          </Tooltip>
        </div>
      </div>

      <nav className="title-session-tabs" aria-label="工作区标签">
        {connectionSessions.map((session) => (
          <div
            className={`tab-shell ${
              !homeActive && !localTerminalActive && session.connectionId === activeConnectionId
                ? "active"
                : ""
            }`}
            key={session.connectionId}
          >
            <button
              className="tab"
              type="button"
              onClick={() => onSelectConnectionSession(session.connectionId)}
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

function HomeGlyph() {
  return <House className="title-tool-icon" aria-hidden="true" />;
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
