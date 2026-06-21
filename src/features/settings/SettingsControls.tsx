import type { ReactNode } from "react";
import { Minus, Plus, type LucideIcon } from "lucide-react";

interface SettingsRowProps {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon: LucideIcon;
  stack?: boolean;
  title: ReactNode;
}

interface SegmentedControlOption<T extends string> {
  icon?: LucideIcon;
  label: string;
  value: T;
}

export function SettingsRow({
  children,
  className,
  description,
  icon: Icon,
  stack = false,
  title,
}: SettingsRowProps) {
  const rowClassName = ["settings-row", stack ? "settings-row-stack" : "", className || ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClassName}>
      <div className="settings-row-label">
        <Icon className="ui-icon" aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            className={option.value === value ? "active" : ""}
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon className="ui-icon" aria-hidden="true" /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stepper<T extends number>({
  value,
  values,
  onChange,
}: {
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  const currentIndex = values.indexOf(value);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < values.length - 1;

  return (
    <div className="settings-stepper">
      <button
        type="button"
        aria-label="减小"
        disabled={!canDecrease}
        onClick={() => {
          if (canDecrease) {
            onChange(values[currentIndex - 1]);
          }
        }}
      >
        <Minus className="ui-icon" aria-hidden="true" />
      </button>
      <span>{value.toString()}</span>
      <button
        type="button"
        aria-label="增大"
        disabled={!canIncrease}
        onClick={() => {
          if (canIncrease) {
            onChange(values[currentIndex + 1]);
          }
        }}
      >
        <Plus className="ui-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SettingsToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
    >
      <span />
    </button>
  );
}
