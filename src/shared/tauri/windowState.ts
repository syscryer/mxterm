import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  type Monitor,
  type Window,
} from "@tauri-apps/api/window";

import { hasTauriRuntime } from "./runtime";

interface StoredWindowState {
  height: number;
  width: number;
  x: number;
  y: number;
}

const windowStateStorageKey = "mxterm.windowState.v1";
const minWindowWidth = 1100;
const minWindowHeight = 720;
const saveWindowStateDelayMs = 250;

export function initializeWindowStatePersistence() {
  if (!hasTauriRuntime()) {
    return () => undefined;
  }

  const appWindow = getCurrentWindow();
  let disposed = false;
  let saveTimer: number | null = null;
  const unlisteners: Array<() => void> = [];

  function scheduleSave() {
    if (disposed) {
      return;
    }
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void persistCurrentWindowState(appWindow);
    }, saveWindowStateDelayMs);
  }

  void (async () => {
    await restoreStoredWindowState(appWindow);
    if (disposed) {
      return;
    }

    const unlistenResize = await appWindow.onResized(scheduleSave);
    if (disposed) {
      unlistenResize();
      return;
    }
    unlisteners.push(unlistenResize);

    const unlistenMove = await appWindow.onMoved(scheduleSave);
    if (disposed) {
      unlistenMove();
      return;
    }
    unlisteners.push(unlistenMove);

    await persistCurrentWindowState(appWindow);
  })();

  return () => {
    disposed = true;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    unlisteners.forEach((unlisten) => unlisten());
  };
}

async function restoreStoredWindowState(appWindow: Window) {
  const state = readStoredWindowState();
  if (!state) {
    return;
  }

  const monitors = await safeAvailableMonitors();
  if (monitors.length > 0 && !isWindowStateVisible(state, monitors)) {
    return;
  }

  try {
    await appWindow.setSize(new PhysicalSize(state.width, state.height));
    await appWindow.setPosition(new PhysicalPosition(state.x, state.y));
  } catch {
    // Window state restore is best-effort; invalid platform state should not block startup.
  }
}

async function persistCurrentWindowState(appWindow: Window) {
  try {
    const [position, size, monitors] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.innerSize(),
      safeAvailableMonitors(),
    ]);
    const state = normalizeWindowState({
      height: size.height,
      width: size.width,
      x: position.x,
      y: position.y,
    });

    if (!state) {
      return;
    }
    if (monitors.length > 0 && !isWindowStateVisible(state, monitors)) {
      return;
    }

    window.localStorage.setItem(windowStateStorageKey, JSON.stringify(state));
  } catch {
    // localStorage or window APIs can be unavailable during shutdown.
  }
}

async function safeAvailableMonitors() {
  try {
    return await availableMonitors();
  } catch {
    return [];
  }
}

function readStoredWindowState() {
  try {
    return normalizeWindowState(JSON.parse(window.localStorage.getItem(windowStateStorageKey) || "null"));
  } catch {
    return null;
  }
}

function normalizeWindowState(value: unknown): StoredWindowState | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const state = value as Partial<StoredWindowState>;
  const { height, width, x, y } = state;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  const normalizedWidth = Math.round(width);
  const normalizedHeight = Math.round(height);
  if (normalizedWidth < minWindowWidth || normalizedHeight < minWindowHeight) {
    return null;
  }

  return {
    height: normalizedHeight,
    width: normalizedWidth,
    x: Math.round(x),
    y: Math.round(y),
  };
}

function isWindowStateVisible(state: StoredWindowState, monitors: Monitor[]) {
  return monitors.some((monitor) => {
    const workArea = monitor.workArea || monitor;
    const left = workArea.position.x;
    const top = workArea.position.y;
    const right = left + workArea.size.width;
    const bottom = top + workArea.size.height;
    const visibleWidth = Math.min(state.x + state.width, right) - Math.max(state.x, left);
    const visibleHeight = Math.min(state.y + state.height, bottom) - Math.max(state.y, top);

    return visibleWidth >= 160 && visibleHeight >= 120;
  });
}
