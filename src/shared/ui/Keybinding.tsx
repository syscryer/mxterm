import { formatShortcutBinding, normalizeShortcutBinding } from "../../features/shortcuts/shortcutKeys";

interface KeybindingProps {
  className?: string;
  compact?: boolean;
  emptyLabel?: string;
  value: string | null | undefined;
}

export function Keybinding({
  className,
  compact = false,
  emptyLabel = "未设置",
  value,
}: KeybindingProps) {
  const normalized = normalizeShortcutBinding(value);
  const rootClassName = [
    "keybinding",
    compact ? "keybinding-compact" : "",
    !normalized ? "empty" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  if (compact) {
    return <kbd className={rootClassName}>{normalized || emptyLabel}</kbd>;
  }

  if (!normalized) {
    return <span className={rootClassName}>{emptyLabel}</span>;
  }

  return (
    <span className={rootClassName} aria-label={formatShortcutBinding(normalized)}>
      {normalized.split("+").map((part, index, parts) => (
        <span className="keybinding-part" key={`${part}-${index.toString()}`}>
          <kbd>{part}</kbd>
          {index < parts.length - 1 ? <span className="keybinding-plus">+</span> : null}
        </span>
      ))}
    </span>
  );
}
