import type { RemoteFileKind } from "./remoteFileTypes";

export function formatRemoteFileIdentity(
  name: string | null,
  id: number | null,
  idLabel: "GID" | "UID",
) {
  const normalizedName = name?.trim();
  if (normalizedName && normalizedName.toLowerCase() !== "unknown") {
    return normalizedName;
  }
  return id !== null && Number.isFinite(id) ? `${idLabel} ${id.toString()}` : "未知";
}

export function formatRemoteFileTimestamp(timestamp: number | null, unavailableLabel: string) {
  if (timestamp === null || !Number.isFinite(timestamp) || timestamp <= 0) {
    return unavailableLabel;
  }
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? unavailableLabel : date.toLocaleString();
}

export function remoteFileKindLabel(kind: RemoteFileKind) {
  const labels: Record<RemoteFileKind, string> = {
    directory: "目录",
    file: "文件",
    other: "其他",
    symlink: "符号链接",
  };
  return labels[kind];
}

export function shouldShowRemoteFileSize(kind: RemoteFileKind) {
  return kind !== "directory";
}
