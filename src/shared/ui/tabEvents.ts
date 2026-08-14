import type { MouseEventHandler } from "react";

export function createMiddleClickCloseHandler<T extends HTMLElement>(
  onClose: () => void,
): MouseEventHandler<T> {
  return (event) => {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
}
