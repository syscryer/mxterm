export type RemoteFileKind = "directory" | "file" | "symlink" | "other";

export interface RemoteFileEntry {
  name: string;
  path: string;
  type: RemoteFileKind;
}
