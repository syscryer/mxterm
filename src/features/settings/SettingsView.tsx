import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileKey,
  Folder,
  FolderOpen,
  KeyRound,
  Layers,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Server,
  Settings,
  Sun,
  Terminal,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";

import { AppSelect } from "../../shared/ui/AppSelect";
import { Tooltip } from "../../shared/ui/Tooltip";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { selectLocalDownloadDirectory } from "../../shared/tauri/dialog";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type {
  ConnectionAuthKind,
  CredentialProfile,
  CredentialProfileInput,
} from "../connections/connectionTypes";
import {
  getTerminalAnsiSwatches,
  getTerminalColorSchemeTone,
  terminalColorSchemes,
  type TerminalColorScheme,
  type TerminalColorSchemeTone,
} from "./terminalColorSchemes";
import {
  accentColorPresets,
  defaultSettings,
  type FileTransferConflictPolicy,
  type FileTransferSettings,
  type FileTransferTimestampFormat,
  normalizeFontFamilyInput,
  normalizeHexColor,
  terminalFontPresets,
  type AccentColor,
  type AppearanceSettings,
  type BasicSettings,
  type FontSettingMode,
  type MxtermSettings,
  type SettingsSectionId,
  type TerminalThemeSettings,
  type TerminalFontPreset,
  type UiFontPreset,
  type WindowMaterialMode,
  uiFontPresets,
} from "./settingsTypes";
import { getWindowMaterialLabel } from "../../shared/tauri/windowMaterial";
import {
  SegmentedControl,
  SettingsRow,
  SettingsToggle,
  Stepper,
} from "./SettingsControls";

interface SettingsViewProps {
  credentials: CredentialProfile[];
  credentialError?: string | null;
  credentialLoading?: boolean;
  effectiveWindowMaterial: WindowMaterialMode;
  hidden?: boolean;
  settings: MxtermSettings;
  activeSection?: SettingsSectionId;
  supportedWindowMaterials: WindowMaterialMode[];
  onReset: () => void;
  onReturnWorkspace: () => void;
  onSaveCredential: (input: CredentialProfileInput) => Promise<void>;
  onDeleteCredential: (credential: CredentialProfile) => Promise<void>;
  onUpdateAppearance: (update: Partial<AppearanceSettings>) => void;
  onUpdateBasic: (update: Partial<BasicSettings>) => void;
  onUpdateFileTransfer: (update: Partial<FileTransferSettings>) => void;
  onUpdateTerminalTheme: (update: Partial<TerminalThemeSettings>) => void;
}

const settingsSections: Array<{
  description: string;
  icon: typeof Settings;
  id: SettingsSectionId;
  label: string;
}> = [
  { id: "basic", label: "基础设置", description: "启动、连接与面板行为", icon: Settings },
  { id: "credentials", label: "账号管理", description: "复用登录账号（用户名+密码/私钥）", icon: Shield },
  { id: "appearance", label: "外观", description: "字号、密度与强调色", icon: Palette },
  { id: "terminalTheme", label: "终端配色", description: "终端 ANSI 主题方案", icon: Terminal },
];

const credentialKindOptions: Array<{
  label: string;
  value: ConnectionAuthKind;
}> = [
  { label: "密码", value: "password" },
  { label: "私钥", value: "private_key" },
];

export function SettingsView({
  credentials,
  credentialError,
  credentialLoading = false,
  effectiveWindowMaterial,
  hidden = false,
  settings,
  activeSection: requestedActiveSection,
  supportedWindowMaterials,
  onReset,
  onReturnWorkspace,
  onSaveCredential,
  onDeleteCredential,
  onUpdateAppearance,
  onUpdateBasic,
  onUpdateFileTransfer,
  onUpdateTerminalTheme,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("basic");
  const [accentDraft, setAccentDraft] = useState(settings.appearance.accentColorCustom);
  const selectedScheme = useMemo(
    () =>
      terminalColorSchemes.find((scheme) => scheme.id === settings.terminalTheme.scheme) ||
      terminalColorSchemes[0],
    [settings.terminalTheme.scheme],
  );

  useEffect(() => {
    setAccentDraft(settings.appearance.accentColorCustom);
  }, [settings.appearance.accentColorCustom]);

  useEffect(() => {
    if (requestedActiveSection) {
      setActiveSection(requestedActiveSection);
    }
  }, [requestedActiveSection]);

  return (
    <section className="settings-view" hidden={hidden} aria-label="设置" aria-hidden={hidden}>
      <aside className="settings-sidebar app-sidebar" aria-label="设置分类">
        <button className="settings-return" type="button" onClick={onReturnWorkspace}>
          <ArrowLeft className="ui-icon" aria-hidden="true" />
          <span>返回工作区</span>
        </button>

        <nav className="settings-nav" aria-label="设置导航">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                className={`settings-nav-item ${activeSection === section.id ? "active" : ""}`}
                key={section.id}
                type="button"
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon className="ui-icon" aria-hidden="true" />
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="settings-sidebar-foot">设置会自动保存到本机。</div>
      </aside>

      <div className="settings-content">
        {activeSection === "basic" ? (
          <BasicSettingsSection
            fileTransferSettings={settings.fileTransfer}
            settings={settings.basic}
            onUpdate={onUpdateBasic}
            onUpdateFileTransfer={onUpdateFileTransfer}
          />
        ) : null}
        {activeSection === "appearance" ? (
          <AppearanceSettingsSection
            accentDraft={accentDraft}
            effectiveWindowMaterial={effectiveWindowMaterial}
            settings={settings.appearance}
            supportedWindowMaterials={supportedWindowMaterials}
            onAccentDraftChange={setAccentDraft}
            onReset={onReset}
            onUpdate={onUpdateAppearance}
          />
        ) : null}
        {activeSection === "credentials" ? (
          <CredentialSettingsSection
            credentials={credentials}
            error={credentialError || null}
            loading={credentialLoading}
            onDelete={onDeleteCredential}
            onSave={onSaveCredential}
          />
        ) : null}
        {activeSection === "terminalTheme" ? (
          <TerminalThemeSettingsSection
            selectedScheme={selectedScheme}
            settings={settings.terminalTheme}
            onUpdate={onUpdateTerminalTheme}
          />
        ) : null}
      </div>
    </section>
  );
}

function CredentialSettingsSection({
  credentials,
  error,
  loading,
  onDelete,
  onSave,
}: {
  credentials: CredentialProfile[];
  error: string | null;
  loading: boolean;
  onDelete: (credential: CredentialProfile) => Promise<void>;
  onSave: (input: CredentialProfileInput) => Promise<void>;
}) {
  const [editing, setEditing] = useState<CredentialProfile | null>(null);
  const [form, setForm] = useState<CredentialProfileInput>(emptyCredentialForm());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CredentialProfile | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | ConnectionAuthKind>("all");
  const [query, setQuery] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const passwordCount = credentials.filter((credential) => credential.kind === "password").length;
  const privateKeyCount = credentials.length - passwordCount;
  const filteredCredentials = useMemo(
    () =>
      credentials.filter((credential) => {
        const matchesKind = kindFilter === "all" || credential.kind === kindFilter;
        const keyword = query.trim().toLowerCase();
        const matchesQuery =
          !keyword ||
          credential.name.toLowerCase().includes(keyword) ||
          (credential.notes || "").toLowerCase().includes(keyword);
        return matchesKind && matchesQuery;
      }),
    [credentials, kindFilter, query],
  );
  const editingKindLabel = form.kind === "private_key" ? "私钥" : "密码";

  function startCreate(kind: ConnectionAuthKind = "password") {
    setEditing(null);
    setForm(emptyCredentialForm(kind));
    setFormError(null);
    setShowSecret(false);
    setShowPassphrase(false);
  }

  function startEdit(credential: CredentialProfile) {
    setEditing(credential);
    setForm({
      id: credential.id,
      kind: credential.kind,
      name: credential.name,
      username: credential.username || "",
      notes: credential.notes || "",
      password: credential.password || "",
      private_key_passphrase: credential.private_key_passphrase || "",
      private_key_path: credential.private_key_path || "",
    });
    setFormError(null);
    setShowSecret(false);
    setShowPassphrase(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await onSave(form);
      startCreate(form.kind);
    } catch (nextError) {
      setFormError(formatError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onDelete(deleteTarget);
      if (editing?.id === deleteTarget.id) {
        startCreate(deleteTarget.kind);
      }
      setDeleteTarget(null);
    } catch (nextError) {
      setFormError(formatError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-page-section credential-page-section">
      <header className="settings-section-head settings-section-head-row">
        <span>
          <h1>账号管理</h1>
          <p>保存可复用的登录账号（用户名 + 密码或私钥），连接时直接引用。</p>
        </span>
        <button
          className="repository-primary-button credential-new-button"
          type="button"
          onClick={() => startCreate()}
        >
          <Plus className="ui-icon" aria-hidden="true" />
          <span>新增账号</span>
        </button>
      </header>

      <div className="credential-settings-layout">
        <section className="settings-panel credential-list-panel" aria-label="账号列表">
          <header className="credential-list-head">
            <span>
              <strong>账号库</strong>
              <small>{credentialSummary(credentials.length, passwordCount, privateKeyCount)}</small>
            </span>
            <button
              className="repository-icon-button"
              type="button"
              aria-label="新增私钥账号"
              onClick={() => startCreate("private_key")}
            >
              <FileKey className="ui-icon" aria-hidden="true" />
            </button>
          </header>

          <div className="credential-list-tools">
            <label className="credential-search">
              <Search className="ui-icon" aria-hidden="true" />
              <input
                value={query}
                placeholder="搜索账号"
                aria-label="搜索账号"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <SegmentedControl
              value={kindFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "password", label: "密码" },
                { value: "private_key", label: "私钥" },
              ]}
              onChange={setKindFilter}
            />
          </div>

          <div className="credential-list-body">
            {loading ? <p className="settings-note">加载账号中...</p> : null}
            {error ? <p className="form-error credential-list-error">{error}</p> : null}
            {credentials.length === 0 && !loading ? (
              <div className="credential-empty-state">
                <ShieldCheck className="ui-icon" aria-hidden="true" />
                <strong>还没有保存账号</strong>
                <small>先添加一个账号（用户名 + 密码或私钥），连接配置里可以直接引用。</small>
                <div>
                  <button type="button" onClick={() => startCreate("password")}>
                    新建密码账号
                  </button>
                  <button type="button" onClick={() => startCreate("private_key")}>
                    新建私钥账号
                  </button>
                </div>
              </div>
            ) : null}
            {credentials.length > 0 && filteredCredentials.length === 0 ? (
              <p className="settings-note">没有匹配的账号。</p>
            ) : null}
            {filteredCredentials.map((credential) => {
              const Icon = credential.kind === "private_key" ? FileKey : KeyRound;
              return (
                <button
                  className={`credential-list-item ${
                    editing?.id === credential.id ? "active" : ""
                  }`}
                  key={credential.id}
                  type="button"
                  onClick={() => startEdit(credential)}
                >
                  <span className="credential-list-icon">
                    <Icon className="ui-icon" aria-hidden="true" />
                  </span>
                  <span className="credential-list-copy">
                    <strong>{credential.name}</strong>
                    <small>
                      {credential.username || "未设置用户名"}
                      {` · ${credential.kind === "private_key" ? "私钥" : "密码"}`}
                      {credential.notes ? ` · ${credential.notes}` : ""}
                    </small>
                  </span>
                  <span className="credential-list-kind">
                    {credential.kind === "private_key" ? "私钥" : "密码"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <form className="settings-panel credential-form-panel" onSubmit={submit}>
          <header className="credential-form-head">
            <span className="credential-form-icon">
              {form.kind === "private_key" ? (
                <FileKey className="ui-icon" aria-hidden="true" />
              ) : (
                <KeyRound className="ui-icon" aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{editing ? "编辑账号" : `新增${editingKindLabel}账号`}</strong>
              <small>账号包含用户名和认证材料，不包含主机、端口。</small>
            </span>
          </header>

          <div className="credential-form-body">
            <label className="credential-field credential-field-name">
              <span>名称</span>
              <input
                className="settings-input"
                value={form.name || ""}
                placeholder="例如：生产只读账号"
                aria-label="账号名称"
                onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
              />
            </label>
            <label className="credential-field credential-field-kind">
              <span>类型</span>
              <AppSelect
                ariaLabel="账号认证类型"
                className="settings-select"
                value={form.kind}
                options={credentialKindOptions}
                onChange={(kind) => {
                  setForm(emptyCredentialForm(kind, form));
                  setShowSecret(false);
                  setShowPassphrase(false);
                }}
              />
            </label>

            <label className="credential-field credential-field-full">
              <span>用户名</span>
              <input
                className="settings-input"
                value={form.username || ""}
                placeholder="例如：root、deploy"
                aria-label="账号用户名"
                onChange={(event) => setForm({ ...form, username: event.currentTarget.value })}
              />
            </label>

            {form.kind === "password" ? (
              <label className="credential-field credential-field-full">
                <span>密码</span>
                <div className="credential-secret-field">
                  <LockKeyhole className="ui-icon" aria-hidden="true" />
                  <input
                    type={showSecret ? "text" : "password"}
                    value={form.password || ""}
                    placeholder="输入密码"
                    aria-label="密码"
                    onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                  />
                  <button
                    type="button"
                    aria-label={showSecret ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowSecret((value) => !value)}
                  >
                    {showSecret ? (
                      <EyeOff className="ui-icon" aria-hidden="true" />
                    ) : (
                      <Eye className="ui-icon" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            ) : (
              <>
                <label className="credential-field credential-field-full">
                  <span>私钥路径</span>
                  <input
                    className="settings-input settings-path-input"
                    value={form.private_key_path || ""}
                    placeholder="~/.ssh/id_ed25519"
                    aria-label="私钥路径"
                    onChange={(event) =>
                      setForm({ ...form, private_key_path: event.currentTarget.value })
                    }
                  />
                </label>
                <label className="credential-field credential-field-full">
                  <span>私钥口令</span>
                  <div className="credential-secret-field">
                    <LockKeyhole className="ui-icon" aria-hidden="true" />
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={form.private_key_passphrase || ""}
                      placeholder="可选"
                      aria-label="私钥口令"
                      onChange={(event) =>
                        setForm({
                          ...form,
                          private_key_passphrase: event.currentTarget.value,
                        })
                      }
                    />
                    <button
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

            <label className="credential-field credential-field-full">
              <span>备注</span>
              <textarea
                className="settings-input credential-notes-input"
                value={form.notes || ""}
                placeholder="可选，用于本机识别和检索。"
                aria-label="凭据备注"
                onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })}
              />
            </label>
          </div>

          {formError ? <p className="form-error credential-form-error">{formError}</p> : null}

          <footer className="credential-form-actions">
            <div>
              {editing ? (
                <button
                  className="danger-button credential-danger-button"
                  disabled={busy}
                  type="button"
                  onClick={() => setDeleteTarget(editing)}
                >
                  <Trash2 className="ui-icon" aria-hidden="true" />
                  删除
                </button>
              ) : null}
            </div>
            <div>
              <button disabled={busy} type="button" onClick={() => startCreate(form.kind)}>
                清空
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                <ShieldCheck className="ui-icon" aria-hidden="true" />
                保存账号
              </button>
            </div>
          </footer>
        </form>
      </div>

      <ConfirmDialog
        confirmLabel="删除"
        description={
          deleteTarget
            ? `确认删除账号“${deleteTarget.name}”吗？如果已有连接正在使用它，请先修改这些连接后再删除。`
            : ""
        }
        open={Boolean(deleteTarget)}
        title="删除账号"
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </section>
  );
}

function emptyCredentialForm(
  kind: ConnectionAuthKind = "password",
  base?: CredentialProfileInput,
): CredentialProfileInput {
  return {
    id: base?.id,
    kind,
    name: base?.name || "",
    username: base?.username || "",
    notes: base?.notes || "",
    password: kind === "password" ? base?.password || "" : "",
    private_key_passphrase:
      kind === "private_key" ? base?.private_key_passphrase || "" : "",
    private_key_path: kind === "private_key" ? base?.private_key_path || "" : "",
  };
}

function credentialSummary(total: number, passwordCount: number, privateKeyCount: number) {
  if (total === 0) {
    return "0 项账号";
  }
  return `${total.toString()} 项 · ${passwordCount.toString()} 密码 · ${privateKeyCount.toString()} 私钥`;
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}

function BasicSettingsSection({
  fileTransferSettings,
  settings,
  onUpdate,
  onUpdateFileTransfer,
}: {
  fileTransferSettings: FileTransferSettings;
  settings: BasicSettings;
  onUpdate: (update: Partial<BasicSettings>) => void;
  onUpdateFileTransfer: (update: Partial<FileTransferSettings>) => void;
}) {
  const [downloadRootError, setDownloadRootError] = useState<string | null>(null);
  const hasCustomDownloadRoot = fileTransferSettings.downloadRoot.trim().length > 0;

  async function chooseDownloadRoot() {
    if (!hasTauriRuntime()) {
      return;
    }
    setDownloadRootError(null);
    try {
      const selectedPath = await selectLocalDownloadDirectory();
      if (selectedPath) {
        onUpdateFileTransfer({ downloadRoot: selectedPath });
      }
    } catch (error) {
      setDownloadRootError(error instanceof Error ? error.message : "无法打开目录选择器");
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>基础设置</h1>
        <p>控制 mXterm 启动、连接失败和文件面板跟随行为。</p>
      </header>

      <div className="settings-panel">
        <SettingsRow
          icon={RotateCcw}
          title="启动时恢复布局"
          description="重新打开应用后恢复上次的工作区布局。"
        >
          <SettingsToggle
            checked={settings.restoreWorkspaceOnLaunch}
            label="启动时恢复布局"
            onChange={(restoreWorkspaceOnLaunch) => onUpdate({ restoreWorkspaceOnLaunch })}
          />
        </SettingsRow>
        <SettingsRow
          icon={Terminal}
          title="自动打开上次终端"
          description="启动时回到上次活动连接和终端标签。"
        >
          <SettingsToggle
            checked={settings.reopenLastTerminal}
            label="自动打开上次终端"
            onChange={(reopenLastTerminal) => onUpdate({ reopenLastTerminal })}
          />
        </SettingsRow>
        <SettingsRow
          icon={Server}
          title="保留失败页"
          description="连接失败时保留当前会话页，方便查看原因、重试或编辑连接。"
        >
          <SettingsToggle
            checked={settings.keepFailedTerminalTabs}
            label="保留失败页"
            onChange={(keepFailedTerminalTabs) => onUpdate({ keepFailedTerminalTabs })}
          />
        </SettingsRow>
        <SettingsRow
          icon={Folder}
          title="文件面板跟随连接"
          description="切换活动连接时，右侧文件面板跟随当前会话。"
        >
          <SettingsToggle
            checked={settings.filePanelFollowsActiveConnection}
            label="文件面板跟随连接"
            onChange={(filePanelFollowsActiveConnection) =>
              onUpdate({ filePanelFollowsActiveConnection })
            }
          />
        </SettingsRow>
      </div>

      <div className="settings-panel">
        <SettingsRow
          icon={Download}
          title="下载根目录"
          description={
            hasCustomDownloadRoot
              ? "使用自定义本地根目录，可随时恢复系统默认。"
              : "未设置时使用系统 Downloads，可选择自定义目录。"
          }
        >
          <div className="settings-path-control">
            <div className="settings-path-picker">
              <input
                className="settings-input settings-path-input"
                value={fileTransferSettings.downloadRoot}
                placeholder="使用系统 Downloads"
                spellCheck={false}
                aria-label="下载根目录"
                onChange={(event) => {
                  setDownloadRootError(null);
                  onUpdateFileTransfer({ downloadRoot: event.currentTarget.value });
                }}
              />
              <button
                className="settings-action-button settings-path-button"
                type="button"
                disabled={!hasTauriRuntime()}
                title={hasTauriRuntime() ? "选择下载目录" : "桌面模式可选择目录"}
                onClick={() => void chooseDownloadRoot()}
              >
                <FolderOpen className="ui-icon" aria-hidden="true" />
                <span>选择</span>
              </button>
              <button
                className="settings-action-button settings-path-button"
                type="button"
                disabled={!hasCustomDownloadRoot}
                title="恢复系统 Downloads"
                onClick={() => {
                  setDownloadRootError(null);
                  onUpdateFileTransfer({ downloadRoot: "" });
                }}
              >
                <X className="ui-icon" aria-hidden="true" />
                <span>默认</span>
              </button>
            </div>
            {downloadRootError ? <small className="settings-path-error">{downloadRootError}</small> : null}
          </div>
        </SettingsRow>
        <SettingsRow
          icon={Folder}
          title="按连接分组"
          description="下载到 <连接名称>/<时间戳> 子目录。"
        >
          <SettingsToggle
            checked={fileTransferSettings.groupBySession}
            label="按连接分组"
            onChange={(groupBySession) => onUpdateFileTransfer({ groupBySession })}
          />
        </SettingsRow>
        <SettingsRow
          icon={Clock3}
          title="时间戳目录"
          description="每轮下载放入独立时间戳目录。"
        >
          <SettingsToggle
            checked={fileTransferSettings.timestampDirectory}
            label="时间戳目录"
            onChange={(timestampDirectory) => onUpdateFileTransfer({ timestampDirectory })}
          />
        </SettingsRow>
        <SettingsRow icon={Clock3} title="时间戳格式" description="用于默认下载目录命名。">
          <SegmentedControl<FileTransferTimestampFormat>
            value={fileTransferSettings.timestampFormat}
            options={[
              { value: "yyyyMMddHHmm", label: "紧凑" },
              { value: "yyyyMMdd-HHmm", label: "短横" },
              { value: "yyyy-MM-dd-HHmm", label: "日期" },
            ]}
            onChange={(timestampFormat) => onUpdateFileTransfer({ timestampFormat })}
          />
        </SettingsRow>
        <SettingsRow icon={Save} title="保留压缩包" description="目录上传/下载后保留中间 tar.gz。">
          <SettingsToggle
            checked={fileTransferSettings.keepArchives}
            label="保留压缩包"
            onChange={(keepArchives) => onUpdateFileTransfer({ keepArchives })}
          />
        </SettingsRow>
        <SettingsRow icon={Rows3} title="同名冲突" description="上传/下载遇到同名目标时的默认策略。">
          <SegmentedControl<FileTransferConflictPolicy>
            value={fileTransferSettings.conflictPolicyDefault}
            options={[
              { value: "ask", label: "询问" },
              { value: "rename", label: "重命名" },
              { value: "overwrite", label: "覆盖" },
              { value: "skip", label: "跳过" },
            ]}
            onChange={(conflictPolicyDefault) =>
              onUpdateFileTransfer({ conflictPolicyDefault })
            }
          />
        </SettingsRow>
      </div>
    </section>
  );
}

function AppearanceSettingsSection({
  accentDraft,
  effectiveWindowMaterial,
  settings,
  supportedWindowMaterials,
  onAccentDraftChange,
  onReset,
  onUpdate,
}: {
  accentDraft: string;
  effectiveWindowMaterial: WindowMaterialMode;
  settings: AppearanceSettings;
  supportedWindowMaterials: WindowMaterialMode[];
  onAccentDraftChange: (value: string) => void;
  onReset: () => void;
  onUpdate: (update: Partial<AppearanceSettings>) => void;
}) {
  const [uiFontDraft, setUiFontDraft] = useState(settings.uiFontCustom);
  const [terminalFontDraft, setTerminalFontDraft] = useState(settings.terminalFontCustom);
  const windowMaterialDescription =
    supportedWindowMaterials.length > 1
      ? "选择窗口背景材质；不支持的平台会自动回退。"
      : "当前平台仅支持默认窗口背景。";

  useEffect(() => {
    setUiFontDraft(settings.uiFontCustom);
  }, [settings.uiFontCustom]);

  useEffect(() => {
    setTerminalFontDraft(settings.terminalFontCustom);
  }, [settings.terminalFontCustom]);

  function commitCustomAccent(value: string) {
    const nextColor = normalizeHexColor(value, defaultSettings.appearance.accentColorCustom);
    onAccentDraftChange(nextColor);
    onUpdate({
      accentColor: "custom",
      accentColorCustom: nextColor,
    });
  }

  function commitUiFontFamily(value: string) {
    const nextValue = normalizeFontFamilyInput(
      value,
      defaultSettings.appearance.uiFontCustom,
    );
    setUiFontDraft(nextValue);
    onUpdate({ uiFontCustom: nextValue });
  }

  function commitTerminalFontFamily(value: string) {
    const nextValue = normalizeFontFamilyInput(
      value,
      defaultSettings.appearance.terminalFontCustom,
    );
    setTerminalFontDraft(nextValue);
    onUpdate({ terminalFontCustom: nextValue });
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>外观</h1>
        <p>调整 mXterm 的工具密度、强调色、字号和面板细节。</p>
      </header>

      <div className="appearance-preview" aria-hidden="true">
        <div className="appearance-preview-sidebar">
          <span className="appearance-preview-accent" />
          <span />
          <span />
          <span className="short" />
        </div>
        <div className="appearance-preview-main">
          <div className="appearance-preview-toolbar">
            <span>mXterm 预览</span>
            <i />
          </div>
          <div className="appearance-preview-workbench">
            <div className="appearance-preview-terminal">
              <code>$ ssh prod-core</code>
              <code>connected to 10.0.2.16</code>
              <code>~/apps/mxterm $</code>
            </div>
            <div className="appearance-preview-files">
              <span>src</span>
              <span>logs</span>
              <span>deploy.sh</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-panel">
        <SettingsRow icon={Monitor} title="主题模式" description="浅色、深色和系统主题会同步应用到整个工作区。">
          <SegmentedControl
            value={settings.themeMode}
            options={[
              { value: "system", label: "系统", icon: Monitor },
              { value: "light", label: "浅色", icon: Sun },
              { value: "dark", label: "深色", icon: Moon },
            ]}
            onChange={(themeMode) => onUpdate({ themeMode })}
          />
        </SettingsRow>

        <SettingsRow icon={Layers} title="窗口材质" description={windowMaterialDescription}>
          <SegmentedControl<WindowMaterialMode>
            value={effectiveWindowMaterial}
            options={supportedWindowMaterials.map((material) => ({
              value: material,
              label: getWindowMaterialLabel(material),
            }))}
            onChange={(windowMaterial) => onUpdate({ windowMaterial })}
          />
        </SettingsRow>

        <SettingsRow icon={Palette} title="强调色" description="用于选中态、关键按钮和焦点高亮。">
          <div className="settings-accent-picker">
            {accentColorPresets.map((preset) => (
              <button
                className={settings.accentColor === preset.value ? "active" : ""}
                key={preset.value}
                type="button"
                aria-label={`选择${preset.label}色`}
                title={preset.label}
                onClick={() => onUpdate({ accentColor: preset.value })}
              >
                <span
                  className="settings-accent-swatch"
                  style={{ "--settings-accent-swatch": preset.light } as CSSProperties}
                />
                <span>{preset.label}</span>
              </button>
            ))}
            <label
              className={`settings-accent-custom ${
                settings.accentColor === "custom" ? "active" : ""
              }`}
              title="自定义强调色"
            >
              <input
                type="color"
                value={normalizeHexColor(accentDraft, defaultSettings.appearance.accentColorCustom)}
                aria-label="选择自定义强调色"
                onChange={(event) => commitCustomAccent(event.target.value)}
              />
              <span
                className="settings-accent-swatch"
                style={{
                  "--settings-accent-swatch": normalizeHexColor(
                    accentDraft,
                    defaultSettings.appearance.accentColorCustom,
                  ),
                } as CSSProperties}
              />
              <span>自选</span>
            </label>
            <input
              className="settings-input settings-accent-value-input"
              value={accentDraft}
              maxLength={7}
              spellCheck={false}
              aria-label="自定义强调色值"
              onFocus={() => {
                if (settings.accentColor !== "custom") {
                  onUpdate({ accentColor: "custom" as AccentColor });
                }
              }}
              onChange={(event) => onAccentDraftChange(event.target.value)}
              onBlur={() => commitCustomAccent(accentDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCustomAccent(accentDraft);
                }
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow icon={Rows3} title="界面密度" description="影响连接树、文件树、工具栏和设置行距。">
          <SegmentedControl
            value={settings.density}
            options={[
              { value: "comfortable", label: "舒适" },
              { value: "compact", label: "紧凑" },
            ]}
            onChange={(density) => onUpdate({ density })}
          />
        </SettingsRow>

        <SettingsRow icon={Type} title="界面字体" description="用于菜单、侧栏、按钮和设置页。">
          <FontFamilyControl<UiFontPreset>
            modeValue={settings.uiFontMode}
            onModeChange={(uiFontMode) => onUpdate({ uiFontMode })}
            presetValue={settings.uiFontPreset}
            presetOptions={uiFontPresets}
            onPresetChange={(uiFontPreset) => onUpdate({ uiFontPreset })}
            customValue={uiFontDraft}
            customPlaceholder={'例如 "Microsoft YaHei UI", "Segoe UI", sans-serif'}
            onCustomChange={setUiFontDraft}
            onCustomCommit={() => commitUiFontFamily(uiFontDraft)}
          />
        </SettingsRow>

        <SettingsRow icon={Terminal} title="终端字体" description="用于 xterm 会话、预览和等宽文本。">
          <FontFamilyControl<TerminalFontPreset>
            modeValue={settings.terminalFontMode}
            onModeChange={(terminalFontMode) => onUpdate({ terminalFontMode })}
            presetValue={settings.terminalFontPreset}
            presetOptions={terminalFontPresets}
            onPresetChange={(terminalFontPreset) => onUpdate({ terminalFontPreset })}
            customValue={terminalFontDraft}
            customPlaceholder={'例如 "JetBrains Mono", "Cascadia Mono", Consolas, monospace'}
            onCustomChange={setTerminalFontDraft}
            onCustomCommit={() => commitTerminalFontFamily(terminalFontDraft)}
          />
        </SettingsRow>

        <SettingsRow icon={Type} title="UI 字号" description="调整菜单、侧栏、按钮和设置页文字。">
          <Stepper
            value={settings.uiFontSize}
            values={[12, 13, 14, 15] as const}
            onChange={(uiFontSize) => onUpdate({ uiFontSize })}
          />
        </SettingsRow>

        <SettingsRow icon={Terminal} title="终端字号" description="调整 xterm 会话字号并自动重新适配尺寸。">
          <Stepper
            value={settings.terminalFontSize}
            values={[12, 13, 14, 15, 16] as const}
            onChange={(terminalFontSize) => onUpdate({ terminalFontSize })}
          />
        </SettingsRow>

        <SettingsRow icon={PanelLeft} title="图标大小" description="影响连接树、文件树和工具按钮图标。">
          <SegmentedControl
            value={settings.iconSize}
            options={[
              { value: "small", label: "小" },
              { value: "medium", label: "中" },
              { value: "large", label: "大" },
            ]}
            onChange={(iconSize) => onUpdate({ iconSize })}
          />
        </SettingsRow>

        <SettingsRow icon={PanelLeft} title="记住面板宽度" description="保留左侧连接仓库和右侧文件面板拖拽宽度。">
          <SettingsToggle
            checked={settings.rememberPaneWidths}
            label="记住面板宽度"
            onChange={(rememberPaneWidths) => onUpdate({ rememberPaneWidths })}
          />
        </SettingsRow>

        <SettingsRow icon={RotateCcw} title="恢复默认外观" description="恢复字号、字体、密度、强调色和终端配色默认值。">
          <button className="settings-action-button" type="button" onClick={onReset}>
            <RotateCcw className="ui-icon" aria-hidden="true" />
            <span>重置</span>
          </button>
        </SettingsRow>
      </div>
    </section>
  );
}

function FontFamilyControl<TPreset extends string>({
  modeValue,
  onModeChange,
  presetValue,
  presetOptions,
  onPresetChange,
  customValue,
  customPlaceholder,
  onCustomChange,
  onCustomCommit,
}: {
  modeValue: FontSettingMode;
  onModeChange: (value: FontSettingMode) => void;
  presetValue: TPreset;
  presetOptions: ReadonlyArray<{ label: string; value: TPreset }>;
  onPresetChange: (value: TPreset) => void;
  customValue: string;
  customPlaceholder: string;
  onCustomChange: (value: string) => void;
  onCustomCommit: () => void;
}) {
  return (
    <div className="settings-font-control">
      <div className="settings-font-main">
        <SegmentedControl
          value={modeValue}
          options={[
            { value: "preset", label: "预设" },
            { value: "custom", label: "自定义" },
          ]}
          onChange={onModeChange}
        />
        {modeValue === "custom" ? (
          <input
            className="settings-input settings-font-custom-input"
            value={customValue}
            placeholder={customPlaceholder}
            title="支持直接输入字体名，或输入完整 font-family 栈。"
            aria-label="自定义字体"
            spellCheck={false}
            onChange={(event) => onCustomChange(event.currentTarget.value)}
            onBlur={onCustomCommit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCustomCommit();
              }
            }}
          />
        ) : (
          <AppSelect
            ariaLabel="选择字体预设"
            className="settings-select"
            value={presetValue}
            options={presetOptions.map((preset) => ({
              label: preset.label,
              value: preset.value,
            }))}
            onChange={onPresetChange}
          />
        )}
      </div>
    </div>
  );
}

function TerminalThemeSettingsSection({
  selectedScheme,
  settings,
  onUpdate,
}: {
  selectedScheme: TerminalColorScheme;
  settings: TerminalThemeSettings;
  onUpdate: (update: Partial<TerminalThemeSettings>) => void;
}) {
  const [terminalSchemeQuery, setTerminalSchemeQuery] = useState("");
  const [terminalSchemeTone, setTerminalSchemeTone] =
    useState<"all" | TerminalColorSchemeTone>("all");
  const filteredTerminalColorSchemes = useMemo(() => {
    const query = terminalSchemeQuery.trim().toLowerCase();

    return terminalColorSchemes.filter((scheme) => {
      const matchesQuery =
        !query ||
        [scheme.name, scheme.id, scheme.source].some((value) =>
          value.toLowerCase().includes(query),
        );
      const matchesTone =
        terminalSchemeTone === "all" ||
        getTerminalColorSchemeTone(scheme) === terminalSchemeTone;

      return matchesQuery && matchesTone;
    });
  }, [terminalSchemeQuery, terminalSchemeTone]);

  const SCHEME_PAGE_SIZE = 60;
  const [visibleSchemeCount, setVisibleSchemeCount] = useState(SCHEME_PAGE_SIZE);
  const schemeListRef = useRef<HTMLDivElement | null>(null);
  const schemeSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleSchemeCount(SCHEME_PAGE_SIZE);
  }, [terminalSchemeQuery, terminalSchemeTone]);

  useEffect(() => {
    const total = filteredTerminalColorSchemes.length;
    if (visibleSchemeCount >= total) return;
    const node = schemeSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleSchemeCount((prev) => Math.min(prev + SCHEME_PAGE_SIZE, total));
        }
      },
      { root: schemeListRef.current?.closest(".settings-content") ?? null, rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleSchemeCount, filteredTerminalColorSchemes.length]);

  return (
    <section className="settings-page-section terminal-theme-section">
      <header className="settings-section-head settings-section-head-row">
        <span>
          <h1>终端配色</h1>
          <p>选择终端 surface 的 ANSI 配色方案，不改变整个应用主题。</p>
        </span>
        <Tooltip label="自定义方案后续接入">
          <button className="settings-action-button" type="button" disabled>
            <Plus className="ui-icon" aria-hidden="true" />
            <span>新增</span>
          </button>
        </Tooltip>
      </header>

      <div className="terminal-scheme-toolbar">
        <div className="terminal-scheme-tools">
          <label className="terminal-scheme-search">
            <Search className="ui-icon" aria-hidden="true" />
            <input
              type="search"
              value={terminalSchemeQuery}
              aria-label="搜索终端配色方案"
              placeholder="搜索配色方案"
              onChange={(event) => setTerminalSchemeQuery(event.currentTarget.value)}
            />
          </label>
          <SegmentedControl
            value={terminalSchemeTone}
            options={[
              { value: "all", label: "全部" },
              { value: "dark", label: "暗色", icon: Moon },
              { value: "light", label: "亮色", icon: Sun },
            ]}
            onChange={setTerminalSchemeTone}
          />
        </div>
        <span className="terminal-scheme-count">
          {filteredTerminalColorSchemes.length} / {terminalColorSchemes.length}
        </span>
      </div>

      <div ref={schemeListRef} className="terminal-scheme-list" aria-label="终端配色方案">
        {filteredTerminalColorSchemes.length > 0 ? (
          <>
            {filteredTerminalColorSchemes.slice(0, visibleSchemeCount).map((scheme) => (
            <button
              className={`terminal-scheme-card ${
                settings.scheme === scheme.id ? "active" : ""
              }`}
              key={scheme.id}
              type="button"
              aria-pressed={settings.scheme === scheme.id}
              onClick={() => onUpdate({ scheme: scheme.id })}
              style={{
                "--terminal-scheme-bg": scheme.theme.background,
                "--terminal-scheme-fg": scheme.theme.foreground,
              } as CSSProperties}
            >
              <span className="terminal-scheme-preview">
                <span className="terminal-scheme-prompt">{scheme.name}</span>
                <span className="terminal-scheme-command">$ ls --color</span>
              </span>
              <span className="terminal-scheme-meta">
                <strong>{scheme.name}</strong>
                <small>{scheme.source}</small>
              </span>
              <span className="terminal-scheme-swatches" aria-hidden="true">
                {getTerminalAnsiSwatches(scheme).map((color, index) => (
                  <span
                    key={`${scheme.id}-${color}-${index.toString()}`}
                    style={{ "--terminal-swatch": color } as CSSProperties}
                  />
                ))}
              </span>
              {settings.scheme === scheme.id ? (
                <span className="terminal-scheme-check" aria-hidden="true">
                  <Check className="ui-icon" />
                </span>
              ) : null}
            </button>
          ))}
          {visibleSchemeCount < filteredTerminalColorSchemes.length ? (
            <div ref={schemeSentinelRef} className="terminal-scheme-sentinel" aria-hidden="true" />
          ) : null}
          </>
        ) : (
          <div className="terminal-scheme-empty" role="status">
            未找到匹配的配色方案。
          </div>
        )}
      </div>

      <footer className="terminal-scheme-actions">
        <span>
          当前方案：<strong>{selectedScheme.name}</strong>
        </span>
        <div>
          <button className="settings-action-button" type="button" disabled>
            <Save className="ui-icon" aria-hidden="true" />
            <span>已保存</span>
          </button>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => onUpdate({ scheme: defaultSettings.terminalTheme.scheme })}
          >
            <Undo2 className="ui-icon" aria-hidden="true" />
            <span>放弃更改</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
