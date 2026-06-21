import { useEffect, useMemo } from "react";

import { shortcutActions } from "./shortcutRegistry";
import { keyboardEventMatchesShortcut } from "./shortcutKeys";
import type { ShortcutAction, ShortcutActionId } from "./shortcutTypes";

export interface ShortcutHandler {
  enabled?: () => boolean;
  run: () => void;
}

export function useShortcutManager({
  bindings,
  handlers,
}: {
  bindings: Record<string, string | null>;
  handlers: Partial<Record<ShortcutActionId, ShortcutHandler>>;
}) {
  const activeBindings = useMemo(
    () =>
      shortcutActions.map((action) => ({
        action,
        binding: resolveShortcutBinding(bindings, action),
      })),
    [bindings],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = isTerminalTarget(target);
      const inTerminalSearch = isTerminalSearchTarget(target);

      if (isEditableTarget(target) && !inTerminal && !inTerminalSearch) {
        return;
      }

      for (const item of activeBindings) {
        if (!item.binding || !keyboardEventMatchesShortcut(event, item.binding)) {
          continue;
        }
        if (inTerminal && !item.action.allowInTerminal) {
          continue;
        }
        if (inTerminalSearch && !canRunInsideTerminalSearch(item.action)) {
          continue;
        }

        const handler = handlers[item.action.id];
        if (!handler || handler.enabled?.() === false) {
          continue;
        }

        event.preventDefault();
        event.stopPropagation();
        handler.run();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeBindings, handlers]);
}

function resolveShortcutBinding(
  bindings: Record<string, string | null>,
  action: ShortcutAction,
) {
  return Object.prototype.hasOwnProperty.call(bindings, action.id)
    ? bindings[action.id]
    : action.defaultBinding;
}

function isTerminalTarget(target: Element | null) {
  return Boolean(target?.closest(".xterm"));
}

function isTerminalSearchTarget(target: Element | null) {
  return Boolean(target?.closest(".terminal-search-bar"));
}

function isEditableTarget(target: Element | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function canRunInsideTerminalSearch(action: ShortcutAction) {
  return action.scope === "terminal" || action.scope === "terminal-search";
}
