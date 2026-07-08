import { memo, useState } from "react";
import {
  Archive,
  ChevronDown,
  Clipboard,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Tooltip } from "../../shared/ui/Tooltip";
import {
  clearFinishedTransfers,
  useRemoteFileTransferStore,
} from "./remoteFileTransferStore";
import type { RemoteFileTransferItem } from "./remoteFileTransferTypes";
import {
  clampTransferProgress,
  formatTransferDetailTime,
  transferDirectionLabel,
  transferDisplayStatusLabel,
  transferFileTypeClass,
  transferFileTypeLabel,
  transferInlineErrorText,
  transferItemSizeText,
  transferKindLabel,
  transferSourcePath,
  transferTargetPath,
} from "./remoteFileTransferUtils";

interface RemoteFileTransferPanelProps {
  onCancel: (transferId: string) => void;
  onCopyPath: (path: string) => void;
  onRemove: (transferId: string) => void;
  onRetry: (transferId: string) => void;
  onOpenLocalPath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
}

export function RemoteFileTransferPanel(props: RemoteFileTransferPanelProps) {
  const transfers = useRemoteFileTransferStore((state) => state.items);
  const [expanded, setExpanded] = useState(false);
  const runningCount = transfers.filter((item) => item.status === "running").length;
  const queuedCount = transfers.filter((item) => item.status === "queued").length;
  const errorCount = transfers.filter((item) => item.status === "error").length;
  const finishedCount = transfers.filter((item) =>
    ["success", "skipped", "canceled"].includes(item.status),
  ).length;
  const summaryTransfer =
    transfers.find((item) => ["running", "queued"].includes(item.status)) ||
    transfers.find((item) => item.status === "error") ||
    transfers[0] ||
    null;
  const summaryProgress = summaryTransfer ? clampTransferProgress(summaryTransfer.progress) : 0;
  const summaryProgressText = summaryTransfer
    ? `${Math.round(summaryProgress).toString()}%`
    : "空闲";
  const summaryProgressScale = summaryProgress / 100;

  return (
    <section className={`transfer-panel ${expanded ? "open" : ""}`} aria-label="文件传输">
      <header className="transfer-panel-bar">
        <div className="transfer-panel-summary transfer-progress-summary">
          <strong>传输</strong>
          {runningCount > 0 ? <span className="transfer-chip running">{runningCount.toString()} 进行中</span> : null}
          {queuedCount > 0 ? <span className="transfer-chip">{queuedCount.toString()} 排队</span> : null}
          {errorCount > 0 ? <span className="transfer-chip error">{errorCount.toString()} 失败</span> : null}
          {transfers.length === 0 ? <span className="transfer-chip">无任务</span> : null}
        </div>
        <div className="transfer-progress-mini" aria-hidden="true">
          <span style={{ transform: `scaleX(${summaryProgressScale.toString()})` }} />
        </div>
        <span className="transfer-panel-percent">{summaryProgressText}</span>
        <button
          className="transfer-panel-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "收起" : "展开"}
          <ChevronDown className="ui-icon" aria-hidden="true" />
        </button>
      </header>

      <div className="transfer-drawer">
        <div className="transfer-drawer-head">
          <strong>传输队列</strong>
          <button type="button" disabled={finishedCount === 0} onClick={clearFinishedTransfers}>
            清理完成项
          </button>
        </div>

        <div className="transfer-list">
          {transfers.length === 0 ? (
            <p className="file-panel-empty">上传和下载任务会显示在这里。</p>
          ) : (
            transfers.map((item) => (
              <RemoteFileTransferRow
                item={item}
                key={item.id}
                onCancel={props.onCancel}
                onCopyPath={props.onCopyPath}
                onOpenLocalPath={props.onOpenLocalPath}
                onRemove={props.onRemove}
                onRetry={props.onRetry}
                onRevealLocalPath={props.onRevealLocalPath}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

const RemoteFileTransferRow = memo(function RemoteFileTransferRow({
  item,
  onCancel,
  onCopyPath,
  onRemove,
  onRetry,
  onOpenLocalPath,
  onRevealLocalPath,
}: RemoteFileTransferPanelProps & { item: RemoteFileTransferItem }) {
  const progressValue = clampTransferProgress(item.progress);
  const progressLabel = `${Math.round(progressValue).toString()}%`;
  const progressScale = progressValue / 100;
  const canRemove = item.status !== "queued" && item.status !== "running";
  const typeLabel = transferFileTypeLabel(item);
  const sizeText = transferItemSizeText(item);
  const statusText = transferDisplayStatusLabel(item);
  const fileTypeClass = transferFileTypeClass(item);
  const detailText = [
    `状态：${statusText}`,
    `阶段：${item.stage}`,
    `方向：${transferDirectionLabel(item.direction)}`,
    `类型：${transferKindLabel(item.kind)}`,
    `进度：${progressLabel}`,
    `大小：${sizeText}`,
    item.speedText ? `速度：${item.speedText}` : null,
    `创建时间：${formatTransferDetailTime(item.createdAt)}`,
    item.error ? `错误：${item.error}` : null,
    `来源：${transferSourcePath(item)}`,
    `目标：${transferTargetPath(item)}`,
  ].filter(Boolean).join("\n");

  return (
    <article className={`transfer-item ${item.status}`}>
      <Tooltip label={detailText}>
        <div className={`transfer-type-icon ${fileTypeClass}`}>
          {item.kind === "directory" ? (
            <Folder className="ui-icon" aria-hidden="true" />
          ) : fileTypeClass === "archive" ? (
            <Archive className="ui-icon" aria-hidden="true" />
          ) : (
            <FileText className="ui-icon" aria-hidden="true" />
          )}
          {typeLabel ? <span>{typeLabel}</span> : null}
        </div>
      </Tooltip>

      <div className="transfer-item-main">
        <div className="transfer-item-title">
          <strong title={item.name}>{item.name}</strong>
        </div>
        <div className="transfer-item-meta">
          <span className="transfer-tag direction">
            {item.direction === "upload" ? "上传" : "下载"}
          </span>
          <span className={`transfer-status-dot ${item.status}`} aria-hidden="true" />
          <span className="transfer-size-text" title={sizeText}>
            {sizeText}
          </span>
          {item.speedText ? <span className="transfer-speed-text">{item.speedText}</span> : null}
        </div>
        {item.status === "error" && item.error ? (
          <p className="transfer-item-error" title={item.error}>
            {transferInlineErrorText(item.error)}
          </p>
        ) : null}
      </div>

      <div className="transfer-item-actions">
        <Tooltip label="复制路径">
          <button
            type="button"
            aria-label={`复制 ${item.name} 路径`}
            onClick={() => onCopyPath(item.localPath || item.remotePath)}
          >
            <Clipboard className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
        {item.localPath && item.kind !== "directory" ? (
          <Tooltip label="打开">
            <button
              type="button"
              aria-label={`打开 ${item.name}`}
              onClick={() => onOpenLocalPath(item.localPath || "")}
            >
              <ExternalLink className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        {item.localPath ? (
          <Tooltip label="定位">
            <button
              type="button"
              aria-label={`定位 ${item.name}`}
              onClick={() => onRevealLocalPath(item.localPath || "")}
            >
              <FolderOpen className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        {item.status === "error" && item.retry ? (
          <Tooltip label="重试">
            <button type="button" aria-label={`重试 ${item.name}`} onClick={() => onRetry(item.id)}>
              <RefreshCw className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        {item.status === "queued" || item.status === "running" ? (
          <Tooltip label="取消">
            <button type="button" aria-label={`取消 ${item.name}`} onClick={() => onCancel(item.id)}>
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        {canRemove ? (
          <Tooltip label="移除任务">
            <button
              type="button"
              aria-label={`删除任务 ${item.name}`}
              onClick={() => onRemove(item.id)}
            >
              <Trash2 className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className="transfer-progress-line">
        <div
          className={`transfer-progress ${item.progressIndeterminate ? "indeterminate" : ""}`}
          role="progressbar"
          aria-label={`${item.name} ${item.stage}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progressValue)}
        >
          <span style={{ transform: `scaleX(${progressScale.toString()})` }} />
        </div>
        <span className="transfer-progress-text">{progressLabel}</span>
        <span className="transfer-progress-status">{statusText}</span>
      </div>
    </article>
  );
});
