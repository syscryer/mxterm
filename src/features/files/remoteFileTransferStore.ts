import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { normalizeRemotePath } from "./remoteFilePaths";
import type { RemoteFileTransferProgressEvent } from "./remoteFileTypes";
import type {
  RemoteFileTransferItem,
  RemoteFileTransferRetry,
  TransferDirection,
  TransferKind,
  TransferStatus,
} from "./remoteFileTransferTypes";
import {
  calculateTransferAverageSpeed,
  clampTransferProgress,
  formatFileSize,
  formatTransferProgressBytes,
  formatTransferSpeed,
  transferProgressPercent,
} from "./remoteFileTransferUtils";

const transferProgressUiFlushMs = 120;
const maxFinishedTransferHistory = 100;
const maxErrorTransferHistory = 100;
const finishedTransferStatuses = new Set<TransferStatus>(["success", "skipped", "canceled"]);

export interface AddRemoteFileTransferInput {
  direction: TransferDirection;
  kind: TransferKind;
  name: string;
  progress?: number;
  progressDetail?: string | null;
  progressIndeterminate?: boolean;
  remotePath: string;
  retry?: RemoteFileTransferRetry | null;
  speedText?: string | null;
  stage: string;
}

export interface SetTransferProgressInput {
  detail?: string | null;
  indeterminate?: boolean;
  progress: number;
  speedText?: string | null;
  stage: string;
  status?: TransferStatus;
}

interface RemoteFileTransferState {
  items: RemoteFileTransferItem[];
}

export const remoteFileTransferStore = createStore<RemoteFileTransferState>()(() => ({
  items: [],
}));

export function useRemoteFileTransferStore<T>(
  selector: (state: RemoteFileTransferState) => T,
) {
  return useStore(remoteFileTransferStore, selector);
}

export function getRemoteFileTransfers() {
  return remoteFileTransferStore.getState().items;
}

export function getRemoteFileTransfer(transferId: string) {
  return getRemoteFileTransfers().find((item) => item.id === transferId) || null;
}

export function addRemoteFileTransfer(input: AddRemoteFileTransferInput) {
  const id = `transfer-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const item: RemoteFileTransferItem = {
    createdAt: now,
    direction: input.direction,
    error: null,
    id,
    kind: input.kind,
    localPath: null,
    name: input.name,
    progress: input.progress ?? 0,
    progressDetail: input.progressDetail ?? null,
    progressIndeterminate: input.progressIndeterminate ?? false,
    remotePath: normalizeRemotePath(input.remotePath),
    retry: input.retry ?? null,
    speedText: input.speedText ?? null,
    stage: input.stage,
    startedAt: now,
    status: "queued",
  };

  remoteFileTransferStore.setState((state) => ({
    items: trimTransferHistory([item, ...state.items]),
  }));
  return id;
}

export function updateRemoteFileTransfer(
  transferId: string,
  update: Partial<Omit<RemoteFileTransferItem, "id" | "createdAt">>,
) {
  remoteFileTransferStore.setState((state) => {
    let changed = false;
    const items = state.items.map((item) => {
      if (item.id !== transferId) {
        return item;
      }

      const next = { ...item, ...update };
      if (update.progressDetail === "100%" && item.progressDetail?.includes(" / ")) {
        next.progressDetail = item.progressDetail;
      }
      if (isTransferItemEqual(item, next)) {
        return item;
      }
      changed = true;
      return next;
    });

    if (!changed) {
      return state;
    }
    return { items: trimTransferHistory(items) };
  });
}

export function setTransferProgress(transferId: string, input: SetTransferProgressInput) {
  updateRemoteFileTransfer(transferId, {
    progress: clampTransferProgress(input.progress),
    progressDetail: input.detail ?? null,
    progressIndeterminate: input.indeterminate ?? false,
    speedText: input.speedText ?? null,
    stage: input.stage,
    status: input.status ?? "running",
  });
}

export function prepareTransferRetry(transferId: string, stage: string) {
  updateRemoteFileTransfer(transferId, {
    error: null,
    localPath: null,
    progress: 0,
    progressDetail: null,
    progressIndeterminate: false,
    speedText: null,
    stage,
    startedAt: Date.now(),
    status: "queued",
  });
}

export function markTransferCanceled(transferId: string) {
  updateRemoteFileTransfer(transferId, {
    progress: 0,
    progressDetail: null,
    progressIndeterminate: false,
    speedText: null,
    status: "canceled",
    stage: "已取消",
  });
}

export function clearFinishedTransfers() {
  remoteFileTransferStore.setState((state) => {
    const items = state.items.filter((item) => !finishedTransferStatuses.has(item.status));
    return items.length === state.items.length ? state : { items };
  });
}

export function removeRemoteFileTransfer(transferId: string) {
  remoteFileTransferStore.setState((state) => {
    const items = state.items.filter((item) => item.id !== transferId);
    return items.length === state.items.length ? state : { items };
  });
}

let pendingTransferProgressEvents = new Map<string, RemoteFileTransferProgressEvent>();
let transferProgressFlushTimer: number | null = null;

export function queueRemoteTransferProgress(event: RemoteFileTransferProgressEvent) {
  pendingTransferProgressEvents.set(event.transfer_id, event);
  if (transferProgressFlushTimer !== null) {
    return;
  }

  transferProgressFlushTimer = window.setTimeout(() => {
    transferProgressFlushTimer = null;
    const events = Array.from(pendingTransferProgressEvents.values());
    pendingTransferProgressEvents.clear();
    applyRemoteTransferProgressEvents(events);
  }, transferProgressUiFlushMs);
}

export function clearPendingTransferProgressEvents() {
  if (transferProgressFlushTimer !== null) {
    window.clearTimeout(transferProgressFlushTimer);
    transferProgressFlushTimer = null;
  }
  pendingTransferProgressEvents.clear();
}

function applyRemoteTransferProgressEvents(events: RemoteFileTransferProgressEvent[]) {
  if (events.length === 0) {
    return;
  }
  const eventByTransferId = new Map(events.map((event) => [event.transfer_id, event]));
  remoteFileTransferStore.setState((state) => {
    let changed = false;
    const items = state.items.map((item) => {
      const event = eventByTransferId.get(item.id);
      if (!event || item.status !== "running") {
        return item;
      }

      const hasKnownTotal = event.total_bytes !== null && event.total_bytes !== undefined;
      const totalBytes = event.total_bytes ?? 0;
      const progress =
        totalBytes > 0 ? transferProgressPercent(event.loaded_bytes, totalBytes) : item.progress;
      const displayProgress =
        event.direction === "upload" && progress >= 100 ? 99 : progress;
      const stage =
        event.direction === "upload" && progress >= 100
          ? "等待远端确认"
          : item.kind === "directory" && event.direction === "download" && !hasKnownTotal
            ? "压缩中"
            : event.direction === "upload"
              ? "上传中"
              : "下载中";
      const progressDetail =
        item.kind === "directory" && event.direction === "download" && !hasKnownTotal
          ? `压缩包 ${formatFileSize(event.loaded_bytes)}`
          : formatTransferProgressBytes(event.loaded_bytes, totalBytes);
      const nextProgress = clampTransferProgress(displayProgress);
      const nextSpeedText = formatTransferSpeed(
        calculateTransferAverageSpeed(event.loaded_bytes, item.startedAt),
      );
      const nextIndeterminate = totalBytes <= 0;

      if (
        item.progress === nextProgress &&
        item.progressDetail === progressDetail &&
        item.progressIndeterminate === nextIndeterminate &&
        item.speedText === nextSpeedText &&
        item.stage === stage
      ) {
        return item;
      }

      changed = true;
      return {
        ...item,
        progress: nextProgress,
        progressDetail,
        progressIndeterminate: nextIndeterminate,
        speedText: nextSpeedText,
        stage,
      };
    });

    return changed ? { items } : state;
  });
}

function trimTransferHistory(items: RemoteFileTransferItem[]) {
  let finishedCount = 0;
  let errorCount = 0;
  const trimmed: RemoteFileTransferItem[] = [];
  for (const item of items) {
    if (item.status === "error") {
      if (errorCount < maxErrorTransferHistory) {
        trimmed.push(item);
        errorCount += 1;
      }
      continue;
    }
    if (!finishedTransferStatuses.has(item.status)) {
      trimmed.push(item);
      continue;
    }
    if (finishedCount < maxFinishedTransferHistory) {
      trimmed.push(item);
      finishedCount += 1;
    }
  }
  return trimmed;
}

function isTransferItemEqual(left: RemoteFileTransferItem, right: RemoteFileTransferItem) {
  return (
    left.direction === right.direction &&
    left.error === right.error &&
    left.kind === right.kind &&
    left.localPath === right.localPath &&
    left.name === right.name &&
    left.progress === right.progress &&
    left.progressDetail === right.progressDetail &&
    left.progressIndeterminate === right.progressIndeterminate &&
    left.retry === right.retry &&
    left.remotePath === right.remotePath &&
    left.speedText === right.speedText &&
    left.stage === right.stage &&
    left.startedAt === right.startedAt &&
    left.status === right.status
  );
}
