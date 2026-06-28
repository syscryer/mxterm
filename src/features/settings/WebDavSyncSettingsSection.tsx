import { useEffect, useState, type FormEvent } from "react";
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";

import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { usernameInputAttributes } from "../../shared/ui/inputAttributes";
import {
  webdavDownloadSnapshot,
  webdavFetchRemoteInfo,
  webdavSettingsGet,
  webdavSettingsSave,
  webdavTestConnection,
  webdavUploadSnapshot,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { SettingsRow, SettingsToggle } from "./SettingsControls";
import type {
  WebDavRemoteInfo,
  WebDavSettings,
  WebDavSettingsInput,
  WebDavSyncResult,
} from "./webdavSyncTypes";

type WebDavBusyAction = "load" | "save" | "test" | "remote" | "upload" | "download" | null;
type WebDavConfirmAction = "upload" | "download" | null;

interface WebDavSyncFormState {
  enabled: boolean;
  base_url: string;
  username: string;
  password: string;
  password_touched: boolean;
  remote_root: string;
  profile: string;
}

export function WebDavSyncSettingsSection() {
  const [settings, setSettings] = useState<WebDavSettings | null>(null);
  const [form, setForm] = useState<WebDavSyncFormState>(() =>
    formFromSettings(previewWebDavSettings()),
  );
  const [syncPassword, setSyncPassword] = useState("");
  const [remoteInfo, setRemoteInfo] = useState<WebDavRemoteInfo | null>(null);
  const [busyAction, setBusyAction] = useState<WebDavBusyAction>(null);
  const [confirmAction, setConfirmAction] = useState<WebDavConfirmAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWebDavPassword, setShowWebDavPassword] = useState(false);
  const [showSyncPassword, setShowSyncPassword] = useState(false);
  const runtimeAvailable = hasTauriRuntime();
  const busy = busyAction !== null;
  const passwordStatus = form.password_touched
    ? form.password.trim()
      ? "将更新密码"
      : "将清空密码"
    : settings?.password_saved
      ? "已保存密码"
      : "未保存密码";

  useEffect(() => {
    let disposed = false;

    async function load() {
      setBusyAction("load");
      setError(null);
      try {
        const loaded = runtimeAvailable ? await webdavSettingsGet() : previewWebDavSettings();
        if (disposed) {
          return;
        }
        setSettings(loaded);
        setForm(formFromSettings(loaded));
      } catch (nextError) {
        if (!disposed) {
          setError(formatWebDavError(nextError));
        }
      } finally {
        if (!disposed) {
          setBusyAction(null);
        }
      }
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [runtimeAvailable]);

  async function runAction<T>(action: Exclude<WebDavBusyAction, null>, task: () => Promise<T>) {
    setBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      return await task();
    } catch (nextError) {
      setError(formatWebDavError(nextError));
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtimeAvailable) {
      setError("桌面模式下才能保存 WebDAV 设置。");
      return;
    }

    const saved = await runAction("save", () => webdavSettingsSave(formToInput(form)));
    if (saved) {
      setSettings(saved);
      setForm(formFromSettings(saved));
      setMessage("WebDAV 设置已保存。");
    }
  }

  async function testConnection() {
    if (!runtimeAvailable) {
      setError("桌面模式下才能测试 WebDAV 连接。");
      return;
    }

    const result = await runAction("test", () => webdavTestConnection(formToInput(form)));
    if (result?.ok) {
      setMessage(result.message || "WebDAV 连接正常。");
    }
  }

  async function fetchRemoteInfo() {
    if (!runtimeAvailable) {
      setError("桌面模式下才能读取远端快照。");
      return;
    }

    const result = await runAction("remote", () => webdavFetchRemoteInfo());
    if (result) {
      setRemoteInfo(result);
      setMessage(remoteInfoMessage(result));
    }
  }

  async function confirmUpload() {
    if (!runtimeAvailable) {
      setError("桌面模式下才能上传同步快照。");
      return;
    }

    const result = await runAction("upload", () =>
      webdavUploadSnapshot({
        sync_password: trimmedOrNull(syncPassword),
      }),
    );
    if (result) {
      setMessage(syncResultMessage(result));
      setRemoteInfo(null);
    }
  }

  async function confirmDownload() {
    if (!runtimeAvailable) {
      setError("桌面模式下才能下载同步快照。");
      return;
    }

    const result = await runAction("download", () =>
      webdavDownloadSnapshot({
        sync_password: trimmedOrNull(syncPassword),
      }),
    );
    if (result) {
      setMessage(syncResultMessage(result));
      setRemoteInfo(null);
    }
  }

  return (
    <section className="settings-page-section webdav-sync-section">
      <header className="settings-section-head settings-section-head-row">
        <span>
          <h1>同步</h1>
          <p>配置 WebDAV 手动同步，上传和下载 MXterm 的连接、账号、隧道和安全快照。</p>
        </span>
        <span className={`webdav-sync-state ${form.enabled ? "enabled" : ""}`}>
          {form.enabled ? "已启用" : "未启用"}
        </span>
      </header>

      <div className="settings-panel webdav-sync-config-panel">
        <SettingsRow
          icon={Cloud}
          title="WebDAV 同步"
          description="默认关闭；启用后仍只在你点击上传或下载时同步。"
        >
          <SettingsToggle
            checked={form.enabled}
            label="启用 WebDAV 同步"
            onChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
          />
        </SettingsRow>

        <form className="webdav-sync-form" onSubmit={submitSettings}>
          <div className="webdav-sync-form-grid">
            <label className="credential-field credential-field-full">
              <span>服务地址</span>
              <input
                className="settings-input"
                value={form.base_url}
                placeholder="https://dav.example.com/remote.php/dav/files/user"
                spellCheck={false}
                onChange={(event) =>
                  setForm((current) => ({ ...current, base_url: event.currentTarget.value }))
                }
              />
            </label>

            <label className="credential-field">
              <span>用户名</span>
              <input
                className="settings-input"
                {...usernameInputAttributes}
                value={form.username}
                autoComplete="username"
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.currentTarget.value }))
                }
              />
            </label>

            <label className="credential-field">
              <span>WebDAV 密码 · {passwordStatus}</span>
              <div className="credential-secret-field">
                <LockKeyhole className="ui-icon" aria-hidden="true" />
                <input
                  type={showWebDavPassword ? "text" : "password"}
                  value={form.password}
                  autoComplete="current-password"
                  placeholder={settings?.password_saved ? "留空保留已保存密码" : "输入 WebDAV 密码"}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.currentTarget.value,
                      password_touched: true,
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label={showWebDavPassword ? "隐藏 WebDAV 密码" : "显示 WebDAV 密码"}
                  onClick={() => setShowWebDavPassword((value) => !value)}
                >
                  {showWebDavPassword ? (
                    <EyeOff className="ui-icon" aria-hidden="true" />
                  ) : (
                    <Eye className="ui-icon" aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>

            <label className="credential-field">
              <span>远端目录</span>
              <input
                className="settings-input"
                value={form.remote_root}
                spellCheck={false}
                onChange={(event) =>
                  setForm((current) => ({ ...current, remote_root: event.currentTarget.value }))
                }
              />
            </label>

            <label className="credential-field">
              <span>Profile</span>
              <input
                className="settings-input"
                value={form.profile}
                spellCheck={false}
                onChange={(event) =>
                  setForm((current) => ({ ...current, profile: event.currentTarget.value }))
                }
              />
            </label>
          </div>

          <footer className="credential-form-actions webdav-sync-actions">
            <div>
              <button
                className="settings-action-button"
                type="button"
                disabled={busy || !runtimeAvailable}
                onClick={() => void testConnection()}
              >
                <Wifi className="ui-icon" aria-hidden="true" />
                {busyAction === "test" ? "测试中" : "测试连接"}
              </button>
            </div>
            <div>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !runtimeAvailable}
              >
                <Save className="ui-icon" aria-hidden="true" />
                {busyAction === "save" ? "保存中" : "保存设置"}
              </button>
            </div>
          </footer>
        </form>
      </div>

      <div className="webdav-sync-grid">
        <section className="settings-panel webdav-remote-panel" aria-label="远端快照">
          <header className="local-terminal-panel-head">
            <span>
              <strong>远端快照</strong>
              <small>{remoteInfo ? remoteInfoSummary(remoteInfo) : "读取 manifest.json 后显示"}</small>
            </span>
            <button
              className="settings-action-button"
              type="button"
              disabled={busy || !runtimeAvailable}
              onClick={() => void fetchRemoteInfo()}
            >
              <RefreshCw className="ui-icon" aria-hidden="true" />
              {busyAction === "remote" ? "读取中" : "读取远端"}
            </button>
          </header>

          {remoteInfo ? (
            <div className="webdav-remote-info">
              <span className={`webdav-remote-badge ${remoteInfo.compatible ? "ok" : "warn"}`}>
                {remoteInfo.compatible ? "兼容" : remoteInfo.exists ? "不兼容" : "空目录"}
              </span>
              <dl>
                <div>
                  <dt>来源设备</dt>
                  <dd>{remoteInfo.device_name || "无"}</dd>
                </div>
                <div>
                  <dt>快照时间</dt>
                  <dd>{formatTimestamp(remoteInfo.created_at)}</dd>
                </div>
                <div>
                  <dt>协议版本</dt>
                  <dd>{remoteInfo.protocol_version ?? "无"}</dd>
                </div>
                <div>
                  <dt>数据大小</dt>
                  <dd>{formatBytes(remoteInfo.data_size)}</dd>
                </div>
                <div>
                  <dt>Secrets</dt>
                  <dd>{remoteInfo.secrets_size ? formatBytes(remoteInfo.secrets_size) : "无"}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="settings-note">保存设置后读取远端信息，确认远端是否已有快照。</p>
          )}
        </section>

        <section className="settings-panel webdav-operation-panel" aria-label="同步操作">
          <header className="local-terminal-panel-head">
            <span>
              <strong>手动同步</strong>
              <small>同步主密码只用于本次加密或解密云端 secrets，不会保存。</small>
            </span>
            <ShieldCheck className="ui-icon" aria-hidden="true" />
          </header>

          <div className="webdav-operation-body">
            <label className="credential-field">
              <span>同步主密码</span>
              <div className="credential-secret-field">
                <KeyRound className="ui-icon" aria-hidden="true" />
                <input
                  type={showSyncPassword ? "text" : "password"}
                  value={syncPassword}
                  autoComplete="new-password"
                  placeholder="上传含密码快照时必填"
                  onChange={(event) => setSyncPassword(event.currentTarget.value)}
                />
                <button
                  type="button"
                  aria-label={showSyncPassword ? "隐藏同步主密码" : "显示同步主密码"}
                  onClick={() => setShowSyncPassword((value) => !value)}
                >
                  {showSyncPassword ? (
                    <EyeOff className="ui-icon" aria-hidden="true" />
                  ) : (
                    <Eye className="ui-icon" aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>

            <div className="webdav-operation-actions">
              <button
                className="settings-action-button"
                type="button"
                disabled={busy || !runtimeAvailable}
                onClick={() => setConfirmAction("upload")}
              >
                <CloudUpload className="ui-icon" aria-hidden="true" />
                {busyAction === "upload" ? "上传中" : "上传本机"}
              </button>
              <button
                className="settings-action-button danger-button"
                type="button"
                disabled={busy || !runtimeAvailable}
                onClick={() => setConfirmAction("download")}
              >
                <CloudDownload className="ui-icon" aria-hidden="true" />
                {busyAction === "download" ? "下载中" : "下载远端"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {message ? (
        <p className="webdav-sync-message" role="status">
          <Database className="ui-icon" aria-hidden="true" />
          <span>{message}</span>
        </p>
      ) : null}

      {error ? (
        <p className="form-error webdav-sync-message" role="alert">
          <Server className="ui-icon" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      {!runtimeAvailable ? (
        <p className="settings-note">浏览器预览只展示布局，WebDAV 操作需要在 Tauri 桌面模式中执行。</p>
      ) : null}

      <ConfirmDialog
        confirmLabel="上传覆盖"
        description="会用本机当前同步快照覆盖远端 latest。manifest 会最后上传，避免远端指向未完成的快照。"
        open={confirmAction === "upload"}
        title="上传本机快照"
        onConfirm={confirmUpload}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
      />

      <ConfirmDialog
        confirmLabel="下载导入"
        description="会用远端快照覆盖本机同步范围数据；导入前会由快照层创建本机备份。"
        open={confirmAction === "download"}
        title="下载远端快照"
        onConfirm={confirmDownload}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
      />
    </section>
  );
}

function previewWebDavSettings(): WebDavSettings {
  return {
    enabled: false,
    base_url: "",
    username: null,
    password_saved: false,
    remote_root: "mxterm-sync",
    profile: "default",
    last_sync_at: null,
    last_snapshot_id: null,
    last_remote_device_name: null,
    last_error: null,
    updated_at: "",
  };
}

function formFromSettings(settings: WebDavSettings): WebDavSyncFormState {
  return {
    enabled: settings.enabled,
    base_url: settings.base_url,
    username: settings.username || "",
    password: "",
    password_touched: false,
    remote_root: settings.remote_root || "mxterm-sync",
    profile: settings.profile || "default",
  };
}

function formToInput(form: WebDavSyncFormState): WebDavSettingsInput {
  return {
    enabled: form.enabled,
    base_url: form.base_url.trim(),
    username: trimmedOrNull(form.username),
    password: form.password_touched ? form.password : undefined,
    password_touched: form.password_touched,
    remote_root: form.remote_root.trim() || "mxterm-sync",
    profile: form.profile.trim() || "default",
  };
}

function trimmedOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatWebDavError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function remoteInfoMessage(info: WebDavRemoteInfo) {
  if (!info.exists) {
    return "远端目录还没有同步快照。";
  }
  if (!info.compatible) {
    return "远端快照格式不兼容，不能下载导入。";
  }
  return "远端快照信息已读取。";
}

function syncResultMessage(result: WebDavSyncResult) {
  const direction = result.uploaded ? "上传完成" : "下载导入完成";
  const secretNote = result.secrets_skipped ? "，未导入 secrets" : "";
  return `${direction}：${result.device_name} / ${result.snapshot_id}${secretNote}`;
}

function remoteInfoSummary(info: WebDavRemoteInfo) {
  if (!info.exists) {
    return "远端为空";
  }
  if (!info.compatible) {
    return "远端快照不兼容";
  }
  return `${info.device_name || "未知设备"} · ${formatTimestamp(info.created_at)}`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "无";
  }
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatBytes(value: number | null) {
  if (!value || value <= 0) {
    return "无";
  }
  if (value < 1024) {
    return `${value.toString()} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
