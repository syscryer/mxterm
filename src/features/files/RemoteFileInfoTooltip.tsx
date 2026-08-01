import type { RefObject } from "react";

import { AnchoredSurfacePortal } from "../../shared/ui/AnchoredSurfacePortal";
import { formatFileSize } from "./remoteFileTransferUtils";
import {
  formatRemoteFileIdentity,
  formatRemoteFileTimestamp,
  remoteFileKindLabel,
  shouldShowRemoteFileSize,
} from "./remoteFileMetadataPresentation";
import type { RemoteFileEntry, RemoteFileEntryMetadata } from "./remoteFileTypes";
import { RemoteFileIcon } from "./RemoteFileIcon";

export type RemoteFileInfoState =
  | { status: "loading" }
  | { error: string; status: "error" }
  | { metadata: RemoteFileEntryMetadata; status: "ready" };

interface RemoteFileInfoTooltipProps {
  anchorRef: RefObject<HTMLElement | null>;
  entry: RemoteFileEntry | null;
  id: string;
  open: boolean;
  state: RemoteFileInfoState | null;
  onOpenChange: (open: boolean) => void;
}

export function RemoteFileInfoTooltip({
  anchorRef,
  entry,
  id,
  open,
  state,
  onOpenChange,
}: RemoteFileInfoTooltipProps) {
  if (!entry) {
    return null;
  }

  const metadata = state?.status === "ready" ? state.metadata : null;
  const kind = metadata?.type || entry.type;

  return (
    <AnchoredSurfacePortal
      align="start"
      anchorRef={anchorRef}
      className="ui-tooltip remote-file-info-tooltip"
      consumeEscape
      desiredHeight={292}
      id={id}
      minHeight={168}
      open={open}
      role="tooltip"
      side="left"
      width={318}
      onOpenChange={onOpenChange}
    >
      <header className="remote-file-info-head">
        <RemoteFileIcon entry={entry} expanded={false} />
        <strong>{entry.name}</strong>
      </header>
      <dl className="remote-file-info-list">
        <RemoteFileInfoRow label="类型" value={remoteFileKindLabel(kind)} />
        {metadata && shouldShowRemoteFileSize(kind) ? (
          <RemoteFileInfoRow label="大小" value={formatFileSize(metadata.size)} />
        ) : null}
        {metadata ? (
          <>
            <RemoteFileInfoRow
              label="用户"
              value={formatRemoteFileIdentity(metadata.owner, metadata.uid, "UID")}
            />
            <RemoteFileInfoRow
              label="用户组"
              value={formatRemoteFileIdentity(metadata.group, metadata.gid, "GID")}
            />
            <RemoteFileInfoRow label="权限" value={metadata.mode || "未知"} />
            <RemoteFileInfoRow
              label="修改时间"
              value={formatRemoteFileTimestamp(metadata.mtime, "未知")}
            />
            <RemoteFileInfoRow
              label="创建时间"
              value={formatRemoteFileTimestamp(metadata.birthtime, "系统不支持")}
            />
          </>
        ) : null}
        <RemoteFileInfoRow label="路径" value={entry.path} wrap />
      </dl>
      {state?.status === "loading" ? (
        <p className="remote-file-info-status" aria-live="polite">正在读取属性...</p>
      ) : state?.status === "error" ? (
        <p className="remote-file-info-status is-error" aria-live="polite">{state.error}</p>
      ) : null}
    </AnchoredSurfacePortal>
  );
}

function RemoteFileInfoRow({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={wrap ? "is-path" : undefined}>{value}</dd>
    </div>
  );
}
