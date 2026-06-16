import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Monitor,
  MonitorPlay,
  Network,
  RefreshCw,
  Terminal,
  TerminalSquare,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import type {
  ConnectionAuthKind,
  ConnectionCredentialMode,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionProxyKind,
  ConnectionTerminalEncoding,
  CredentialProfile,
  HostKeyInfo,
} from "./connectionTypes";
import {
  defaultAdvancedConfig,
  defaultJumpConfig,
  defaultProxyConfig,
  normalizeTerminalEncoding,
  terminalEncodingOptions,
} from "./connectionTypes";
import {
  parseHostKeyError,
  type ParsedHostKeyError,
} from "./hostKeyErrors";

interface ConnectionDialogProps {
  connection: ConnectionProfile | null;
  connections: ConnectionProfile[];
  credentials: CredentialProfile[];
  defaultGroup?: string | null;
  groups: ConnectionDialogGroup[];
  open: boolean;
  onClose: () => void;
  onDelete: (connection: ConnectionProfile) => Promise<void>;
  onManageCredentials: () => void;
  onSave: (input: ConnectionProfileInput) => Promise<void>;
  onTest: (input: ConnectionProfileInput) => Promise<void>;
  onTrustHostKey: (hostKey: HostKeyInfo) => Promise<void>;
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
type ConnectionTestState = "idle" | "running" | "success" | "error" | "host-key";
type ConnectionNetworkPathMode = "direct" | "proxy" | "ssh_jump";

interface DialogFeedback {
  detail: string;
  hostKey?: HostKeyInfo | null;
  hostKeyDecision?: ParsedHostKeyError["decision"] | null;
  oldHostKeyFingerprint?: string | null;
  title: string;
  rawMessage?: string | null;
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
  jump: defaultJumpConfig,
  proxy: defaultProxyConfig,
  advanced: defaultAdvancedConfig,
  notes: "",
};

export function ConnectionDialog({
  connection,
  connections,
  credentials,
  defaultGroup,
  groups,
  open,
  onClose,
  onDelete,
  onManageCredentials,
  onSave,
  onTest,
  onTrustHostKey,
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
    const validation = validateNetworkPath(form);
    if (validation) {
      setActiveTab("proxy");
      setTestState("error");
      setFeedback(validation);
      return;
    }

    await runAction(async () => {
      await onSave(normalizeForSubmit(form, credentials));
      onClose();
    });
  }

  async function testConnection() {
    if (busyRef.current) {
      return;
    }

    const validation = validateNetworkPath(form);
    if (validation) {
      setActiveTab("proxy");
      setTestState("error");
      setFeedback(validation);
      return;
    }

    await runConnectionTest(normalizeForSubmit(form, credentials));
  }

  async function trustHostKeyAndContinueTest() {
    if (busyRef.current || !feedback?.hostKey) {
      return;
    }

    const input = normalizeForSubmit(form, credentials);
    busyRef.current = true;
    setBusy(true);
    setFeedback({
      detail:
        feedback.hostKeyDecision === "changed"
          ? "正在更新本机保存的主机密钥信任，然后继续测试。"
          : "正在保存本机主机密钥信任，然后继续测试。",
      title: "正在确认主机密钥",
    });
    setTestState("running");

    try {
      await onTrustHostKey(feedback.hostKey);
    } catch (nextError) {
      setTestState("error");
      setFeedback(describeDialogError(nextError));
      busyRef.current = false;
      setBusy(false);
      return;
    }

    busyRef.current = false;
    setBusy(false);
    await runConnectionTest(input);
  }

  async function runConnectionTest(input: ConnectionProfileInput) {
    busyRef.current = true;
    setBusy(true);
    setFeedback({
      detail: "测试会复用当前表单配置，不会打开终端。",
      title: `${formatAddress(input)} 正在检查`,
    });
    setTestState("running");

    try {
      await onTest(input);
      setTestState("success");
      setFeedback({
        detail: "当前配置可以继续保存。",
        title: "连接测试通过",
      });
    } catch (nextError) {
      setActiveTab(tabForError(nextError));
      const hostKeyError = parseHostKeyError(nextError);
      if (hostKeyError) {
        setTestState("host-key");
        setFeedback(describeHostKeyFeedback(hostKeyError));
      } else {
        setTestState("error");
        setFeedback(describeDialogError(nextError));
      }
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

              <div className="protocol-switch" aria-label="连接协议">
                <button className="protocol-chip active" type="button" aria-current="true"><Terminal className="ui-icon" aria-hidden="true" />SSH</button>
                <button className="protocol-chip" type="button" disabled title="即将支持"><Monitor className="ui-icon" aria-hidden="true" />RDP <span className="chip-tag">即将</span></button>
                <button className="protocol-chip" type="button" disabled title="即将支持"><TerminalSquare className="ui-icon" aria-hidden="true" />Telnet <span className="chip-tag">即将</span></button>
                <button className="protocol-chip" type="button" disabled title="即将支持"><MonitorPlay className="ui-icon" aria-hidden="true" />VNC <span className="chip-tag">即将</span></button>
                <button className="protocol-chip" type="button" disabled title="即将支持"><Network className="ui-icon" aria-hidden="true" />隧道 <span className="chip-tag">即将</span></button>
              </div>

              <nav className="connection-dialog-tabs" aria-label="连接配置页签">
                {[
                  ["basic", "基本"],
                  ["proxy", "网络路径"],
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
                <div
                  className={`conn-feedback ${testState}`}
                  role={testState === "error" || testState === "host-key" ? "alert" : "status"}
                >
                  <span className="fb-icon" aria-hidden="true">
                    {testState === "running" ? (
                      <Loader2 className="ui-icon spin" />
                    ) : testState === "success" ? (
                      <CheckCircle2 className="ui-icon" />
                    ) : (
                      <AlertTriangle className="ui-icon" />
                    )}
                  </span>
                  <div className="fb-body">
                    <strong className="fb-title">{feedback.title}</strong>
                    <span className="fb-detail">
                      {feedback.detail}
                      {feedback.rawMessage && testState !== "host-key" ? (
                        <>
                          {" "}
                          原因：<code>{feedback.rawMessage}</code>
                        </>
                      ) : null}
                    </span>
                    {feedback.hostKey ? (
                      <dl className="fb-host-key">
                        <div>
                          <dt>主机</dt>
                          <dd>{feedback.hostKey.host}:{feedback.hostKey.port.toString()}</dd>
                        </div>
                        <div>
                          <dt>算法</dt>
                          <dd>{feedback.hostKey.key_algorithm}</dd>
                        </div>
                        {feedback.oldHostKeyFingerprint ? (
                          <div>
                            <dt>已保存指纹</dt>
                            <dd>{feedback.oldHostKeyFingerprint}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>
                            {feedback.oldHostKeyFingerprint ? "当前指纹" : "SHA256 指纹"}
                          </dt>
                          <dd>{feedback.hostKey.fingerprint_sha256}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {testState === "error" ? (
                      <div className="fb-actions">
                        <button
                          className="fb-primary"
                          type="button"
                          disabled={busy}
                          onClick={testConnection}
                        >
                          <RefreshCw className="ui-icon" aria-hidden="true" />
                          <span>重试</span>
                        </button>
                      </div>
                    ) : null}
                    {testState === "host-key" ? (
                      <div className="fb-actions">
                        <button
                          className="fb-primary"
                          type="button"
                          disabled={busy}
                          onClick={trustHostKeyAndContinueTest}
                        >
                          <RefreshCw className="ui-icon" aria-hidden="true" />
                          <span>
                            {feedback.hostKeyDecision === "changed"
                              ? "更新信任并继续测试"
                              : "信任并继续测试"}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
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
    const showGroupField = groupOptions.length > 0 || Boolean(form.group?.trim());

    return (
      <div className="connection-dialog-fields">
        {/* 目标：名称/分组、主机/端口 平铺，无分组标题 */}
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

        {/* 登录账号 */}
        {credentialMode === "inline" ? (
          <>
            {/* 账号来源 + 认证方式 并排 */}
            <div className="form-grid form-grid-wide">
              <label>
                <span>账号来源</span>
                <select
                  value={credentialMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      credential_mode: event.target.value as ConnectionCredentialMode,
                    })
                  }
                >
                  <option value="saved">使用保存的账号</option>
                  <option value="inline">在此连接中保存</option>
                  <option value="prompt">每次询问</option>
                </select>
              </label>
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
            </div>

            {/* 用户名 + 密码 并排（密码模式）；用户名单行（私钥模式） */}
            {inlineAuthKind === "password" ? (
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
              </div>
            ) : (
              <label>
                <span>用户名</span>
                <input
                  required
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  placeholder="root"
                />
              </label>
            )}

            {/* 私钥字段（仅私钥模式） */}
            {inlineAuthKind === "private_key" ? (
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
            ) : null}
          </>
        ) : null}

        {credentialMode === "saved" ? (
          <>
            <label>
              <span>账号来源</span>
              <select
                value={credentialMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    credential_mode: event.target.value as ConnectionCredentialMode,
                  })
                }
              >
                <option value="saved">使用保存的账号</option>
                <option value="inline">在此连接中保存</option>
                <option value="prompt">每次询问</option>
              </select>
            </label>
            <div className="credential-select-row">
              <label>
                <span>选择账号</span>
                <select
                  value={form.credential_id || ""}
                  onChange={(event) => setForm({ ...form, credential_id: event.target.value })}
                >
                  <option value="">选择账号</option>
                  {credentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.name}
                      {credential.username ? `（${credential.username}）` : ""}
                      · {credential.kind === "password" ? "密码" : "私钥"}
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
          </>
        ) : null}

        {credentialMode === "prompt" ? (
          <>
            <label>
              <span>账号来源</span>
              <select
                value={credentialMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    credential_mode: event.target.value as ConnectionCredentialMode,
                  })
                }
              >
                <option value="saved">使用保存的账号</option>
                <option value="inline">在此连接中保存</option>
                <option value="prompt">每次询问</option>
              </select>
            </label>
            <p className="connection-dialog-note">
              连接时弹出密码或私钥输入，不在本机保存认证材料。
            </p>
          </>
        ) : null}

        {/* 备注 */}
        <label>
          <span>说明</span>
          <textarea
            rows={3}
            value={form.notes || ""}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="可记录用途、环境、连接注意事项。"
          />
        </label>
      </div>
    );
  }

  function renderProxyTab() {
    const proxy = form.proxy || defaultProxyConfig;
    const jump = form.jump || defaultJumpConfig;
    const networkPathMode: ConnectionNetworkPathMode =
      jump.kind === "ssh_jump" ? "ssh_jump" : proxy.kind === "none" ? "direct" : "proxy";
    const jumpCandidates = connections.filter((item) => item.id !== connection?.id);

    return (
      <section className="dialog-section dialog-section-last">
        <div className="dialog-section-title">网络路径</div>

        <label>
          <span>连接方式</span>
          <select
            value={networkPathMode}
            onChange={(event) => {
              const mode = event.target.value as ConnectionNetworkPathMode;
              setForm({
                ...form,
                proxy:
                  mode === "proxy"
                    ? {
                        ...defaultProxyConfig,
                        kind: "http_connect",
                      }
                    : defaultProxyConfig,
                jump:
                  mode === "ssh_jump"
                    ? {
                        kind: "ssh_jump",
                        jump_connection_id: jumpCandidates[0]?.id || "",
                      }
                    : defaultJumpConfig,
              });
            }}
          >
            <option value="direct">直连</option>
            <option value="proxy">网络代理</option>
            <option value="ssh_jump">SSH 跳板机</option>
          </select>
        </label>

        {networkPathMode === "proxy" ? (
          <>
            <label>
              <span>代理类型</span>
              <select
                value={proxy.kind === "none" ? "http_connect" : proxy.kind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    proxy: {
                      ...defaultProxyConfig,
                      kind: event.target.value as ConnectionProxyKind,
                    },
                    jump: defaultJumpConfig,
                  })
                }
              >
                <option value="http_connect">HTTP CONNECT</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </label>

            <div className="form-grid">
              <label>
                <span>代理主机</span>
                <input
                  value={proxy.host || ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      proxy: { ...proxy, host: event.target.value },
                      jump: defaultJumpConfig,
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
                      jump: defaultJumpConfig,
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
                      jump: defaultJumpConfig,
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
                        jump: defaultJumpConfig,
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
        ) : null}

        {networkPathMode === "ssh_jump" ? (
          <>
            <label>
              <span>跳板机连接</span>
              <select
                value={jump.jump_connection_id || ""}
                disabled={jumpCandidates.length === 0}
                onChange={(event) =>
                  setForm({
                    ...form,
                    proxy: defaultProxyConfig,
                    jump: {
                      kind: "ssh_jump",
                      jump_connection_id: event.target.value,
                    },
                  })
                }
              >
                <option value="">选择跳板机</option>
                {jumpCandidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.username}@{item.host}:{item.port.toString()}
                  </option>
                ))}
              </select>
            </label>
            <p className="connection-dialog-note">
              当前仅保存跳板机连接引用。
            </p>
          </>
        ) : null}

        {networkPathMode === "direct" ? (
          <p className="connection-dialog-note">当前连接将直接访问 SSH 主机。</p>
        ) : null}
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
        <div className="form-grid form-grid-wide">
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
          <label>
            <span>终端显示编码</span>
            <select
              value={normalizeTerminalEncoding(advanced.terminal_encoding)}
              onChange={(event) =>
                setForm({
                  ...form,
                  advanced: {
                    ...advanced,
                    terminal_encoding: event.target.value as ConnectionTerminalEncoding,
                  },
                })
              }
            >
              {terminalEncodingOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
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
    jump: connection.jump || defaultJumpConfig,
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
    remote_os_id: connection.remote_os_id || "",
    remote_os_name: connection.remote_os_name || "",
    remote_os_version: connection.remote_os_version || "",
  };
}

function normalizeForSubmit(
  form: ConnectionProfileInput,
  credentials: CredentialProfile[],
): ConnectionProfileInput {
  const jump = form.jump || defaultJumpConfig;
  const proxy = form.proxy || defaultProxyConfig;
  const savedUsername =
    form.credential_mode === "saved" && form.credential_id
      ? credentials.find((credential) => credential.id === form.credential_id)?.username || ""
      : "";

  return {
    ...form,
    // saved 模式：用户名从所选账号回填，保证连接快照完整且后端校验通过
    username: form.credential_mode === "saved" ? savedUsername : form.username,
    port: Number(form.port) || 22,
    proxy:
      jump.kind === "ssh_jump" || proxy.kind === "none"
        ? { kind: "none" }
        : {
            ...proxy,
            port: Number(proxy.port) || undefined,
          },
    jump:
      jump.kind === "ssh_jump"
        ? {
            kind: "ssh_jump",
            jump_connection_id: jump.jump_connection_id?.trim() || "",
          }
        : { kind: "none" },
    advanced: {
      auth_timeout_ms:
        Number(form.advanced.auth_timeout_ms) || defaultAdvancedConfig.auth_timeout_ms,
      connect_timeout_ms:
        Number(form.advanced.connect_timeout_ms) ||
        defaultAdvancedConfig.connect_timeout_ms,
      keepalive_interval_ms:
        Number(form.advanced.keepalive_interval_ms) ||
        defaultAdvancedConfig.keepalive_interval_ms,
      terminal_encoding: normalizeTerminalEncoding(form.advanced.terminal_encoding),
    },
  };
}

function validateNetworkPath(form: ConnectionProfileInput): DialogFeedback | null {
  if (form.jump?.kind !== "ssh_jump" || form.jump.jump_connection_id?.trim()) {
    return null;
  }

  return {
    detail: "SSH 跳板机模式需要选择一条已保存连接。",
    title: "请选择跳板机连接",
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
    code === "connection_keepalive_invalid" ||
    code === "connection_terminal_encoding_invalid"
  ) {
    return "advanced";
  }
  return "basic";
}

function describeHostKeyFeedback(error: ParsedHostKeyError): DialogFeedback {
  if (error.decision === "changed") {
    return {
      detail: "检测到主机 SSH 指纹已变化。若非预期的重装或换密钥，请谨慎处理。",
      hostKey: error.hostKey,
      hostKeyDecision: error.decision,
      oldHostKeyFingerprint: error.oldFingerprint,
      title: "主机密钥已变化，连接已阻断",
    };
  }

  return {
    detail: "首次连接该主机，需要确认主机密钥。核对指纹无误后再信任并继续测试。",
    hostKey: error.hostKey,
    hostKeyDecision: error.decision,
    oldHostKeyFingerprint: null,
    title: "首次连接该主机，需要确认主机密钥",
  };
}

function describeDialogError(error: unknown): DialogFeedback {
  const code = errorCode(error);
  const rawMessage = errorRawMessage(error);
  const raw = rawMessage.toLowerCase();

  if (isTimeoutError(code, raw)) {
    return {
      title: "连接超时",
      detail: "在限定时间内无法连接到目标主机，请检查 IP、端口、防火墙、代理或网络连通性。",
      rawMessage,
    };
  }

  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return {
      title: "端口无法连接",
      detail: "目标主机拒绝了连接，请确认 SSH 服务已启动、端口正确，或安全组允许访问。",
      rawMessage,
    };
  }

  if (raw.includes("no route") || raw.includes("unreachable")) {
    return {
      title: "主机不可达",
      detail: "本机到目标主机没有可用路由，请检查 VPN、网段、网关或代理配置。",
      rawMessage,
    };
  }

  if (code.includes("auth") || raw.includes("auth")) {
    return {
      title: "认证失败",
      detail: "请检查账号的用户名、密码或私钥是否匹配服务器配置。",
      rawMessage,
    };
  }

  if (code.startsWith("proxy_") || code.includes("proxy")) {
    return {
      title: "代理连接失败",
      detail: "请检查代理类型、代理地址端口以及代理用户名密码。",
      rawMessage,
    };
  }

  return {
    title: formatError(error),
    detail: rawMessage || "请根据提示调整配置后重试。",
    rawMessage,
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
