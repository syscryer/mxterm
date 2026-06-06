import type { RemoteFileEntry } from "./remoteFileTypes";

export function normalizeRemotePath(path: string | null | undefined) {
  const normalized = (path || "/").trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized) {
    return "/";
  }
  if (normalized === "/") {
    return "/";
  }
  return normalized.replace(/\/$/, "");
}

export function sortRemoteFileEntries(entries: RemoteFileEntry[]) {
  return [...entries].sort((left, right) =>
    remoteFileRank(left.type) - remoteFileRank(right.type) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.name.localeCompare(right.name),
  );
}

export function remoteFileRank(kind: RemoteFileEntry["type"]) {
  if (kind === "directory") {
    return 0;
  }
  if (kind === "symlink") {
    return 1;
  }
  if (kind === "file") {
    return 2;
  }
  return 3;
}
