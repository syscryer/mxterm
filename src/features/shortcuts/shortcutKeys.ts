import type { ParsedShortcutBinding } from "./shortcutTypes";

const modifierOrder: Array<keyof Omit<ParsedShortcutBinding, "key">> = [
  "ctrl",
  "shift",
  "alt",
  "meta",
];

const modifierLabels: Record<keyof Omit<ParsedShortcutBinding, "key">, string> = {
  alt: "Alt",
  ctrl: "Ctrl",
  meta: "Meta",
  shift: "Shift",
};

const modifierAliases: Record<string, keyof Omit<ParsedShortcutBinding, "key">> = {
  alt: "alt",
  control: "ctrl",
  ctrl: "ctrl",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  option: "alt",
  shift: "shift",
  super: "meta",
  win: "meta",
};

const keyAliases: Record<string, string> = {
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  comma: ",",
  delete: "Delete",
  del: "Delete",
  down: "ArrowDown",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  left: "ArrowLeft",
  minus: "-",
  period: ".",
  plus: "+",
  right: "ArrowRight",
  space: "Space",
  tab: "Tab",
  up: "ArrowUp",
};

const keyboardModifierKeys = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

export function parseShortcutBinding(value: string | null | undefined): ParsedShortcutBinding | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const binding: ParsedShortcutBinding = {
    alt: false,
    ctrl: false,
    key: "",
    meta: false,
    shift: false,
  };

  for (const part of parts) {
    const normalizedPart = part.toLowerCase();
    const modifier = modifierAliases[normalizedPart];
    if (modifier) {
      binding[modifier] = true;
      continue;
    }
    if (binding.key) {
      return null;
    }
    binding.key = normalizeShortcutKey(part);
  }

  return binding.key ? binding : null;
}

export function normalizeShortcutBinding(value: string | null | undefined) {
  const binding = parseShortcutBinding(value);
  return binding ? serializeShortcutBinding(binding) : null;
}

export function serializeShortcutBinding(binding: ParsedShortcutBinding) {
  const parts = modifierOrder
    .filter((modifier) => binding[modifier])
    .map((modifier) => modifierLabels[modifier]);
  parts.push(binding.key);
  return parts.join("+");
}

export function formatShortcutBinding(value: string | null | undefined) {
  const normalized = normalizeShortcutBinding(value);
  return normalized ? normalized.split("+").join(" + ") : "未设置";
}

export function shortcutBindingFromKeyboardEvent(event: KeyboardEvent) {
  if (keyboardModifierKeys.has(event.key)) {
    return null;
  }

  return serializeShortcutBinding({
    alt: event.altKey,
    ctrl: event.ctrlKey,
    key: normalizeShortcutKey(event.key),
    meta: event.metaKey,
    shift: event.shiftKey,
  });
}

export function keyboardEventMatchesShortcut(event: KeyboardEvent, value: string | null | undefined) {
  const binding = parseShortcutBinding(value);
  if (!binding || keyboardModifierKeys.has(event.key)) {
    return false;
  }

  return (
    event.altKey === binding.alt &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.shiftKey === binding.shift &&
    normalizeShortcutKey(event.key) === binding.key
  );
}

export function normalizeShortcutKey(key: string) {
  const trimmed = key.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (keyAliases[lower]) {
    return keyAliases[lower];
  }

  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (trimmed.length === 1) {
    return /^[a-z]$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
  }

  return trimmed;
}

export function isPlainPrintableShortcut(value: string | null | undefined) {
  const binding = parseShortcutBinding(value);
  return Boolean(
    binding &&
      !binding.alt &&
      !binding.ctrl &&
      !binding.meta &&
      !binding.shift &&
      binding.key.length === 1,
  );
}
