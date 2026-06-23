export function remoteFileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).pop() || path || "untitled";
}

export function remoteFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function isDockerfileName(fileName: string) {
  const normalizedName = remoteFileNameFromPath(fileName).toLowerCase();
  return normalizedName === "dockerfile" || normalizedName.endsWith(".dockerfile");
}
