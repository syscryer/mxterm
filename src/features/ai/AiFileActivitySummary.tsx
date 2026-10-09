import type { AiToolCallRecord } from "./aiTypes";
import { fileActivityLabel, getFileActivity, splitActivityPath } from "./aiFileActivity";

export function AiFileActivitySummary({ call }: { call: AiToolCallRecord }) {
  const activity = getFileActivity(call);
  const { filename, directory } = splitActivityPath(activity?.path || "");
  const destination = activity?.destination ? splitActivityPath(activity.destination).filename : null;
  return (
    <>
      <span className="ai-tool-label">{fileActivityLabel(call, activity)}</span>
      {activity ? (
        <>
          <span className="ai-file-name" title={activity.path}>
            {filename}{destination ? ` → ${destination}` : ""}
          </span>
          <span className="ai-file-directory" title={directory}>{directory}</span>
          {(activity.added_lines != null || activity.removed_lines != null) ? (
            <span className="ai-file-counts" title={call.name.startsWith("preview_") || call.status !== "completed" ? "拟变更行数" : "变更行数"}>
              {activity.added_lines ? <span className="ai-file-added">+{activity.added_lines}</span> : null}
              {activity.removed_lines ? <span className="ai-file-removed">−{activity.removed_lines}</span> : null}
            </span>
          ) : null}
        </>
      ) : <span className="ai-file-directory" />}
    </>
  );
}
