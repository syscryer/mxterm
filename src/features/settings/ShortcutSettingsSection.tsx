import { useMemo, useState, type KeyboardEvent } from "react";
import { Keyboard, Pencil, RotateCcw, Search, X } from "lucide-react";

import { Keybinding } from "../../shared/ui/Keybinding";
import {
  defaultShortcutBindings,
  shortcutActions,
  shortcutCategories,
} from "../shortcuts/shortcutRegistry";
import {
  normalizeShortcutBinding,
  shortcutBindingFromKeyboardEvent,
} from "../shortcuts/shortcutKeys";
import {
  findShortcutConflicts,
  validateShortcutBinding,
} from "../shortcuts/shortcutValidation";
import type { ShortcutAction } from "../shortcuts/shortcutTypes";
import type { ShortcutSettings } from "./settingsTypes";

interface ShortcutSettingsSectionProps {
  settings: ShortcutSettings;
  onUpdate: (update: Partial<ShortcutSettings>) => void;
}

export function ShortcutSettingsSection({
  settings,
  onUpdate,
}: ShortcutSettingsSectionProps) {
  const [query, setQuery] = useState("");
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const currentBindings = settings.bindings;
  const filteredActions = useMemo(
    () =>
      shortcutActions.filter((action) => {
        if (!normalizedQuery) {
          return true;
        }
        const binding = resolveShortcutBinding(currentBindings, action);
        const category = shortcutCategories.find((item) => item.id === action.category);
        return [action.label, action.description, binding || "", category?.label || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [currentBindings, normalizedQuery],
  );

  function updateBinding(action: ShortcutAction, binding: string | null) {
    onUpdate({
      bindings: {
        ...currentBindings,
        [action.id]: binding,
      },
    });
  }

  function resetAll() {
    setEditingActionId(null);
    setLocalError(null);
    onUpdate({ bindings: { ...defaultShortcutBindings } });
  }

  function clearBinding(action: ShortcutAction) {
    setEditingActionId(null);
    setLocalError(null);
    updateBinding(action, null);
  }

  function commitBinding(action: ShortcutAction, rawBinding: string) {
    const normalized = normalizeShortcutBinding(rawBinding);
    const validation = validateShortcutBinding(normalized);
    if (!validation.valid) {
      setLocalError(validation.message || "快捷键不可用。");
      return;
    }

    const nextBindings = {
      ...currentBindings,
      [action.id]: normalized,
    };
    const conflict = findShortcutConflicts(nextBindings).find((item) =>
      item.actionIds.includes(action.id),
    );
    if (conflict) {
      const conflictAction = shortcutActions.find(
        (item) => item.id !== action.id && conflict.actionIds.includes(item.id),
      );
      setLocalError(
        conflictAction
          ? `与“${conflictAction.label}”冲突。`
          : "与其他快捷键冲突。",
      );
      return;
    }

    setLocalError(null);
    setEditingActionId(null);
    onUpdate({ bindings: nextBindings });
  }

  function handleCaptureKeyDown(action: ShortcutAction, event: KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setEditingActionId(null);
      setLocalError(null);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      clearBinding(action);
      return;
    }

    const binding = shortcutBindingFromKeyboardEvent(event.nativeEvent);
    if (!binding) {
      return;
    }
    commitBinding(action, binding);
  }

  return (
    <section className="settings-page-section">
      <header className="settings-section-head settings-section-head-row">
        <div>
          <h1>快捷键</h1>
          <p>管理 mXterm 应用内快捷键，不影响系统级热键。</p>
        </div>
        <button className="settings-action-button" type="button" onClick={resetAll}>
          <RotateCcw className="ui-icon" aria-hidden="true" />
          <span>恢复默认</span>
        </button>
      </header>

      <div className="shortcut-toolbar">
        <label className="shortcut-search" aria-label="搜索快捷键">
          <Search className="ui-icon" aria-hidden="true" />
          <input
            value={query}
            placeholder="搜索动作或快捷键"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      {shortcutCategories.map((category) => {
        const actions = filteredActions.filter((action) => action.category === category.id);
        if (actions.length === 0) {
          return null;
        }

        return (
          <section className="settings-panel shortcut-group" key={category.id}>
            <div className="shortcut-group-title">
              <Keyboard className="ui-icon" aria-hidden="true" />
              <span>{category.label}</span>
            </div>
            <div className="shortcut-list">
              {actions.map((action) => {
                const binding = resolveShortcutBinding(currentBindings, action);
                const editing = editingActionId === action.id;
                return (
                  <div className="shortcut-row" key={action.id}>
                    <div className="shortcut-row-copy">
                      <strong>{action.label}</strong>
                      <small>{action.description}</small>
                    </div>
                    <div className="shortcut-row-control">
                      {editing ? (
                        <button
                          autoFocus
                          className="shortcut-capture-button"
                          type="button"
                          onBlur={() => {
                            setEditingActionId(null);
                            setLocalError(null);
                          }}
                          onKeyDown={(event) => handleCaptureKeyDown(action, event)}
                        >
                          按下新的快捷键
                        </button>
                      ) : (
                        <Keybinding value={binding} />
                      )}
                      <button
                        className="settings-action-button shortcut-icon-action"
                        type="button"
                        aria-label={`编辑${action.label}快捷键`}
                        onClick={() => {
                          setEditingActionId(action.id);
                          setLocalError(null);
                        }}
                      >
                        <Pencil className="ui-icon" aria-hidden="true" />
                      </button>
                      <button
                        className="settings-action-button shortcut-icon-action"
                        type="button"
                        aria-label={`清空${action.label}快捷键`}
                        disabled={!binding}
                        onClick={() => clearBinding(action)}
                      >
                        <X className="ui-icon" aria-hidden="true" />
                      </button>
                    </div>
                    {editing && localError ? (
                      <small className="shortcut-row-error">{localError}</small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {filteredActions.length === 0 ? (
        <div className="settings-panel shortcut-empty">
          没有匹配的快捷键。
        </div>
      ) : null}

      <p className="settings-note">
        当前仅管理应用内快捷键。终端聚焦时，普通 Shell 快捷键会继续交给终端处理。
      </p>
    </section>
  );
}

function resolveShortcutBinding(
  bindings: Record<string, string | null>,
  action: ShortcutAction,
) {
  return Object.prototype.hasOwnProperty.call(bindings, action.id)
    ? bindings[action.id]
    : action.defaultBinding;
}
