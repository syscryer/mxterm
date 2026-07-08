import { useCallback, useEffect, useRef } from "react";
import { remoteFileCancelTransfer } from "../../shared/tauri/commands";
import { listenRemoteFileTransferProgress } from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type { RemoteFileTransferTask } from "./remoteFileTransferTypes";
import {
  clearPendingTransferProgressEvents,
  getRemoteFileTransfer,
  markTransferCanceled,
  queueRemoteTransferProgress,
  removeRemoteFileTransfer,
  updateRemoteFileTransfer,
} from "./remoteFileTransferStore";

interface UseRemoteFileTransferControllerInput {
  concurrentTransfers: number;
  onTaskError: (transferId: string, error: unknown) => void;
}

export function useRemoteFileTransferController({
  concurrentTransfers,
  onTaskError,
}: UseRemoteFileTransferControllerInput) {
  const concurrencyRef = useRef(concurrentTransfers);
  const onTaskErrorRef = useRef(onTaskError);
  const transferQueueRef = useRef<string[]>([]);
  const runningTransferIdsRef = useRef<Set<string>>(new Set());
  const transferTasksRef = useRef<Map<string, RemoteFileTransferTask>>(new Map());

  useEffect(() => {
    onTaskErrorRef.current = onTaskError;
  }, [onTaskError]);

  const drainTransferQueue = useCallback(() => {
    const maxConcurrentTransfers = concurrencyRef.current;

    while (
      runningTransferIdsRef.current.size < maxConcurrentTransfers &&
      transferQueueRef.current.length > 0
    ) {
      const transferId = transferQueueRef.current.shift();
      if (!transferId) {
        continue;
      }

      const task = transferTasksRef.current.get(transferId);
      const item = getRemoteFileTransfer(transferId);
      if (!task || (item && item.status !== "queued")) {
        transferTasksRef.current.delete(transferId);
        continue;
      }

      runningTransferIdsRef.current.add(transferId);
      updateRemoteFileTransfer(transferId, {
        startedAt: Date.now(),
        status: "running",
      });

      void task()
        .catch((error) => {
          onTaskErrorRef.current(transferId, error);
        })
        .finally(() => {
          runningTransferIdsRef.current.delete(transferId);
          transferTasksRef.current.delete(transferId);
          drainTransferQueue();
        });
    }
  }, []);

  useEffect(() => {
    concurrencyRef.current = concurrentTransfers;
    drainTransferQueue();
  }, [concurrentTransfers, drainTransferQueue]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenRemoteFileTransferProgress((event) => {
      if (!disposed) {
        queueRemoteTransferProgress(event);
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      clearPendingTransferProgressEvents();
      unlisten?.();
    };
  }, []);

  const dropQueuedTransfer = useCallback((transferId: string) => {
    transferQueueRef.current = transferQueueRef.current.filter((id) => id !== transferId);
    transferTasksRef.current.delete(transferId);
  }, []);

  const enqueueRemoteFileTransfer = useCallback((transferId: string, task: RemoteFileTransferTask) => {
    transferTasksRef.current.set(transferId, task);
    if (
      !transferQueueRef.current.includes(transferId) &&
      !runningTransferIdsRef.current.has(transferId)
    ) {
      transferQueueRef.current.push(transferId);
    }
    drainTransferQueue();
  }, [drainTransferQueue]);

  const cancelQueuedTransfer = useCallback((transferId: string) => {
    dropQueuedTransfer(transferId);
    updateRemoteFileTransfer(transferId, {
      error: null,
      progress: 0,
      progressDetail: null,
      progressIndeterminate: false,
      speedText: null,
      stage: "已取消",
      status: "canceled",
    });
  }, [dropQueuedTransfer]);

  const requestCancelTransfer = useCallback((transferId: string) => {
    const item = getRemoteFileTransfer(transferId);
    if (!item || item.status === "queued") {
      cancelQueuedTransfer(transferId);
      return;
    }
    if (item.status !== "running") {
      return;
    }
    markTransferCanceled(transferId);
    if (hasTauriRuntime()) {
      void remoteFileCancelTransfer(transferId).catch(() => undefined);
    }
  }, [cancelQueuedTransfer]);

  const removeTransfer = useCallback((transferId: string) => {
    dropQueuedTransfer(transferId);
    removeRemoteFileTransfer(transferId);
  }, [dropQueuedTransfer]);

  const isTransferNoLongerActive = useCallback((transferId: string) => {
    const item = getRemoteFileTransfer(transferId);
    return Boolean(item && (item.status === "canceled" || item.status === "error"));
  }, []);

  return {
    enqueueRemoteFileTransfer,
    isTransferNoLongerActive,
    removeTransfer,
    requestCancelTransfer,
  };
}
