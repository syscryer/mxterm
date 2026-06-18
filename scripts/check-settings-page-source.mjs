import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../src/features/layout/WorkspaceShell.tsx", import.meta.url), "utf8");
const connectionPane = readFileSync(new URL("../src/features/connections/ConnectionPane.tsx", import.meta.url), "utf8");
const settingsView = readFileSync(new URL("../src/features/settings/SettingsView.tsx", import.meta.url), "utf8");
const terminalSchemes = readFileSync(new URL("../src/features/settings/terminalColorSchemes.ts", import.meta.url), "utf8");
const settingsTypes = readFileSync(new URL("../src/features/settings/settingsTypes.ts", import.meta.url), "utf8");
const terminalPanel = readFileSync(new URL("../src/features/terminal/TerminalPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

if (!workspace.includes("<SettingsView")) {
  throw new Error("WorkspaceShell should render the lightweight SettingsView");
}

if (!workspace.includes("hidden={activeView !== \"settings\"}")) {
  throw new Error("SettingsView should be hidden instead of conditionally mounted");
}

if (!workspace.includes("hidden={activeView === \"settings\"}")) {
  throw new Error("WorkspaceShell should hide the live workspace without unmounting it");
}

if (!connectionPane.includes("onOpenSettings")) {
  throw new Error("ConnectionPane should expose the left-bottom settings action");
}

for (const section of ["basic", "appearance", "terminalTheme"]) {
  if (!settingsView.includes(section)) {
    throw new Error(`SettingsView should include the ${section} section`);
  }
}

if (!settingsTypes.includes("recentConnectionLimit")) {
  throw new Error("Basic settings should include recentConnectionLimit");
}

if (!settingsTypes.includes("recentConnectionLimit: 5")) {
  throw new Error("Left sidebar recent connection limit should default to 5");
}

if (
  !settingsView.includes("左侧最近连接") ||
  !settingsView.includes("recentConnectionLimit")
) {
  throw new Error("SettingsView should expose the left sidebar recent connection limit");
}

if (!workspace.includes("recentConnectionLimit={settings.basic.recentConnectionLimit}")) {
  throw new Error("WorkspaceShell should pass the configured recent connection limit to ConnectionPane");
}

if (!connectionPane.includes("recentConnectionLimit") || !connectionPane.includes(".slice(0, recentConnectionLimit)")) {
  throw new Error("ConnectionPane should cap the recent system folder by recentConnectionLimit");
}

const iTermSchemeCount = [...terminalSchemes.matchAll(/source: "iTerm2-Color-Schemes"/g)].length;
if (iTermSchemeCount < 100) {
  throw new Error(`terminalColorSchemes should include the upstream iTerm2 schemes, found ${iTermSchemeCount}`);
}

if (!settingsView.includes("terminalSchemeQuery")) {
  throw new Error("Terminal color schemes should be searchable when many schemes are available");
}

if (
  !settingsView.includes("terminalSchemeTone") ||
  !terminalSchemes.includes("getTerminalColorSchemeTone") ||
  !styles.includes(".terminal-scheme-tools")
) {
  throw new Error("Terminal color schemes should support light/dark filtering");
}

for (const field of [
  "uiFontMode",
  "uiFontPreset",
  "uiFontCustom",
  "terminalFontMode",
  "terminalFontPreset",
  "terminalFontCustom",
]) {
  if (!settingsTypes.includes(field) || !settingsView.includes(field)) {
    throw new Error(`Appearance settings should include ${field}`);
  }
}

if (!terminalPanel.includes("fontFamily") || !settingsTypes.includes("resolveTerminalFontFamily")) {
  throw new Error("Terminal font family should be resolved from settings and passed to xterm");
}

for (const scheme of [
  "Dracula",
  "Gruvbox Dark",
  "iTerm2 Solarized Dark",
  "One Half Dark",
  "One Half Light",
  "TokyoNight",
]) {
  if (!terminalSchemes.includes(scheme)) {
    throw new Error(`terminalColorSchemes should include ${scheme}`);
  }
}

if (
  !styles.includes(".settings-view") ||
  !styles.includes(".terminal-scheme-card") ||
  !styles.includes(".terminal-scheme-search")
) {
  throw new Error("Settings page and terminal scheme card styles should exist");
}

console.log("Settings page source check passed.");
