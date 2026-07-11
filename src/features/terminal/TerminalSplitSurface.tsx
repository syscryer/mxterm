import { Eraser, Plus, Search, X } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AppSelect } from "../../shared/ui/AppSelect";
import { Tooltip } from "../../shared/ui/Tooltip";
import {
  clampTerminalSplitRatio,
  collectTerminalSplitPanes,
  collectTerminalSplitResizers,
  terminalPaneBindingKey,
  updateTerminalSplitRatio,
  type TerminalPaneBinding,
  type TerminalSplitBounds,
  type TerminalSplitNode,
  type TerminalSplitPane,
  type TerminalSplitResizer,
} from "./terminalSplitLayout";

const terminalSplitPaneGap = 1;
const terminalSplitPaneHeaderHeight = 30;
const terminalSplitResizeStep = 0.05;
const terminalSplitMinimumPaneWidth = 220;
const terminalSplitMinimumPaneHeight = 150;

export interface TerminalSplitSessionOption {
  binding?: TerminalPaneBinding;
  connectionId?: string;
  disabled?: boolean;
  group?: string;
  icon?: ReactNode;
  label: string;
  searchOpen?: boolean;
  status?: string;
  value: string;
  variant?: "action";
}

interface TerminalSplitLayoutProps {
  focusedPaneId: string;
  layout: TerminalSplitNode;
  pickerOpenRequest?: { key: number; paneId: string } | null;
  sessionOptions: TerminalSplitSessionOption[];
  syncEnabled: boolean;
  syncParticipantKeys: ReadonlySet<string>;
  onClearPane: (binding: TerminalPaneBinding) => void;
  onClosePane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onPickerOpenChange: (paneId: string, open: boolean) => void;
  onRatioChange: (splitId: string, ratio: number) => void;
  onResizeEnd: () => void;
  onSelectSession: (paneId: string, option: TerminalSplitSessionOption) => void;
  onToggleSearch: (binding: TerminalPaneBinding) => void;
}

interface ActiveResize {
  pointerId: number;
  resizer: TerminalSplitResizer;
}

export function TerminalSplitLayout({
  focusedPaneId,
  layout,
  pickerOpenRequest = null,
  sessionOptions,
  syncEnabled,
  syncParticipantKeys,
  onClearPane,
  onClosePane,
  onFocusPane,
  onPickerOpenChange,
  onRatioChange,
  onResizeEnd,
  onSelectSession,
  onToggleSearch,
}: TerminalSplitLayoutProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [activeResize, setActiveResize] = useState<ActiveResize | null>(null);
  const panes = useMemo(() => collectTerminalSplitPanes(layout), [layout]);
  const resizers = useMemo(() => collectTerminalSplitResizers(layout), [layout]);
  const sessionOptionByValue = useMemo(
    () => new Map(sessionOptions.map((option) => [option.value, option])),
    [sessionOptions],
  );
  const occupiedBindingKeys = useMemo(
    () =>
      new Set(
        panes.flatMap((pane) =>
          pane.binding ? [terminalPaneBindingKey(pane.binding)] : [],
        ),
      ),
    [panes],
  );

  useEffect(() => {
    if (!activeResize) {
      return;
    }
    const resize = activeResize;

    function updateRatio(event: PointerEvent) {
      const surface = surfaceRef.current;
      if (!surface || event.pointerId !== resize.pointerId) {
        return;
      }
      onRatioChange(
        resize.resizer.id,
        readPointerRatio(surface, layout, resize.resizer, event.clientX, event.clientY),
      );
    }

    function endResize(event: PointerEvent) {
      if (event.pointerId !== resize.pointerId) {
        return;
      }
      setActiveResize(null);
      onResizeEnd();
    }

    window.addEventListener("pointermove", updateRatio);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    return () => {
      window.removeEventListener("pointermove", updateRatio);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
    };
  }, [activeResize, layout, onRatioChange, onResizeEnd]);

  function startResize(event: ReactPointerEvent<HTMLButtonElement>, resizer: TerminalSplitResizer) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveResize({ pointerId: event.pointerId, resizer });
  }

  return (
    <div
      className="terminal-split-layout"
      data-resizing={activeResize ? "true" : undefined}
      ref={surfaceRef}
    >
      {panes.map((pane, index) => {
        const bindingKey = pane.binding ? terminalPaneBindingKey(pane.binding) : null;
        const selectedOption = bindingKey ? sessionOptionByValue.get(bindingKey) : undefined;
        const focused = pane.id === focusedPaneId;
        const syncParticipant = Boolean(bindingKey && syncParticipantKeys.has(bindingKey));
        const syncRole = syncEnabled && syncParticipant ? (focused ? "主输入" : "接收") : null;
        const options = buildPaneOptions(pane, sessionOptions, occupiedBindingKeys);

        return (
          <section
            className={`terminal-split-pane-frame ${focused ? "is-focused" : ""} ${
              pane.binding ? "has-terminal" : "is-empty"
            } ${syncRole === "主输入" ? "is-sync-source" : ""} ${
              syncRole === "接收" ? "is-sync-target" : ""
            }`}
            data-pane-id={pane.id}
            key={pane.id}
            style={terminalSplitFrameStyle(pane.bounds)}
            onPointerDown={() => onFocusPane(pane.id)}
          >
            <header className="terminal-split-pane-header">
              <span className="terminal-split-pane-order" aria-hidden="true">
                {(index + 1).toString()}
              </span>
              {pane.binding ? (
                <AppSelect
                  ariaLabel={`切换分屏终端 ${index + 1}`}
                  className="terminal-split-session-select"
                  menuMinWidth={248}
                  options={options}
                  searchable
                  searchPlaceholder="搜索会话或 SSH 连接"
                  value={bindingKey || emptyPaneValue(pane.id)}
                  onChange={(nextValue) => {
                    const option = options.find((item) => item.value === nextValue);
                    if (option && !option.disabled) {
                      onSelectSession(pane.id, option);
                    }
                  }}
                />
              ) : (
                <AppSelect
                  ariaLabel={`为 pane ${index + 1} 选择终端`}
                  className="terminal-split-session-select terminal-split-empty-header-select"
                  menuMinWidth={248}
                  openRequestKey={
                    pickerOpenRequest?.paneId === pane.id ? pickerOpenRequest.key : 0
                  }
                  options={options}
                  placeholder="选择终端"
                  searchable
                  searchPlaceholder="搜索会话或 SSH 连接"
                  value={emptyPaneValue(pane.id)}
                  onChange={(nextValue) => {
                    const option = options.find((item) => item.value === nextValue);
                    if (option && !option.disabled) {
                      onSelectSession(pane.id, option);
                    }
                  }}
                  onOpenChange={(open) => onPickerOpenChange(pane.id, open)}
                />
              )}
              <span className="terminal-split-pane-meta">
                {syncRole ? <span className="terminal-split-sync-role">{syncRole}</span> : null}
                {selectedOption?.status ? (
                  <span className="terminal-split-session-status">{selectedOption.status}</span>
                ) : null}
              </span>
              <div className="terminal-split-pane-actions">
                <Tooltip label="搜索当前终端">
                  <button
                    className={`terminal-split-pane-action ${
                      selectedOption?.searchOpen ? "active" : ""
                    }`}
                    type="button"
                    aria-label={`搜索终端 ${index + 1}`}
                    aria-pressed={Boolean(selectedOption?.searchOpen)}
                    disabled={!pane.binding}
                    onClick={() => pane.binding && onToggleSearch(pane.binding)}
                  >
                    <Search className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="清屏">
                  <button
                    className="terminal-split-pane-action"
                    type="button"
                    aria-label={`清屏终端 ${index + 1}`}
                    disabled={!pane.binding}
                    onClick={() => pane.binding && onClearPane(pane.binding)}
                  >
                    <Eraser className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="关闭当前 pane">
                  <button
                    className="terminal-split-pane-action terminal-split-pane-close"
                    type="button"
                    aria-label={`关闭终端 pane ${index + 1}`}
                    onClick={() => onClosePane(pane.id)}
                  >
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </header>
          </section>
        );
      })}
      {resizers.map((resizer) => (
        <button
          className={`terminal-split-resizer terminal-split-resizer-${resizer.direction}`}
          key={resizer.id}
          type="button"
          role="separator"
          aria-label={
            resizer.direction === "row"
              ? "调整左右终端分屏宽度，双击恢复均分"
              : "调整上下终端分屏高度，双击恢复均分"
          }
          aria-orientation={resizer.direction === "row" ? "vertical" : "horizontal"}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(resizer.ratio * 100)}
          style={terminalSplitResizerStyle(resizer)}
          onDoubleClick={() => {
            onRatioChange(resizer.id, 0.5);
            onResizeEnd();
          }}
          onKeyDown={(event) => {
            const isBackward =
              (resizer.direction === "row" && event.key === "ArrowLeft") ||
              (resizer.direction === "column" && event.key === "ArrowUp");
            const isForward =
              (resizer.direction === "row" && event.key === "ArrowRight") ||
              (resizer.direction === "column" && event.key === "ArrowDown");
            if (!isBackward && !isForward) {
              return;
            }
            event.preventDefault();
            const surface = surfaceRef.current;
            const nextRatio = clampTerminalSplitRatio(
              resizer.ratio + (isForward ? terminalSplitResizeStep : -terminalSplitResizeStep),
            );
            onRatioChange(
              resizer.id,
              surface
                ? clampRatioForMinimumPaneSize(surface, layout, resizer, nextRatio)
                : nextRatio,
            );
            onResizeEnd();
          }}
          onPointerDown={(event) => startResize(event, resizer)}
        />
      ))}
    </div>
  );
}

export function terminalSplitContentStyle(bounds: TerminalSplitBounds): CSSProperties {
  const frame = terminalSplitFrameStyle(bounds);
  return {
    ...frame,
    bottom: addCssLength(frame.bottom, terminalSplitPaneGap),
    left: addCssLength(frame.left, terminalSplitPaneGap),
    right: addCssLength(frame.right, terminalSplitPaneGap),
    top: addCssLength(frame.top, terminalSplitPaneHeaderHeight + terminalSplitPaneGap),
  };
}

function buildPaneOptions(
  pane: TerminalSplitPane,
  sessionOptions: TerminalSplitSessionOption[],
  occupiedBindingKeys: ReadonlySet<string>,
) {
  const currentBindingKey = pane.binding ? terminalPaneBindingKey(pane.binding) : null;
  return [
    {
      disabled: true,
      group: "会话",
      label: "选择终端",
      value: emptyPaneValue(pane.id),
    },
    ...sessionOptions
      .filter(
        (option) =>
          !option.binding ||
          option.value === currentBindingKey ||
          !occupiedBindingKeys.has(option.value),
      )
      .map((option) => ({
        ...option,
        icon:
          option.icon ??
          (option.variant === "action" ? (
            <Plus className="ui-icon" aria-hidden="true" />
          ) : undefined),
      })),
  ];
}

function emptyPaneValue(paneId: string) {
  return `empty:${paneId}`;
}

function terminalSplitFrameStyle(bounds: TerminalSplitBounds): CSSProperties {
  return {
    bottom: percentLength(1 - bounds.top - bounds.height),
    left: percentLength(bounds.left),
    right: percentLength(1 - bounds.left - bounds.width),
    top: percentLength(bounds.top),
  };
}

function terminalSplitResizerStyle(resizer: TerminalSplitResizer): CSSProperties {
  const { bounds, direction, ratio } = resizer;
  if (direction === "row") {
    return {
      bottom: percentLength(1 - bounds.top - bounds.height),
      left: `calc(${percentLength(bounds.left + bounds.width * ratio)} - 4px)`,
      top: percentLength(bounds.top),
    };
  }

  return {
    left: percentLength(bounds.left),
    right: percentLength(1 - bounds.left - bounds.width),
    top: `calc(${percentLength(bounds.top + bounds.height * ratio)} - 4px)`,
  };
}

function readPointerRatio(
  surface: HTMLDivElement,
  layout: TerminalSplitNode,
  resizer: TerminalSplitResizer,
  clientX: number,
  clientY: number,
) {
  const rect = surface.getBoundingClientRect();
  const { bounds, direction } = resizer;
  const size = direction === "row" ? rect.width * bounds.width : rect.height * bounds.height;
  const offset =
    direction === "row"
      ? clientX - rect.left - rect.width * bounds.left
      : clientY - rect.top - rect.height * bounds.top;
  const nextRatio = clampTerminalSplitRatio(size > 0 ? offset / size : resizer.ratio);
  return clampRatioForMinimumPaneSize(surface, layout, resizer, nextRatio);
}

function clampRatioForMinimumPaneSize(
  surface: HTMLDivElement,
  layout: TerminalSplitNode,
  resizer: TerminalSplitResizer,
  requestedRatio: number,
) {
  const currentRatio = resizer.ratio;
  if (terminalSplitRatioFits(surface, layout, resizer.id, requestedRatio)) {
    return requestedRatio;
  }
  if (!terminalSplitRatioFits(surface, layout, resizer.id, currentRatio)) {
    return currentRatio;
  }

  let validRatio = currentRatio;
  let invalidRatio = requestedRatio;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidate = (validRatio + invalidRatio) / 2;
    if (terminalSplitRatioFits(surface, layout, resizer.id, candidate)) {
      validRatio = candidate;
    } else {
      invalidRatio = candidate;
    }
  }
  return validRatio;
}

function terminalSplitRatioFits(
  surface: HTMLDivElement,
  layout: TerminalSplitNode,
  splitId: string,
  ratio: number,
) {
  const rect = surface.getBoundingClientRect();
  const candidateLayout = updateTerminalSplitRatio(layout, splitId, ratio);
  return collectTerminalSplitPanes(candidateLayout).every(
    (pane) =>
      pane.bounds.width * rect.width >= terminalSplitMinimumPaneWidth &&
      pane.bounds.height * rect.height >= terminalSplitMinimumPaneHeight,
  );
}

function addCssLength(value: CSSProperties["top"], pixels: number) {
  return `calc(${value || "0px"} + ${pixels}px)`;
}

function percentLength(value: number) {
  return `${Math.max(0, value * 100).toFixed(4)}%`;
}
