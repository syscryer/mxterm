import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Settings,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { AiProviderConfig, AiProviderModelOption } from "./aiTypes";
import { aiProviderModelsList } from "../../shared/tauri/commands";

const MENU_WIDTH = 200;
const SUBMENU_WIDTH = 224;
const MENU_GAP = 4;
const VIEWPORT_PADDING = 12;
const MENU_ROW_HEIGHT = 34;
const MENU_CHROME_HEIGHT = 16;
const MENU_SEPARATOR_HEIGHT = 9;

interface ModelListState {
  cacheKey: string;
  loading: boolean;
  models: AiProviderModelOption[];
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

interface SubmenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface AiModelPickerProps {
  providers: AiProviderConfig[];
  selectedProviderId: string;
  selectedModel: string;
  disabled?: boolean;
  onSelect: (providerId: string, model: string) => void;
  onModelCapabilitiesChange?: (
    providerId: string,
    model: AiProviderModelOption | null,
  ) => void;
  onManage: () => void;
}

export function AiModelPicker({
  providers,
  selectedProviderId,
  selectedModel,
  disabled = false,
  onSelect,
  onModelCapabilitiesChange,
  onManage,
}: AiModelPickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const providerRowRects = useRef<Map<string, DOMRect>>(new Map());
  const providerRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [modelCache, setModelCache] = useState<Record<string, ModelListState>>({});

  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) || null;
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) || null;
  const selectedModelLabel =
    modelCache[selectedProviderId]?.models.find(
      (model) => model.id === selectedModel,
    )?.display_name?.trim() || selectedModel || selectedProvider?.model || "未配置";

  const ensureProviderModels = useCallback(
    (provider: AiProviderConfig) => {
      const cacheKey = `${provider.id}:${provider.model}:${provider.endpoint}:${provider.models.map((model) => `${model.id}:${model.enabled}`).join(",")}`;
      const cached = modelCache[provider.id];
      if (cached && cached.cacheKey === cacheKey) {
        return;
      }
      const configuredModels = getConfiguredProviderModels(provider);
      const fallbackModels =
        configuredModels.length > 0
          ? configuredModels
          : provider.model.trim()
            ? [withDefaultModelCapabilities({ id: provider.model.trim(), display_name: null })]
            : [];

      // Settings already contains the user's enabled model list. Render it immediately;
      // a remote /models request should never delay opening the picker.
      if (configuredModels.length > 0) {
        setModelCache((previous) => ({
          ...previous,
          [provider.id]: { cacheKey, loading: false, models: configuredModels },
        }));
        return;
      }

      setModelCache((previous) => ({
        ...previous,
        [provider.id]: {
          cacheKey,
          loading: true,
          models: fallbackModels,
        },
      }));
      void aiProviderModelsList({
        id: provider.id,
        name: provider.name,
        provider: provider.provider,
        api_format: provider.api_format,
        endpoint: provider.endpoint,
        model: provider.model,
        models: provider.models,
      })
        .then((remoteModels) => {
          const configuredModels = provider.models
            .filter((model) => model.enabled)
            .map((model) => {
              const remote = remoteModels.find((candidate) => candidate.id === model.id);
              return withDefaultModelCapabilities(
                remote || { id: model.id, display_name: null, subtitle: null },
              );
            });
          const models =
            configuredModels.length > 0
              ? configuredModels
              : remoteModels.filter((model) => model.id === provider.model.trim());
          setModelCache((previous) => {
            if (previous[provider.id]?.cacheKey !== cacheKey) {
              return previous;
            }
            return {
              ...previous,
              [provider.id]: { cacheKey, loading: false, models },
            };
          });
        })
        .catch(() => {
          setModelCache((previous) => {
            if (previous[provider.id]?.cacheKey !== cacheKey) {
              return previous;
            }
            return {
              ...previous,
              [provider.id]: { cacheKey, loading: false, models: fallbackModels },
            };
          });
        });
    },
    [modelCache],
  );

  function setPickerOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setActiveProviderId(null);
    }
  }

  function activateProvider(provider: AiProviderConfig, row: HTMLElement) {
    providerRowRects.current.set(provider.id, row.getBoundingClientRect());
    setActiveProviderId(provider.id);
    ensureProviderModels(provider);
  }

  useEffect(() => {
    if (selectedProvider) {
      ensureProviderModels(selectedProvider);
    }
  }, [ensureProviderModels, selectedProvider]);

  function chooseModel(providerId: string, model: string) {
    onSelect(providerId, model);
    setPickerOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveRowFocus(row: HTMLElement, direction: 1 | -1) {
    const container = row.closest("[data-picker-list]");
    const rows = container
      ? Array.from(
          container.querySelectorAll<HTMLButtonElement>(
            "button.select-menu-item:not(:disabled):not([aria-disabled])",
          ),
        )
      : [];
    const index = rows.indexOf(row as HTMLButtonElement);
    if (index < 0 || rows.length === 0) {
      return;
    }
    rows[(index + direction + rows.length) % rows.length]?.focus();
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setPosition(
      readProviderMenuPosition(triggerRef.current, providers.length + 1),
    );
    window.requestAnimationFrame(() => {
      const target = selectedProviderId
        ? providerRowRefs.current.get(selectedProviderId)
        : undefined;
      (target || providerRowRefs.current.values().next().value)?.focus();
    });

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) ||
          menuRef.current?.contains(target) ||
          submenuRef.current?.contains(target))
      ) {
        return;
      }
      setPickerOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPickerOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }

    function handleViewportChange() {
      setPickerOpen(false);
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, providers.length]);

  const submenuPosition =
    open && activeProvider && position
      ? readSubmenuPosition(
          providerRowRects.current.get(activeProvider.id) || null,
          position,
          (modelCache[activeProvider.id]?.models.length || 1) + 1,
        )
      : null;
  const activeModels = activeProvider
    ? modelCache[activeProvider.id]?.models || []
    : [];

  useEffect(() => {
    if (!onModelCapabilitiesChange || !selectedProviderId || !selectedModel) {
      return;
    }
    const model = modelCache[selectedProviderId]?.models.find(
      (candidate) => candidate.id === selectedModel,
    );
    onModelCapabilitiesChange(selectedProviderId, model || null);
  }, [modelCache, onModelCapabilitiesChange, selectedModel, selectedProviderId]);

  return (
    <div className="app-select ai-model-picker">
      <button
        ref={triggerRef}
        className="app-select-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`模型：${selectedModelLabel}`}
        title={selectedModelLabel}
        disabled={disabled || providers.length === 0}
        onClick={(event) => {
          if (event.detail !== 0) {
            setPickerOpen(!open);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              setPickerOpen(true);
            }
          }
        }}
      >
        <span className="app-select-value">
          <Boxes className="ui-icon" aria-hidden="true" />
          <span className="app-select-value-label">{selectedModelLabel}</span>
        </span>
        <ChevronDown className="ui-icon" aria-hidden="true" />
      </button>

      {open && position
        ? createPortal(
            <DismissableLayerBranch asChild>
              <div
                ref={menuRef}
                className="app-select-menu select-menu-content ai-model-picker-menu"
                style={menuStyle(position)}
                role="menu"
                aria-label="选择供应商与模型"
                data-picker-list
              >
                {providers.map((provider) => {
                  const isActiveProvider = provider.id === selectedProviderId;
                  const submenuOpen = provider.id === activeProviderId;
                  return (
                    <button
                      key={provider.id}
                      ref={(element) => {
                        if (element) {
                          providerRowRefs.current.set(provider.id, element);
                        } else {
                          providerRowRefs.current.delete(provider.id);
                        }
                      }}
                      className="app-select-item select-menu-item ai-model-picker-provider"
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={submenuOpen}
                      data-highlighted={submenuOpen ? "" : undefined}
                      onFocus={(event) => activateProvider(provider, event.currentTarget)}
                      onMouseEnter={(event) =>
                        activateProvider(provider, event.currentTarget)
                      }
                      onClick={(event) =>
                        activateProvider(provider, event.currentTarget)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveRowFocus(
                            event.currentTarget,
                            event.key === "ArrowDown" ? 1 : -1,
                          );
                        } else if (event.key === "ArrowRight" || event.key === "Enter") {
                          event.preventDefault();
                          activateProvider(provider, event.currentTarget);
                          focusFirstSubmenuItem();
                        }
                      }}
                    >
                      {isActiveProvider ? (
                        <Check className="ui-icon" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <span className="ai-model-picker-provider-label">
                        {provider.name}
                      </span>
                      <ChevronRight
                        className="ui-icon ai-model-picker-sub-icon"
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
                <div className="context-menu-separator" role="separator" />
                <button
                  className="app-select-item select-menu-item ai-model-picker-provider"
                  data-variant="action"
                  type="button"
                  role="menuitem"
                  onMouseEnter={() => setActiveProviderId(null)}
                  onFocus={() => setActiveProviderId(null)}
                  onClick={() => {
                    setPickerOpen(false);
                    onManage();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveRowFocus(
                        event.currentTarget,
                        event.key === "ArrowDown" ? 1 : -1,
                      );
                    }
                  }}
                >
                  <Settings className="ui-icon" aria-hidden="true" />
                  <span className="ai-model-picker-provider-label">管理模型</span>
                </button>
              </div>
            </DismissableLayerBranch>,
            document.body,
          )
        : null}

      {open && activeProvider && submenuPosition
        ? createPortal(
            <DismissableLayerBranch asChild>
              <div
                ref={submenuRef}
                className="app-select-menu select-menu-content ai-model-picker-sub"
                style={submenuStyle(submenuPosition)}
                role="menu"
                aria-label={`${activeProvider.name} 模型`}
                data-picker-list
              >
                {modelCache[activeProvider.id]?.loading ? (
                  <div className="select-menu-item ai-model-picker-hint" aria-disabled="true">
                    <LoaderCircle className="ui-icon ai-tool-spinner" aria-hidden="true" />
                    <span>加载模型…</span>
                  </div>
                ) : null}
                {activeModels.map((model) => {
                  const selected =
                    activeProvider.id === selectedProviderId &&
                    model.id === selectedModel;
                  const label = model.display_name?.trim() || model.id;
                  return (
                    <button
                      key={model.id}
                      className="app-select-item select-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-state={selected ? "checked" : undefined}
                      title={model.id}
                      onClick={() => chooseModel(activeProvider.id, model.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveRowFocus(
                            event.currentTarget,
                            event.key === "ArrowDown" ? 1 : -1,
                          );
                        } else if (event.key === "ArrowLeft") {
                          event.preventDefault();
                          setActiveProviderId(null);
                          providerRowRefs.current.get(activeProvider.id)?.focus();
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          chooseModel(activeProvider.id, model.id);
                        }
                      }}
                    >
                      {selected ? (
                        <Check className="ui-icon" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <span className="ai-model-picker-model-label">{label}</span>
                    </button>
                  );
                })}
                {!modelCache[activeProvider.id]?.loading && activeModels.length === 0 ? (
                  <div className="select-menu-item ai-model-picker-hint" aria-disabled="true">
                    <span aria-hidden="true" />
                    <span>暂无可用模型</span>
                  </div>
                ) : null}
              </div>
            </DismissableLayerBranch>,
            document.body,
          )
        : null}
    </div>
  );
}

function getConfiguredProviderModels(provider: AiProviderConfig): AiProviderModelOption[] {
  return provider.models
    .filter((model) => model.enabled)
    .map((model) =>
      withDefaultModelCapabilities({
        id: model.id,
        display_name: null,
        subtitle: null,
      }),
    );
}

function withDefaultModelCapabilities(model: AiProviderModelOption): AiProviderModelOption {
  // /models 未提供能力时，沿用内置模型目录规则；接口明确返回空数组时保持无选项。
  if (model.reasoning_levels != null) {
    return model;
  }
  const knownLevels = knownReasoningLevelsForModel(model.id);
  if (knownLevels) {
    return {
      ...model,
      reasoning_levels: knownLevels,
      reasoning_default_level: "max",
    };
  }
  return {
    ...model,
    reasoning_levels: ["disabled", "enabled"],
    reasoning_default_level: "enabled",
  };
}

function knownReasoningLevelsForModel(modelId: string): string[] | null {
  const normalized = modelId.trim().toLocaleLowerCase();
  const rules: Array<{ fragment: string; levels: string[] }> = [
    { fragment: "deepseek-v4-flash", levels: ["disabled", "low", "high", "max"] },
    { fragment: "deepseek-v4-pro", levels: ["disabled", "low", "high", "max"] },
    { fragment: "deepseek-flash", levels: ["disabled", "low", "high", "max"] },
    { fragment: "deepseek-v4.1-flash", levels: ["disabled", "low", "high", "max"] },
    { fragment: "deepseek-v4-1-flash", levels: ["disabled", "low", "high", "max"] },
    { fragment: "glm-5.3", levels: ["low", "high", "max"] },
    { fragment: "glm-5.2", levels: ["disabled", "high", "max"] },
    { fragment: "gpt-5.6", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
    { fragment: "gpt-5.3-codex", levels: ["low", "medium", "high", "xhigh"] },
    { fragment: "gpt-6-astra", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "gpt-5.4-pro", levels: ["medium", "high", "xhigh"] },
    { fragment: "gpt-5.4", levels: ["none", "low", "medium", "high", "xhigh"] },
    { fragment: "claude-opus-5", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "claude-sonnet-5", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "claude-fable-5", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "claude-fable-5.1", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "claude-mythos-5.1", levels: ["low", "medium", "high", "xhigh", "max"] },
    { fragment: "grok-4.6", levels: ["low", "medium", "high", "xhigh"] },
    { fragment: "kimi-k3", levels: ["low", "high", "max"] },
    { fragment: "kimi-k2.7-code", levels: ["enabled"] },
    { fragment: "k3-256k", levels: ["low", "high", "max"] },
    {
      fragment: "qwen3.8-omni-flash",
      levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    },
    { fragment: "qwen3.8-max", levels: ["low", "medium", "xhigh"] },
    { fragment: "qwen3.8-flash", levels: ["low", "medium", "xhigh"] },
  ];
  return rules.find((rule) => normalized.includes(rule.fragment))?.levels || null;
}

function menuStyle(position: MenuPosition): CSSProperties {
  return {
    "--app-select-menu-left": `${position.left}px`,
    "--app-select-menu-top": `${position.top}px`,
    "--app-select-menu-width": `${position.width}px`,
    "--app-select-menu-max-height": `${position.maxHeight}px`,
  } as CSSProperties;
}

function submenuStyle(position: SubmenuPosition): CSSProperties {
  return {
    "--app-select-menu-left": `${position.left}px`,
    "--app-select-menu-top": `${position.top}px`,
    "--app-select-menu-width": `${SUBMENU_WIDTH}px`,
    "--app-select-menu-max-height": `${position.maxHeight}px`,
  } as CSSProperties;
}

function readProviderMenuPosition(
  trigger: HTMLButtonElement | null,
  rowCount: number,
): MenuPosition | null {
  if (!trigger) {
    return null;
  }
  const rect = trigger.getBoundingClientRect();
  const estimated =
    Math.max(rowCount, 1) * MENU_ROW_HEIGHT +
    MENU_SEPARATOR_HEIGHT +
    MENU_CHROME_HEIGHT;
  const spaceAbove = rect.top - VIEWPORT_PADDING - MENU_GAP;
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING - MENU_GAP;
  const openAbove = spaceBelow < estimated && spaceAbove > spaceBelow;
  const availableHeight = Math.max(
    MENU_ROW_HEIGHT,
    openAbove ? spaceAbove : spaceBelow,
  );
  const placementHeight = Math.min(estimated, availableHeight);
  const top = openAbove
    ? rect.top - MENU_GAP - placementHeight
    : rect.bottom + MENU_GAP;
  return {
    left: clamp(
      rect.right - MENU_WIDTH,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING),
    ),
    maxHeight: availableHeight,
    top,
    width: MENU_WIDTH,
  };
}

function readSubmenuPosition(
  rowRect: DOMRect | null,
  menuPosition: MenuPosition,
  rowCount: number,
): SubmenuPosition | null {
  if (!rowRect) {
    return null;
  }
  const estimated = Math.max(rowCount, 1) * MENU_ROW_HEIGHT + MENU_CHROME_HEIGHT;
  const rightSpace =
    window.innerWidth - (menuPosition.left + menuPosition.width) - VIEWPORT_PADDING;
  const openRight = rightSpace - MENU_GAP >= SUBMENU_WIDTH;
  const left = openRight
    ? menuPosition.left + menuPosition.width + MENU_GAP
    : Math.max(
        VIEWPORT_PADDING,
        menuPosition.left - SUBMENU_WIDTH - MENU_GAP,
      );
  const maxHeight = Math.max(
    MENU_ROW_HEIGHT,
    window.innerHeight - VIEWPORT_PADDING * 2,
  );
  const placementHeight = Math.min(estimated, maxHeight);
  const top = clamp(
    rowRect.top - 5,
    VIEWPORT_PADDING,
    Math.max(
      VIEWPORT_PADDING,
      window.innerHeight - placementHeight - VIEWPORT_PADDING,
    ),
  );
  return { left, maxHeight, top };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function focusFirstSubmenuItem() {
  window.requestAnimationFrame(() => {
    document
      .querySelector<HTMLButtonElement>(
        ".ai-model-picker-sub .select-menu-item:not(:disabled):not([aria-disabled])",
      )
      ?.focus();
  });
}
