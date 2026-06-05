import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import type { ConnectionProfile, ConnectionProfileInput } from "./connectionTypes";

interface ConnectionDialogProps {
  connection: ConnectionProfile | null;
  open: boolean;
  onClose: () => void;
  onDelete: (connection: ConnectionProfile) => Promise<void>;
  onSave: (input: ConnectionProfileInput) => Promise<void>;
}

const emptyForm: ConnectionProfileInput = {
  name: "",
  host: "",
  port: 22,
  username: "",
  auth_kind: "password",
  password: "",
  private_key_path: "",
  private_key_passphrase: "",
  notes: "",
};

export function ConnectionDialog({
  connection,
  open,
  onClose,
  onDelete,
  onSave,
}: ConnectionDialogProps) {
  const [form, setForm] = useState<ConnectionProfileInput>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setBusy(false);
    setError(null);
    setShowPassword(false);
    setShowPassphrase(false);
    setForm(
      connection
        ? {
            id: connection.id,
            name: connection.name,
            host: connection.host,
            port: connection.port,
            username: connection.username,
            auth_kind: connection.auth_kind,
            password: connection.password || "",
            private_key_path: connection.private_key_path || "",
            private_key_passphrase: connection.private_key_passphrase || "",
            notes: connection.notes || "",
          }
        : emptyForm,
    );
  }, [connection, open]);

  if (!open) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await onSave({
        ...form,
        port: Number(form.port) || 22,
      });
      onClose();
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!connection || !window.confirm(`确认删除连接“${connection.name}”吗？`)) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onDelete(connection);
      onClose();
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content asChild>
          <form className="connection-dialog" onSubmit={submit}>
        <header className="dialog-head">
          <div className="dialog-title-group">
            <Dialog.Title asChild>
              <strong>{connection ? "编辑连接" : "新增连接"}</strong>
            </Dialog.Title>
            <Dialog.Description className="dialog-subtitle">
              {form.host ? formatAddress(form) : "保存一条可直接打开终端的 SSH 连接。"}
            </Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <button className="icon-button" type="button" aria-label="关闭">
              <X className="ui-icon" aria-hidden="true" />
            </button>
          </Dialog.Close>
        </header>

        <div className="dialog-body">
          <section className="dialog-section">
            <div className="dialog-section-title">基本信息</div>

            <label>
              <span>名称</span>
              <input
                value={form.name || ""}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：生产跳板"
              />
            </label>

            <div className="form-grid">
              <label>
                <span>主机</span>
                <input
                  required
                  value={form.host}
                  onChange={(event) => setForm({ ...form, host: event.target.value })}
                  placeholder="203.0.113.70"
                />
              </label>
              <label>
                <span>端口</span>
                <input
                  inputMode="numeric"
                  required
                  value={form.port.toString()}
                  onChange={(event) =>
                    setForm({ ...form, port: Number(event.target.value) || 22 })
                  }
                />
              </label>
            </div>

            <div className="form-grid form-grid-wide">
              <label>
                <span>用户名</span>
                <input
                  required
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  placeholder="root"
                />
              </label>
              <label>
                <span>认证方式</span>
                <select
                  value={form.auth_kind}
                  onChange={(event) =>
                    setForm(
                      event.target.value === "password"
                        ? {
                            ...form,
                            auth_kind: "password",
                            private_key_path: "",
                            private_key_passphrase: "",
                          }
                        : {
                            ...form,
                            auth_kind: "private_key",
                            password: "",
                          },
                    )
                  }
                >
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </label>
            </div>
          </section>

          <section className="dialog-section">
            <div className="dialog-section-title">认证信息</div>

            {form.auth_kind === "password" ? (
              <label>
                <span>密码</span>
                <div className="input-with-toggle">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password || ""}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder="输入密码"
                  />
                  <button
                    className="field-toggle"
                    type="button"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? (
                      <EyeOff className="ui-icon" aria-hidden="true" />
                    ) : (
                      <Eye className="ui-icon" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            ) : (
              <>
                <label>
                  <span>私钥路径</span>
                  <input
                    value={form.private_key_path || ""}
                    onChange={(event) =>
                      setForm({ ...form, private_key_path: event.target.value })
                    }
                    placeholder="~/.ssh/id_ed25519"
                  />
                </label>

                <label>
                  <span>私钥口令</span>
                  <div className="input-with-toggle">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={form.private_key_passphrase || ""}
                      onChange={(event) =>
                        setForm({ ...form, private_key_passphrase: event.target.value })
                      }
                      placeholder="输入私钥口令"
                    />
                    <button
                      className="field-toggle"
                      type="button"
                      aria-label={showPassphrase ? "隐藏私钥口令" : "显示私钥口令"}
                      onClick={() => setShowPassphrase((value) => !value)}
                    >
                      {showPassphrase ? (
                        <EyeOff className="ui-icon" aria-hidden="true" />
                      ) : (
                        <Eye className="ui-icon" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </label>
              </>
            )}
          </section>

          <section className="dialog-section dialog-section-last">
            <div className="dialog-section-title">备注</div>
            <label>
              <span>说明</span>
              <textarea
                rows={4}
                value={form.notes || ""}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="可记录用途、环境、连接注意事项。"
              />
            </label>
          </section>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <footer className="dialog-actions">
          {connection ? (
            <button className="danger-button" disabled={busy} type="button" onClick={remove}>
              删除
            </button>
          ) : (
            <span />
          )}
          <span />
          <Dialog.Close asChild>
            <button disabled={busy} type="button">
              取消
            </button>
          </Dialog.Close>
          <button className="primary-button" disabled={busy} type="submit">
            {connection ? "保存连接" : "创建连接"}
          </button>
        </footer>
      </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatAddress(connection: ConnectionProfileInput) {
  return `${connection.username}@${connection.host}:${connection.port.toString()}`;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}
