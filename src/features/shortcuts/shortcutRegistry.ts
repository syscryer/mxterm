import type { ShortcutAction, ShortcutCategory } from "./shortcutTypes";

export const aiSendMessageShortcutActionId = "ai.sendMessage";

export const shortcutCategories: ShortcutCategory[] = [
  { id: "general", label: "通用" },
  { id: "terminal", label: "终端" },
  { id: "search", label: "搜索" },
  { id: "tools", label: "工具" },
];

export const shortcutActions: ShortcutAction[] = [
  {
    id: "connection.quickOpen",
    category: "general",
    label: "快速打开连接",
    description: "打开连接搜索面板。",
    defaultBinding: "Ctrl+Shift+O",
    scope: "global",
    allowInTerminal: true,
  },
  {
    id: "settings.open",
    category: "general",
    label: "打开设置",
    description: "进入设置页面。",
    defaultBinding: "Ctrl+,",
    scope: "global",
    allowInTerminal: true,
  },
  {
    id: "terminal.newTab",
    category: "terminal",
    label: "新建终端 Tab",
    description: "基于当前上下文新建 SSH 或本地终端 Tab。",
    defaultBinding: "Ctrl+Shift+T",
    scope: "terminal",
    allowInTerminal: true,
  },
  {
    id: "terminal.closeTab",
    category: "terminal",
    label: "关闭当前终端 Tab",
    description: "关闭当前活动的 SSH 或本地终端 Tab。",
    defaultBinding: "Ctrl+Shift+W",
    scope: "terminal",
    allowInTerminal: true,
  },
  {
    id: "terminal.search.toggle",
    category: "search",
    label: "打开或关闭终端搜索",
    description: "切换当前终端的搜索条。",
    defaultBinding: "Ctrl+Shift+F",
    scope: "terminal",
    allowInTerminal: true,
  },
  {
    id: "terminal.search.next",
    category: "search",
    label: "搜索下一个",
    description: "跳转到当前终端搜索的下一个结果。",
    defaultBinding: "F3",
    scope: "terminal-search",
    allowInTerminal: true,
  },
  {
    id: "terminal.search.previous",
    category: "search",
    label: "搜索上一个",
    description: "跳转到当前终端搜索的上一个结果。",
    defaultBinding: "Shift+F3",
    scope: "terminal-search",
    allowInTerminal: true,
  },
  {
    id: aiSendMessageShortcutActionId,
    category: "tools",
    label: "发送 AI 消息",
    description: "在 AI 对话输入框中发送当前问题。",
    defaultBinding: "Enter",
    scope: "workspace",
    allowInTerminal: false,
  },
  {
    id: "commandSender.toggle",
    category: "tools",
    label: "打开或关闭 Command Sender",
    description: "切换命令发送面板。",
    defaultBinding: "Ctrl+Shift+K",
    scope: "workspace",
    allowInTerminal: true,
  },
];

export const defaultShortcutBindings: Record<string, string | null> = Object.fromEntries(
  shortcutActions.map((action) => [action.id, action.defaultBinding]),
);

export function getShortcutAction(actionId: string) {
  return shortcutActions.find((action) => action.id === actionId) || null;
}

export function resolveShortcutBindingById(
  bindings: Record<string, string | null | undefined>,
  actionId: string,
) {
  const action = getShortcutAction(actionId);
  return action ? resolveShortcutBinding(bindings, action) : null;
}

export function resolveShortcutBinding(
  bindings: Record<string, string | null | undefined>,
  action: ShortcutAction,
) {
  return Object.prototype.hasOwnProperty.call(bindings, action.id)
    ? bindings[action.id] ?? null
    : action.defaultBinding;
}
