import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { ChevronDown, Check } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface AppSelectOption<T extends string> {
  disabled?: boolean;
  group?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  searchText?: string;
  value: T;
  variant?: "action";
}

interface AppSelectProps<T extends string> {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  menuMinWidth?: number;
  openRequestKey?: number;
  options: Array<AppSelectOption<T>>;
  placeholder?: ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  value: T;
  onChange: (value: T) => void;
  onOpenChange?: (open: boolean) => void;
}

interface MenuPosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

interface MenuPositionOptions {
  groupCount: number;
  menuMinWidth?: number;
  optionCount: number;
  searchable?: boolean;
}

export function AppSelect<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  menuMinWidth,
  openRequestKey = 0,
  options,
  placeholder = "请选择",
  searchable = false,
  searchPlaceholder = "搜索",
  value,
  onChange,
  onOpenChange,
}: AppSelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const displayedOptions = useMemo(
    () => filterAppSelectOptions(options, searchQuery, searchable),
    [options, searchQuery, searchable],
  );
  const selectedIndex = Math.max(
    0,
    displayedOptions.findIndex((option) => option.value === value),
  );
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const selectLabel = selectedOption?.label || placeholder;
  const groupCount = countOptionGroups(displayedOptions);

  function setSelectOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
    onOpenChange?.(nextOpen);
  }

  useEffect(() => {
    if (!openRequestKey || disabled) {
      return;
    }
    setSelectOpen(true);
    if (!searchable) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, [disabled, openRequestKey]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    setPosition(
      readMenuPosition(triggerRef.current, {
        groupCount,
        menuMinWidth,
        optionCount: displayedOptions.length,
        searchable,
      }),
    );
    setHighlightedIndex(selectedIndex);
  }, [displayedOptions.length, groupCount, menuMinWidth, open, searchable, selectedIndex]);

  useEffect(() => {
    if (!open || !searchable) {
      return;
    }
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchable]);

  useEffect(() => {
    if (!open || !searchable) {
      return;
    }
    setHighlightedIndex(findFirstEnabledOptionIndex(displayedOptions));
  }, [displayedOptions, open, searchQuery, searchable]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }

      setSelectOpen(false);
    }

    function updatePosition() {
      setPosition(
        readMenuPosition(triggerRef.current, {
          groupCount,
          menuMinWidth,
          optionCount: displayedOptions.length,
          searchable,
        }),
      );
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [displayedOptions.length, groupCount, menuMinWidth, open, searchable]);

  function chooseOption(option: AppSelectOption<T>) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setSelectOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveHighlight(direction: 1 | -1) {
    const nextIndex = findEnabledOptionIndex(displayedOptions, highlightedIndex, direction);
    if (nextIndex >= 0) {
      setHighlightedIndex(nextIndex);
    }
  }

  function handleMenuWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const menu = menuRef.current;
    if (!menu || menu.scrollHeight <= menu.clientHeight) {
      return;
    }

    const previousScrollTop = menu.scrollTop;
    const nextScrollTop = Math.min(
      menu.scrollHeight - menu.clientHeight,
      Math.max(0, previousScrollTop + event.deltaY),
    );

    if (nextScrollTop === previousScrollTop) {
      return;
    }

    menu.scrollTop = nextScrollTop;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className={`app-select ${className || ""}`}>
      <button
        ref={triggerRef}
        className="app-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setSelectOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setSelectOpen(true);
              return;
            }
            moveHighlight(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setSelectOpen(true);
              return;
            }
            moveHighlight(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              setSelectOpen(true);
              return;
            }
            const option = displayedOptions[highlightedIndex];
            if (option) {
              chooseOption(option);
            }
          } else if (event.key === "Escape") {
            setSelectOpen(false);
          }
        }}
      >
        <span className="app-select-value">
          {selectedOption?.icon || null}
          <span className="app-select-value-label">{selectLabel}</span>
        </span>
        <ChevronDown className="ui-icon" aria-hidden="true" />
      </button>

      {open && position
        ? createPortal(
            <DismissableLayerBranch asChild>
              <div
                ref={menuRef}
                className="app-select-menu select-menu-content"
                style={
                  {
                    "--app-select-menu-left": `${position.left}px`,
                    "--app-select-menu-top": `${position.top}px`,
                    "--app-select-menu-width": `${position.width}px`,
                    "--app-select-menu-max-height": `${position.maxHeight}px`,
                  } as CSSProperties
                }
                role="listbox"
                aria-label={ariaLabel}
                onWheel={handleMenuWheel}
              >
                {searchable ? (
                  <div className="app-select-search-shell">
                    <input
                      ref={searchInputRef}
                      className="app-select-search-input"
                      type="search"
                      aria-label={searchPlaceholder}
                      placeholder={searchPlaceholder}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveHighlight(event.key === "ArrowDown" ? 1 : -1);
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          const option = displayedOptions[highlightedIndex];
                          if (option) {
                            chooseOption(option);
                          }
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setSelectOpen(false);
                          window.requestAnimationFrame(() => triggerRef.current?.focus());
                        }
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    />
                  </div>
                ) : null}
                {displayedOptions.map((option, index) => {
                  const showGroup =
                    option.group && option.group !== displayedOptions[index - 1]?.group;
                  return (
                    <Fragment key={option.value}>
                      {showGroup ? (
                        <div className="app-select-group-label" role="presentation">
                          {option.group}
                        </div>
                      ) : null}
                      <button
                        className="app-select-item select-menu-item"
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        data-highlighted={index === highlightedIndex ? "" : undefined}
                        data-state={option.value === value ? "checked" : undefined}
                        data-variant={option.variant}
                        disabled={option.disabled}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          chooseOption(option);
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          chooseOption(option);
                        }}
                      >
                        {option.icon ? (
                          option.icon
                        ) : option.value === value ? (
                          <Check className="ui-icon" aria-hidden="true" />
                        ) : (
                          <span aria-hidden="true" />
                        )}
                        <span>{option.label}</span>
                      </button>
                    </Fragment>
                  );
                })}
                {searchable && displayedOptions.length === 0 ? (
                  <div className="app-select-empty">没有匹配项</div>
                ) : null}
              </div>
            </DismissableLayerBranch>,
            document.body,
          )
        : null}
    </div>
  );
}

function readMenuPosition(
  trigger: HTMLButtonElement | null,
  { groupCount, menuMinWidth = 0, optionCount, searchable = false }: MenuPositionOptions,
): MenuPosition | null {
  if (!trigger) {
    return null;
  }

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 5;
  const optionHeight = 34;
  const menuPaddingY = 16;
  const menuBorderY = 2;
  const menuChromeHeight =
    menuPaddingY + menuBorderY + 2 + groupCount * 22 + (searchable ? 38 : 0);
  const menuWidth = Math.max(rect.width, menuMinWidth);
  const minimumMenuHeight = optionHeight + menuChromeHeight;
  const desiredHeight = Math.min(
    260,
    Math.max(minimumMenuHeight, optionCount * optionHeight + menuChromeHeight),
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const availableHeight = Math.max(
    minimumMenuHeight,
    (openAbove ? spaceAbove : spaceBelow) - gap,
  );
  const maxHeight = Math.min(260, desiredHeight, availableHeight);

  return {
    left: Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
    ),
    maxHeight,
    top: openAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
    width: menuWidth,
  };
}

function countOptionGroups<T extends string>(options: Array<AppSelectOption<T>>) {
  return options.reduce((count, option, index) =>
    option.group && option.group !== options[index - 1]?.group ? count + 1 : count,
  0);
}

function filterAppSelectOptions<T extends string>(
  options: Array<AppSelectOption<T>>,
  query: string,
  searchable: boolean,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!searchable || !normalizedQuery) {
    return options;
  }
  return options.filter((option) =>
    appSelectOptionSearchText(option).toLocaleLowerCase().includes(normalizedQuery),
  );
}

function appSelectOptionSearchText<T extends string>(option: AppSelectOption<T>) {
  if (option.searchText) {
    return option.searchText;
  }
  if (typeof option.label === "string" || typeof option.label === "number") {
    return option.label.toString();
  }
  return "";
}

function findFirstEnabledOptionIndex<T extends string>(options: Array<AppSelectOption<T>>) {
  return Math.max(
    0,
    options.findIndex((option) => !option.disabled),
  );
}

function findEnabledOptionIndex<T extends string>(
  options: Array<AppSelectOption<T>>,
  currentIndex: number,
  direction: 1 | -1,
) {
  if (options.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + offset * direction + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
  }

  return -1;
}
