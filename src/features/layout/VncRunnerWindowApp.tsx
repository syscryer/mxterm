import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CircleAlert,
  Loader2,
  Minus,
  MonitorPlay,
  Square,
  X,
} from "lucide-react";

import type {
  VncRunnerWindowMessageEvent,
  VncRunnerWindowPayload,
} from "../connections/connectionTypes";
import {
  emitVncRunnerWindowClosed,
  emitVncRunnerWindowError,
  emitVncRunnerWindowMessage,
  emitVncRunnerWindowReady,
  listenVncRunnerWindowCloseRequest,
  listenVncRunnerWindowPayload,
} from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import {
  getPlatformCapabilities,
  resolveDesktopPlatform,
} from "../../shared/tauri/platformCapabilities";
import {
  normalizeWindowMaterial,
} from "../../shared/tauri/windowMaterial";
import { syncCurrentWebviewBackground } from "../../shared/tauri/webviewBackground";
import { resolveSettingsStyle } from "../settings/settingsTypes";
import { useSettings } from "../settings/useSettings";
import { VncViewerSurface } from "./VncViewerSurface";

interface VncRunnerHostSession {
  createdAt: number;
  error?: string | null;
  message?: string | null;
  payload: VncRunnerWindowPayload;
}

export function VncRunnerWindowApp() {
  const { settings } = useSettings();
  const [windowLabel, setWindowLabel] = useState("vnc-runner-host");
  const [sessions, setSessions] = useState<VncRunnerHostSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionsRef = useRef<VncRunnerHostSession[]>([]);
  const reportedClosedRef = useRef<Set<string>>(new Set());
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const desktopPlatform = useMemo(() => resolveDesktopPlatform(), []);
  const platformCapabilities = useMemo(
    () => getPlatformCapabilities(desktopPlatform),
    [desktopPlatform],
  );
  const effectiveWindowMaterial = normalizeWindowMaterial(
    settings.appearance.windowMaterial,
    platformCapabilities.windowMaterials,
  );
  const rootStyle = resolveSettingsStyle(settings) as CSSProperties;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    document.body.classList.add("vnc-runner-window-body");
    return () => {
      document.body.classList.remove("vnc-runner-window-body");
    };
  }, []);

  useLayoutEffect(() => {
    const body = document.body;
    body.dataset.themeMode = settings.appearance.themeMode;
    body.dataset.windowMaterial = effectiveWindowMaterial;
    body.dataset.density = settings.appearance.density;
    body.dataset.platform = desktopPlatform;

    const portalThemeStyle = resolveSettingsStyle(settings);
    for (const [name, value] of Object.entries(portalThemeStyle)) {
      body.style.setProperty(name, value);
    }

    void syncCurrentWebviewBackground();

    // system 主题模式下，监听系统深浅色切换，同步 WebView 背景
    let mediaQuery: MediaQueryList | null = null;
    let cleanup: (() => void) | null = null;

    if (settings.appearance.themeMode === "system") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        void syncCurrentWebviewBackground();
      };
      mediaQuery.addEventListener("change", handleChange);
      cleanup = () => mediaQuery?.removeEventListener("change", handleChange);
    }

    return () => {
      delete body.dataset.themeMode;
      delete body.dataset.windowMaterial;
      delete body.dataset.density;
      delete body.dataset.platform;
      for (const name of Object.keys(portalThemeStyle)) {
        body.style.removeProperty(name);
      }
      cleanup?.();
    };
  }, [
    desktopPlatform,
    effectiveWindowMaterial,
    settings,
    settings.appearance.density,
    settings.appearance.themeMode,
  ]);

  const reportSessionClosed = useCallback(
    (workspaceSessionId: string, label = windowLabel) => {
      if (reportedClosedRef.current.has(workspaceSessionId)) {
        return;
      }
      reportedClosedRef.current.add(workspaceSessionId);
      void emitVncRunnerWindowClosed({
        window_label: label,
        workspace_session_id: workspaceSessionId,
      }).catch(() => undefined);
    },
    [windowLabel],
  );

  const closeSession = useCallback(
    (
      workspaceSessionId: string,
      options: { closeWindowWhenEmpty?: boolean; notifyMain?: boolean } = {},
    ) => {
      const closeWindowWhenEmpty = options.closeWindowWhenEmpty ?? true;
      const notifyMain = options.notifyMain ?? true;
      const current = sessionsRef.current;
      const closingSession = current.find(
        (session) => session.payload.workspace_session_id === workspaceSessionId,
      );
      if (notifyMain && closingSession) {
        reportSessionClosed(workspaceSessionId, closingSession.payload.window_label || windowLabel);
      }
      if (!closingSession && closeWindowWhenEmpty && current.length === 0) {
        void closeCurrentWindow();
        return;
      }

      const nextSessions = current.filter(
        (session) => session.payload.workspace_session_id !== workspaceSessionId,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setActiveSessionId((currentActive) => {
        if (currentActive && currentActive !== workspaceSessionId) {
          return currentActive;
        }
        return nextSessions[nextSessions.length - 1]?.payload.workspace_session_id || null;
      });

      if (closeWindowWhenEmpty && nextSessions.length === 0) {
        void closeCurrentWindow();
      }
    },
    [reportSessionClosed, windowLabel],
  );

  const reportAllSessionsClosed = useCallback(() => {
    sessionsRef.current.forEach((session) => {
      reportSessionClosed(session.payload.workspace_session_id, session.payload.window_label);
    });
  }, [reportSessionClosed]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    async function setupWindowEvents() {
      try {
        const [{ getCurrentWebviewWindow }, { getCurrentWindow }] = await Promise.all([
          import("@tauri-apps/api/webviewWindow"),
          import("@tauri-apps/api/window"),
        ]);
        if (disposed) {
          return;
        }
        const currentLabel = getCurrentWebviewWindow().label || "vnc-runner-host";
        setWindowLabel(currentLabel);

        const [unlistenPayload, unlistenCloseRequest, unlistenClose] = await Promise.all([
          listenVncRunnerWindowPayload((payload) => {
            if (payload.window_label !== currentLabel) {
              return;
            }
            reportedClosedRef.current.delete(payload.workspace_session_id);
            setSessions((current) => {
              const nextSession: VncRunnerHostSession = {
                createdAt: Date.now(),
                error: null,
                message: "VNC 画面准备连接。",
                payload,
              };
              const exists = current.some(
                (session) =>
                  session.payload.workspace_session_id === payload.workspace_session_id,
              );
              const next = exists
                ? current.map((session) =>
                    session.payload.workspace_session_id === payload.workspace_session_id
                      ? {
                          ...session,
                          error: null,
                          message: "VNC 画面准备连接。",
                          payload,
                        }
                      : session,
                  )
                : [...current, nextSession];
              sessionsRef.current = next;
              return next;
            });
            setActiveSessionId(payload.workspace_session_id);
          }),
          listenVncRunnerWindowCloseRequest((event) => {
            if (event.window_label !== currentLabel) {
              return;
            }
            closeSession(event.workspace_session_id, {
              closeWindowWhenEmpty: true,
              notifyMain: false,
            });
          }),
          getCurrentWindow().onCloseRequested(() => {
            reportAllSessionsClosed();
          }),
        ]);

        if (disposed) {
          unlistenPayload();
          unlistenCloseRequest();
          unlistenClose();
          return;
        }

        unlisteners.push(unlistenPayload, unlistenCloseRequest, unlistenClose);
        await emitVncRunnerWindowReady({ window_label: currentLabel });
      } catch {
        return;
      }
    }

    void setupWindowEvents();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [closeSession, reportAllSessionsClosed]);

  function updateSessionMessage(event: VncRunnerWindowMessageEvent, error: boolean) {
    setSessions((current) => {
      const next = current.map((session) =>
        session.payload.workspace_session_id === event.workspace_session_id
          ? {
              ...session,
              error: error ? event.message : session.error,
              message: error ? null : event.message,
            }
          : session,
      );
      sessionsRef.current = next;
      return next;
    });
  }

  function handleViewerMessage(session: VncRunnerHostSession, message: string) {
    const event = {
      message,
      window_label: session.payload.window_label,
      workspace_session_id: session.payload.workspace_session_id,
    };
    updateSessionMessage(event, false);
    void emitVncRunnerWindowMessage(event).catch(() => undefined);
  }

  function handleViewerError(session: VncRunnerHostSession, message: string) {
    const event = {
      message,
      window_label: session.payload.window_label,
      workspace_session_id: session.payload.workspace_session_id,
    };
    updateSessionMessage(event, true);
    void emitVncRunnerWindowError(event).catch(() => undefined);
  }

  function handleTitlebarPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
      return;
    }
    dragStartRef.current = { x: event.clientX, y: event.clientY };

    const cleanup = () => {
      dragStartRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) {
        cleanup();
        return;
      }
      const distanceX = Math.abs(moveEvent.clientX - start.x);
      const distanceY = Math.abs(moveEvent.clientY - start.y);
      if (distanceX < 3 && distanceY < 3) {
        return;
      }
      cleanup();
      void startWindowDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  function closeWholeWindow() {
    reportAllSessionsClosed();
    void closeCurrentWindow();
  }

  const activeSession =
    sessions.find((session) => session.payload.workspace_session_id === activeSessionId) ||
    sessions[0] ||
    null;

  return (
    <main
      className="vnc-runner-host-root"
      data-theme-mode={settings.appearance.themeMode}
      data-window-material={effectiveWindowMaterial}
      aria-label="VNC runner host"
      style={rootStyle}
    >
      <header
        className="vnc-runner-titlebar"
        onDoubleClick={() => void runWindowAction("toggleMaximize")}
        onPointerDown={handleTitlebarPointerDown}
      >
        <nav className="vnc-runner-tabs" aria-label="VNC 会话标签">
          {sessions.length === 0 ? (
            <div className="vnc-runner-tab active">
              <MonitorPlay className="ui-icon" aria-hidden="true" />
              <span>VNC</span>
            </div>
          ) : (
            sessions.map((session) => {
              const workspaceSessionId = session.payload.workspace_session_id;
              const active = activeSession?.payload.workspace_session_id === workspaceSessionId;
              return (
                <div
                  className={`vnc-runner-tab ${active ? "active" : ""} ${session.error ? "error" : ""}`}
                  key={workspaceSessionId}
                >
                  <button
                    type="button"
                    title={session.payload.connection.name || session.payload.connection.host}
                    onClick={() => setActiveSessionId(workspaceSessionId)}
                  >
                    <MonitorPlay className="ui-icon" aria-hidden="true" />
                    <span>{session.payload.connection.name || session.payload.connection.host}</span>
                  </button>
                  <button
                    className="vnc-runner-tab-close"
                    type="button"
                    aria-label={`关闭 ${session.payload.connection.name || "VNC"}`}
                    onClick={() => closeSession(workspaceSessionId)}
                  >
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </nav>
        <div className="vnc-runner-window-controls">
          <button type="button" aria-label="最小化" onClick={() => void runWindowAction("minimize")}>
            <Minus className="ui-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="最大化或还原"
            onClick={() => void runWindowAction("toggleMaximize")}
          >
            <Square className="ui-icon" aria-hidden="true" />
          </button>
          <button className="danger" type="button" aria-label="关闭窗口" onClick={closeWholeWindow}>
            <X className="ui-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="vnc-runner-content" aria-label="VNC 画面">
        {sessions.length === 0 ? (
          <div className="vnc-runner-empty" role="status">
            <Loader2 className="ui-icon spin" aria-hidden="true" />
            <strong>等待 VNC 会话</strong>
            <span>从主窗口打开 VNC 连接后会显示在这里。</span>
          </div>
        ) : (
          sessions.map((session) => {
            const workspaceSessionId = session.payload.workspace_session_id;
            const active = activeSession?.payload.workspace_session_id === workspaceSessionId;
            return (
              <section
                className={`vnc-runner-pane ${active ? "active" : ""}`}
                aria-hidden={!active}
                key={workspaceSessionId}
              >
                {session.error ? (
                  <div className="vnc-runner-error" role="alert">
                    <CircleAlert className="ui-icon" aria-hidden="true" />
                    <strong>VNC 连接失败</strong>
                    <pre>{session.error}</pre>
                    <button type="button" onClick={() => closeSession(workspaceSessionId)}>
                      关闭
                    </button>
                  </div>
                ) : (
                  <VncViewerSurface
                    active={active}
                    className="vnc-runner-viewer"
                    config={session.payload.config}
                    connection={session.payload.connection}
                    result={session.payload.result}
                    onError={(message) => handleViewerError(session, message)}
                    onMessage={(message) => handleViewerMessage(session, message)}
                  />
                )}
              </section>
            );
          })
        )}
      </section>
    </main>
  );
}

function isInteractiveDragTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a"));
}

async function startWindowDrag() {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const currentWindow = await getCurrentRunnerWindow();
    await currentWindow.startDragging();
  } catch {
    return;
  }
}

async function closeCurrentWindow() {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const currentWindow = await getCurrentRunnerWindow();
    await currentWindow.destroy();
  } catch {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      return;
    }
  }
}

async function runWindowAction(action: "minimize" | "toggleMaximize") {
  if (!hasTauriRuntime()) {
    return;
  }

  try {
    const currentWindow = await getCurrentRunnerWindow();
    if (action === "minimize") {
      await currentWindow.minimize();
    } else {
      await currentWindow.toggleMaximize();
    }
  } catch {
    return;
  }
}

async function getCurrentRunnerWindow() {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow();
  } catch {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  }
}
