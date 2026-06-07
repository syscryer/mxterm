import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Check,
  Folder,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  Plus,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Server,
  Settings,
  Sun,
  Terminal,
  Type,
  Undo2,
} from "lucide-react";

import { Tooltip } from "../../shared/ui/Tooltip";
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
  uiFontPresets,
} from "./settingsTypes";
import {
  SegmentedControl,
  SettingsRow,
  SettingsToggle,
  Stepper,
} from "./SettingsControls";

interface SettingsViewProps {
  hidden?: boolean;
  settings: MxtermSettings;
  onReset: () => void;
  onReturnWorkspace: () => void;
  onUpdateAppearance: (update: Partial<AppearanceSettings>) => void;
  onUpdateBasic: (update: Partial<BasicSettings>) => void;
  onUpdateTerminalTheme: (update: Partial<TerminalThemeSettings>) => void;
}

const settingsSections: Array<{
  description: string;
  icon: typeof Settings;
  id: SettingsSectionId;
  label: string;
}> = [
  { id: "basic", label: "基础设置", description: "启动、连接与面板行为", icon: Settings },
  { id: "appearance", label: "外观", description: "字号、密度与强调色", icon: Palette },
  { id: "terminalTheme", label: "终端配色", description: "终端 ANSI 主题方案", icon: Terminal },
];

export function SettingsView({
  hidden = false,
  settings,
  onReset,
  onReturnWorkspace,
  onUpdateAppearance,
  onUpdateBasic,
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

  return (
    <section className="settings-view" hidden={hidden} aria-label="设置" aria-hidden={hidden}>
      <aside className="settings-sidebar" aria-label="设置分类">
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
          <BasicSettingsSection settings={settings.basic} onUpdate={onUpdateBasic} />
        ) : null}
        {activeSection === "appearance" ? (
          <AppearanceSettingsSection
            accentDraft={accentDraft}
            settings={settings.appearance}
            onAccentDraftChange={setAccentDraft}
            onReset={onReset}
            onUpdate={onUpdateAppearance}
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

function BasicSettingsSection({
  settings,
  onUpdate,
}: {
  settings: BasicSettings;
  onUpdate: (update: Partial<BasicSettings>) => void;
}) {
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
          title="保留失败标签"
          description="连接失败时保留终端标签，并在标签内显示错误。"
        >
          <SettingsToggle
            checked={settings.keepFailedTerminalTabs}
            label="保留失败标签"
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
    </section>
  );
}

function AppearanceSettingsSection({
  accentDraft,
  settings,
  onAccentDraftChange,
  onReset,
  onUpdate,
}: {
  accentDraft: string;
  settings: AppearanceSettings;
  onAccentDraftChange: (value: string) => void;
  onReset: () => void;
  onUpdate: (update: Partial<AppearanceSettings>) => void;
}) {
  const [uiFontDraft, setUiFontDraft] = useState(settings.uiFontCustom);
  const [terminalFontDraft, setTerminalFontDraft] = useState(settings.terminalFontCustom);

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
        <SettingsRow icon={Monitor} title="主题模式" description="深色主题暂不应用到全局，后续完整适配。">
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
          <select
            className="settings-select"
            value={presetValue}
            aria-label="选择字体预设"
            onChange={(event) => onPresetChange(event.currentTarget.value as TPreset)}
          >
            {presetOptions.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
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

      <div className="terminal-scheme-list" aria-label="终端配色方案">
        {filteredTerminalColorSchemes.length > 0 ? (
          filteredTerminalColorSchemes.map((scheme) => (
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
          ))
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
