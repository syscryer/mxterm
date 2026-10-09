import { ChevronRight, FileText, Undo2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { usePanelVisible } from "../../shared/ui/panelVisibility";
import { splitActivityPath } from "./aiFileActivity";
import type { AiFileChangeSummary } from "./aiTypes";

interface Props {
  summary: AiFileChangeSummary;
  disabled: boolean;
  onUndo: (summary: AiFileChangeSummary) => Promise<string | null>;
}

export function AiFileChangesSummary({ summary, disabled, onUndo }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const visible = usePanelVisible();
  useEffect(() => { if (!visible) setConfirmOpen(false); }, [visible]);
  if (!summary.files.length) return null;

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      setError(await onUndo(summary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ai-file-changes" aria-label="本轮文件修改">
      <div className="ai-file-changes-header">
        <button className="ai-file-changes-disclosure" type="button" aria-expanded={expanded}
          aria-controls={listId} onClick={() => setExpanded(!expanded)}>
          <ChevronRight className="ui-icon" aria-hidden="true" />
          <span>{summary.files.length} 个文件已{summary.status === "reverted" ? "撤销" : "更改"}</span>
          <span className="ai-file-counts">
            {summary.added_lines > 0 && <span className="ai-file-added">+{summary.added_lines}</span>}
            {summary.removed_lines > 0 && <span className="ai-file-removed">−{summary.removed_lines}</span>}
          </span>
        </button>
        {summary.status === "partial" && <span className="ai-file-changes-status">部分已撤销</span>}
        {summary.remaining_changes > 0 && <button className="ai-file-changes-undo" type="button"
          disabled={disabled || busy} onClick={() => setConfirmOpen(true)}
          title={disabled ? "当前 Agent 结束或停止后可撤销" : "撤销本轮文件修改"}>
          <Undo2 className="ui-icon" aria-hidden="true" /><span>{busy ? "撤销中…" : "撤销"}</span>
        </button>}
      </div>
      <div id={listId} hidden={!expanded}>
        <ul className="ai-file-changes-list">
          {summary.files.map((file) => {
            const { filename, directory } = splitActivityPath(file.path);
            return <li key={`${file.target}:${file.path}`} title={`${file.target === "ssh" ? "SSH" : "本机"}：${file.path}`}>
              <FileText className="ui-icon" aria-hidden="true" />
              <span className="ai-file-name">{filename}</span>
              <span className="ai-file-directory">{directory}</span>
              <span className="ai-file-changes-target">{file.target === "ssh" ? "SSH" : "本机"}</span>
              <span className="ai-file-counts">
                {file.added_lines > 0 && <span className="ai-file-added">+{file.added_lines}</span>}
                {file.removed_lines > 0 && <span className="ai-file-removed">−{file.removed_lines}</span>}
              </span>
            </li>;
          })}
        </ul>
      </div>
      {error && <p className="ai-file-changes-error" role="alert">{error}</p>}
      <ConfirmDialog open={visible && confirmOpen} onOpenChange={setConfirmOpen} title="撤销本轮文件修改？"
        description={`将恢复这 ${summary.files.length} 个文件在本轮修改前的内容，对话记录会保留。如果文件后来发生变化，将停止撤销并提示冲突。`}
        confirmLabel="撤销修改" onConfirm={undo} />
    </section>
  );
}
