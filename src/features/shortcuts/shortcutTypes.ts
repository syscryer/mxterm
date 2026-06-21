export type ShortcutActionId = string;
export type ShortcutCategoryId = "general" | "terminal" | "search" | "tools";
export type ShortcutScope = "global" | "workspace" | "terminal" | "terminal-search";

export interface ShortcutCategory {
  id: ShortcutCategoryId;
  label: string;
}

export interface ShortcutAction {
  allowInTerminal: boolean;
  category: ShortcutCategoryId;
  defaultBinding: string | null;
  description: string;
  id: ShortcutActionId;
  label: string;
  scope: ShortcutScope;
}

export interface ParsedShortcutBinding {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

export interface ShortcutConflict {
  actionIds: ShortcutActionId[];
  binding: string;
}
