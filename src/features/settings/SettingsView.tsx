import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  Clock3,
  Cloud,
  Download,
  Eye,
  EyeOff,
  FileKey,
  Folder,
  FolderOpen,
  HardDrive,
  Keyboard,
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
  Waypoints,
  X,
} from "lucide-react";

import { AppSelect } from "../../shared/ui/AppSelect";
import { Tooltip } from "../../shared/ui/Tooltip";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  selectLocalDownloadDirectory,
  selectLocalPrivateKeyFile,
} from "../../shared/tauri/dialog";
import {
  credentialRevealSecret,
  localTerminalListProfiles,
  mcpExecutablePath,
  mcpSettingsGet,
  mcpSettingsSave,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type {
  ConnectionAuthKind,
  ConnectionProfile,
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
  normalizeLocalTerminalProfileInput,
  terminalFontPresets,
  type AccentColor,
  type AppearanceSettings,
  type BasicSettings,
  type CommandSettings,
  type FontSettingMode,
  type MxtermSettings,
  type SecuritySettings,
  type SettingsSectionId,
  type ShortcutSettings,
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
import type {
  LocalTerminalProfile,
  LocalTerminalProfileInput,
  LocalTerminalSettings,
} from "../terminal/localTerminalTypes";
import { LocalTerminalIcon } from "../terminal/LocalTerminalIcons";
import { WebDavSyncSettingsSection } from "./WebDavSyncSettingsSection";
import { ShortcutSettingsSection } from "./ShortcutSettingsSection";
import { defaultMcpSettings, type McpSettings } from "./mcpSettingsTypes";

interface SettingsViewProps {
  connections: ConnectionProfile[];
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
  secretVaultBusy?: boolean;
  secretVaultError?: string | null;
  onDisableMasterPassword: () => Promise<boolean>;
  onEnableMasterPassword: (masterPassword: string) => Promise<boolean>;
  onUnlockSecuritySettings: (masterPassword: string) => Promise<boolean>;
  onUpdateAppearance: (update: Partial<AppearanceSettings>) => void;
  onUpdateBasic: (update: Partial<BasicSettings>) => void;
  onUpdateCommand: (update: Partial<CommandSettings>) => void;
  onUpdateFileTransfer: (update: Partial<FileTransferSettings>) => void;
  onUpdateLocalTerminal: (update: Partial<LocalTerminalSettings>) => void;
  onUpdateSecurity: (update: Partial<SecuritySettings>) => void;
  onUpdateShortcuts: (update: Partial<ShortcutSettings>) => void;
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
  { id: "mcp", label: "MCP", description: "AI Agent 连接与受控 SSH 工具", icon: Waypoints },
  { id: "security", label: "安全", description: "安全密码与本机保护", icon: ShieldCheck },
  { id: "sync", label: "同步", description: "WebDAV 手动同步", icon: Cloud },
  { id: "shortcuts", label: "快捷键", description: "应用内键盘操作与冲突管理", icon: Keyboard },
  { id: "appearance", label: "外观", description: "字号、密度与强调色", icon: Palette },
  { id: "localTerminal", label: "本地终端", description: "默认 Shell 与 profile 管理", icon: HardDrive },
  { id: "terminalTheme", label: "终端配色", description: "终端 ANSI 主题方案", icon: Terminal },
];

const credentialKindOptions: Array<{
  label: string;
  value: ConnectionAuthKind;
}> = [
  { label: "密码账号", value: "password" },
  { label: "私钥账号", value: "private_key" },
];

export function SettingsView({
  connections,
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
  secretVaultBusy = false,
  secretVaultError = null,
  onDisableMasterPassword,
  onEnableMasterPassword,
  onUnlockSecuritySettings,
  onUpdateAppearance,
  onUpdateBasic,
  onUpdateCommand,
  onUpdateFileTransfer,
  onUpdateLocalTerminal,
  onUpdateSecurity,
  onUpdateShortcuts,
  onUpdateTerminalTheme,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("basic");
  const [accentDraft, setAccentDraft] = useState(settings.appearance.accentColorCustom);
  const effectiveAllowPasswordReveal =
    !settings.security.masterPasswordEnabled || settings.security.allowPasswordReveal;
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
            commandSettings={settings.command}
            fileTransferSettings={settings.fileTransfer}
            settings={settings.basic}
            onUpdate={onUpdateBasic}
            onUpdateCommand={onUpdateCommand}
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
        {activeSection === "localTerminal" ? (
          <LocalTerminalSettingsSection
            settings={settings.localTerminal}
            onUpdate={onUpdateLocalTerminal}
          />
        ) : null}
        {activeSection === "credentials" ? (
          <CredentialSettingsSection
            allowPasswordReveal={effectiveAllowPasswordReveal}
            credentials={credentials}
            error={credentialError || null}
            loading={credentialLoading}
            onDelete={onDeleteCredential}
            onSave={onSaveCredential}
          />
        ) : null}
        {activeSection === "security" ? (
          <SecuritySettingsSection
            busy={secretVaultBusy}
            error={secretVaultError}
            settings={settings.security}
            onDisableMasterPassword={onDisableMasterPassword}
            onEnableMasterPassword={onEnableMasterPassword}
            onUnlockSecuritySettings={onUnlockSecuritySettings}
            onUpdate={onUpdateSecurity}
          />
        ) : null}
        {activeSection === "mcp" ? <McpSettingsSection connections={connections} /> : null}
        {activeSection === "sync" ? <WebDavSyncSettingsSection /> : null}
        {activeSection === "shortcuts" ? (
          <ShortcutSettingsSection
            settings={settings.shortcuts}
            onUpdate={onUpdateShortcuts}
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

function McpSettingsSection({ connections }: { connections: ConnectionProfile[] }) {
  const [settings, setSettings] = useState<McpSettings>(defaultMcpSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const desktopRuntime = hasTauriRuntime();
  const [executablePath, setExecutablePath] = useState("mxterm-mcp.exe");
  const [connectionExposureQuery, setConnectionExposureQuery] = useState("");
  const connectionExposureSearchQuery = connectionExposureQuery.trim();
  const connectionExposureSearchActive = connectionExposureSearchQuery.length > 0;
  const connectionIds = useMemo(
    () => connections.map((connection) => connection.id),
    [connections],
  );
  const filteredConnections = useMemo(() => {
    const query = connectionExposureSearchQuery.toLowerCase();
    if (!query) {
      return connections;
    }
    return connections.filter((connection) =>
      [
        connection.name,
        connection.group,
        connection.host,
        connection.username,
        connection.port.toString(),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [connectionExposureSearchQuery, connections]);
  const filteredConnectionIds = useMemo(
    () => filteredConnections.map((connection) => connection.id),
    [filteredConnections],
  );
  const exposedConnectionIds = useMemo(
    () =>
      settings.connection_exposure_mode === "all"
        ? connectionIds
        : connectionIds.filter((id) => settings.exposed_connection_ids.includes(id)),
    [connectionIds, settings.connection_exposure_mode, settings.exposed_connection_ids],
  );
  const exposedConnectionIdSet = useMemo(
    () => new Set(exposedConnectionIds),
    [exposedConnectionIds],
  );
  const connectionExposureDisabled =
    loading || saving || !desktopRuntime || !settings.enabled || !settings.expose_connections;
  const connectionExposureBatchDisabled =
    connectionExposureDisabled || filteredConnectionIds.length === 0;
  const configSnippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            mxterm: {
              command: executablePath,
              args: [],
            },
          },
        },
        null,
        2,
      ),
    [executablePath],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!desktopRuntime) {
        setSettings(defaultMcpSettings);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const next = await mcpSettingsGet();
        const nextExecutablePath = await mcpExecutablePath().catch(() => executablePath);
        if (!cancelled) {
          setSettings(next);
          setExecutablePath(nextExecutablePath);
          setError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "MCP 设置读取失败。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [desktopRuntime]);

  async function saveUpdate(update: Partial<McpSettings>) {
    if (!desktopRuntime) {
      setError("需要在 mXterm 桌面端保存 MCP 设置。");
      return;
    }
    const previous = settings;
    const next = { ...settings, ...update };
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      setSettings(await mcpSettingsSave(next));
    } catch (error) {
      setSettings(previous);
      setError(error instanceof Error ? error.message : "MCP 设置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function setAllConnectionExposure(exposed: boolean) {
    if (!connectionExposureSearchActive) {
      void saveUpdate(
        exposed
          ? {
              connection_exposure_mode: "all",
              exposed_connection_ids: [],
            }
          : {
              connection_exposure_mode: "custom",
              exposed_connection_ids: [],
            },
      );
      return;
    }

    const nextIds = new Set(exposedConnectionIds);
    for (const connectionId of filteredConnectionIds) {
      if (exposed) {
        nextIds.add(connectionId);
      } else {
        nextIds.delete(connectionId);
      }
    }
    void saveUpdate({
      connection_exposure_mode: "custom",
      exposed_connection_ids: connectionIds.filter((id) => nextIds.has(id)),
    });
  }

  function setConnectionExposure(connectionId: string, exposed: boolean) {
    const nextIds = new Set(exposedConnectionIds);
    if (exposed) {
      nextIds.add(connectionId);
    } else {
      nextIds.delete(connectionId);
    }
    void saveUpdate({
      connection_exposure_mode: "custom",
      exposed_connection_ids: connectionIds.filter((id) => nextIds.has(id)),
    });
  }

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(configSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("无法写入剪贴板，可手动复制下方配置。");
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>MCP</h1>
        <p>把 mXterm 保存的连接提供给本机 AI Agent；SSH 操作必须单独开启。</p>
      </header>

      <div className="settings-panel mcp-settings-panel">
        <SettingsRow
          icon={Waypoints}
          title="启用 mXterm MCP"
          description="默认关闭。关闭时 sidecar 只返回禁用状态，不暴露连接信息。"
        >
          <SettingsToggle
            checked={settings.enabled}
            disabled={loading || saving || !desktopRuntime}
            label="启用 mXterm MCP"
            onChange={(enabled) => void saveUpdate({ enabled })}
          />
        </SettingsRow>

        <SettingsRow
          icon={Server}
          title="暴露连接信息"
          description="只返回脱敏后的连接元数据，不返回密码、私钥口令或 vault 明文。"
        >
          <SettingsToggle
            checked={settings.expose_connections}
            disabled={loading || saving || !desktopRuntime || !settings.enabled}
            label="暴露连接信息"
            onChange={(expose_connections) => void saveUpdate({ expose_connections })}
          />
        </SettingsRow>

        <SettingsRow
          icon={Terminal}
          title="启用 SSH 操作"
          description="允许 Agent 通过已保存 connection_id 测试连接、执行命令和传输文件。"
        >
          <SettingsToggle
            checked={settings.ssh_operations_enabled}
            disabled={loading || saving || !desktopRuntime || !settings.enabled}
            label="启用 SSH 操作"
            onChange={(ssh_operations_enabled) => void saveUpdate({ ssh_operations_enabled })}
          />
        </SettingsRow>

        <SettingsRow
          icon={ShieldCheck}
          title="允许危险命令确认"
          description="关闭时直接拒绝危险命令；开启后仍需要 MCP 工具参数显式确认。"
        >
          <SettingsToggle
            checked={settings.allow_dangerous_commands}
            disabled={
              loading ||
              saving ||
              !desktopRuntime ||
              !settings.enabled ||
              !settings.ssh_operations_enabled
            }
            label="允许危险命令确认"
            onChange={(allow_dangerous_commands) =>
              void saveUpdate({ allow_dangerous_commands })
            }
          />
        </SettingsRow>

        <div className="mcp-config-block">
          <div>
            <strong>stdio client 配置</strong>
            <small>发布包中 sidecar 会随 mXterm 一起提供；开发期可替换为本地绝对路径。</small>
          </div>
          <button
            className="settings-action-button"
            type="button"
            disabled={!desktopRuntime}
            onClick={() => void copyConfig()}
          >
            <Check className="ui-icon" aria-hidden="true" />
            <span>{copied ? "已复制" : "复制配置"}</span>
          </button>
          <pre>{configSnippet}</pre>
        </div>

        {!desktopRuntime ? (
          <p className="settings-note">浏览器预览不能保存 MCP 设置，请在桌面端操作。</p>
        ) : null}
        {error ? (
          <p className="settings-path-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="settings-panel mcp-connection-exposure-panel">
        <div className="mcp-connection-exposure-head">
          <span>
            <strong>MCP 可用连接</strong>
            <small>
              {connectionExposureSearchActive
                ? `匹配 ${filteredConnections.length.toString()} / ${connections.length.toString()}，已开放 ${exposedConnectionIds.length.toString()} 个连接`
                : settings.connection_exposure_mode === "all"
                ? `默认开放全部 ${connections.length.toString()} 个连接`
                : `已开放 ${exposedConnectionIds.length.toString()} / ${connections.length.toString()} 个连接`}
            </small>
          </span>
          <div>
            <button
              className="settings-action-button"
              type="button"
              disabled={connectionExposureBatchDisabled}
              onClick={() => setAllConnectionExposure(true)}
            >
              {connectionExposureSearchActive ? "打开匹配" : "全部打开"}
            </button>
            <button
              className="settings-action-button"
              type="button"
              disabled={connectionExposureBatchDisabled}
              onClick={() => setAllConnectionExposure(false)}
            >
              {connectionExposureSearchActive ? "关闭匹配" : "全部关闭"}
            </button>
          </div>
        </div>
        <div className="mcp-connection-exposure-tools">
          <label className="mcp-connection-search">
            <Search className="ui-icon" aria-hidden="true" />
            <input
              type="search"
              value={connectionExposureQuery}
              placeholder="搜索连接名、主机、用户或分组"
              aria-label="搜索 MCP 可用连接"
              onChange={(event) => setConnectionExposureQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="mcp-connection-exposure-list">
          {connections.length === 0 ? (
            <p className="settings-note">还没有保存连接。</p>
          ) : filteredConnections.length === 0 ? (
            <p className="settings-note">没有匹配的连接。</p>
          ) : (
            filteredConnections.map((connection) => {
              const exposed = exposedConnectionIdSet.has(connection.id);
              return (
                <div className="mcp-connection-exposure-row" key={connection.id}>
                  <span>
                    <strong>{connection.name}</strong>
                    <small>
                      {connection.username}@{connection.host}:{connection.port.toString()}
                    </small>
                  </span>
                  <SettingsToggle
                    checked={exposed}
                    disabled={connectionExposureDisabled}
                    label={`${connection.name} MCP 暴露`}
                    onChange={(nextExposed) =>
                      setConnectionExposure(connection.id, nextExposed)
                    }
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function SecuritySettingsSection({
  busy,
  error,
  settings,
  onDisableMasterPassword,
  onEnableMasterPassword,
  onUnlockSecuritySettings,
  onUpdate,
}: {
  busy: boolean;
  error: string | null;
  settings: SecuritySettings;
  onDisableMasterPassword: () => Promise<boolean>;
  onEnableMasterPassword: (masterPassword: string) => Promise<boolean>;
  onUnlockSecuritySettings: (masterPassword: string) => Promise<boolean>;
  onUpdate: (update: Partial<SecuritySettings>) => void;
}) {
  const [enabling, setEnabling] = useState(false);
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [nextConfirmPassword, setNextConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.masterPasswordEnabled) {
      setSettingsUnlocked(false);
      setUnlockPassword("");
      setChangingPassword(false);
    }
  }, [settings.masterPasswordEnabled]);

  async function submitEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = masterPassword.trim();
    if (!password) {
      setLocalError("请输入安全密码。");
      return;
    }
    if (password !== confirmPassword.trim()) {
      setLocalError("两次输入的安全密码不一致。");
      return;
    }

    setLocalError(null);
    const ok = await onEnableMasterPassword(password);
    if (ok) {
      onUpdate({ masterPasswordEnabled: true });
      setSettingsUnlocked(false);
      setMasterPassword("");
      setConfirmPassword("");
      setEnabling(false);
    }
  }

  async function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = unlockPassword.trim();
    if (!password) {
      setLocalError("请输入安全密码。");
      return;
    }
    setLocalError(null);
    const ok = await onUnlockSecuritySettings(password);
    if (ok) {
      setSettingsUnlocked(true);
      setUnlockPassword("");
    }
  }

  async function submitChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = nextPassword.trim();
    if (!password) {
      setLocalError("请输入新的安全密码。");
      return;
    }
    if (password !== nextConfirmPassword.trim()) {
      setLocalError("两次输入的安全密码不一致。");
      return;
    }
    setLocalError(null);
    const ok = await onEnableMasterPassword(password);
    if (ok) {
      setChangingPassword(false);
      setNextPassword("");
      setNextConfirmPassword("");
    }
  }

  async function disableMasterPassword() {
    setLocalError(null);
    const ok = await onDisableMasterPassword();
    if (ok) {
      onUpdate({ masterPasswordEnabled: false });
      setEnabling(false);
      setSettingsUnlocked(false);
    }
  }

  const autoLockOptions = [
    { label: "不自动锁定", value: "0" },
    { label: "5 分钟", value: "5" },
    { label: "15 分钟", value: "15" },
    { label: "30 分钟", value: "30" },
    { label: "60 分钟", value: "60" },
  ];

  return (
    <section className="settings-page-section">
      <header className="settings-section-head">
        <h1>安全</h1>
        <p>默认无打扰；需要更强保护时，可开启总安全密码。</p>
      </header>

      <div className="settings-panel">
        <SettingsRow
          icon={LockKeyhole}
          title="高级安全保护"
          description={
            settings.masterPasswordEnabled
              ? "已开启。vault 使用安全密码加密，启动后必须解锁。"
              : "默认关闭，适合个人使用；密码仍会加密保存到本机 vault。"
          }
        >
          <SettingsToggle
            checked={settings.masterPasswordEnabled}
            label="高级安全保护"
            onChange={(checked) => {
              if (checked) {
                setEnabling(true);
                setLocalError(null);
              } else if (settingsUnlocked) {
                void disableMasterPassword();
              }
            }}
            disabled={settings.masterPasswordEnabled && !settingsUnlocked}
          />
        </SettingsRow>

        {!settings.masterPasswordEnabled && enabling ? (
          <form className="settings-security-master-form" onSubmit={submitEnable}>
            <label className="credential-field">
              <span>安全密码</span>
              <input
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.currentTarget.value)}
              />
            </label>
            <label className="credential-field">
              <span>确认安全密码</span>
              <input
                className="settings-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              />
            </label>
            <div className="settings-security-master-actions">
              <button className="settings-action-button" type="submit" disabled={busy}>
                启用
              </button>
              <button
                className="settings-action-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEnabling(false);
                  setLocalError(null);
                  setMasterPassword("");
                  setConfirmPassword("");
                }}
              >
                取消
              </button>
            </div>
          </form>
        ) : null}

        {settings.masterPasswordEnabled && !settingsUnlocked ? (
          <form className="settings-security-master-form" onSubmit={submitUnlock}>
            <label className="credential-field">
              <span>安全密码</span>
              <input
                className="settings-input"
                type="password"
                autoComplete="current-password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.currentTarget.value)}
              />
            </label>
            <div className="settings-security-master-actions">
              <button className="settings-action-button" type="submit" disabled={busy}>
                解锁安全设置
              </button>
            </div>
          </form>
        ) : null}

        {settings.masterPasswordEnabled && settingsUnlocked ? (
          <>
            <SettingsRow
              icon={Clock3}
              title="闲置自动锁定"
              description="锁定后会清除内存中的 vault 解锁状态，需要重新输入安全密码。"
            >
              <AppSelect
                ariaLabel="闲置自动锁定"
                className="settings-select"
                value={String(settings.autoLockMinutes)}
                options={autoLockOptions}
                onChange={(value) =>
                  onUpdate({ autoLockMinutes: Number(value) as SecuritySettings["autoLockMinutes"] })
                }
              />
            </SettingsRow>

            <SettingsRow
              icon={Eye}
              title="允许查看已保存密码"
              description="关闭后，连接编辑和账号管理不显示眼睛按钮，只能替换密码。"
            >
              <SettingsToggle
                checked={settings.allowPasswordReveal}
                label="允许查看已保存密码"
                onChange={(allowPasswordReveal) => onUpdate({ allowPasswordReveal })}
              />
            </SettingsRow>

            {changingPassword ? (
              <form className="settings-security-master-form" onSubmit={submitChangePassword}>
                <label className="credential-field">
                  <span>新的安全密码</span>
                  <input
                    className="settings-input"
                    type="password"
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.currentTarget.value)}
                  />
                </label>
                <label className="credential-field">
                  <span>确认安全密码</span>
                  <input
                    className="settings-input"
                    type="password"
                    autoComplete="new-password"
                    value={nextConfirmPassword}
                    onChange={(event) => setNextConfirmPassword(event.currentTarget.value)}
                  />
                </label>
                <div className="settings-security-master-actions">
                  <button className="settings-action-button" type="submit" disabled={busy}>
                    保存新密码
                  </button>
                  <button
                    className="settings-action-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setChangingPassword(false);
                      setNextPassword("");
                      setNextConfirmPassword("");
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <div className="settings-security-master-actions">
                <button
                  className="settings-action-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setChangingPassword(true)}
                >
                  修改安全密码
                </button>
                <button
                  className="danger-button credential-danger-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void disableMasterPassword()}
                >
                  关闭高级保护
                </button>
              </div>
            )}
          </>
        ) : null}

        <p className="settings-note">
          高级保护关闭时不会明文保存密码；开启后如果忘记安全密码，已保存的密码和口令无法恢复。
        </p>

        {localError || error ? (
          <p className="settings-path-error" role="alert">
            {localError || error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CredentialSettingsSection({
  allowPasswordReveal,
  credentials,
  error,
  loading,
  onDelete,
  onSave,
}: {
  allowPasswordReveal: boolean;
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
          (credential.username || "").toLowerCase().includes(keyword) ||
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
      password: "",
      password_touched: false,
      private_key_passphrase: "",
      private_key_passphrase_touched: false,
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

  async function choosePrivateKeyPath() {
    if (!hasTauriRuntime()) {
      return;
    }
    setFormError(null);
    try {
      const selectedPath = await selectLocalPrivateKeyFile();
      if (selectedPath) {
        setForm((current) => ({ ...current, private_key_path: selectedPath }));
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "无法打开私钥文件选择器");
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
                { value: "password", label: "密码账号" },
                { value: "private_key", label: "私钥账号" },
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
                      {` · ${credential.kind === "private_key" ? "私钥账号" : "密码账号"}`}
                      {credential.notes ? ` · ${credential.notes}` : ""}
                    </small>
                  </span>
                  <span className="credential-list-kind">
                    {credential.kind === "private_key" ? "私钥账号" : "密码账号"}
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
                <span>账号密码</span>
                <div className="credential-secret-field">
                  <LockKeyhole className="ui-icon" aria-hidden="true" />
                  <input
                    type={showSecret ? "text" : "password"}
                    value={form.password || ""}
                    placeholder={editing ? "已保存，留空保留" : "输入账号密码"}
                    aria-label="账号密码"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        password: event.currentTarget.value,
                        password_touched: true,
                      })
                    }
                  />
                  {allowPasswordReveal ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={showSecret ? "隐藏密码" : "显示密码"}
                      onClick={() => void toggleCredentialSecretVisibility()}
                    >
                      {showSecret ? (
                        <EyeOff className="ui-icon" aria-hidden="true" />
                      ) : (
                        <Eye className="ui-icon" aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                </div>
              </label>
            ) : (
              <>
                <label className="credential-field credential-field-full">
                  <span>账号私钥路径</span>
                  <div className="settings-path-picker credential-private-key-picker">
                    <input
                      className="settings-input settings-path-input"
                      value={form.private_key_path || ""}
                      placeholder="~/.ssh/id_ed25519"
                      aria-label="账号私钥路径"
                      onChange={(event) =>
                        setForm({ ...form, private_key_path: event.currentTarget.value })
                      }
                    />
                    <button
                      className="settings-action-button settings-path-button"
                      type="button"
                      aria-label="选择账号私钥文件"
                      onClick={choosePrivateKeyPath}
                    >
                      <FolderOpen className="ui-icon" aria-hidden="true" />
                      <span>选择</span>
                    </button>
                  </div>
                </label>
                <label className="credential-field credential-field-full">
                  <span>账号私钥口令</span>
                  <div className="credential-secret-field">
                    <LockKeyhole className="ui-icon" aria-hidden="true" />
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={form.private_key_passphrase || ""}
                      placeholder={editing ? "已保存，留空保留" : "可选"}
                      aria-label="账号私钥口令"
                      onChange={(event) =>
                        setForm({
                          ...form,
                          private_key_passphrase: event.currentTarget.value,
                          private_key_passphrase_touched: true,
                        })
                      }
                    />
                    {allowPasswordReveal ? (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={showPassphrase ? "隐藏私钥口令" : "显示私钥口令"}
                        onClick={() => void toggleCredentialPassphraseVisibility()}
                      >
                        {showPassphrase ? (
                          <EyeOff className="ui-icon" aria-hidden="true" />
                        ) : (
                          <Eye className="ui-icon" aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
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
                aria-label="账号备注"
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

  async function toggleCredentialSecretVisibility() {
    if (showSecret) {
      setShowSecret(false);
      return;
    }
    if (!form.password && editing?.id) {
      await revealCredentialSecret("password");
      return;
    }
    setShowSecret(true);
  }

  async function toggleCredentialPassphraseVisibility() {
    if (showPassphrase) {
      setShowPassphrase(false);
      return;
    }
    if (!form.private_key_passphrase && editing?.id) {
      await revealCredentialSecret("private_key");
      return;
    }
    setShowPassphrase(true);
  }

  async function revealCredentialSecret(kind: ConnectionAuthKind) {
    if (!editing?.id) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const secret = await credentialRevealSecret(editing.id);
      if (secret.kind !== kind) {
        return;
      }
      if (kind === "password") {
        setForm((current) => ({
          ...current,
          password: secret.password || "",
          password_touched: false,
        }));
        setShowSecret(true);
      } else {
        setForm((current) => ({
          ...current,
          private_key_passphrase: secret.private_key_passphrase || "",
          private_key_passphrase_touched: false,
        }));
        setShowPassphrase(true);
      }
    } catch (nextError) {
      setFormError(formatError(nextError));
    } finally {
      setBusy(false);
    }
  }
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
    password_touched: false,
    private_key_passphrase:
      kind === "private_key" ? base?.private_key_passphrase || "" : "",
    private_key_passphrase_touched: false,
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
  commandSettings,
  settings,
  onUpdate,
  onUpdateCommand,
  onUpdateFileTransfer,
}: {
  commandSettings: CommandSettings;
  fileTransferSettings: FileTransferSettings;
  settings: BasicSettings;
  onUpdate: (update: Partial<BasicSettings>) => void;
  onUpdateCommand: (update: Partial<CommandSettings>) => void;
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
        <SettingsRow
          icon={Clock3}
          title="左侧最近连接"
          description="限制左侧连接树“最近”分组展示数量。"
        >
          <Stepper
            value={settings.recentConnectionLimit}
            values={[5, 10, 15, 20, 30, 50] as const}
            onChange={(recentConnectionLimit) => onUpdate({ recentConnectionLimit })}
          />
        </SettingsRow>
      </div>

      <div className="settings-panel">
        <SettingsRow
          icon={Terminal}
          title="记录终端输入"
          description="开启后，将普通回车命令保存到历史；控制序列、Tab 和疑似敏感输入会丢弃。"
        >
          <SettingsToggle
            checked={commandSettings.recordTerminalInputHistory}
            label="记录终端输入"
            onChange={(recordTerminalInputHistory) =>
              onUpdateCommand({ recordTerminalInputHistory })
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
        <SettingsRow icon={Archive} title="压缩目录传输" description="上传/下载目录时打包成 tar.gz 传输，节省带宽。服务器或本机缺少 tar 时自动降级为逐文件传输。">
          <SettingsToggle
            checked={fileTransferSettings.compressDirectories}
            label="压缩目录传输"
            onChange={(compressDirectories) =>
              onUpdateFileTransfer({ compressDirectories })
            }
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

function LocalTerminalSettingsSection({
  settings,
  onUpdate,
}: {
  settings: LocalTerminalSettings;
  onUpdate: (update: Partial<LocalTerminalSettings>) => void;
}) {
  const [detectedProfiles, setDetectedProfiles] = useState<LocalTerminalProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<LocalTerminalProfileInput | null>(null);
  const [form, setForm] = useState<LocalTerminalProfileInput>(emptyLocalTerminalProfile());
  const [formError, setFormError] = useState<string | null>(null);
  const customProfiles = settings.customProfiles
    .map((profile) => normalizeLocalTerminalProfileInput(profile))
    .filter((profile): profile is LocalTerminalProfileInput => Boolean(profile));
  const profileOptions = [...detectedProfiles, ...customProfiles];
  const visibleDetectedProfiles = detectedProfiles.filter(
    (profile) => !settings.hiddenProfileIds.includes(profile.id),
  );

  useEffect(() => {
    let disposed = false;

    async function loadProfiles() {
      setLoading(true);
      setError(null);
      try {
        const profiles = hasTauriRuntime()
          ? await localTerminalListProfiles()
          : previewSettingsLocalTerminalProfiles();
        if (!disposed) {
          setDetectedProfiles(profiles);
        }
      } catch (nextError) {
        if (!disposed) {
          setError(formatError(nextError));
          setDetectedProfiles(previewSettingsLocalTerminalProfiles());
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadProfiles();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (editingProfile) {
      setForm(editingProfile);
    }
  }, [editingProfile]);

  const currentDefaultOption = profileOptions.find(
    (profile) => profile.id === settings.defaultProfileId,
  );
  const effectiveDefaultOption = currentDefaultOption || profileOptions[0] || null;

  function toggleHiddenProfile(profileId: string, hidden: boolean) {
    const nextHiddenIds = hidden
      ? [...new Set([...settings.hiddenProfileIds, profileId])]
      : settings.hiddenProfileIds.filter((id) => id !== profileId);
    onUpdate({ hiddenProfileIds: nextHiddenIds });
  }

  function resetForm() {
    setEditingProfile(null);
    setForm(emptyLocalTerminalProfile());
    setFormError(null);
  }

  function saveCustomProfile() {
    const normalized = normalizeLocalTerminalProfileInput(form);
    if (!normalized || !normalized.name || !normalized.command) {
      setFormError("名称、类型和命令不能为空。");
      return;
    }

    const nextCustomProfiles = [...settings.customProfiles];
    const nextId = normalized.id || editingProfile?.id || `custom-${Date.now().toString()}`;
    const nextProfile = { ...normalized, id: nextId };
    const existingIndex = nextCustomProfiles.findIndex((item) => item.id === nextProfile.id);
    if (existingIndex >= 0) {
      nextCustomProfiles[existingIndex] = nextProfile;
    } else {
      nextCustomProfiles.push(nextProfile);
    }

    onUpdate({ customProfiles: nextCustomProfiles });
    resetForm();
  }

  function deleteCustomProfile(profileId?: string) {
    if (!profileId) {
      return;
    }
    onUpdate({
      customProfiles: settings.customProfiles.filter((item) => item.id !== profileId),
      defaultProfileId:
        settings.defaultProfileId === profileId ? visibleDetectedProfiles[0]?.id || null : settings.defaultProfileId,
    });
    if (editingProfile?.id === profileId) {
      resetForm();
    }
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head settings-section-head-row">
        <span>
          <h1>本地终端</h1>
          <p>管理默认本地 Shell、探测结果显示和自定义 profile。</p>
        </span>
        <button className="repository-primary-button" type="button" onClick={resetForm}>
          <Plus className="ui-icon" aria-hidden="true" />
          <span>新增自定义终端</span>
        </button>
      </header>

      <div className="settings-panel">
        <SettingsRow
          className="settings-row-compact settings-local-terminal-default-row"
          icon={HardDrive}
          title="默认终端"
        >
          <div className="settings-local-terminal-default">
            <AppSelect
              ariaLabel="默认本地终端"
              className="settings-select"
              options={profileOptions.map((profile) => ({
                label: (
                  <span className="local-terminal-menu-label">
                    <LocalTerminalIcon className="ui-icon" kind={profile.kind} title={profile.name} />
                    <span>{profile.name}</span>
                  </span>
                ),
                value: profile.id || `custom-fallback-${profile.name}`,
              }))}
              placeholder={loading ? "探测中" : "选择默认终端"}
              value={effectiveDefaultOption?.id || ""}
              onChange={(defaultProfileId) => onUpdate({ defaultProfileId })}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          icon={RotateCcw}
          title="恢复本地工作区"
          description="后续预留：启动时恢复上次本地终端工作区。"
        >
          <SettingsToggle
            checked={settings.reopenLastLocalWorkspace}
            label="恢复本地工作区"
            onChange={(reopenLastLocalWorkspace) => onUpdate({ reopenLastLocalWorkspace })}
          />
        </SettingsRow>
      </div>

      <div className="settings-panel local-terminal-detected-panel">
        <header className="local-terminal-panel-head">
          <span>
            <strong>自动探测</strong>
            <small>{loading ? "探测中..." : `${detectedProfiles.length.toString()} 项`}</small>
          </span>
          {error ? <small className="form-error">{error}</small> : null}
        </header>
        <div className="local-terminal-profile-list">
          {detectedProfiles.map((profile) => {
            const hidden = settings.hiddenProfileIds.includes(profile.id);
            return (
              <div className={`local-terminal-profile-card ${hidden ? "is-hidden-profile" : ""}`} key={profile.id}>
                <div className="local-terminal-profile-main">
                  <span className="local-terminal-profile-icon">
                    <LocalTerminalIcon className="ui-icon" kind={profile.kind} title={profile.name} />
                  </span>
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.command}</small>
                  </span>
                </div>
                <button
                  className="settings-action-button"
                  type="button"
                  onClick={() => toggleHiddenProfile(profile.id, !hidden)}
                >
                  {hidden ? "显示" : "隐藏"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="local-terminal-settings-grid">
        <section className="settings-panel local-terminal-custom-list">
          <header className="local-terminal-panel-head">
            <span>
              <strong>自定义 profile</strong>
              <small>{customProfiles.length.toString()} 项</small>
            </span>
          </header>
          <div className="local-terminal-profile-list">
            {customProfiles.length === 0 ? (
              <p className="settings-note">还没有自定义 profile。</p>
            ) : (
              customProfiles.map((profile, index) => (
                <div className="local-terminal-profile-card" key={profile.id || `custom-${index.toString()}`}>
                  <div className="local-terminal-profile-main">
                    <span className="local-terminal-profile-icon">
                      <LocalTerminalIcon className="ui-icon" kind={profile.kind} title={profile.name} />
                    </span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.command}</small>
                    </span>
                  </div>
                  <div className="local-terminal-profile-actions">
                    <button
                      className="settings-action-button"
                      type="button"
                      onClick={() => setEditingProfile(profile)}
                    >
                      编辑
                    </button>
                    <button
                      className="settings-action-button danger-button"
                      type="button"
                      onClick={() => deleteCustomProfile(profile.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="settings-panel local-terminal-custom-form">
          <header className="local-terminal-panel-head">
            <span>
              <strong>{editingProfile ? "编辑自定义 profile" : "新增自定义 profile"}</strong>
              <small>用于补充 Git Bash、WSL 包装脚本或团队约定命令。</small>
            </span>
          </header>
          <div className="local-terminal-form-grid">
            <label>
              <span>名称</span>
              <input
                className="settings-input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>类型</span>
              <input
                className="settings-input"
                value={form.kind}
                placeholder="例如 powershell、wsl、custom"
                onChange={(event) => setForm({ ...form, kind: event.currentTarget.value })}
              />
            </label>
            <label className="local-terminal-form-span">
              <span>命令</span>
              <input
                className="settings-input"
                value={form.command}
                placeholder="例如 C:\\Program Files\\PowerShell\\7\\pwsh.exe"
                onChange={(event) => setForm({ ...form, command: event.currentTarget.value })}
              />
            </label>
            <label className="local-terminal-form-span">
              <span>参数</span>
              <input
                className="settings-input"
                value={form.args.join(" ")}
                placeholder='例如 -NoLogo -NoProfile'
                onChange={(event) =>
                  setForm({
                    ...form,
                    args: event.currentTarget.value
                      .split(/\s+/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="local-terminal-form-span">
              <span>启动目录</span>
              <input
                className="settings-input"
                value={form.cwd || ""}
                placeholder="可选"
                onChange={(event) => setForm({ ...form, cwd: event.currentTarget.value })}
              />
            </label>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <footer className="credential-form-actions">
            <div />
            <div>
              <button type="button" onClick={resetForm}>
                清空
              </button>
              <button className="primary-button" type="button" onClick={saveCustomProfile}>
                保存 profile
              </button>
            </div>
          </footer>
        </section>
      </div>
    </section>
  );
}

function emptyLocalTerminalProfile(): LocalTerminalProfileInput {
  return {
    args: [],
    command: "",
    cwd: "",
    detected: false,
    env: {},
    hidden: false,
    icon: "terminal-shell",
    id: undefined,
    kind: "custom",
    name: "",
    platform: "all",
    source: "custom",
  };
}

function previewSettingsLocalTerminalProfiles(): LocalTerminalProfile[] {
  return [
    {
      args: ["-NoLogo", "-NoProfile"],
      command: "pwsh.exe",
      cwd: null,
      detected: true,
      env: {},
      hidden: false,
      icon: "terminal-powershell",
      id: "pwsh",
      kind: "powershell_core",
      name: "PowerShell 7",
      platform: "windows",
      source: "detected",
    },
    {
      args: [],
      command: "cmd.exe",
      cwd: null,
      detected: true,
      env: {},
      hidden: false,
      icon: "terminal-cmd",
      id: "cmd",
      kind: "cmd",
      name: "命令提示符",
      platform: "windows",
      source: "detected",
    },
  ];
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
