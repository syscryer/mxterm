import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";

export interface TabContextMenuAction {
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  label: string;
  onSelect: () => void;
  separatorBefore?: boolean;
}

interface TabContextMenuProps {
  actions: TabContextMenuAction[];
  children: ReactNode;
}

export function TabContextMenu({ actions, children }: TabContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-content tab-context-menu-content">
          {actions.map((action) => (
            <ContextMenu.Group key={action.label}>
              {action.separatorBefore ? (
                <ContextMenu.Separator className="context-menu-separator" />
              ) : null}
              <ContextMenu.Item
                className={`context-menu-item tab-context-menu-item ${action.danger ? "danger" : ""}`}
                disabled={action.disabled}
                onSelect={() => action.onSelect()}
              >
                <span className="tab-context-menu-label">{action.label}</span>
                {action.hint ? <span className="tab-context-menu-hint">{action.hint}</span> : null}
              </ContextMenu.Item>
            </ContextMenu.Group>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
