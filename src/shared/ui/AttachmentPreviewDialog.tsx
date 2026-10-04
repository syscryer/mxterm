import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export interface AttachmentPreviewValue {
  kind: string;
  title: string;
  content: string;
  source: string;
  char_count: number;
  data_url?: string | null;
}

interface AttachmentPreviewDialogProps {
  attachment: AttachmentPreviewValue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: AttachmentPreviewDialogProps) {
  if (!attachment) {
    return null;
  }
  const isImage = attachment.kind === "image" && Boolean(attachment.data_url);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop attachment-preview-backdrop" />
        <Dialog.Content className="attachment-preview-dialog">
          <header className="attachment-preview-header">
            <div>
              <Dialog.Title className="attachment-preview-title">{attachment.title}</Dialog.Title>
              <Dialog.Description className="attachment-preview-meta">
                {attachment.source} · {isImage ? "图片附件" : `${attachment.char_count.toString()} 字`}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="ai-compose-icon-button" type="button" aria-label="关闭预览">
                <X className="ui-icon" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          {isImage ? (
            <img className="attachment-preview-image" src={attachment.data_url || ""} alt={attachment.title} />
          ) : (
            <pre className="attachment-preview-text">{attachment.content}</pre>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
