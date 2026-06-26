import { useCallback, useEffect, useState } from "react";

import {
  defaultSettings,
  normalizeSettings,
  type AppearanceSettings,
  type BasicSettings,
  type CommandSettings,
  type FileTransferSettings,
  type MxtermSettings,
  type SecuritySettings,
  type ShortcutSettings,
  type TerminalThemeSettings,
} from "./settingsTypes";
import { readStartupSettings, writeStoredSettings } from "./startupSettings";
import type { LocalTerminalSettings } from "../terminal/localTerminalTypes";

export function useSettings() {
  const [settings, setSettings] = useState<MxtermSettings>(() => readStartupSettings());

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

  const updateSecurity = useCallback((update: Partial<SecuritySettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        security: {
          ...current.security,
          ...update,
        },
      }),
    );
  }, []);

  const updateShortcuts = useCallback((update: Partial<ShortcutSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        shortcuts: {
          ...current.shortcuts,
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

  const updateFileTransfer = useCallback((update: Partial<FileTransferSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        fileTransfer: {
          ...current.fileTransfer,
          ...update,
        },
      }),
    );
  }, []);

  const updateCommand = useCallback((update: Partial<CommandSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        command: {
          ...current.command,
          ...update,
        },
      }),
    );
  }, []);

  const updateLocalTerminal = useCallback((update: Partial<LocalTerminalSettings>) => {
    setSettings((current) =>
      normalizeSettings({
        ...current,
        localTerminal: {
          ...current.localTerminal,
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
    updateCommand,
    updateFileTransfer,
    updateLocalTerminal,
    updateSecurity,
    updateShortcuts,
    updateTerminalTheme,
    reset,
  };
}
