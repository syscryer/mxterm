import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppSelect } from "../../shared/ui/AppSelect";
import {
  connectionTransferExport,
  connectionTransferImport,
  connectionTransferPreview,
} from "../../shared/tauri/commands";
import {
  selectConnectionTransferExportPath,
  selectConnectionTransferImportPath,
} from "../../shared/tauri/dialog";
import type {
  ConnectionTransferConflictStrategy,
  ConnectionTransferExportResult,
  ConnectionTransferImportResult,
  ConnectionTransferMode,
  ConnectionTransferPreviewResult,
} from "./connectionTransferTypes";

interface ConnectionTransferDialogProps {
  mode: ConnectionTransferMode;
  open: boolean;
  onImported: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}

const conflictOptions = [
  { label: "跳过本地已有项", value: "skip" },
  { label: "使用导入内容覆盖", value: "overwrite" },
] satisfies Array<{ label: string; value: ConnectionTransferConflictStrategy }>;

export function ConnectionTransferDialog({
  mode,
  open,
  onImported,
  onOpenChange,
}: ConnectionTransferDialogProps) {
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [strategy, setStrategy] = useState<ConnectionTransferConflictStrategy>("skip");
  const [preview, setPreview] = useState<ConnectionTransferPreviewResult | null>(null);
  const [exportResult, setExportResult] = useState<ConnectionTransferExportResult | null>(null);
  const [importResult, setImportResult] = useState<ConnectionTransferImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPath("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setStrategy("skip");
    setPreview(null);
    setExportResult(null);
    setImportResult(null);
    setBusy(false);
    setError(null);
  }, [mode, open]);

  function changePassword(value: string) {
    setPassword(value);
    setPreview(null);
    setError(null);
  }

  async function choosePath() {
    setError(null);
    try {
      const selected =
        mode === "import"
          ? await selectConnectionTransferImportPath()
          : await selectConnectionTransferExportPath();
      if (selected) {
        setPath(selected);
        setPreview(null);
      }
    } catch (selectionError) {
      setError(formatError(selectionError, "无法打开文件选择器。"));
    }
  }

  async function exportConnections(event: FormEvent) {
    event.preventDefault();
    if (!path) {
      setError("请先选择导出位置。");
      return;
    }
    if (!password) {
      setError("请输入导出密码。");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setExportResult(await connectionTransferExport(path, password));
      setPassword("");
      setPasswordConfirmation("");
    } catch (exportError) {
      setError(formatError(exportError, "连接导出失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    if (!path) {
      setError("请先选择连接迁移文件。");
      return;
    }
    if (!password) {
      setError("请输入文件密码。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await connectionTransferPreview(path, password));
    } catch (previewError) {
      setPreview(null);
      setError(formatError(previewError, "连接迁移文件预检失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function importConnections() {
    if (!preview) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await connectionTransferImport(
        path,
        password,
        preview.fingerprint,
        strategy,
      );
      setImportResult(result);
      setPassword("");
    } catch (importError) {
      setError(formatError(importError, "连接导入失败。"));
      setBusy(false);
      return;
    }
    try {
      await onImported();
    } catch (refreshError) {
      setError(formatError(refreshError, "导入已完成，但连接列表刷新失败，请手动刷新。"));
    } finally {
      setBusy(false);
    }
  }

  const complete = Boolean(exportResult || importResult);
  const title = mode === "import" ? "导入连接" : "导出连接";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="connection-transfer-dialog"
          onInteractOutside={(event) => busy && event.preventDefault()}
          onPointerDownOutside={(event) => busy && event.preventDefault()}
        >
          <header className="connection-transfer-header">
            <span className="connection-transfer-heading-icon" aria-hidden="true">
              {mode === "import" ? <Upload className="ui-icon" /> : <Download className="ui-icon" />}
            </span>
            <span>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {mode === "import"
                  ? "预检后再写入连接、分组、账号和加密凭据。"
                  : "导出全部连接、分组、账号和保存凭据。"}
              </Dialog.Description>
            </span>
            <Dialog.Close asChild>
              <button className="connection-transfer-close" disabled={busy} type="button" aria-label="关闭">
                <X className="ui-icon" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="connection-transfer-body">
            {complete ? (
              <>
                <TransferComplete mode={mode} exportResult={exportResult} importResult={importResult} />
                {error ? <p className="connection-transfer-error connection-transfer-complete-error" role="alert">{error}</p> : null}
              </>
            ) : mode === "export" ? (
              <form className="connection-transfer-form" onSubmit={(event) => void exportConnections(event)}>
                <FilePicker path={path} busy={busy} label="导出位置" onChoose={() => void choosePath()} />
                <PasswordField
                  id="connection-transfer-export-password"
                  label="导出密码"
                  value={password}
                  visible={showPassword}
                  busy={busy}
                  onChange={changePassword}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                <label className="connection-transfer-field" htmlFor="connection-transfer-export-confirmation">
                  <span>确认密码</span>
                  <input
                    id="connection-transfer-export-confirmation"
                    autoComplete="new-password"
                    disabled={busy}
                    type={showPassword ? "text" : "password"}
                    value={passwordConfirmation}
                    onChange={(event) => {
                      setPasswordConfirmation(event.target.value);
                      setError(null);
                    }}
                  />
                </label>
                <p className="connection-transfer-note">
                  <ShieldCheck className="ui-icon" aria-hidden="true" />
                  私钥文件不会打包；密码和私钥口令仅以 AES-256-GCM 密文保存。
                </p>
                {error ? <p className="connection-transfer-error" role="alert">{error}</p> : null}
                <footer className="connection-transfer-actions">
                  <Dialog.Close asChild><button disabled={busy} type="button">取消</button></Dialog.Close>
                  <button className="primary-button" disabled={busy} type="submit">
                    {busy ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : <Download className="ui-icon" aria-hidden="true" />}
                    导出
                  </button>
                </footer>
              </form>
            ) : (
              <form className="connection-transfer-form" onSubmit={(event) => void runPreview(event)}>
                <FilePicker path={path} busy={busy} label="迁移文件" onChoose={() => void choosePath()} />
                <PasswordField
                  id="connection-transfer-import-password"
                  label="文件密码"
                  value={password}
                  visible={showPassword}
                  busy={busy}
                  onChange={changePassword}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                {preview ? (
                  <PreviewPanel
                    preview={preview}
                    strategy={strategy}
                    busy={busy}
                    onStrategyChange={setStrategy}
                  />
                ) : null}
                {error ? <p className="connection-transfer-error" role="alert">{error}</p> : null}
                <footer className="connection-transfer-actions">
                  <Dialog.Close asChild><button disabled={busy} type="button">取消</button></Dialog.Close>
                  {preview ? (
                    <button className="primary-button" disabled={busy} type="button" onClick={() => void importConnections()}>
                      {busy ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : <Upload className="ui-icon" aria-hidden="true" />}
                      确认导入
                    </button>
                  ) : (
                    <button className="primary-button" disabled={busy} type="submit">
                      {busy ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : <ShieldCheck className="ui-icon" aria-hidden="true" />}
                      预检
                    </button>
                  )}
                </footer>
              </form>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FilePicker({ path, busy, label, onChoose }: { path: string; busy: boolean; label: string; onChoose: () => void }) {
  return (
    <div className="connection-transfer-field">
      <span>{label}</span>
      <button className="connection-transfer-file" disabled={busy} type="button" title={path || undefined} onClick={onChoose}>
        <FileJson className="ui-icon" aria-hidden="true" />
        <span>{path ? fileName(path) : "尚未选择文件"}</span>
        <FolderOpen className="ui-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

function PasswordField({ id, label, value, visible, busy, onChange, onToggle }: { id: string; label: string; value: string; visible: boolean; busy: boolean; onChange: (value: string) => void; onToggle: () => void }) {
  return (
    <label className="connection-transfer-field" htmlFor={id}>
      <span>{label}</span>
      <span className="connection-transfer-password">
        <input id={id} autoComplete="new-password" disabled={busy} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} />
        <button disabled={busy} type="button" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={onToggle}>
          {visible ? <EyeOff className="ui-icon" aria-hidden="true" /> : <Eye className="ui-icon" aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

function PreviewPanel({ preview, strategy, busy, onStrategyChange }: { preview: ConnectionTransferPreviewResult; strategy: ConnectionTransferConflictStrategy; busy: boolean; onStrategyChange: (value: ConnectionTransferConflictStrategy) => void }) {
  const { summary } = preview;
  return (
    <section className="connection-transfer-preview" aria-label="预检结果">
      <div className="connection-transfer-stats">
        <TransferStat label="连接" value={summary.connections} />
        <TransferStat label="账号" value={summary.credentials} />
        <TransferStat label="分组" value={summary.groups} />
      </div>
      <label className="connection-transfer-field">
        <span>冲突处理</span>
        <AppSelect ariaLabel="冲突处理" disabled={busy} options={conflictOptions} value={strategy} onChange={onStrategyChange} />
      </label>
      {summary.private_key_warnings.length ? (
        <div className="connection-transfer-warning">
          <AlertTriangle className="ui-icon" aria-hidden="true" />
          <span>
            <strong>{summary.private_key_warnings.length.toString()} 个私钥路径当前不可访问</strong>
            <ul>
              {summary.private_key_warnings.map((path) => <li key={path} title={path}>{path}</li>)}
            </ul>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function TransferStat({ label, value }: { label: string; value: { total: number; new: number; conflicts: number } }) {
  return <div><strong>{value.total.toString()}</strong><span>{label}</span><small>新增 {value.new.toString()} · 冲突 {value.conflicts.toString()}</small></div>;
}

function TransferComplete({ mode, exportResult, importResult }: { mode: ConnectionTransferMode; exportResult: ConnectionTransferExportResult | null; importResult: ConnectionTransferImportResult | null }) {
  const connectionCount = exportResult?.connections ?? (importResult ? importResult.connections.created + importResult.connections.updated : 0);
  return (
    <div className="connection-transfer-complete">
      <CheckCircle2 className="ui-icon" aria-hidden="true" />
      <strong>{mode === "import" ? "连接已导入" : "连接已导出"}</strong>
      <span>{connectionCount.toString()} 个连接，{(exportResult?.credentials ?? (importResult ? importResult.credentials.created + importResult.credentials.updated : 0)).toString()} 个账号</span>
      {exportResult ? <small>{exportResult.file_name}</small> : null}
      <Dialog.Close asChild><button className="primary-button" type="button">完成</button></Dialog.Close>
    </div>
  );
}

function fileName(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || path;
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message: unknown }).message).trim();
    return message || fallback;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
