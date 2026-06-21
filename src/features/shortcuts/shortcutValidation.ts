import { defaultShortcutBindings, shortcutActions } from "./shortcutRegistry";
import type { ShortcutAction, ShortcutConflict } from "./shortcutTypes";
import {
  isPlainPrintableShortcut,
  normalizeShortcutBinding,
  parseShortcutBinding,
} from "./shortcutKeys";

export interface ShortcutValidationResult {
  code?: "invalid" | "plain-printable" | "reserved";
  message?: string;
  valid: boolean;
}

const reservedBindings = new Set([
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+E",
  "Ctrl+L",
  "Ctrl+R",
  "Ctrl+V",
  "Ctrl+W",
  "Ctrl+X",
]);

export function validateShortcutBinding(value: string | null | undefined): ShortcutValidationResult {
  if (value === null || value === undefined || value === "") {
    return { valid: true };
  }

  const normalized = normalizeShortcutBinding(value);
  if (!normalized || !parseShortcutBinding(normalized)) {
    return {
      code: "invalid",
      message: "快捷键格式无效。",
      valid: false,
    };
  }

  if (isPlainPrintableShortcut(normalized)) {
    return {
      code: "plain-printable",
      message: "普通字符会影响输入，不能作为应用快捷键。",
      valid: false,
    };
  }

  if (reservedBindings.has(normalized)) {
    return {
      code: "reserved",
      message: "该组合键通常由终端或编辑器使用，不能作为应用快捷键。",
      valid: false,
    };
  }

  return { valid: true };
}

export function findShortcutConflicts(
  bindings: Record<string, string | null | undefined>,
  actions: ShortcutAction[] = shortcutActions,
): ShortcutConflict[] {
  const actionIds = new Set(actions.map((action) => action.id));
  const byBinding = new Map<string, string[]>();

  for (const [actionId, binding] of Object.entries(bindings)) {
    if (!actionIds.has(actionId)) {
      continue;
    }
    const normalized = normalizeShortcutBinding(binding);
    if (!normalized) {
      continue;
    }
    const ids = byBinding.get(normalized) || [];
    ids.push(actionId);
    byBinding.set(normalized, ids);
  }

  return Array.from(byBinding.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([binding, ids]) => ({ actionIds: ids, binding }));
}

export function normalizeShortcutBindings(
  value: unknown,
  fallback: Record<string, string | null> = defaultShortcutBindings,
) {
  const record = isRecord(value) ? value : {};
  const next: Record<string, string | null> = {};

  for (const action of shortcutActions) {
    const raw = record[action.id];
    if (raw === null) {
      next[action.id] = null;
      continue;
    }

    const normalized = typeof raw === "string" ? normalizeShortcutBinding(raw) : null;
    next[action.id] =
      normalized && validateShortcutBinding(normalized).valid
        ? normalized
        : fallback[action.id] ?? action.defaultBinding;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
