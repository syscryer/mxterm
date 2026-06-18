import { readFileSync } from "node:fs";

const shellSource = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const titlebarSource = readFileSync("src/features/layout/AppTitlebar.tsx", "utf8");
const styleSource = readFileSync("src/styles/app.css", "utf8");
const localProfilesSource = readFileSync("src-tauri/src/terminal/local_profiles.rs", "utf8");
const settingsViewSource = readFileSync("src/features/settings/SettingsView.tsx", "utf8");

function assertIncludes(source, value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(source, value, message) {
  if (source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(titlebarSource, "<span>终端</span>", "Titlebar must label the local terminal workspace as 终端.");
assertExcludes(titlebarSource, "<span>本地终端</span>", "Titlebar must not show 本地终端 after the label rename.");
assertIncludes(shellSource, "className=\"local-terminal-profile-menu dropdown-menu-content\"", "Local terminal profile choices must open from the compact dropdown menu.");
assertIncludes(shellSource, "role=\"menuitem\"", "Local terminal profile menu items must use menu item semantics.");
assertExcludes(shellSource, "默认：", "Local terminal subtabs must not show the default profile text in the toolbar.");
assertExcludes(styleSource, "local-terminal-profile-select", "The old wide local terminal profile select styles must not remain.");
assertIncludes(
  localProfilesSource,
  'vec!["-NoLogo".to_string(), "-NoProfile".to_string()]',
  "Detected PowerShell profiles should skip user profile scripts for fast default startup.",
);
assertIncludes(
  shellSource,
  'args: ["-NoLogo", "-NoProfile"]',
  "Workspace preview PowerShell profiles should match the fast detected default args.",
);
assertIncludes(
  settingsViewSource,
  'args: ["-NoLogo", "-NoProfile"]',
  "Settings preview PowerShell profiles should match the fast detected default args.",
);

console.log("local terminal launcher source check passed");
