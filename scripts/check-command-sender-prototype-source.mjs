import { readFileSync } from "node:fs";

const prototype = readFileSync("prototype/light-neutral/mxterm-empty-session.html", "utf8");

if (prototype.includes('class="command-sender-panel open"')) {
  throw new Error("Command sender should not be open by default.");
}

for (const needle of [
  "commandSenderToggle",
  "terminal-mode-button",
  "command-sender-panel",
  "command-sender-console",
  "title-session-tab",
  "192.168.10.75[Harbor]",
  "终端 2",
  "terminal-tool-button",
  "aria-label=\"命令发送器\"",
  "Command Sender",
  "命令操作台",
  "command-console-toggle",
  "关闭",
  "aria-label=\"关闭命令操作台\"",
  "同步输入: 关",
  "sync-input-banner",
  "command-target-checkbox",
  "command-target-count",
  "command-target-select-all",
  "command-target-terminal",
  "192.168.10.75[Harbor] / 终端 2",
  "commandSelectAllTargets",
  "command-target-delivery",
  "has-delivery",
  "has-failed-delivery",
  "command-risk-warning",
  "command-send-result",
  "command-compose-footer",
  "command-last-sent",
  "data-session-target",
  "data-delivery-jump",
  "data-command-target",
  "发送不回车",
  "投递状态",
  "已写入",
  "发送失败",
  "检测到高风险片段",
]) {
  if (!prototype.includes(needle)) {
    throw new Error(`Command sender prototype is missing: ${needle}`);
  }
}

for (const behaviorNeedle of [
  "function updateCommandSenderState()",
  "function commandLooksRisky(command)",
  "function activateSession(target)",
  "function commandTargetForCheckbox(checkbox)",
  "function deliveryResultForTarget(target)",
  "function simulateCommandSend(appendEnter)",
  "commandSenderToggle.addEventListener",
  "commandSenderPanelToggle.addEventListener",
  "function setCommandSenderExpanded(nextExpanded)",
  "commandSenderPanel.classList.toggle(\"open\", nextExpanded)",
  "commandSelectAllTargets.indeterminate",
  "commandSelectAllTargets.addEventListener",
  "commandTargetTerminalSelects.forEach",
  "syncInputToggleButton.addEventListener",
  "sendCommandButton.addEventListener",
  "sendNoEnterButton.addEventListener",
]) {
  if (!prototype.includes(behaviorNeedle)) {
    throw new Error(`Command sender prototype behavior is missing: ${behaviorNeedle}`);
  }
}

console.log("Command sender prototype source check passed.");
