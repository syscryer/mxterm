import type { CSSProperties } from "react";

import { resolveRemoteFileIcon, type RemoteFileIconDescriptor } from "./remoteFileIcons";
import type { RemoteFileEntry } from "./remoteFileTypes";

interface RemoteFileIconProps {
  className?: string;
  entry: Pick<RemoteFileEntry, "name" | "type">;
  expanded?: boolean;
}

export function RemoteFileIcon({ className, entry, expanded = false }: RemoteFileIconProps) {
  const icon = resolveRemoteFileIcon(entry);
  const style = {
    "--remote-file-icon-accent": icon.accent,
    "--remote-file-icon-tone": icon.tone,
  } as CSSProperties;
  const extraClassName = className ? ` ${className}` : "";

  if (icon.shape === "folder") {
    return (
      <span
        className={`remote-file-icon-svg folder${expanded ? " is-open" : ""}${extraClassName}`}
        style={style}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" focusable="false">
          <path
            d="M2.75 7.8c0-1.1.9-2 2-2h5.15l1.72 1.9h7.63c1.1 0 2 .9 2 2v7.9c0 1.1-.9 2-2 2H4.75c-1.1 0-2-.9-2-2V7.8Z"
            fill="var(--remote-file-icon-tone)"
          />
          <path
            d="M2.75 9.7c0-1.1.9-2 2-2h14.5c1.1 0 2 .9 2 2v1.05H2.75V9.7Z"
            fill="var(--remote-file-icon-accent)"
            opacity="0.86"
          />
          <path
            d="M2.75 10.45h18.5l-1.45 7.45a2 2 0 0 1-1.96 1.62H4.28a2 2 0 0 1-1.97-2.35l.44-6.72Z"
            fill="var(--remote-file-icon-tone)"
          />
          <path
            d="M2.75 10.45h18.5l-1.45 7.45a2 2 0 0 1-1.96 1.62H4.28a2 2 0 0 1-1.97-2.35l.44-6.72Z"
            fill="var(--remote-file-icon-accent)"
            opacity={expanded ? "0.42" : "0.22"}
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`remote-file-icon-svg file ${icon.shape}${extraClassName}`}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M6 2.75h8.4L19 7.35V19.25a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z"
          fill="var(--remote-file-icon-tone)"
          stroke="var(--remote-file-icon-accent)"
          strokeWidth="1.15"
        />
        <path d="M14.2 2.95v4.7h4.55" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.15" />
        {renderFileIconMark(icon)}
      </svg>
      {icon.label ? <span className="remote-file-icon-label">{icon.label}</span> : null}
    </span>
  );
}

function renderFileIconMark(icon: RemoteFileIconDescriptor) {
  if (icon.shape === "docker") {
    return (
      <>
        <rect x="7" y="11" width="2.7" height="2.3" rx="0.35" fill="var(--remote-file-icon-accent)" />
        <rect x="10.2" y="11" width="2.7" height="2.3" rx="0.35" fill="var(--remote-file-icon-accent)" />
        <rect x="13.4" y="11" width="2.7" height="2.3" rx="0.35" fill="var(--remote-file-icon-accent)" />
        <rect x="10.2" y="8.3" width="2.7" height="2.3" rx="0.35" fill="var(--remote-file-icon-accent)" />
        <path d="M6.8 14.4h10.8c-.5 2.25-2.35 3.55-5.08 3.55H9.4c-1.7 0-2.75-1.05-2.6-3.55Z" fill="var(--remote-file-icon-accent)" />
      </>
    );
  }
  if (icon.shape === "archive") {
    return (
      <>
        <path d="M9 6.5h2.4v2.1H9V6.5Zm2.4 2.1h2.4v2.1h-2.4V8.6ZM9 10.7h2.4v2.1H9v-2.1Zm2.4 2.1h2.4v2.1h-2.4v-2.1Z" fill="var(--remote-file-icon-accent)" />
        <path d="M9.4 16.3h4.2" stroke="var(--remote-file-icon-accent)" strokeWidth="1.3" strokeLinecap="round" />
      </>
    );
  }
  if (icon.shape === "key" || icon.shape === "certificate") {
    return (
      <>
        <circle cx="9" cy="13.5" r="2.1" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.4" />
        <path d="M11.1 13.5h5.1m-1.5 0v2m-2-2v1.35" stroke="var(--remote-file-icon-accent)" strokeWidth="1.4" strokeLinecap="round" />
      </>
    );
  }
  if (icon.shape === "image") {
    return (
      <>
        <circle cx="14.8" cy="9.1" r="1.25" fill="var(--remote-file-icon-accent)" />
        <path d="m7.3 16.5 3.1-3.55 2.15 2.2 1.45-1.55 2.8 2.9H7.3Z" fill="var(--remote-file-icon-accent)" />
      </>
    );
  }
  if (icon.shape === "symlink") {
    return <path d="M8.2 14.2 15.8 6.6m-5.1-.2h5.3v5.3M8 9.1H6.7a2.7 2.7 0 0 0 0 5.4h2.1m6.4 0h2.1a2.7 2.7 0 0 0 0-5.4H16" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (icon.shape === "script" || icon.shape === "code") {
    return <path d="m9.8 10.2-2.3 2.45 2.3 2.45m4.4-4.9 2.3 2.45-2.3 2.45" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (icon.shape === "database") {
    return (
      <>
        <ellipse cx="12" cy="9" rx="4.4" ry="1.8" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.25" />
        <path d="M7.6 9v5.5c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8V9" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.25" />
        <path d="M7.6 11.75c0 1 2 1.8 4.4 1.8s4.4-.8 4.4-1.8" fill="none" stroke="var(--remote-file-icon-accent)" strokeWidth="1.25" />
      </>
    );
  }
  return null;
}
