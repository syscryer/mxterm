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
  desiredHeight?: number;
  minHeight?: number;
  open: boolean;
  role?: string;
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
  desiredHeight = 280,
  minHeight = 120,
  open,
  role,
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
        width,
      }),
    );
  }, [align, anchorRef, desiredHeight, minHeight, open, width]);

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
        onOpenChange(false);
      }
    }

    function updatePosition() {
      setPosition(
        readAnchoredSurfacePosition(anchorRef.current, {
          align,
          desiredHeight,
          minHeight,
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
  }, [align, anchorRef, desiredHeight, minHeight, onOpenChange, open, width]);

  if (!open || !position) {
    return null;
  }

  return createPortal(
    <DismissableLayerBranch asChild>
      <div
        ref={surfaceRef}
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
    width,
  }: {
    align: "start" | "end";
    desiredHeight: number;
    minHeight: number;
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
  const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
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
