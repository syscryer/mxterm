import type {
  RemoteFileTransferItem,
  TransferDirection,
  TransferKind,
  TransferStatus,
} from "./remoteFileTransferTypes";

export function clampTransferProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, progress));
}

export function transferProgressPercent(loadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) {
    return 0;
  }
  return (Math.max(0, loadedBytes) / totalBytes) * 100;
}

export function interpolateTransferProgress(
  start: number,
  end: number,
  loadedBytes: number,
  totalBytes: number,
) {
  if (totalBytes <= 0) {
    return end;
  }
  const ratio = Math.max(0, Math.min(1, loadedBytes / totalBytes));
  return start + (end - start) * ratio;
}

export function formatTransferProgressBytes(loadedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) {
    return formatFileSize(loadedBytes);
  }
  return `${formatFileSize(loadedBytes)} / ${formatFileSize(totalBytes)}`;
}

export function createTransferSpeedTracker() {
  const startedAt = performance.now();
  let lastSampleAt = startedAt;
  let lastLoadedBytes = 0;
  let lastSpeedBytesPerSecond: number | null = null;

  return {
    sample(loadedBytes: number) {
      const now = performance.now();
      const elapsedMs = now - lastSampleAt;
      const totalElapsedMs = now - startedAt;
      if (elapsedMs >= 250 || loadedBytes === 0 || lastSpeedBytesPerSecond === null) {
        const deltaBytes = Math.max(0, loadedBytes - lastLoadedBytes);
        lastSpeedBytesPerSecond =
          elapsedMs > 0
            ? (deltaBytes / elapsedMs) * 1000
            : totalElapsedMs > 0
              ? (loadedBytes / totalElapsedMs) * 1000
              : 0;
        lastLoadedBytes = loadedBytes;
        lastSampleAt = now;
      }
      return formatTransferSpeed(
        lastSpeedBytesPerSecond ??
          (totalElapsedMs > 0 ? (loadedBytes / totalElapsedMs) * 1000 : 0),
      );
    },
  };
}

export function calculateTransferAverageSpeed(loadedBytes: number, startedAt: number) {
  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  return Math.max(0, loadedBytes / elapsedSeconds);
}

export function formatTransferSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null;
  }
  return `${formatFileSize(bytesPerSecond)}/s`;
}

export function transferFileTypeClass(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return "directory";
  }
  const name = item.name.toLowerCase();
  if (
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz") ||
    name.endsWith(".zip") ||
    name.endsWith(".gz") ||
    name.endsWith(".7z") ||
    name.endsWith(".rar")
  ) {
    return "archive";
  }
  if (name.endsWith(".log")) {
    return "log";
  }
  return "file";
}

export function transferFileTypeLabel(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return null;
  }
  const name = item.name.toLowerCase();
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "TGZ";
  if (name.endsWith(".zip")) return "ZIP";
  if (name.endsWith(".gz")) return "GZ";
  if (name.endsWith(".7z")) return "7Z";
  if (name.endsWith(".rar")) return "RAR";
  if (name.endsWith(".log")) return "LOG";
  const extension = item.name.includes(".") ? item.name.split(".").pop() || "" : "";
  return extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : null;
}

export function transferItemSizeText(item: RemoteFileTransferItem) {
  if (item.kind === "directory") {
    return item.progressDetail?.includes(" / ") || item.progressDetail?.startsWith("压缩包 ")
      ? item.progressDetail
      : "目录";
  }
  if (item.progressDetail?.includes(" / ")) {
    return item.progressDetail;
  }
  if (item.progressDetail?.startsWith("压缩包 ")) {
    return item.progressDetail;
  }
  return "文件";
}

export function transferDirectionLabel(direction: TransferDirection) {
  return direction === "upload" ? "上传" : "下载";
}

export function transferKindLabel(kind: TransferKind) {
  return kind === "directory" ? "目录" : "文件";
}

export function transferSourcePath(item: RemoteFileTransferItem) {
  if (item.direction === "upload") {
    return item.localPath || "本地选择的文件";
  }
  return item.remotePath;
}

export function transferTargetPath(item: RemoteFileTransferItem) {
  if (item.direction === "upload") {
    return item.remotePath;
  }
  return item.localPath || "本地下载目录";
}

export function formatTransferDetailTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

export function transferStatusLabel(status: TransferStatus) {
  const labels: Record<TransferStatus, string> = {
    canceled: "已取消",
    error: "失败",
    queued: "等待",
    running: "进行中",
    skipped: "已跳过",
    success: "完成",
  };
  return labels[status];
}

export function transferInlineErrorText(error: string) {
  return error
    .split(/\r?\n/)
    .map((line) => normalizeErrorText(line))
    .filter(Boolean)
    .join("；");
}

export function transferDisplayStatusLabel(item: RemoteFileTransferItem) {
  if (item.status !== "running" && item.status !== "queued") {
    return transferStatusLabel(item.status);
  }

  const stage = item.stage.trim();
  if (!stage) {
    return transferStatusLabel(item.status);
  }
  if (stage.includes("等待")) {
    return "等待";
  }
  if (stage.includes("压缩") || stage.includes("打包") || stage.includes("tar.gz")) {
    return "压缩中";
  }
  if (stage.includes("扫描")) {
    return "扫描中";
  }
  if (stage.includes("检查") || stage.includes("准备")) {
    return "准备中";
  }
  if (stage.includes("下载")) {
    return "下载中";
  }
  if (stage.includes("上传")) {
    return "上传中";
  }
  if (stage.includes("解压")) {
    return "解压中";
  }
  return transferStatusLabel(item.status);
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size.toString()} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function normalizeErrorText(message: string) {
  return message.replace(/^Error:\s*/i, "").trim();
}
