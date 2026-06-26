import {
  defaultSettings,
  normalizeSettings,
  resolveSettingsStyle,
  type MxtermSettings,
} from "./settingsTypes";
import {
  getPlatformWindowMaterials,
  normalizeWindowMaterial,
  resolveDesktopPlatform,
} from "../../shared/tauri/windowMaterial";

const settingsStorageKey = "mxterm.settings.v1";

export function readStartupSettings(): MxtermSettings {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(settingsStorageKey) || "null"));
  } catch {
    return defaultSettings;
  }
}

export function applyStartupTheme(settings: MxtermSettings) {
  if (typeof document === "undefined") {
    return;
  }

  const body = document.body;
  const platform = resolveDesktopPlatform();
  const windowMaterial = normalizeWindowMaterial(
    settings.appearance.windowMaterial,
    getPlatformWindowMaterials(platform),
  );

  body.dataset.themeMode = settings.appearance.themeMode;
  body.dataset.windowMaterial = windowMaterial;
  body.dataset.density = settings.appearance.density;
  body.dataset.platform = platform;

  const style = resolveSettingsStyle(settings);
  for (const [name, value] of Object.entries(style)) {
    body.style.setProperty(name, value);
  }
}

export function writeStoredSettings(settings: MxtermSettings) {
  try {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}
