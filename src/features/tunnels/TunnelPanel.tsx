import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { ConnectionAuthKind, ConnectionProfile } from "../connections/connectionTypes";
import { parseHostKeyError, type ParsedHostKeyError } from "../connections/hostKeyErrors";
import {
  knownHostTrust,
  tunnelDelete,
  tunnelList,
  tunnelStart,
  tunnelStop,
  tunnelUpsert,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { AppSelect } from "../../shared/ui/AppSelect";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import type {
  TunnelRule,
  TunnelRuleInput,
  TunnelRuleWithState,
  TunnelRuntimeCredentialInput,
  TunnelStatus,
} from "./tunnelTypes";

interface TunnelPanelProps {
  activeConnectionId?: string | null;
  connections: ConnectionProfile[];
}

interface TunnelFormState {
  autoStart: boolean;
  connectionId: string;
  id?: string;
  localHost: string;
  localPort: string;
  name: string;
  remoteHost: string;
  remotePort: string;
}

interface CredentialPromptState {
  authKind: ConnectionAuthKind;
  error?: string | null;
  password: string;
  privateKeyPassphrase: string;
  privateKeyPath: string;
  rule: TunnelRule;
  submitting: boolean;
}

interface HostKeyPromptState {
  credential?: TunnelRuntimeCredentialInput;
  error?: string | null;
  parsed: ParsedHostKeyError;
  rule: TunnelRule;
  submitting: boolean;
}

const authKindOptions: Array<{ label: string; value: ConnectionAuthKind }> = [
  { label: "密码", value: "password" },
  { label: "私钥", value: "private_key" },
];

const localKindOptions = [{ label: "本地转发", value: "local" }];

export function TunnelPanel({ activeConnectionId = null, connections }: TunnelPanelProps) {
  const [items, setItems] = useState<TunnelRuleWithState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [form, setForm] = useState<TunnelFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TunnelRule | null>(null);
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPromptState | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptState | null>(null);

  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const connectionOptions = useMemo(
    () =>
      connections.length
        ? connections.map((connection) => ({
            label: connection.name || `${connection.host}:${connection.port.toString()}`,
            value: connection.id,
          }))
        : [{ disabled: true, label: "暂无连接", value: "" }],
    [connections],
  );
  const sortedItems = useMemo(() => [...items].sort(compareTunnelItems), [items]);
  const runningCount = items.filter((item) => item.state.status === "running").length;
  const credentialRequiredCount = items.filter(
    (item) => item.state.status === "credential_required",
  ).length;

  useEffect(() => {
    void loadTunnels();
  }, []);

  async function loadTunnels() {
    setLoading(true);
    setError(null);
    setUnavailableReason(null);
    try {
      if (!hasTauriRuntime()) {
        setItems(previewTunnelItems(connections[0]?.id || "preview-connection"));
        return;
      }
      const nextItems = await tunnelList();
      setItems(nextItems);
    } catch (nextError) {
      if (isTauriCommandMissingError(nextError, "tunnel_list")) {
        setItems([]);
        setUnavailableReason("刚更新隧道功能后需要重启应用，重启后这里会加载隧道规则。");
        return;
      }
      setError(formatError(nextError));
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    const connectionId = activeConnectionId || connections[0]?.id || "";
    setForm({
      autoStart: false,
      connectionId,
      localHost: "127.0.0.1",
      localPort: "15432",
      name: "",
      remoteHost: "127.0.0.1",
      remotePort: "5432",
    });
    setFormError(null);
  }

  function openEditForm(rule: TunnelRule) {
    setForm({
      autoStart: rule.auto_start,
      connectionId: rule.connection_id,
      id: rule.id,
      localHost: rule.local_host,
      localPort: rule.local_port.toString(),
      name: rule.name,
      remoteHost: rule.remote_host,
      remotePort: rule.remote_port.toString(),
    });
    setFormError(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }

    let input: TunnelRuleInput;
    try {
      input = formToInput(form);
    } catch (nextError) {
      setFormError(formatError(nextError));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const saved = hasTauriRuntime()
        ? await tunnelUpsert(input)
        : previewSavedTunnel(input, connections[0]?.id || "preview-connection");
      upsertItem(saved);
      setForm(null);
    } catch (nextError) {
      setFormError(formatError(nextError));
    } finally {
      setSaving(false);
    }
  }

  async function startRule(rule: TunnelRule, credential?: TunnelRuntimeCredentialInput) {
    setBusyRuleId(rule.id);
    setError(null);
    try {
      const started = hasTauriRuntime()
        ? await tunnelStart(rule.id, credential)
        : previewWithStatus(rule, "running");
      upsertItem(started);
      setCredentialPrompt(null);
      setHostKeyPrompt(null);
    } catch (nextError) {
      const hostKeyError = parseHostKeyError(nextError);
      if (hostKeyError) {
        setHostKeyPrompt({
          credential,
          parsed: hostKeyError,
          rule,
          submitting: false,
        });
        return;
      }
      if (isCredentialPromptError(nextError)) {
        const connection = connectionById.get(rule.connection_id);
        setCredentialPrompt({
          authKind: connection?.prompt_auth_kind || "password",
          password: "",
          privateKeyPassphrase: "",
          privateKeyPath: "",
          rule,
          submitting: false,
        });
        void loadTunnels();
        return;
      }
      setError(formatError(nextError));
      void loadTunnels();
    } finally {
      setBusyRuleId(null);
    }
  }

  async function stopRule(rule: TunnelRule) {
    setBusyRuleId(rule.id);
    setError(null);
    try {
      const stopped = hasTauriRuntime()
        ? await tunnelStop(rule.id)
        : previewWithStatus(rule, "stopped");
      upsertItem(stopped);
    } catch (nextError) {
      setError(formatError(nextError));
      void loadTunnels();
    } finally {
      setBusyRuleId(null);
    }
  }

  async function confirmDeleteRule() {
    if (!deleteTarget) {
      return;
    }
    const rule = deleteTarget;
    setError(null);
    try {
      if (hasTauriRuntime()) {
        await tunnelDelete(rule.id);
      }
      setItems((current) => current.filter((item) => item.rule.id !== rule.id));
    } catch (nextError) {
      setError(formatError(nextError));
      void loadTunnels();
    } finally {
      setDeleteTarget(null);
    }
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credentialPrompt) {
      return;
    }
    const credential = credentialPromptToInput(credentialPrompt);
    if (!credential) {
      setCredentialPrompt({ ...credentialPrompt, error: "请填写密码或私钥路径。" });
      return;
    }
    setCredentialPrompt({ ...credentialPrompt, error: null, submitting: true });
    await startRule(credentialPrompt.rule, credential);
  }

  async function trustHostKeyAndRetry() {
    if (!hostKeyPrompt) {
      return;
    }
    setHostKeyPrompt({ ...hostKeyPrompt, error: null, submitting: true });
    try {
      await knownHostTrust(hostKeyPrompt.parsed.hostKey);
      await startRule(hostKeyPrompt.rule, hostKeyPrompt.credential);
    } catch (nextError) {
      setHostKeyPrompt({
        ...hostKeyPrompt,
        error: formatError(nextError),
        submitting: false,
      });
    }
  }

  function upsertItem(item: TunnelRuleWithState) {
    setItems((current) => {
      const index = current.findIndex((existing) => existing.rule.id === item.rule.id);
      if (index < 0) {
        return [...current, item];
      }
      const next = [...current];
      next[index] = item;
      return next;
    });
  }

  return (
    <div className="tunnel-tool-body">
      <section className="tunnel-panel" aria-label="SSH 隧道">
        <header className="tunnel-panel-head">
          <span>
            <strong>隧道</strong>
            <small>
              运行 {runningCount.toString()} 个
              {credentialRequiredCount > 0 ? ` · ${credentialRequiredCount.toString()} 个需要凭据` : ""}
            </small>
          </span>
          <div className="tunnel-head-actions">
            <Tooltip label="刷新隧道">
              <button className="mini-action" type="button" aria-label="刷新隧道" onClick={() => void loadTunnels()}>
                <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
              </button>
            </Tooltip>
            <button
              className="tunnel-primary-button"
              type="button"
              disabled={connections.length === 0 || Boolean(unavailableReason)}
              onClick={openCreateForm}
            >
              <Plus className="ui-icon" aria-hidden="true" />
              新建
            </button>
          </div>
        </header>

        {error ? <p className="tunnel-inline-error">{error}</p> : null}

        <div className="tunnel-list">
          {sortedItems.length === 0 ? (
            <div className="tunnel-empty">
              <Network className="ui-icon" aria-hidden="true" />
              <strong>{unavailableReason ? "隧道功能需要重启后启用" : connections.length ? "还没有隧道规则" : "暂无可用 SSH 连接"}</strong>
              <small>{unavailableReason || (connections.length ? "新建本地端口转发后，可以从本机访问远端内网服务。" : "先创建 SSH 连接后再配置端口转发。")}</small>
              {connections.length && !unavailableReason ? (
                <button type="button" onClick={openCreateForm}>
                  <Plus className="ui-icon" aria-hidden="true" />
                  新建规则
                </button>
              ) : null}
            </div>
          ) : (
            sortedItems.map((item) => {
              const rule = item.rule;
              const state = item.state;
              const connection = connectionById.get(rule.connection_id);
              const busy = busyRuleId === rule.id || state.status === "starting";
              const running = state.status === "running";
              return (
                <article className={`tunnel-item ${state.status}`} key={rule.id}>
                  <header>
                    <span className="tunnel-item-title">
                      <Network className="ui-icon" aria-hidden="true" />
                      <strong title={rule.name}>{rule.name}</strong>
                    </span>
                    <span className={`tunnel-status ${state.status}`}>{tunnelStatusLabel(state.status)}</span>
                  </header>
                  <div className="tunnel-route">
                    <code>{rule.local_host}:{rule.local_port.toString()}</code>
                    <span aria-hidden="true">→</span>
                    <code>{rule.remote_host}:{rule.remote_port.toString()}</code>
                  </div>
                  <div className="tunnel-meta">
                    <span>{connection?.name || "连接不存在"}</span>
                    {rule.auto_start ? <em>自动启动</em> : null}
                    {state.active_connections > 0 ? <em>{state.active_connections.toString()} 路连接</em> : null}
                  </div>
                  {state.last_error ? <p className="tunnel-item-error">{state.last_error}</p> : null}
                  <footer>
                    {running ? (
                      <button type="button" disabled={busy} onClick={() => void stopRule(rule)}>
                        <Square className="ui-icon" aria-hidden="true" />
                        停止
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void startRule(rule)}>
                        {busy ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : <Play className="ui-icon" aria-hidden="true" />}
                        启动
                      </button>
                    )}
                    <Tooltip label={running ? "请先停止隧道" : "编辑规则"}>
                      <button className="tunnel-icon-button" type="button" disabled={running || busy} aria-label="编辑规则" onClick={() => openEditForm(rule)}>
                        <Pencil className="ui-icon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip label="删除规则">
                      <button className="tunnel-icon-button danger" type="button" disabled={busy} aria-label="删除规则" onClick={() => setDeleteTarget(rule)}>
                        <Trash2 className="ui-icon" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </footer>
                </article>
              );
            })
          )}
        </div>
      </section>

      <TunnelRuleDialog
        connectionOptions={connectionOptions}
        form={form}
        formError={formError}
        saving={saving}
        onChange={setForm}
        onClose={() => setForm(null)}
        onSubmit={submitForm}
      />
      <CredentialPromptDialog
        prompt={credentialPrompt}
        onAuthKindChange={(authKind) => credentialPrompt && setCredentialPrompt({ ...credentialPrompt, authKind })}
        onChange={setCredentialPrompt}
        onClose={() => setCredentialPrompt(null)}
        onSubmit={submitCredential}
      />
      <HostKeyPromptDialog
        prompt={hostKeyPrompt}
        onClose={() => setHostKeyPrompt(null)}
        onTrust={() => void trustHostKeyAndRetry()}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除隧道规则"
        description={deleteTarget ? `确认删除“${deleteTarget.name}”吗？运行中的隧道会先停止。` : ""}
        confirmLabel="删除"
        onConfirm={confirmDeleteRule}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}

function TunnelRuleDialog({
  connectionOptions,
  form,
  formError,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  connectionOptions: Array<{ disabled?: boolean; label: string; value: string }>;
  form: TunnelFormState | null;
  formError: string | null;
  saving: boolean;
  onChange: (form: TunnelFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog.Root open={Boolean(form)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        {form ? (
          <Dialog.Content className="tunnel-dialog">
            <form onSubmit={onSubmit}>
              <header className="dialog-head">
                <span className="dialog-title-group">
                  <Dialog.Title>{form.id ? "编辑隧道" : "新建隧道"}</Dialog.Title>
                  <Dialog.Description className="dialog-subtitle">本地端口转发到远端网络目标</Dialog.Description>
                </span>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>
              <div className="dialog-body tunnel-dialog-body">
                <label>
                  <span>名称</span>
                  <input value={form.name} placeholder="例如：远端 PostgreSQL" onChange={(event) => onChange({ ...form, name: event.currentTarget.value })} />
                </label>
                <label>
                  <span>类型</span>
                  <AppSelect ariaLabel="隧道类型" value="local" options={localKindOptions} onChange={() => undefined} />
                </label>
                <label>
                  <span>SSH 连接</span>
                  <AppSelect ariaLabel="SSH 连接" value={form.connectionId} options={connectionOptions} onChange={(connectionId) => onChange({ ...form, connectionId })} />
                </label>
                <div className="tunnel-form-grid">
                  <label>
                    <span>本地监听地址</span>
                    <input value={form.localHost} onChange={(event) => onChange({ ...form, localHost: event.currentTarget.value })} />
                  </label>
                  <label>
                    <span>本地端口</span>
                    <input inputMode="numeric" value={form.localPort} onChange={(event) => onChange({ ...form, localPort: event.currentTarget.value })} />
                  </label>
                </div>
                <div className="tunnel-form-grid">
                  <label>
                    <span>远端目标地址</span>
                    <input value={form.remoteHost} onChange={(event) => onChange({ ...form, remoteHost: event.currentTarget.value })} />
                  </label>
                  <label>
                    <span>远端端口</span>
                    <input inputMode="numeric" value={form.remotePort} onChange={(event) => onChange({ ...form, remotePort: event.currentTarget.value })} />
                  </label>
                </div>
                <label className="tunnel-check-row">
                  <input type="checkbox" checked={form.autoStart} onChange={(event) => onChange({ ...form, autoStart: event.currentTarget.checked })} />
                  <span>
                    <strong>应用启动后自动启动</strong>
                    <small>prompt 凭据连接会标记为需要手动输入。</small>
                  </span>
                </label>
                {formError ? <p className="remote-file-dialog-error">{formError}</p> : null}
              </div>
              <footer className="dialog-actions tunnel-dialog-actions">
                <span />
                <Dialog.Close asChild>
                  <button type="button" disabled={saving}>取消</button>
                </Dialog.Close>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : null}
                  保存
                </button>
              </footer>
            </form>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CredentialPromptDialog({
  prompt,
  onAuthKindChange,
  onChange,
  onClose,
  onSubmit,
}: {
  prompt: CredentialPromptState | null;
  onAuthKindChange: (authKind: ConnectionAuthKind) => void;
  onChange: (prompt: CredentialPromptState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog.Root open={Boolean(prompt)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        {prompt ? (
          <Dialog.Content className="tunnel-dialog tunnel-credential-dialog">
            <form onSubmit={onSubmit}>
              <header className="dialog-head">
                <span className="dialog-title-group">
                  <Dialog.Title>输入本次凭据</Dialog.Title>
                  <Dialog.Description className="dialog-subtitle">{prompt.rule.name} 不会保存这些内容</Dialog.Description>
                </span>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>
              <div className="dialog-body tunnel-dialog-body">
                <div className="tunnel-dialog-icon-head">
                  <KeyRound className="ui-icon" aria-hidden="true" />
                  <span>该连接使用 prompt 凭据模式。</span>
                </div>
                <label>
                  <span>认证方式</span>
                  <AppSelect ariaLabel="认证方式" value={prompt.authKind} options={authKindOptions} onChange={onAuthKindChange} />
                </label>
                {prompt.authKind === "password" ? (
                  <label>
                    <span>密码</span>
                    <input type="password" value={prompt.password} onChange={(event) => onChange({ ...prompt, password: event.currentTarget.value })} />
                  </label>
                ) : (
                  <>
                    <label>
                      <span>私钥路径</span>
                      <input value={prompt.privateKeyPath} placeholder="~/.ssh/id_ed25519" onChange={(event) => onChange({ ...prompt, privateKeyPath: event.currentTarget.value })} />
                    </label>
                    <label>
                      <span>私钥口令</span>
                      <input type="password" value={prompt.privateKeyPassphrase} onChange={(event) => onChange({ ...prompt, privateKeyPassphrase: event.currentTarget.value })} />
                    </label>
                  </>
                )}
                {prompt.error ? <p className="remote-file-dialog-error">{prompt.error}</p> : null}
              </div>
              <footer className="dialog-actions tunnel-dialog-actions">
                <span />
                <Dialog.Close asChild>
                  <button type="button" disabled={prompt.submitting}>取消</button>
                </Dialog.Close>
                <button className="primary-button" type="submit" disabled={prompt.submitting}>
                  {prompt.submitting ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : null}
                  继续启动
                </button>
              </footer>
            </form>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HostKeyPromptDialog({
  prompt,
  onClose,
  onTrust,
}: {
  prompt: HostKeyPromptState | null;
  onClose: () => void;
  onTrust: () => void;
}) {
  return (
    <Dialog.Root open={Boolean(prompt)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        {prompt ? (
          <Dialog.Content className="tunnel-dialog tunnel-host-key-dialog">
            <header className="dialog-head">
              <span className="dialog-title-group">
                <Dialog.Title>确认主机密钥</Dialog.Title>
                <Dialog.Description className="dialog-subtitle">{prompt.parsed.decision === "changed" ? "主机密钥已变化" : prompt.parsed.hostKey.key_algorithm}</Dialog.Description>
              </span>
              <Dialog.Close asChild>
                <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </header>
            <div className="dialog-body tunnel-dialog-body">
              <div className="tunnel-dialog-icon-head warning">
                <LockKeyhole className="ui-icon" aria-hidden="true" />
                <span>信任后会重试启动该隧道。</span>
              </div>
              {prompt.parsed.oldFingerprint ? <code>旧指纹：{prompt.parsed.oldFingerprint}</code> : null}
              <code>{prompt.parsed.hostKey.fingerprint_sha256}</code>
              {prompt.error ? <p className="remote-file-dialog-error">{prompt.error}</p> : null}
            </div>
            <footer className="dialog-actions tunnel-dialog-actions">
              <span />
              <Dialog.Close asChild>
                <button type="button" disabled={prompt.submitting}>取消</button>
              </Dialog.Close>
              <button className="primary-button" type="button" disabled={prompt.submitting} onClick={onTrust}>
                {prompt.submitting ? <Loader2 className="ui-icon spin" aria-hidden="true" /> : <CheckCircle2 className="ui-icon" aria-hidden="true" />}
                信任并继续
              </button>
            </footer>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formToInput(form: TunnelFormState): TunnelRuleInput {
  const localPort = parsePort(form.localPort, "本地端口无效。");
  const remotePort = parsePort(form.remotePort, "远端端口无效。");
  if (!form.connectionId.trim()) {
    throw new Error("请选择 SSH 连接。");
  }
  if (!form.localHost.trim()) {
    throw new Error("请填写本地监听地址。");
  }
  if (!form.remoteHost.trim()) {
    throw new Error("请填写远端目标地址。");
  }
  return {
    auto_start: form.autoStart,
    connection_id: form.connectionId.trim(),
    id: form.id,
    kind: "local",
    local_host: form.localHost.trim(),
    local_port: localPort,
    name: form.name.trim() || undefined,
    remote_host: form.remoteHost.trim(),
    remote_port: remotePort,
  };
}

function parsePort(value: string, message: string) {
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(message);
  }
  return port;
}

function credentialPromptToInput(prompt: CredentialPromptState): TunnelRuntimeCredentialInput | null {
  if (prompt.authKind === "password") {
    return prompt.password.trim()
      ? {
          auth_kind: "password",
          password: prompt.password,
        }
      : null;
  }
  return prompt.privateKeyPath.trim()
    ? {
        auth_kind: "private_key",
        private_key_passphrase: prompt.privateKeyPassphrase || undefined,
        private_key_path: prompt.privateKeyPath.trim(),
      }
    : null;
}

function compareTunnelItems(left: TunnelRuleWithState, right: TunnelRuleWithState) {
  const statusDelta = statusPriority(right.state.status) - statusPriority(left.state.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return left.rule.name.localeCompare(right.rule.name, "zh-Hans-CN");
}

function statusPriority(status: TunnelStatus) {
  const priorities: Record<TunnelStatus, number> = {
    credential_required: 3,
    failed: 4,
    running: 5,
    starting: 6,
    stopped: 1,
  };
  return priorities[status];
}

function tunnelStatusLabel(status: TunnelStatus) {
  const labels: Record<TunnelStatus, string> = {
    credential_required: "需要凭据",
    failed: "失败",
    running: "运行中",
    starting: "启动中",
    stopped: "已停止",
  };
  return labels[status];
}

function isCredentialPromptError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code) === "credential_prompt_required"
  );
}

function isTauriCommandMissingError(error: unknown, commandName: string) {
  const message = formatError(error).toLowerCase();
  const normalizedCommandName = commandName.toLowerCase();
  const singleQuote = String.fromCharCode(39);
  return (
    message.includes(`command ${normalizedCommandName} not found`) ||
    message.includes(`command ${singleQuote}${normalizedCommandName}${singleQuote} not found`) ||
    message.includes(`command "${normalizedCommandName}" not found`)
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function previewTunnelItems(connectionId: string): TunnelRuleWithState[] {
  const rule: TunnelRule = {
    auto_start: false,
    connection_id: connectionId,
    created_at: "preview",
    id: "preview-tunnel",
    kind: "local",
    local_host: "127.0.0.1",
    local_port: 15432,
    name: "预览数据库隧道",
    remote_host: "127.0.0.1",
    remote_port: 5432,
    updated_at: "preview",
  };
  return [previewWithStatus(rule, "stopped")];
}

function previewSavedTunnel(input: TunnelRuleInput, fallbackConnectionId: string): TunnelRuleWithState {
  const rule: TunnelRule = {
    auto_start: input.auto_start,
    connection_id: input.connection_id || fallbackConnectionId,
    created_at: "preview",
    id: input.id || `preview-${Date.now().toString()}`,
    kind: "local",
    local_host: input.local_host,
    local_port: input.local_port,
    name: input.name || `${input.local_host}:${input.local_port.toString()} -> ${input.remote_host}:${input.remote_port.toString()}`,
    remote_host: input.remote_host,
    remote_port: input.remote_port,
    updated_at: "preview",
  };
  return previewWithStatus(rule, "stopped");
}

function previewWithStatus(rule: TunnelRule, status: TunnelStatus): TunnelRuleWithState {
  return {
    rule,
    state: {
      active_connections: status === "running" ? 1 : 0,
      bound_host: status === "running" ? rule.local_host : null,
      bound_port: status === "running" ? rule.local_port : null,
      last_error: null,
      last_error_code: null,
      rule_id: rule.id,
      started_at: status === "running" ? "preview" : null,
      status,
    },
  };
}
