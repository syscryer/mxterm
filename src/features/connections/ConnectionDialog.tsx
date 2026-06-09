import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import type {
  ConnectionAuthKind,
  ConnectionCredentialMode,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProxyKind,
  CredentialProfile,
} from "./connectionTypes";
import {
  defaultAdvancedConfig,
  defaultProxyConfig,
} from "./connectionTypes";

interface ConnectionDialogProps {
  connection: ConnectionProfile | null;
  credentials: CredentialProfile[];
  defaultGroup?: string | null;
  groups: ConnectionDialogGroup[];
  open: boolean;
  onClose: () => void;
  onDelete: (connection: ConnectionProfile) => Promise<void>;
  onManageCredentials: () => void;
  onSave: (input: ConnectionProfileInput) => Promise<void>;
  onTest: (input: ConnectionProfileInput) => Promise<void>;
}

interface ConnectionDialogGroup {
  id: string;
  name: string;
  parentId?: string | null;
}

interface GroupOption {
  id: string;
  label: string;
}

type ConnectionDialogTab = "basic" | "proxy" | "advanced";
type ConnectionTestState = "idle" | "running" | "success" | "error";

interface DialogFeedback {
  detail: string;
  title: string;
}

const emptyForm: ConnectionProfileInput = {
  name: "",
  group: "",
  host: "",
  port: 22,
  username: "",
  credential_mode: "inline",
  credential_id: "",
  inline_auth_kind: "password",
  inline_password: "",
  inline_private_key_path: "",
  inline_private_key_passphrase: "",
  prompt_auth_kind: "password",
  proxy: defaultProxyConfig,
  advanced: defaultAdvancedConfig,
  notes: "",
};

export function ConnectionDialog({
  connection,
  credentials,
  defaultGroup,
  groups,
  open,
  onClose,
  onDelete,
  onManageCredentials,
  onSave,
  onTest,
}: ConnectionDialogProps) {
  const [form, setForm] = useState<ConnectionProfileInput>(emptyForm);
  const [activeTab, setActiveTab] = useState<ConnectionDialogTab>("basic");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<DialogFeedback | null>(null);
  const [testState, setTestState] = useState<ConnectionTestState>("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const busyRef = useRef(false);
  const groupOptions = useMemo(
    () => buildGroupOptions(groups, form.group || ""),
    [form.group, groups],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab("basic");
    busyRef.current = false;
    setBusy(false);
    setFeedback(null);
    setTestState("idle");
    setShowPassword(false);
    setShowPassphrase(false);
    setShowProxyPassword(false);
    setDeleteConfirmOpen(false);
    setForm(connection ? formFromConnection(connection) : { ...emptyForm, group: defaultGroup || "" });
  }, [connection, defaultGroup, open]);

  if (!open) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await onSave(normalizeForSubmit(form));
      onClose();
    });
  }

  async function testConnection() {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setFeedback({
      detail: "测试会复用当前表单配置，不会打开终端。",
      title: `${formatAddress(form)} 正在检查`,
    });
    setTestState("running");

    try {
      await onTest(normalizeForSubmit(form));
      setTestState("success");
      setFeedback({
        detail: "当前配置可以继续保存。",
        title: "连接测试通过",
      });
    } catch (nextError) {
      setActiveTab(tabForError(nextError));
      setTestState("error");
      setFeedback(describeDialogError(nextError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (!connection) {
      return;
    }

    await runAction(async () => {
      await onDelete(connection);
      onClose();
    });
  }

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setFeedback(null);

    try {
      await action();
    } catch (nextError) {
      setActiveTab(tabForError(nextError));
      setTestState("error");
      setFeedback(describeDialogError(nextError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
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
          <Dialog.Content
            asChild
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <form className="connection-dialog" onSubmit={submit}>
              <header className="dialog-head">
                <div className="dialog-title-group">
                  <Dialog.Title asChild>
                    <strong>{connection ? "编辑连接" : "新增连接"}</strong>
                  </Dialog.Title>
                  <Dialog.Description className="dialog-subtitle">
                    {form.host ? formatAddress(form) : "保存一条可维护的 SSH 连接配置。"}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>

              <nav className="connection-dialog-tabs" aria-label="连接配置页签">
                {[
                  ["basic", "基本"],
                  ["proxy", "代理"],
                  ["advanced", "高级"],
                ].map(([id, label]) => (
                  <button
                    className={activeTab === id ? "active" : ""}
                    key={id}
                    type="button"
                    aria-current={activeTab === id ? "page" : undefined}
                    onClick={() => setActiveTab(id as ConnectionDialogTab)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="dialog-body connection-dialog-body">
                {activeTab === "basic" ? renderBasicTab() : null}
                {activeTab === "proxy" ? renderProxyTab() : null}
                {activeTab === "advanced" ? renderAdvancedTab() : null}
              </div>

              {feedback ? (
                <div className={`connection-dialog-test-result ${testState}`}>
                  {testState === "running" ? (
                    <Loader2 className="ui-icon spin" aria-hidden="true" />
                  ) : testState === "success" ? (
                    <CheckCircle2 className="ui-icon" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="ui-icon" aria-hidden="true" />
                  )}
                  <span>
                    <strong>{feedback.title}</strong>
                    <small>{feedback.detail}</small>
                  </span>
                </div>
              ) : null}

              <footer className="dialog-actions connection-dialog-actions">
                <div className="dialog-action-left">
                  {connection ? (
                    <button
                      className="danger-button"
                      disabled={busy}
                      type="button"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      删除
                    </button>
                  ) : null}
                  <button
                    className="test-connection-button"
                    disabled={busy}
                    type="button"
                    onClick={testConnection}
                  >
                    测试连接
                  </button>
                </div>
                <div className="dialog-action-right">
                  <Dialog.Close asChild>
                    <button disabled={busy} type="button">
                      取消
                    </button>
                  </Dialog.Close>
                  <button className="primary-button" disabled={busy} type="submit">
                    {connection ? "保存连接" : "创建连接"}
                  </button>
                </div>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {connection ? (
        <ConfirmDialog
          confirmLabel="删除"
          description={`确认删除连接“${connection.name}”吗？这个操作无法撤销。`}
          open={deleteConfirmOpen}
          title="删除连接"
          onConfirm={remove}
          onOpenChange={setDeleteConfirmOpen}
        />
      ) : null}
    </>
  );

  function renderBasicTab() {
    const credentialMode = form.credential_mode || "inline";
    const inlineAuthKind = form.inline_auth_kind || "password";
    const promptAuthKind = form.prompt_auth_kind || "password";
    const showGroupField = groupOptions.length > 0 || Boolean(form.group?.trim());

    return (
      <>
        <section className="dialog-section">
          <div className="dialog-section-title">目标</div>

          <div className={`form-grid ${showGroupField ? "form-grid-wide" : "form-grid-single"}`}>
            <label>
              <span>名称</span>
              <input
                value={form.name || ""}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：生产跳板"
              />
            </label>
            {showGroupField ? (
              <label>
                <span>分组</span>
                <select
                  value={form.group || ""}
                  onChange={(event) => setForm({ ...form, group: event.target.value })}
                >
                  <option value="">不分组</option>
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

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

          <label>
            <span>用户名</span>
            <input
              required
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="root"
            />
          </label>
        </section>

        <section className="dialog-section">
          <div className="dialog-section-title">凭据</div>

          <label>
            <span>凭据来源</span>
            <select
              value={credentialMode}
              onChange={(event) =>
                setForm({
                  ...form,
                  credential_mode: event.target.value as ConnectionCredentialMode,
                })
              }
            >
              <option value="saved">使用保存的凭据</option>
              <option value="inline">在此连接中保存</option>
              <option value="prompt">每次询问</option>
            </select>
          </label>

          {credentialMode === "saved" ? (
            <div className="credential-select-row">
              <label>
                <span>保存的凭据</span>
                <select
                  value={form.credential_id || ""}
                  onChange={(event) => setForm({ ...form, credential_id: event.target.value })}
                >
                  <option value="">选择凭据</option>
                  {credentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.name}（{credential.kind === "password" ? "密码" : "私钥"}）
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="settings-action-button credential-manage-button"
                type="button"
                onClick={onManageCredentials}
              >
                管理
              </button>
            </div>
          ) : null}

          {credentialMode === "inline" ? (
            <>
              <label>
                <span>认证方式</span>
                <select
                  value={inlineAuthKind}
                  onChange={(event) => changeInlineAuthKind(event.target.value as ConnectionAuthKind)}
                >
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </label>

              {inlineAuthKind === "password" ? (
                <label>
                  <span>密码</span>
                  <div className="input-with-toggle">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.inline_password || ""}
                      onChange={(event) =>
                        setForm({ ...form, inline_password: event.target.value })
                      }
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
                      value={form.inline_private_key_path || ""}
                      onChange={(event) =>
                        setForm({ ...form, inline_private_key_path: event.target.value })
                      }
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </label>

                  <label>
                    <span>私钥口令</span>
                    <div className="input-with-toggle">
                      <input
                        type={showPassphrase ? "text" : "password"}
                        value={form.inline_private_key_passphrase || ""}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            inline_private_key_passphrase: event.target.value,
                          })
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
            </>
          ) : null}

          {credentialMode === "prompt" ? (
            <label>
              <span>本次询问类型</span>
              <select
                value={promptAuthKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    prompt_auth_kind: event.target.value as ConnectionAuthKind,
                  })
                }
              >
                <option value="password">密码</option>
                <option value="private_key">私钥</option>
              </select>
            </label>
          ) : null}
        </section>

        <section className="dialog-section dialog-section-last">
          <div className="dialog-section-title">备注</div>
          <label>
            <span>说明</span>
            <textarea
              rows={3}
              value={form.notes || ""}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="可记录用途、环境、连接注意事项。"
            />
          </label>
        </section>
      </>
    );
  }

  function renderProxyTab() {
    const proxy = form.proxy || defaultProxyConfig;
    return (
      <section className="dialog-section dialog-section-last">
        <div className="dialog-section-title">代理</div>

        <label>
          <span>代理类型</span>
          <select
            value={proxy.kind}
            onChange={(event) =>
              setForm({
                ...form,
                proxy: {
                  ...defaultProxyConfig,
                  kind: event.target.value as ConnectionProxyKind,
                },
              })
            }
          >
            <option value="none">不使用代理</option>
            <option value="http_connect">HTTP CONNECT</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>

        {proxy.kind !== "none" ? (
          <>
            <div className="form-grid">
              <label>
                <span>代理主机</span>
                <input
                  value={proxy.host || ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proxy: { ...proxy, host: event.target.value },
                    })
                  }
                  placeholder="proxy.local"
                />
              </label>
              <label>
                <span>代理端口</span>
                <input
                  inputMode="numeric"
                  value={(proxy.port || "").toString()}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proxy: { ...proxy, port: Number(event.target.value) || undefined },
                    })
                  }
                  placeholder="1080"
                />
              </label>
            </div>

            <div className="form-grid form-grid-wide">
              <label>
                <span>代理用户名</span>
                <input
                  value={proxy.username || ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proxy: { ...proxy, username: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <span>代理密码</span>
                <div className="input-with-toggle">
                  <input
                    type={showProxyPassword ? "text" : "password"}
                    value={proxy.password || ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        proxy: { ...proxy, password: event.target.value },
                      })
                    }
                  />
                  <button
                    className="field-toggle"
                    type="button"
                    aria-label={showProxyPassword ? "隐藏代理密码" : "显示代理密码"}
                    onClick={() => setShowProxyPassword((value) => !value)}
                  >
                    {showProxyPassword ? (
                      <EyeOff className="ui-icon" aria-hidden="true" />
                    ) : (
                      <Eye className="ui-icon" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            </div>
          </>
        ) : (
          <p className="connection-dialog-note">当前连接将直接访问 SSH 主机。</p>
        )}
      </section>
    );
  }

  function renderAdvancedTab() {
    const advanced = form.advanced || defaultAdvancedConfig;
    return (
      <section className="dialog-section dialog-section-last">
        <div className="dialog-section-title">高级</div>
        <div className="form-grid form-grid-wide">
          <label>
            <span>连接超时（毫秒）</span>
            <input
              inputMode="numeric"
              value={advanced.connect_timeout_ms.toString()}
              onChange={(event) =>
                setForm({
                  ...form,
                  advanced: {
                    ...advanced,
                    connect_timeout_ms: Number(event.target.value) || 30_000,
                  },
                })
              }
            />
          </label>
          <label>
            <span>认证超时（毫秒）</span>
            <input
              inputMode="numeric"
              value={advanced.auth_timeout_ms.toString()}
              onChange={(event) =>
                setForm({
                  ...form,
                  advanced: {
                    ...advanced,
                    auth_timeout_ms: Number(event.target.value) || 45_000,
                  },
                })
              }
            />
          </label>
        </div>
        <label>
          <span>心跳间隔（毫秒）</span>
          <input
            inputMode="numeric"
            value={advanced.keepalive_interval_ms.toString()}
            onChange={(event) =>
              setForm({
                ...form,
                advanced: {
                  ...advanced,
                  keepalive_interval_ms: Number(event.target.value) || 20_000,
                },
              })
            }
          />
        </label>
      </section>
    );
  }

  function changeInlineAuthKind(authKind: ConnectionAuthKind) {
    setForm(
      authKind === "password"
        ? {
            ...form,
            inline_auth_kind: "password",
            inline_private_key_path: "",
            inline_private_key_passphrase: "",
          }
        : {
            ...form,
            inline_auth_kind: "private_key",
            inline_password: "",
          },
    );
  }
}

function formFromConnection(connection: ConnectionProfile): ConnectionProfileInput {
  const credentialMode = connection.credential_mode || "inline";
  const legacyAuthKind =
    connection.auth_kind ||
    (connection.private_key_path ? "private_key" : "password");
  const inlineAuthKind = connection.inline_auth_kind || legacyAuthKind;

  return {
    id: connection.id,
    name: connection.name,
    group: connection.group || "",
    host: connection.host,
    port: connection.port,
    username: connection.username,
    credential_mode: credentialMode,
    credential_id: connection.credential_id || "",
    inline_auth_kind: inlineAuthKind,
    inline_password: connection.inline_password || connection.password || "",
    inline_private_key_path:
      connection.inline_private_key_path || connection.private_key_path || "",
    inline_private_key_passphrase:
      connection.inline_private_key_passphrase ||
      connection.private_key_passphrase ||
      "",
    prompt_auth_kind: connection.prompt_auth_kind || inlineAuthKind || "password",
    proxy: {
      ...defaultProxyConfig,
      ...connection.proxy,
    },
    advanced: {
      ...defaultAdvancedConfig,
      ...connection.advanced,
    },
    notes: connection.notes || "",
    is_favorite: connection.is_favorite,
    last_connected_at: connection.last_connected_at || "",
  };
}

function normalizeForSubmit(form: ConnectionProfileInput): ConnectionProfileInput {
  return {
    ...form,
    port: Number(form.port) || 22,
    proxy:
      form.proxy.kind === "none"
        ? { kind: "none" }
        : {
            ...form.proxy,
            port: Number(form.proxy.port) || undefined,
          },
    advanced: {
      auth_timeout_ms:
        Number(form.advanced.auth_timeout_ms) || defaultAdvancedConfig.auth_timeout_ms,
      connect_timeout_ms:
        Number(form.advanced.connect_timeout_ms) ||
        defaultAdvancedConfig.connect_timeout_ms,
      keepalive_interval_ms:
        Number(form.advanced.keepalive_interval_ms) ||
        defaultAdvancedConfig.keepalive_interval_ms,
    },
  };
}

function buildGroupOptions(groups: ConnectionDialogGroup[], currentGroup: string): GroupOption[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const options = groups.map((group) => ({
    id: group.id,
    label: groupPathLabel(group, groupById),
  }));
  const trimmedCurrentGroup = currentGroup.trim();

  if (
    trimmedCurrentGroup &&
    !options.some((option) => option.id === trimmedCurrentGroup)
  ) {
    options.push({
      id: trimmedCurrentGroup,
      label: trimmedCurrentGroup,
    });
  }

  return options;
}

function groupPathLabel(
  group: ConnectionDialogGroup,
  groupById: Map<string, ConnectionDialogGroup>,
) {
  const names = [group.name];
  let parentId = group.parentId || null;
  const visited = new Set<string>([group.id]);

  while (parentId && !visited.has(parentId)) {
    const parent = groupById.get(parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    visited.add(parent.id);
    parentId = parent.parentId || null;
  }

  return names.join(" / ");
}

function tabForError(error: unknown): ConnectionDialogTab {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code.startsWith("connection_proxy_")) {
    return "proxy";
  }
  if (
    code === "connection_connect_timeout_invalid" ||
    code === "connection_auth_timeout_invalid" ||
    code === "connection_keepalive_invalid"
  ) {
    return "advanced";
  }
  return "basic";
}

function describeDialogError(error: unknown): DialogFeedback {
  const code = errorCode(error);
  const rawMessage = errorRawMessage(error);
  const raw = rawMessage.toLowerCase();

  if (isTimeoutError(code, raw)) {
    return {
      title: "连接超时",
      detail: "在限定时间内无法连接到目标主机，请检查 IP、端口、防火墙、代理或网络连通性。",
    };
  }

  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return {
      title: "端口无法连接",
      detail: "目标主机拒绝了连接，请确认 SSH 服务已启动、端口正确，或安全组允许访问。",
    };
  }

  if (raw.includes("no route") || raw.includes("unreachable")) {
    return {
      title: "主机不可达",
      detail: "本机到目标主机没有可用路由，请检查 VPN、网段、网关或代理配置。",
    };
  }

  if (code.includes("auth") || raw.includes("auth")) {
    return {
      title: "认证失败",
      detail: "请检查用户名、密码、私钥路径或私钥口令是否匹配服务器配置。",
    };
  }

  if (code.startsWith("proxy_") || code.includes("proxy")) {
    return {
      title: "代理连接失败",
      detail: "请检查代理类型、代理地址端口以及代理用户名密码。",
    };
  }

  return {
    title: formatError(error),
    detail: rawMessage || "请根据提示调整配置后重试。",
  };
}

function formatAddress(connection: ConnectionProfileInput) {
  const username = connection.username || "user";
  const host = connection.host || "host";
  return `${username}@${host}:${connection.port.toString()}`;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

function errorRawMessage(error: unknown) {
  return typeof error === "object" && error !== null && "raw_message" in error
    ? normalizeErrorText((error as { raw_message: unknown }).raw_message)
    : normalizeErrorText(error);
}

function normalizeErrorText(value: unknown) {
  return String(value ?? "")
    .replace(/^Error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTimeoutError(code: string, raw: string) {
  return code.includes("timeout") ||
    raw.includes("timeout") ||
    raw.includes("timed out") ||
    raw.includes("operation timed out");
}
