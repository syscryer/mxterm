import { createPortal } from "react-dom";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
} from "react";
import {
  Download,
  EllipsisVertical,
  House,
  Search,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ConnectionSystemLogo } from "../connections/ConnectionSystemLogo";
import { buildConnectionSearchEntries } from "../connections/connectionSearch";
import { TabContextMenu } from "../../shared/ui/TabContextMenu";
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
  appUpdateNotice?:
    | {
        label: string;
        onDismiss: () => void;
        onOpen: () => void;
      }
    | null;
  connectionById: Map<string, ConnectionProfile>;
  connectionSessions: TitlebarConnectionSession[];
  homeActive: boolean;
  localTerminalActive: boolean;
  leftPaneCollapsed: boolean;
  onCloseAllConnectionSessions: () => void;
  onCloseConnectionSession: (connectionId: string) => void;
  onCloseConnectionSessionsToRight: (connectionId: string) => void;
  onCloseOtherConnectionSessions: (connectionId: string) => void;
  onOpenHome: () => void;
  onOpenLocalTerminal: () => void;
  onSelectConnectionSession: (connectionId: string) => void;
  onToggleLeftPane: () => void;
}

export function AppTitlebar({
  activeConnectionId,
  appUpdateNotice,
  connectionById,
  connectionSessions,
  homeActive,
  localTerminalActive,
  leftPaneCollapsed,
  onCloseAllConnectionSessions,
  onCloseConnectionSession,
  onCloseConnectionSessionsToRight,
  onCloseOtherConnectionSessions,
  onOpenHome,
  onOpenLocalTerminal,
  onSelectConnectionSession,
  onToggleLeftPane,
}: AppTitlebarProps) {
  const titleTabsRef = useRef<HTMLElement | null>(null);
  const [titleTabsWidth, setTitleTabsWidth] = useState(0);
  const visibleConnectionSessions = useMemo(
    () =>
      pickVisibleConnectionSessions(
        connectionSessions,
        connectionById,
        activeConnectionId,
        homeActive,
        localTerminalActive,
        titleTabsWidth,
      ),
    [
      activeConnectionId,
      connectionById,
      connectionSessions,
      homeActive,
      localTerminalActive,
      titleTabsWidth,
    ],
  );
  const visibleConnectionSessionIdSet = useMemo(
    () => new Set(visibleConnectionSessions.map((session) => session.connectionId)),
    [visibleConnectionSessions],
  );
  const overflowConnectionSessions = connectionSessions.filter(
    (session) => !visibleConnectionSessionIdSet.has(session.connectionId),
  );

  useLayoutEffect(() => {
    const element = titleTabsRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => setTitleTabsWidth(element.getBoundingClientRect().width);

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);
    window.addEventListener("resize", updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  return (
    <header
      className="custom-titlebar"
      onDoubleClick={handleTitlebarDoubleClick}
      onPointerDown={handleDragStart}
    >
      <div className="macos-traffic-lights" role="group" aria-label="窗口控制">
        <button
          className="macos-traffic-light close"
          type="button"
          aria-label="关闭窗口"
          onClick={() => void runTauriWindowAction("close")}
        />
        <button
          className="macos-traffic-light minimize"
          type="button"
          aria-label="最小化"
          onClick={() => void runTauriWindowAction("minimize")}
        />
        <button
          className="macos-traffic-light zoom"
          type="button"
          aria-label="缩放窗口"
          onClick={() => void runTauriWindowAction("toggleMaximize")}
        />
      </div>

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

      <nav ref={titleTabsRef} className="title-session-tabs" aria-label="工作区标签">
        {visibleConnectionSessions.map((session, index) => {
          const hasOtherSessions = connectionSessions.length > 1;
          const hasRightSessions = index < visibleConnectionSessions.length - 1;
          return (
            <TabContextMenu
              key={session.connectionId}
              actions={[
                {
                  hint: "Ctrl+F4",
                  label: "关闭",
                  onSelect: () => onCloseConnectionSession(session.connectionId),
                },
                {
                  disabled: !hasOtherSessions,
                  label: "关闭其他",
                  onSelect: () => onCloseOtherConnectionSessions(session.connectionId),
                },
                {
                  disabled: !hasRightSessions,
                  label: "关闭右侧标签页",
                  onSelect: () => onCloseConnectionSessionsToRight(session.connectionId),
                },
                {
                  disabled: connectionSessions.length === 0,
                  hint: "Ctrl+K W",
                  label: "全部关闭",
                  onSelect: onCloseAllConnectionSessions,
                },
              ]}
            >
              <div
                className={`tab-shell ${
                  !homeActive && !localTerminalActive && session.connectionId === activeConnectionId
                    ? "active"
                    : ""
                }`}
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
            </TabContextMenu>
          );
        })}

        {overflowConnectionSessions.length > 0 ? (
          <TitlebarSessionSwitcher
            activeConnectionId={!homeActive && !localTerminalActive ? activeConnectionId : null}
            connectionById={connectionById}
            connectionSessions={connectionSessions}
            hiddenSessionCount={overflowConnectionSessions.length}
            onCloseConnectionSession={onCloseConnectionSession}
            onSelectConnectionSession={onSelectConnectionSession}
          />
        ) : null}
      </nav>

      <div className="title-trailing">
        {appUpdateNotice ? (
          <div className="title-update-entry" aria-label="应用更新">
            <button className="title-update-pill" type="button" onClick={appUpdateNotice.onOpen}>
              <Download className="title-tool-icon" aria-hidden="true" />
              <span>{appUpdateNotice.label}</span>
            </button>
            <Tooltip label="关闭本次提示">
              <button
                className="title-update-close"
                type="button"
                aria-label="关闭本次更新提示"
                onClick={appUpdateNotice.onDismiss}
              >
                <X className="title-tool-icon" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        ) : null}
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

interface TitlebarSessionSwitcherProps {
  activeConnectionId: string | null;
  connectionById: Map<string, ConnectionProfile>;
  connectionSessions: TitlebarConnectionSession[];
  hiddenSessionCount: number;
  onCloseConnectionSession: (connectionId: string) => void;
  onSelectConnectionSession: (connectionId: string) => void;
}

function TitlebarSessionSwitcher({
  activeConnectionId,
  connectionById,
  connectionSessions,
  hiddenSessionCount,
  onCloseConnectionSession,
  onSelectConnectionSession,
}: TitlebarSessionSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TitlebarSessionSwitcherPosition | null>(null);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchConnections = useMemo(
    () =>
      connectionSessions.map((session) => connectionById.get(session.connectionId)),
    [connectionById, connectionSessions],
  );
  const entries = useMemo(
    () =>
      buildConnectionSearchEntries(
        searchConnections.filter((connection): connection is ConnectionProfile => Boolean(connection)),
        query,
        searchConnections.length,
      ),
    [query, searchConnections],
  );
  const selectedIndex = Math.min(highlightedIndex, Math.max(0, entries.length - 1));
  const selectedEntry = entries[selectedIndex] || null;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    setPosition(readTitlebarSessionMenuPosition(triggerRef.current, entries.length));
  }, [entries.length, open, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setHighlightedIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnPointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setOpen(false);
    }

    function updatePosition() {
      setPosition(readTitlebarSessionMenuPosition(triggerRef.current, entries.length));
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [entries.length, open]);

  function openMenu() {
    setQuery("");
    setHighlightedIndex(0);
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  }

  function handleSelect(connectionId: string) {
    closeMenu();
    onSelectConnectionSession(connectionId);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      const targetIndex = Number.parseInt(event.key, 10) - 1;
      const targetEntry = entries[targetIndex];
      if (targetEntry) {
        event.preventDefault();
        handleSelect(targetEntry.connection.id);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(0, entries.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && selectedEntry) {
      event.preventDefault();
      handleSelect(selectedEntry.connection.id);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  return (
    <>
      <Tooltip label={`更多会话${hiddenSessionCount > 0 ? ` · ${hiddenSessionCount}` : ""}`}>
        <button
          ref={triggerRef}
          className="title-tool-button title-session-switcher-button"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`更多会话${hiddenSessionCount > 0 ? `，${hiddenSessionCount} 个隐藏会话` : ""}`}
          onClick={() => {
            if (open) {
              closeMenu();
              return;
            }
            openMenu();
          }}
        >
          <EllipsisVertical className="title-tool-icon" aria-hidden="true" />
        </button>
      </Tooltip>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              className="connection-search-dialog title-session-switcher-menu"
              style={
                {
                  "--title-session-switcher-left": `${position.left}px`,
                  "--title-session-switcher-top": `${position.top}px`,
                  "--title-session-switcher-width": `${position.width}px`,
                  "--title-session-switcher-max-height": `${position.maxHeight}px`,
                } as CSSProperties
              }
              role="dialog"
              aria-label="会话切换"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="connection-search-head title-session-switcher-head">
                <div>
                  <div className="connection-search-title">会话切换</div>
                  <p className="title-session-switcher-subtitle">搜索已打开的会话</p>
                </div>
                <button
                  className="icon-button dialog-close-button"
                  type="button"
                  aria-label="关闭会话切换"
                  onClick={closeMenu}
                >
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </div>

              <label className="connection-search-input-wrap title-session-switcher-input-wrap" aria-label="搜索会话">
                <Search className="ui-icon" aria-hidden="true" />
                <input
                  ref={inputRef}
                  spellCheck={false}
                  value={query}
                  placeholder="搜索会话、主机、分组"
                  onKeyDown={handleMenuKeyDown}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>

              <div className="connection-search-section-title">
                <span>{query.trim().length > 0 ? "搜索结果" : "最近会话"}</span>
                <small>{entries.length.toString()}</small>
              </div>

              <div
                className="title-session-switcher-results connection-search-results"
                role="listbox"
                aria-label="会话列表"
              >
                {entries.length === 0 ? (
                  <p className="connection-search-empty">暂无可切换的会话</p>
                ) : null}

                {entries.map((entry, index) => {
                  const connection = entry.connection;
                  const current = connection.id === activeConnectionId;

                  return (
                    <div
                      key={connection.id}
                      className={`connection-search-result title-session-switcher-row ${index === selectedIndex ? "active" : ""} ${current ? "current" : ""}`}
                      role="option"
                      aria-selected={index === selectedIndex}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => handleSelect(connection.id)}
                    >
                      <ConnectionSystemLogo connection={connection} compact decorative />
                      <span className="connection-search-result-main title-session-switcher-main">
                        <strong>{connection.name}</strong>
                        <small>{entry.address}</small>
                      </span>
                      <div className="connection-search-result-side title-session-switcher-side">
                        <span className="connection-search-result-meta">{entry.metaLabel}</span>
                        {current ? <span className="connection-search-badge">当前</span> : null}
                        <Tooltip label={`关闭 ${connection.name}`}>
                          <button
                            className="title-session-switcher-close"
                            type="button"
                            aria-label={`关闭 ${connection.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCloseConnectionSession(connection.id);
                            }}
                          >
                            <X className="ui-icon" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface TitlebarSessionSwitcherPosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

function readTitlebarSessionMenuPosition(
  trigger: HTMLButtonElement | null,
  itemCount: number,
): TitlebarSessionSwitcherPosition | null {
  if (!trigger) {
    return null;
  }

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 8;
  const width = Math.min(440, Math.max(340, window.innerWidth - viewportPadding * 2));
  const menuChromeHeight = 12 + 10 + 2;
  const rowHeight = 44;
  const titleHeight = 22;
  const desiredHeight = Math.min(
    560,
    Math.max(170, titleHeight + menuChromeHeight + itemCount * rowHeight),
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const availableHeight = Math.max(200, (openAbove ? spaceAbove : spaceBelow) - gap);
  const maxHeight = Math.min(560, desiredHeight, availableHeight);

  return {
    left: Math.min(
      Math.max(viewportPadding, rect.right - width),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    ),
    maxHeight,
    top: openAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
    width,
  };
}

function pickVisibleConnectionSessions(
  connectionSessions: TitlebarConnectionSession[],
  connectionById: Map<string, ConnectionProfile>,
  activeConnectionId: string | null,
  homeActive: boolean,
  localTerminalActive: boolean,
  availableWidth: number,
) {
  const effectiveActiveConnectionId = homeActive || localTerminalActive ? null : activeConnectionId;

  if (connectionSessions.length === 0) {
    return [];
  }

  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    const fallbackVisibleSessions = 4;
    if (connectionSessions.length <= fallbackVisibleSessions) {
      return connectionSessions;
    }

    const head = connectionSessions.slice(0, fallbackVisibleSessions - 1);
    if (effectiveActiveConnectionId) {
      const activeSession = connectionSessions.find(
        (session) => session.connectionId === effectiveActiveConnectionId,
      );
      if (
        activeSession &&
        !head.some((session) => session.connectionId === activeSession.connectionId)
      ) {
        return [...head, activeSession];
      }
    }

    return connectionSessions.slice(0, fallbackVisibleSessions);
  }

  const availableTabsWidth = Math.max(0, availableWidth - 20);
  const switcherWidth = connectionSessions.length > 1 ? 34 : 0;
  const tabGap = 6;
  const visibleBudget = Math.max(0, availableTabsWidth - switcherWidth);
  const fittedSessions: TitlebarConnectionSession[] = [];
  let consumedWidth = 0;

  for (const session of connectionSessions) {
    const estimatedWidth = estimateTitlebarSessionWidth(session, connectionById);
    const nextWidth =
      consumedWidth + (fittedSessions.length > 0 ? tabGap : 0) + estimatedWidth;

    if (nextWidth > visibleBudget) {
      break;
    }

    fittedSessions.push(session);
    consumedWidth = nextWidth;
  }

  if (connectionSessions.length <= fittedSessions.length) {
    return connectionSessions;
  }

  if (!effectiveActiveConnectionId) {
    return fittedSessions;
  }

  const activeSession = connectionSessions.find(
    (session) => session.connectionId === effectiveActiveConnectionId,
  );
  if (!activeSession) {
    return fittedSessions;
  }

  if (fittedSessions.some((session) => session.connectionId === activeSession.connectionId)) {
    return fittedSessions;
  }

  const activeWidth = estimateTitlebarSessionWidth(activeSession, connectionById);
  let trimmedSessions = fittedSessions.slice();
  let trimmedWidth = calculateTitlebarSessionsWidth(trimmedSessions, connectionById);

  while (
    trimmedSessions.length > 0 &&
    trimmedWidth + (trimmedSessions.length > 0 ? tabGap : 0) + activeWidth > visibleBudget
  ) {
    trimmedSessions.pop();
    trimmedWidth = calculateTitlebarSessionsWidth(trimmedSessions, connectionById);
  }

  if (trimmedSessions.length === 0 && activeWidth <= visibleBudget) {
    return [activeSession];
  }

  if (trimmedSessions.length === 0) {
    return [activeSession];
  }

  return [...trimmedSessions, activeSession];
}

function estimateTitlebarSessionWidth(
  session: TitlebarConnectionSession,
  connectionById: Map<string, ConnectionProfile>,
) {
  const connection = connectionById.get(session.connectionId);
  const labelLength = (connection?.name || "连接已删除").trim().length;
  return Math.min(160, Math.max(96, 58 + labelLength * 5.2));
}

function calculateTitlebarSessionsWidth(
  sessions: TitlebarConnectionSession[],
  connectionById: Map<string, ConnectionProfile>,
) {
  let width = 0;

  sessions.forEach((session, index) => {
    width += estimateTitlebarSessionWidth(session, connectionById);
    if (index < sessions.length - 1) {
      width += 6;
    }
  });

  return width;
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
  const railX = collapsed ? 11 : 6;

  return (
    <svg
      className="title-tool-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="13" height="13" rx="3" />
      <rect x={railX} y="6.25" width="3" height="7.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
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
