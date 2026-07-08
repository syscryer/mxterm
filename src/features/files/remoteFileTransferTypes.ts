import type { RemoteFileUploadItem } from "./RemoteFilePanel";
import type {
  RemoteFileDownloadToLocalInput,
  RemoteFileEntry,
  RemoteFileTransferConflictPolicy,
} from "./remoteFileTypes";

export type TransferDirection = "upload" | "download";
export type TransferKind = "file" | "directory";
export type TransferStatus = "queued" | "running" | "success" | "error" | "skipped" | "canceled";

export type RemoteFileTransferRetry =
  | {
      action: "local-file-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      localPath: string;
      parentPath: string;
    }
  | {
      action: "local-directory-upload";
      compress: boolean;
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      keepArchive: boolean;
      localPath: string;
      parentPath: string;
    }
  | {
      action: "browser-file-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      item: RemoteFileUploadItem;
      parentPath: string;
    }
  | {
      action: "browser-directory-upload";
      connectionId: string;
      conflictPolicy: RemoteFileTransferConflictPolicy;
      items: RemoteFileUploadItem[];
      keepArchive: boolean;
      parentPath: string;
      rootName: string;
    }
  | {
      action: "download";
      entry: RemoteFileEntry;
      input: Omit<RemoteFileDownloadToLocalInput, "transferId">;
    };

export interface RemoteFileTransferItem {
  id: string;
  createdAt: number;
  direction: TransferDirection;
  error?: string | null;
  kind: TransferKind;
  localPath?: string | null;
  name: string;
  progress: number;
  progressDetail?: string | null;
  progressIndeterminate?: boolean;
  retry?: RemoteFileTransferRetry | null;
  remotePath: string;
  speedText?: string | null;
  stage: string;
  startedAt: number;
  status: TransferStatus;
}

export type RemoteFileTransferTask = () => Promise<void>;
