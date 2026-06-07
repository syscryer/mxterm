import type { RemoteFileMetadata } from "../files/remoteFileTypes";

export type RemoteFileSaveState =
  | "loading"
  | "ready"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

export interface RemoteFileEditorTab {
  connectionId: string;
  connectionName: string;
  content: string;
  dirty: boolean;
  error: string | null;
  id: string;
  metadata: RemoteFileMetadata | null;
  name: string;
  path: string;
  saveState: RemoteFileSaveState;
  savedContent: string;
  statusMessage: string | null;
}
