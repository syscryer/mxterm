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

  useEffect(() => {
    if (!open) {
      return;
    }

    setError(null);
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
    if (!connection || !window.confirm(`删除连接 ${connection.name}？`)) {
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
    <div className="dialog-backdrop" role="presentation">
      <form className="connection-dialog" onSubmit={submit}>
        <header className="dialog-head">
          <strong>{connection ? "编辑连接" : "新增连接"}</strong>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <label>
          <span>名称</span>
          <input
            value={form.name || ""}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            <span>主机</span>
            <input
              required
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
            />
          </label>
          <label>
            <span>端口</span>
            <input
              inputMode="numeric"
              required
              value={form.port.toString()}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) || 22 })}
            />
          </label>
        </div>
        <label>
          <span>用户名</span>
          <input
            required
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
        </label>
        <label>
          <span>认证</span>
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

        {form.auth_kind === "password" ? (
          <label>
            <span>密码</span>
            <input
              value={form.password || ""}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>
        ) : (
          <>
            <label>
              <span>私钥路径</span>
              <input
                value={form.private_key_path || ""}
                onChange={(event) => setForm({ ...form, private_key_path: event.target.value })}
              />
            </label>
            <label>
              <span>私钥口令</span>
              <input
                value={form.private_key_passphrase || ""}
                onChange={(event) =>
                  setForm({ ...form, private_key_passphrase: event.target.value })
                }
              />
            </label>
          </>
        )}

        <label>
          <span>备注</span>
          <textarea
            rows={3}
            value={form.notes || ""}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <footer className="dialog-actions">
          {connection ? (
            <button className="danger-button" disabled={busy} type="button" onClick={remove}>
              删除
            </button>
          ) : null}
          <span />
          <button disabled={busy} type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            保存
          </button>
        </footer>
      </form>
    </div>
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
