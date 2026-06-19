import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import { ChevronDown, Check } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface AppSelectOption<T extends string> {
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

interface AppSelectProps<T extends string> {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  menuMinWidth?: number;
  options: Array<AppSelectOption<T>>;
  placeholder?: ReactNode;
  value: T;
  onChange: (value: T) => void;
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

export function AppSelect<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  menuMinWidth,
  options,
  placeholder = "请选择",
  value,
  onChange,
}: AppSelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const selectLabel = selectedOption?.label || placeholder;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    setPosition(
      readMenuPosition(triggerRef.current, { menuMinWidth, optionCount: options.length }),
    );
    setHighlightedIndex(selectedIndex);
  }, [menuMinWidth, open, options.length, selectedIndex]);

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

      setOpen(false);
    }

    function updatePosition() {
      setPosition(
        readMenuPosition(triggerRef.current, { menuMinWidth, optionCount: options.length }),
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
  }, [menuMinWidth, open, options.length]);

  function chooseOption(option: AppSelectOption<T>) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveHighlight(direction: 1 | -1) {
    const nextIndex = findEnabledOptionIndex(options, highlightedIndex, direction);
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
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            moveHighlight(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            moveHighlight(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            const option = options[highlightedIndex];
            if (option) {
              chooseOption(option);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{selectLabel}</span>
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
                {options.map((option, index) => (
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
                ))}
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
