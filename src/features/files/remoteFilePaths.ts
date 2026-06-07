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

export function remotePathParent(path: string | null | undefined) {
  const normalizedPath = normalizeRemotePath(path);
  if (normalizedPath === "/") {
    return "/";
  }

  const parentPath = normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
  return parentPath || "/";
}

export function remotePathAncestors(path: string | null | undefined) {
  const normalizedPath = normalizeRemotePath(path);
  if (normalizedPath === "/") {
    return [];
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.map((_, index) => (
    index === 0 ? "/" : `/${segments.slice(0, index).join("/")}`
  ));
}

export function isRemotePathStrictDescendant(path: string | null | undefined, ancestor: string | null | undefined) {
  const normalizedPath = normalizeRemotePath(path);
  const normalizedAncestor = normalizeRemotePath(ancestor);
  if (normalizedPath === normalizedAncestor) {
    return false;
  }
  if (normalizedAncestor === "/") {
    return normalizedPath !== "/";
  }
  return normalizedPath.startsWith(`${normalizedAncestor}/`);
}

export function shouldShowRemoteDirectoryEmptyRow({
  childCount,
  loaded,
  loading,
}: {
  childCount: number;
  loaded: boolean;
  loading: boolean;
}) {
  return loaded && !loading && childCount === 0;
}
