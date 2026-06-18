import type { CSSProperties } from "react";
import type {
  LocalTerminalProfileInput,
  LocalTerminalSettings,
} from "../terminal/localTerminalTypes";

import {
  defaultTerminalColorSchemeId,
  getTerminalColorScheme,
  type TerminalColorSchemeId,
} from "./terminalColorSchemes";

export type SettingsSectionId =
  | "basic"
  | "credentials"
  | "appearance"
  | "terminalTheme"
  | "localTerminal";
export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "blue" | "slate" | "emerald" | "amber" | "rose" | "violet" | "custom";
export type FontSettingMode = "preset" | "custom";
export type InterfaceDensity = "comfortable" | "compact";
export type IconSize = "small" | "medium" | "large";
export type WindowMaterialMode = "auto" | "mica" | "acrylic" | "micaAlt";
export type FileTransferConflictPolicy = "ask" | "overwrite" | "skip" | "rename";
export type FileTransferTimestampFormat =
  | "yyyyMMddHHmm"
  | "yyyyMMdd-HHmm"
  | "yyyy-MM-dd-HHmm";
export type TerminalFontPreset =
  | "cascadia-code"
  | "jetbrains-mono"
  | "fira-code"
  | "source-code-pro"
  | "iosevka"
  | "hack"
  | "noto-sans-mono";
export type UiFontPreset =
  | "system"
  | "segoe-ui"
  | "microsoft-yahei"
  | "noto-sans-sc";

export interface BasicSettings {
  filePanelFollowsActiveConnection: boolean;
  keepFailedTerminalTabs: boolean;
  reopenLastTerminal: boolean;
  restoreWorkspaceOnLaunch: boolean;
  recentConnectionLimit: 5 | 10 | 15 | 20 | 30 | 50;
}

export interface AppearanceSettings {
  accentColor: AccentColor;
  accentColorCustom: string;
  density: InterfaceDensity;
  iconSize: IconSize;
  rememberPaneWidths: boolean;
  terminalFontCustom: string;
  terminalFontMode: FontSettingMode;
  terminalFontPreset: TerminalFontPreset;
  terminalFontSize: 12 | 13 | 14 | 15 | 16;
  themeMode: ThemeMode;
  uiFontCustom: string;
  uiFontMode: FontSettingMode;
  uiFontPreset: UiFontPreset;
  uiFontSize: 12 | 13 | 14 | 15;
  windowMaterial: WindowMaterialMode;
}

export interface TerminalThemeSettings {
  scheme: TerminalColorSchemeId;
}

export interface FileTransferSettings {
  compressDirectories: boolean;
  conflictPolicyDefault: FileTransferConflictPolicy;
  downloadRoot: string;
  groupBySession: boolean;
  keepArchives: boolean;
  timestampDirectory: boolean;
  timestampFormat: FileTransferTimestampFormat;
}

export interface MxtermSettings {
  appearance: AppearanceSettings;
  basic: BasicSettings;
  fileTransfer: FileTransferSettings;
  localTerminal: LocalTerminalSettings;
  terminalTheme: TerminalThemeSettings;
}

export const accentColorPresets: Array<{
  dark: string;
  label: string;
  light: string;
  value: Exclude<AccentColor, "custom" | "slate">;
}> = [
  { value: "blue", label: "蓝", light: "#2374C6", dark: "#73B7FF" },
  { value: "emerald", label: "绿", light: "#168264", dark: "#57D8AE" },
  { value: "amber", label: "琥", light: "#C97A19", dark: "#FFBF66" },
  { value: "rose", label: "玫", light: "#C85F82", dark: "#FF9DB8" },
  { value: "violet", label: "紫", light: "#7460DE", dark: "#AC9CFF" },
];

const legacyAccentColors: Record<Extract<AccentColor, "slate">, { light: string; dark: string }> = {
  slate: { light: "#64748B", dark: "#94A3B8" },
};

export const uiFontPresets: Array<{
  label: string;
  stack: string;
  value: UiFontPreset;
}> = [
  {
    value: "system",
    label: "系统默认",
    stack: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
  {
    value: "segoe-ui",
    label: "Segoe UI",
    stack: "\"Segoe UI Variable Text\", \"Segoe UI\", \"Microsoft YaHei UI\", system-ui, sans-serif",
  },
  {
    value: "microsoft-yahei",
    label: "微软雅黑",
    stack: "\"Microsoft YaHei UI\", \"Microsoft YaHei\", \"Segoe UI\", sans-serif",
  },
  {
    value: "noto-sans-sc",
    label: "Noto Sans SC",
    stack: "\"Noto Sans SC\", \"Source Han Sans SC\", \"Microsoft YaHei UI\", sans-serif",
  },
];

export const terminalFontPresets: Array<{
  label: string;
  stack: string;
  value: TerminalFontPreset;
}> = [
  {
    value: "cascadia-code",
    label: "Cascadia Code",
    stack: "\"Cascadia Code\", \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "jetbrains-mono",
    label: "JetBrains Mono",
    stack: "\"JetBrains Mono\", \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "fira-code",
    label: "Fira Code",
    stack: "\"Fira Code\", \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "source-code-pro",
    label: "Source Code Pro",
    stack: "\"Source Code Pro\", \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "iosevka",
    label: "Iosevka",
    stack: "Iosevka, \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "hack",
    label: "Hack",
    stack: "Hack, \"Cascadia Mono\", Consolas, monospace",
  },
  {
    value: "noto-sans-mono",
    label: "Noto Sans Mono",
    stack: "\"Noto Sans Mono\", \"Cascadia Mono\", Consolas, monospace",
  },
];

export const defaultSettings: MxtermSettings = {
  basic: {
    filePanelFollowsActiveConnection: true,
    keepFailedTerminalTabs: true,
    reopenLastTerminal: false,
    restoreWorkspaceOnLaunch: true,
    recentConnectionLimit: 5,
  },
  fileTransfer: {
    conflictPolicyDefault: "ask",
    downloadRoot: "",
    groupBySession: true,
    keepArchives: false,
    compressDirectories: true,
    timestampDirectory: true,
    timestampFormat: "yyyyMMddHHmm",
  },
  localTerminal: {
    defaultProfileId: null,
    hiddenProfileIds: [],
    customProfiles: [],
    reopenLastLocalWorkspace: true,
  },
  appearance: {
    accentColor: "blue",
    accentColorCustom: "#2374C6",
    density: "comfortable",
    iconSize: "medium",
    rememberPaneWidths: true,
    terminalFontCustom: "\"Cascadia Code\", \"Cascadia Mono\", Consolas, monospace",
    terminalFontMode: "preset",
    terminalFontPreset: "cascadia-code",
    terminalFontSize: 13,
    themeMode: "system",
    uiFontCustom: "\"Segoe UI Variable Text\", \"Segoe UI\", \"Microsoft YaHei UI\", system-ui, sans-serif",
    uiFontMode: "preset",
    uiFontPreset: "segoe-ui",
    uiFontSize: 14,
    windowMaterial: "auto",
  },
  terminalTheme: {
    scheme: defaultTerminalColorSchemeId,
  },
};

export function normalizeSettings(value: unknown): MxtermSettings {
  const record = isRecord(value) ? value : {};
  const basic = isRecord(record.basic) ? record.basic : {};
  const fileTransfer = isRecord(record.fileTransfer) ? record.fileTransfer : {};
  const localTerminal = isRecord(record.localTerminal) ? record.localTerminal : {};
  const appearance = isRecord(record.appearance) ? record.appearance : {};
  const terminalTheme = isRecord(record.terminalTheme) ? record.terminalTheme : {};

  return {
    basic: {
      filePanelFollowsActiveConnection: normalizeBoolean(
        basic.filePanelFollowsActiveConnection,
        defaultSettings.basic.filePanelFollowsActiveConnection,
      ),
      keepFailedTerminalTabs: normalizeBoolean(
        basic.keepFailedTerminalTabs,
        defaultSettings.basic.keepFailedTerminalTabs,
      ),
      reopenLastTerminal: normalizeBoolean(
        basic.reopenLastTerminal,
        defaultSettings.basic.reopenLastTerminal,
      ),
      restoreWorkspaceOnLaunch: normalizeBoolean(
        basic.restoreWorkspaceOnLaunch,
        defaultSettings.basic.restoreWorkspaceOnLaunch,
      ),
      recentConnectionLimit: normalizeNumber(
        basic.recentConnectionLimit,
        [5, 10, 15, 20, 30, 50],
        defaultSettings.basic.recentConnectionLimit,
      ),
    },
    fileTransfer: {
      conflictPolicyDefault: normalizeOneOf(
        fileTransfer.conflictPolicyDefault,
        ["ask", "overwrite", "skip", "rename"],
        defaultSettings.fileTransfer.conflictPolicyDefault,
      ),
      downloadRoot: normalizePathInput(
        fileTransfer.downloadRoot,
        defaultSettings.fileTransfer.downloadRoot,
      ),
      groupBySession: normalizeBoolean(
        fileTransfer.groupBySession,
        defaultSettings.fileTransfer.groupBySession,
      ),
      compressDirectories: normalizeBoolean(
        fileTransfer.compressDirectories,
        defaultSettings.fileTransfer.compressDirectories,
      ),
      keepArchives: normalizeBoolean(
        fileTransfer.keepArchives,
        defaultSettings.fileTransfer.keepArchives,
      ),
      timestampDirectory: normalizeBoolean(
        fileTransfer.timestampDirectory,
        defaultSettings.fileTransfer.timestampDirectory,
      ),
      timestampFormat: normalizeOneOf(
        fileTransfer.timestampFormat,
        ["yyyyMMddHHmm", "yyyyMMdd-HHmm", "yyyy-MM-dd-HHmm"],
        defaultSettings.fileTransfer.timestampFormat,
      ),
    },
    localTerminal: {
      defaultProfileId: normalizeOptionalString(
        localTerminal.defaultProfileId,
        defaultSettings.localTerminal.defaultProfileId,
      ),
      hiddenProfileIds: normalizeStringArray(localTerminal.hiddenProfileIds),
      customProfiles: normalizeLocalTerminalProfiles(localTerminal.customProfiles),
      reopenLastLocalWorkspace: normalizeBoolean(
        localTerminal.reopenLastLocalWorkspace,
        defaultSettings.localTerminal.reopenLastLocalWorkspace,
      ),
    },
    appearance: {
      accentColor: normalizeOneOf(
        appearance.accentColor,
        ["blue", "slate", "emerald", "amber", "rose", "violet", "custom"],
        defaultSettings.appearance.accentColor,
      ),
      accentColorCustom: normalizeHexColor(
        appearance.accentColorCustom,
        defaultSettings.appearance.accentColorCustom,
      ),
      density: normalizeOneOf(
        appearance.density,
        ["comfortable", "compact"],
        defaultSettings.appearance.density,
      ),
      iconSize: normalizeOneOf(
        appearance.iconSize,
        ["small", "medium", "large"],
        defaultSettings.appearance.iconSize,
      ),
      rememberPaneWidths: normalizeBoolean(
        appearance.rememberPaneWidths,
        defaultSettings.appearance.rememberPaneWidths,
      ),
      terminalFontCustom: normalizeFontFamilyInput(
        appearance.terminalFontCustom,
        defaultSettings.appearance.terminalFontCustom,
      ),
      terminalFontMode: normalizeOneOf(
        appearance.terminalFontMode,
        ["preset", "custom"],
        defaultSettings.appearance.terminalFontMode,
      ),
      terminalFontPreset: normalizeOneOf(
        appearance.terminalFontPreset,
        terminalFontPresets.map((preset) => preset.value),
        defaultSettings.appearance.terminalFontPreset,
      ),
      terminalFontSize: normalizeNumber(
        appearance.terminalFontSize,
        [12, 13, 14, 15, 16],
        defaultSettings.appearance.terminalFontSize,
      ),
      themeMode: normalizeOneOf(
        appearance.themeMode,
        ["system", "light", "dark"],
        defaultSettings.appearance.themeMode,
      ),
      uiFontCustom: normalizeFontFamilyInput(
        appearance.uiFontCustom,
        defaultSettings.appearance.uiFontCustom,
      ),
      uiFontMode: normalizeOneOf(
        appearance.uiFontMode,
        ["preset", "custom"],
        defaultSettings.appearance.uiFontMode,
      ),
      uiFontPreset: normalizeOneOf(
        appearance.uiFontPreset,
        uiFontPresets.map((preset) => preset.value),
        defaultSettings.appearance.uiFontPreset,
      ),
      uiFontSize: normalizeNumber(
        appearance.uiFontSize,
        [12, 13, 14, 15],
        defaultSettings.appearance.uiFontSize,
      ),
      windowMaterial: normalizeOneOf(
        appearance.windowMaterial,
        ["auto", "mica", "acrylic", "micaAlt"],
        defaultSettings.appearance.windowMaterial,
      ),
    },
    terminalTheme: {
      scheme: getTerminalColorScheme(
        typeof terminalTheme.scheme === "string" ? terminalTheme.scheme : null,
      ).id,
    },
  };
}

export function resolveSettingsStyle(settings: MxtermSettings): CSSProperties {
  const accent = resolveAccentColors(settings.appearance);
  const terminalScheme = getTerminalColorScheme(settings.terminalTheme.scheme);

  return {
    "--font-mono": resolveTerminalFontFamily(settings.appearance),
    "--font-ui": resolveUiFontFamily(settings.appearance),
    "--mx-primary-light": accent.light,
    "--mx-primary-dark": accent.dark,
    "--mx-settings-ui-font-size": `${settings.appearance.uiFontSize.toString()}px`,
    "--mx-terminal": terminalScheme.theme.background,
    "--mx-terminal-font-size": `${settings.appearance.terminalFontSize.toString()}px`,
    "--mx-ui-icon-size": iconSizeToPixels(settings.appearance.iconSize),
  } as CSSProperties;
}

export function resolveUiFontFamily(
  appearance: Pick<AppearanceSettings, "uiFontCustom" | "uiFontMode" | "uiFontPreset">,
) {
  if (appearance.uiFontMode === "custom") {
    return normalizeFontFamilyInput(
      appearance.uiFontCustom,
      defaultSettings.appearance.uiFontCustom,
    );
  }

  return (
    uiFontPresets.find((preset) => preset.value === appearance.uiFontPreset)?.stack ||
    defaultSettings.appearance.uiFontCustom
  );
}

export function resolveTerminalFontFamily(
  appearance: Pick<
    AppearanceSettings,
    "terminalFontCustom" | "terminalFontMode" | "terminalFontPreset"
  >,
) {
  if (appearance.terminalFontMode === "custom") {
    return normalizeFontFamilyInput(
      appearance.terminalFontCustom,
      defaultSettings.appearance.terminalFontCustom,
    );
  }

  return (
    terminalFontPresets.find((preset) => preset.value === appearance.terminalFontPreset)?.stack ||
    defaultSettings.appearance.terminalFontCustom
  );
}

export function resolveAccentColor(appearance: Pick<AppearanceSettings, "accentColor" | "accentColorCustom">) {
  return resolveAccentColors(appearance).light;
}

export function resolveAccentColors(
  appearance: Pick<AppearanceSettings, "accentColor" | "accentColorCustom">,
) {
  if (appearance.accentColor === "custom") {
    const light = normalizeHexColor(
      appearance.accentColorCustom,
      defaultSettings.appearance.accentColorCustom,
    );
    return {
      light,
      dark: createDarkAccentColor(light),
    };
  }

  const preset =
    accentColorPresets.find((item) => item.value === appearance.accentColor) ||
    legacyAccentColors[appearance.accentColor as keyof typeof legacyAccentColors];

  return preset || {
    light: defaultSettings.appearance.accentColorCustom,
    dark: createDarkAccentColor(defaultSettings.appearance.accentColorCustom),
  };
}

export function normalizeHexColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [red, green, blue] = short[1].split("");
    return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
  }

  const full = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  return full ? `#${full[1].toUpperCase()}` : fallback;
}

export function createDarkAccentColor(lightHex: string) {
  const normalized = normalizeHexColor(lightHex, defaultSettings.appearance.accentColorCustom);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const boost = 0.24;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * boost);

  return `#${[mix(red), mix(green), mix(blue)]
    .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
}

function iconSizeToPixels(size: IconSize) {
  if (size === "small") return "14px";
  if (size === "large") return "18px";
  return "16px";
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeFontFamilyInput(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/[;{}\n\r\t]/g, " ");
  return trimmed.length > 0 && trimmed.length <= 180 ? trimmed : fallback;
}

function normalizePathInput(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/[<>"|?*\n\r\t]/g, "");
  return trimmed.length <= 260 ? trimmed : fallback;
}

function normalizeOptionalString(value: unknown, fallback: string | null) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeLocalTerminalProfiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeLocalTerminalProfile(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function normalizeLocalTerminalProfileInput(
  value: unknown,
): LocalTerminalProfileInput | null {
  return normalizeLocalTerminalProfile(value);
}

function normalizeLocalTerminalProfile(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  if (!name || !kind || !command) {
    return null;
  }

  const env = isRecord(value.env)
    ? Object.fromEntries(
        Object.entries(value.env)
          .filter(([, item]) => typeof item === "string")
          .map(([key, item]) => [key, (item as string).trim()]),
      )
    : {};

  return {
    id: typeof value.id === "string" ? value.id.trim() || undefined : undefined,
    name,
    kind,
    platform: typeof value.platform === "string" ? value.platform.trim() || "all" : "all",
    source: typeof value.source === "string" ? value.source.trim() || "custom" : "custom",
    command,
    args: Array.isArray(value.args)
      ? value.args.filter((item): item is string => typeof item === "string")
      : [],
    cwd: typeof value.cwd === "string" ? value.cwd.trim() || null : null,
    env,
    icon: typeof value.icon === "string" ? value.icon.trim() || "terminal-shell" : "terminal-shell",
    hidden: typeof value.hidden === "boolean" ? value.hidden : false,
    detected: typeof value.detected === "boolean" ? value.detected : false,
  };
}

function normalizeNumber<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
