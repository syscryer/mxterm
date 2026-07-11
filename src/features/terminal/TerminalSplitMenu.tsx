import {
  Check,
  Keyboard,
  PanelsTopLeft,
  SquareSplitHorizontal,
  SquareSplitVertical,
} from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

import { AnchoredSurfacePortal } from "../../shared/ui/AnchoredSurfacePortal";
import { Tooltip } from "../../shared/ui/Tooltip";

interface TerminalSplitMenuProps {
  autoCreateSameSession: boolean;
  canAddPane?: boolean;
  disabled?: boolean;
  onAutoCreateSameSessionChange: (enabled: boolean) => void;
  onSplitDown: () => void;
  onSplitFour: () => void;
  onSplitRight: () => void;
}

export interface TerminalSplitSyncPaneOption {
  disabled?: boolean;
  key: string;
  label: string;
  locked?: boolean;
}

interface TerminalSplitSyncMenuProps {
  enabled: boolean;
  panes: TerminalSplitSyncPaneOption[];
  participantKeys: ReadonlySet<string>;
  onEnabledChange: (enabled: boolean) => void;
  onParticipantChange: (key: string, participant: boolean) => void;
}

export function TerminalSplitMenu({
  autoCreateSameSession,
  canAddPane = true,
  disabled = false,
  onAutoCreateSameSessionChange,
  onSplitDown,
  onSplitFour,
  onSplitRight,
}: TerminalSplitMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  useMenuAutoFocus(open, menuRef);

  function select(action: () => void) {
    setOpen(false);
    action();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="terminal-split-menu">
      <Tooltip label="分屏布局">
        <button
          ref={triggerRef}
          className="add-subtab terminal-split-menu-trigger"
          type="button"
          aria-label="分屏布局"
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <PanelsTopLeft className="ui-icon" aria-hidden="true" />
        </button>
      </Tooltip>
      <AnchoredSurfacePortal
        align="end"
        anchorRef={triggerRef}
        ariaLabel="终端分屏操作"
        className="terminal-split-menu-content dropdown-menu-content"
        desiredHeight={172}
        minHeight={160}
        open={open}
        role="menu"
        width={206}
        onOpenChange={setOpen}
      >
        <div ref={menuRef} onKeyDown={handleMenuArrowNavigation}>
          <button
            className="terminal-split-menu-item terminal-split-same-session-toggle dropdown-menu-item"
            type="button"
            role="menuitemcheckbox"
            aria-checked={autoCreateSameSession}
            onClick={() => onAutoCreateSameSessionChange(!autoCreateSameSession)}
          >
            <span className="terminal-split-menu-check" aria-hidden="true">
              {autoCreateSameSession ? <Check className="ui-icon" /> : null}
            </span>
            <span>同会话</span>
          </button>
          <div className="terminal-split-menu-separator" role="separator" />
          <button
            className="terminal-split-menu-item dropdown-menu-item"
            type="button"
            role="menuitem"
            disabled={disabled || !canAddPane}
            onClick={() => select(onSplitRight)}
          >
            <SquareSplitVertical className="ui-icon" aria-hidden="true" />
            <span>向右分屏</span>
          </button>
          <button
            className="terminal-split-menu-item dropdown-menu-item"
            type="button"
            role="menuitem"
            disabled={disabled || !canAddPane}
            onClick={() => select(onSplitDown)}
          >
            <SquareSplitHorizontal className="ui-icon" aria-hidden="true" />
            <span>向下分屏</span>
          </button>
          <button
            className="terminal-split-menu-item dropdown-menu-item"
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => select(onSplitFour)}
          >
            <PanelsTopLeft className="ui-icon" aria-hidden="true" />
            <span>四分屏</span>
          </button>
        </div>
      </AnchoredSurfacePortal>
    </div>
  );
}

export function TerminalSplitSyncMenu({
  enabled,
  panes,
  participantKeys,
  onEnabledChange,
  onParticipantChange,
}: TerminalSplitSyncMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  useMenuAutoFocus(open, menuRef);
  const availablePanes = panes.filter((pane) => !pane.disabled);
  const canEnable = availablePanes.length >= 2;

  return (
    <div className="terminal-split-menu">
      <Tooltip label={enabled ? "同步输入已开启" : "同步输入"}>
        <button
          ref={triggerRef}
          className={`add-subtab terminal-split-sync-trigger ${enabled ? "active" : ""}`}
          type="button"
          aria-label="同步输入设置"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-pressed={enabled}
          disabled={!canEnable}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        >
          <Keyboard className="ui-icon" aria-hidden="true" />
        </button>
      </Tooltip>
      <AnchoredSurfacePortal
        align="end"
        anchorRef={triggerRef}
        ariaLabel="同步输入设置"
        className="terminal-split-menu-content terminal-split-sync-menu dropdown-menu-content"
        desiredHeight={Math.min(256, 52 + panes.length * 34)}
        minHeight={120}
        open={open}
        role="menu"
        width={248}
        onOpenChange={setOpen}
      >
        <div ref={menuRef} onKeyDown={handleMenuArrowNavigation}>
          <button
            className="terminal-split-menu-item terminal-split-sync-toggle dropdown-menu-item"
            type="button"
            role="menuitemcheckbox"
            aria-checked={enabled}
            disabled={!canEnable}
            onClick={() => onEnabledChange(!enabled)}
          >
            <span className="terminal-split-menu-check" aria-hidden="true">
              {enabled ? <Check className="ui-icon" /> : null}
            </span>
            <span>{enabled ? "关闭同步输入" : "开启同步输入"}</span>
          </button>
          <div className="terminal-split-menu-separator" role="separator" />
          <div className="terminal-split-menu-label">参与同步</div>
          {panes.map((pane) => {
            const checked = participantKeys.has(pane.key);
            return (
              <button
                className="terminal-split-menu-item dropdown-menu-item"
                key={pane.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                data-locked={pane.locked ? "true" : undefined}
                disabled={pane.disabled || pane.locked}
                onClick={() => onParticipantChange(pane.key, !checked)}
              >
                <span className="terminal-split-menu-check" aria-hidden="true">
                  {checked ? <Check className="ui-icon" /> : null}
                </span>
                <span>{pane.label}</span>
              </button>
            );
          })}
        </div>
      </AnchoredSurfacePortal>
    </div>
  );
}

function useMenuAutoFocus(open: boolean, menuRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      firstEnabledMenuButton(menuRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuRef, open]);
}

function handleMenuArrowNavigation(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
    return;
  }
  const buttons = enabledMenuButtons(event.currentTarget);
  if (buttons.length === 0) {
    return;
  }
  event.preventDefault();
  const currentIndex = buttons.findIndex((button) => button === document.activeElement);
  if (event.key === "Home") {
    buttons[0]?.focus();
    return;
  }
  if (event.key === "End") {
    buttons[buttons.length - 1]?.focus();
    return;
  }
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = (Math.max(0, currentIndex) + direction + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

function firstEnabledMenuButton(container: HTMLDivElement | null) {
  return enabledMenuButtons(container)[0] || null;
}

function enabledMenuButtons(container: HTMLDivElement | null) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
}
