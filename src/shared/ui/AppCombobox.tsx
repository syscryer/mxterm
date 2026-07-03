import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { ChevronDown, Check } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface AppComboboxOption<T extends string> {
  disabled?: boolean;
  label: ReactNode;
  searchText?: string;
  value: T;
}

interface AppComboboxProps<T extends string> {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  emptyText?: ReactNode;
  menuMinWidth?: number;
  options: Array<AppComboboxOption<T>>;
  placeholder?: string;
  spellCheck?: boolean;
  value: string;
  onChange: (value: string) => void;
}

interface MenuPosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

interface MenuPositionOptions {
  menuMinWidth?: number;
  optionCount: number;
}

export function AppCombobox<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  emptyText = "没有匹配项",
  menuMinWidth,
  options,
  placeholder = "请输入或选择",
  spellCheck = false,
  value,
  onChange,
}: AppComboboxProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const filteredOptions = useMemo(() => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) {
      return options;
    }
    return options.filter((option) => {
      const haystack = `${option.value}\n${option.searchText || ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [options, value]);

  const selectedIndex = Math.max(
    0,
    filteredOptions.findIndex((option) => option.value === value),
  );
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const visibleOptionCount = Math.max(1, filteredOptions.length);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    setPosition(
      readMenuPosition(rootRef.current, {
        menuMinWidth,
        optionCount: visibleOptionCount,
      }),
    );
    setHighlightedIndex(selectedIndex);
  }, [menuMinWidth, open, selectedIndex, visibleOptionCount]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function updatePosition() {
      setPosition(
        readMenuPosition(rootRef.current, {
          menuMinWidth,
          optionCount: visibleOptionCount,
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
  }, [menuMinWidth, open, visibleOptionCount]);

  function chooseOption(option: AppComboboxOption<T>) {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function moveHighlight(direction: 1 | -1) {
    const nextIndex = findEnabledOptionIndex(filteredOptions, highlightedIndex, direction);
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
    <div
      ref={rootRef}
      className={`app-combobox ${className || ""}`}
      data-open={open ? "" : undefined}
    >
      <div className="app-combobox-field">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={spellCheck}
          value={value}
          onFocus={() => {
            if (!disabled && options.length > 0) {
              setOpen(true);
            }
          }}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            if (!disabled && options.length > 0) {
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) {
                if (options.length > 0) {
                  setOpen(true);
                }
                return;
              }
              moveHighlight(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                if (options.length > 0) {
                  setOpen(true);
                }
                return;
              }
              moveHighlight(-1);
            } else if (event.key === "Enter") {
              if (!open) {
                return;
              }
              const option = filteredOptions[highlightedIndex];
              if (!option) {
                return;
              }
              event.preventDefault();
              chooseOption(option);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button
          className="app-combobox-toggle"
          type="button"
          aria-label={open ? "收起候选项" : "展开候选项"}
          aria-expanded={open}
          disabled={disabled || options.length === 0}
          onClick={() => {
            if (disabled || options.length === 0) {
              return;
            }
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          <ChevronDown className="ui-icon" aria-hidden="true" />
        </button>
      </div>

      {open && position
        ? createPortal(
            <DismissableLayerBranch asChild>
              <div
                ref={menuRef}
                id={listboxId}
                className="app-select-menu app-combobox-menu select-menu-content"
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
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option, index) => (
                    <button
                      className="app-select-item select-menu-item"
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      data-highlighted={index === highlightedIndex ? "" : undefined}
                      data-state={option.value === value ? "checked" : undefined}
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
                      {option.value === value ? (
                        <Check className="ui-icon" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true" />
                      )}
                      <span>{option.label}</span>
                    </button>
                  ))
                ) : (
                  <div className="app-combobox-empty select-menu-item" aria-disabled="true">
                    <span aria-hidden="true" />
                    <span>{emptyText}</span>
                  </div>
                )}
              </div>
            </DismissableLayerBranch>,
            document.body,
          )
        : null}
    </div>
  );
}

function readMenuPosition(
  trigger: HTMLElement | null,
  { menuMinWidth = 0, optionCount }: MenuPositionOptions,
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
  const menuChromeHeight = menuPaddingY + menuBorderY + 2;
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

function findEnabledOptionIndex<T extends string>(
  options: Array<AppComboboxOption<T>>,
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
