import { readFileSync } from "node:fs";

const workspaceShell = readFileSync("src/features/layout/WorkspaceShell.tsx", "utf8");
const appSelect = readFileSync("src/shared/ui/AppSelect.tsx", "utf8");
const appCss = readFileSync("src/styles/app.css", "utf8");
const remoteFilePanel = readFileSync("src/features/files/RemoteFilePanel.tsx", "utf8");

for (const needle of [
  "terminalWrite",
  "CommandSenderDeliveryStatus",
  "CommandSenderTarget",
  "commandSenderOpen",
  "commandSenderTargets",
  "selectedCommandTargetKeys",
  "commandSenderInput",
  "commandSenderHistory",
  "commandSenderRisky",
  "sendCommandToTargets",
  "buildCommandSenderTargets",
  "terminalWrite(target.sessionId, payload)",
  "activateCommandSenderTarget",
  "command-sender-toggle",
  "terminal-subtab-actions",
  "terminal-subtab-panel-toggle",
  "PanelRightOpen",
  "command-sender-panel",
  "命令操作台",
  "Command Sender",
  "发送并回车",
  "发送不回车",
  "未发送",
  "已写入",
  "发送失败",
]) {
  if (!workspaceShell.includes(needle)) {
    throw new Error(`WorkspaceShell is missing Command Sender contract: ${needle}`);
  }
}

for (const needle of [
  ".command-sender-panel",
  ".command-sender-console",
  ".command-sender-target",
  ".command-sender-target.selected",
  ".command-sender-toggle.active",
  ".terminal-subtab-actions",
  ".terminal-subtab-panel-toggle",
  ".command-sender-actions",
  ".command-sender-risk-warning",
]) {
  if (!appCss.includes(needle)) {
    throw new Error(`app.css is missing Command Sender styles: ${needle}`);
  }
}

if (/\.command-sender-toggle[^{]*\{(?:(?!\n\})[\s\S])*margin-left:\s*auto;/.test(appCss)) {
  throw new Error("Command Sender toggle must not be pushed to the far edge over the right-panel expand button.");
}

if (!/\.terminal-subtab-actions\s*\{(?:(?!\n\})[\s\S])*margin-left:\s*auto;/.test(appCss)) {
  throw new Error("Terminal subtab action group should own the far-right alignment.");
}

if (/right-collapse-button-floating/.test(workspaceShell) || /\.right-collapse-button-floating/.test(appCss)) {
  throw new Error("Right pane expand button should live in the terminal toolbar action group, not as a floating overlay.");
}

for (const needle of [
  ".app-select-menu::-webkit-scrollbar",
  ".app-select-menu::-webkit-scrollbar-button",
  ".app-select-menu::-webkit-scrollbar-thumb",
  ".app-select-menu::-webkit-scrollbar-thumb:active",
  "scrollbar-color: color-mix(in srgb, var(--mx-subtle)",
]) {
  if (!appCss.includes(needle)) {
    throw new Error(`AppSelect portal menu is missing shared scrollbar styling: ${needle}`);
  }
}

if (/syncInput|同步输入中：/.test(workspaceShell)) {
  throw new Error("Command Sender MVP must not implement real Sync Input behavior.");
}

for (const needle of [
  "menuMinWidth?: number",
  "optionCount: number",
  "menuChromeHeight",
  "menuBorderY",
  "optionCount * optionHeight + menuChromeHeight",
  "handleMenuWheel",
  "onWheel={handleMenuWheel}",
  "menuMinWidth={176}",
]) {
  const source = needle === "menuMinWidth={176}" ? workspaceShell : appSelect;
  if (!source.includes(needle)) {
    throw new Error(`Command Sender compact selects must support wider menus: ${needle}`);
  }
}

if (!/function handleMenuWheel\(event: ReactWheelEvent<HTMLDivElement>\)[\s\S]*scrollTop[\s\S]*event\.deltaY[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/.test(appSelect)) {
  throw new Error("Command Sender AppSelect menus must keep wheel scrolling usable inside modal scroll locks.");
}

const commandSenderToggle = workspaceShell.match(
  /<button[\s\S]*?command-sender-toggle[\s\S]*?<\/button>/,
)?.[0];
if (!commandSenderToggle) {
  throw new Error("Command Sender toolbar toggle button is missing.");
}
if (commandSenderToggle.includes("<Clipboard ")) {
  throw new Error("Command Sender toolbar toggle should not use the copy-looking Clipboard icon.");
}
if (!commandSenderToggle.includes('<Send className="ui-icon" aria-hidden="true" />')) {
  throw new Error("Command Sender toolbar toggle should use the send icon.");
}

const terminalToolbarActions = workspaceShell.match(
  /<div\s+className="terminal-subtab-actions"[\s\S]*?<\/div>/,
)?.[0];
if (!terminalToolbarActions) {
  throw new Error("Terminal subtabs should include a far-right action group.");
}
for (const needle of ["command-sender-toggle", "terminal-subtab-panel-toggle", "PanelRightOpen"]) {
  if (!terminalToolbarActions.includes(needle)) {
    throw new Error(`Terminal subtab action group is missing: ${needle}`);
  }
}

const rightPaneCollapseButton = remoteFilePanel.match(
  /<button[\s\S]*?right-collapse-button[\s\S]*?<\/button>/,
)?.[0];
if (!rightPaneCollapseButton || !rightPaneCollapseButton.includes("PanelRightClose")) {
  throw new Error("Right pane collapse button should use the panel-close icon.");
}

if (appSelect.includes("Math.max(50, optionCount * 34 + 16)")) {
  throw new Error("AppSelect menu height must account for menu border and padding to avoid fake scrollbars.");
}

if (workspaceShell.includes("commandSenderAppendEnter") || workspaceShell.includes("发送时追加回车")) {
  throw new Error("Command Sender must use explicit send buttons instead of an append-enter checkbox.");
}

if (!workspaceShell.includes("void sendCommandToTargets(true);")) {
  throw new Error("Command Sender Ctrl/Cmd+Enter should send with Enter by default.");
}

if (workspaceShell.includes("const results = await Promise.all")) {
  throw new Error("Command Sender sequential mode must not dispatch target writes with Promise.all.");
}

if (!/for \(const target of targets\)[\s\S]*await terminalWrite\(target\.sessionId, payload\)/.test(workspaceShell)) {
  throw new Error("Command Sender sequential mode must await terminalWrite per target.");
}

if (!/setCommandSenderLastSentLabel\([\s\S]*?\);\s*setCommandSenderInput\(""\);/.test(workspaceShell)) {
  throw new Error("Command Sender must clear the input after a completed send attempt.");
}

console.log("Command Sender MVP source check passed.");
