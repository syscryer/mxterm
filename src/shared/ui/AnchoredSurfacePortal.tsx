import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface AnchoredSurfacePortalProps {
  align?: "start" | "end";
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  consumeEscape?: boolean;
  desiredHeight?: number;
  id?: string;
  minHeight?: number;
  open: boolean;
  role?: string;
  side?: "bottom" | "left" | "right" | "top";
  width: number;
  onOpenChange: (open: boolean) => void;
}

interface AnchoredSurfacePosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}

export function AnchoredSurfacePortal({
  align = "start",
  anchorRef,
  ariaLabel,
  children,
  className,
  consumeEscape = false,
  desiredHeight = 280,
  id,
  minHeight = 120,
  open,
  role,
  side,
  width,
  onOpenChange,
}: AnchoredSurfacePortalProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<AnchoredSurfacePosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setPosition(
      readAnchoredSurfacePosition(anchorRef.current, {
        align,
        desiredHeight,
        minHeight,
        side,
        width,
      }),
    );
  }, [align, anchorRef, desiredHeight, minHeight, open, side, width]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (anchorRef.current?.contains(target) || surfaceRef.current?.contains(target))
      ) {
        return;
      }
      onOpenChange(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (consumeEscape) {
          event.preventDefault();
          event.stopPropagation();
        }
        onOpenChange(false);
      }
    }

    function updatePosition() {
      setPosition(
        readAnchoredSurfacePosition(anchorRef.current, {
          align,
          desiredHeight,
          minHeight,
          side,
          width,
        }),
      );
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchorRef, consumeEscape, desiredHeight, minHeight, onOpenChange, open, side, width]);

  if (!open || !position) {
    return null;
  }

  return createPortal(
    <DismissableLayerBranch asChild>
      <div
        ref={surfaceRef}
        id={id}
        className={className}
        style={
          {
            left: `${position.left}px`,
            maxHeight: `${position.maxHeight}px`,
            position: "fixed",
            top: `${position.top}px`,
            width: `${position.width}px`,
          } as CSSProperties
        }
        role={role}
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </DismissableLayerBranch>,
    document.body,
  );
}

function readAnchoredSurfacePosition(
  anchor: HTMLElement | null,
  {
    align,
    desiredHeight,
    minHeight,
    side,
    width,
  }: {
    align: "start" | "end";
    desiredHeight: number;
    minHeight: number;
    side?: "bottom" | "left" | "right" | "top";
    width: number;
  },
): AnchoredSurfacePosition | null {
  if (!anchor) {
    return null;
  }

  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 5;
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const spaceLeft = rect.left - viewportPadding;
  const spaceRight = window.innerWidth - rect.right - viewportPadding;
  const availableViewportHeight = Math.max(0, window.innerHeight - viewportPadding * 2);
  const sidePlacement = side === "left" || side === "right";
  if (sidePlacement) {
    const openLeft = side === "left" ? spaceLeft >= width || spaceLeft >= spaceRight : !(spaceRight >= width || spaceRight >= spaceLeft);
    const maxHeight = Math.min(desiredHeight, availableViewportHeight);
    const preferredTop = align === "end" ? rect.bottom - maxHeight : rect.top;
    return {
      left: Math.min(
        Math.max(viewportPadding, openLeft ? rect.left - gap - width : rect.right + gap),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
      ),
      maxHeight,
      top: Math.min(
        Math.max(viewportPadding, preferredTop),
        Math.max(viewportPadding, window.innerHeight - maxHeight - viewportPadding),
      ),
      width,
    };
  }

  const openAbove = side === "top"
    ? spaceAbove >= desiredHeight || spaceAbove >= spaceBelow
    : side === "bottom"
      ? !(spaceBelow >= desiredHeight || spaceBelow >= spaceAbove)
      : spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const availableHeight = Math.max(
    minHeight,
    (openAbove ? spaceAbove : spaceBelow) - gap,
  );
  const maxHeight = Math.min(desiredHeight, availableHeight);
  const preferredLeft = align === "end" ? rect.right - width : rect.left;

  return {
    left: Math.min(
      Math.max(viewportPadding, preferredLeft),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    ),
    maxHeight,
    top: openAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
    width,
  };
}
