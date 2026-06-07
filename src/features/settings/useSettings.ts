import { useCallback, useEffect, useState } from "react";

import {
  defaultSettings,
  normalizeSettings,
  type AppearanceSettings,
  type BasicSettings,
  type MxtermSettings,
  type TerminalThemeSettings,
} from "./settingsTypes";

const settingsStorageKey = "mxterm.settings.v1";

export function useSettings() {
  const [settings, setSettings] = useState<MxtermSettings>(() => readStoredSettings());

  useEffect(() => {
    writeStoredSettings(settings);
  }, [settings]);

  const updateBasic = useCallback((update: Partial<BasicSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        basic: {
          ...current.basic,
          ...update,
        },
      }),
    );
  }, []);

  const updateAppearance = useCallback((update: Partial<AppearanceSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        appearance: {
          ...current.appearance,
          ...update,
        },
      }),
    );
  }, []);

  const updateTerminalTheme = useCallback((update: Partial<TerminalThemeSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        terminalTheme: {
          ...current.terminalTheme,
          ...update,
        },
      }),
    );
  }, []);

  const reset = useCallback(() => setSettings(defaultSettings), []);

  return {
    settings,
    updateAppearance,
    updateBasic,
    updateTerminalTheme,
    reset,
  };
}

function readStoredSettings() {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(settingsStorageKey) || "null"));
  } catch {
    return defaultSettings;
  }
}

function writeStoredSettings(settings: MxtermSettings) {
  try {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in restricted preview contexts.
  }
}
