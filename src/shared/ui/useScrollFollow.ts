import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { ScrollFollowController, type ScrollMetrics } from "./scrollFollow";

function readMetrics(viewport: HTMLElement): ScrollMetrics {
  return { top: viewport.scrollTop, height: viewport.scrollHeight, viewport: viewport.clientHeight };
}

// 内层输出区域能够消耗这次滚动时，不改变外层对话的跟随状态。
function scrollsViewport(viewport: HTMLElement, target: EventTarget | null) {
  let element = target instanceof Element ? target : null;
  while (element && element !== viewport) {
    if (element instanceof HTMLElement && element.scrollTop > 0 &&
      element.scrollHeight > element.clientHeight &&
      /^(auto|scroll)$/.test(window.getComputedStyle(element).overflowY)) {
      return false;
    }
    element = element.parentElement;
  }
  return element === viewport;
}

export function useScrollFollow(contentVersion: unknown, scopeKey: string, active = true) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(new ScrollFollowController());
  const [hasNewContent, setHasNewContent] = useState(false);
  const hasNewContentRef = useRef(false);
  const activeRef = useRef(active);
  const followFrameRef = useRef<number | null>(null);

  const updateHasNewContent = useCallback((value: boolean) => {
    if (hasNewContentRef.current === value) return;
    hasNewContentRef.current = value;
    setHasNewContent(value);
  }, []);

  const cancelFollow = useCallback(() => {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
  }, []);

  const followBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!activeRef.current || !viewport || !controllerRef.current.following) {
      return;
    }
    const viewportHeight = viewport.clientHeight;
    if (viewportHeight === 0) return;
    const height = viewport.scrollHeight;
    const top = Math.max(0, height - viewportHeight);
    if (Math.abs(viewport.scrollTop - top) > 1) viewport.scrollTop = top;
    controllerRef.current.record({ top: viewport.scrollTop, height, viewport: viewportHeight });
    updateHasNewContent(false);
  }, [updateHasNewContent]);

  // Commit and resize notifications share one measurement per frame. A user
  // pausing before that frame still takes precedence over pending auto-scroll.
  const scheduleFollow = useCallback(() => {
    if (!activeRef.current || !controllerRef.current.following || followFrameRef.current !== null) return;
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      followBottom();
    });
  }, [followBottom]);

  const resetFollow = useCallback(() => {
    cancelFollow();
    controllerRef.current.resume();
    updateHasNewContent(false);
  }, [cancelFollow, updateHasNewContent]);

  const scrollToBottom = useCallback(() => {
    resetFollow();
    scheduleFollow();
  }, [scheduleFollow, resetFollow]);

  useLayoutEffect(resetFollow, [scopeKey, resetFollow]);

  useLayoutEffect(() => {
    if (controllerRef.current.following) {
      scheduleFollow();
    } else {
      updateHasNewContent(true);
    }
  }, [contentVersion, scopeKey, scheduleFollow, updateHasNewContent]);

  useLayoutEffect(() => {
    activeRef.current = active;
    if (active) {
      scheduleFollow();
    } else {
      cancelFollow();
    }
  }, [active, scheduleFollow, cancelFollow]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!active || !viewport || !content) {
      return;
    }
    const pause = () => {
      if (viewport.scrollTop > 1) {
        cancelFollow();
        controllerRef.current.pause(readMetrics(viewport));
      }
    };
    const onScroll = () => {
      if (controllerRef.current.onScroll(readMetrics(viewport))) {
        scheduleFollow();
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && scrollsViewport(viewport, event.target)) {
        pause();
      } else if (event.deltaY > 0 && !controllerRef.current.following) {
        controllerRef.current.record(readMetrics(viewport));
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      if ((["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)) && scrollsViewport(viewport, event.target)) {
        pause();
      } else if (["ArrowDown", "PageDown", "End", " "].includes(event.key) &&
        !controllerRef.current.following) {
        controllerRef.current.record(readMetrics(viewport));
      }
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? null;
      if (touchY !== null && nextY !== null && nextY > touchY &&
        scrollsViewport(viewport, event.target)) {
        pause();
      } else if (touchY !== null && nextY !== null && nextY < touchY &&
        !controllerRef.current.following) {
        controllerRef.current.record(readMetrics(viewport));
      }
      touchY = nextY;
    };
    viewport.addEventListener("scroll", onScroll);
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    const observer = new ResizeObserver((entries) => {
      if (controllerRef.current.following) {
        scheduleFollow();
      } else if (entries.some((entry) => entry.target === content)) {
        updateHasNewContent(true);
      }
    });
    observer.observe(viewport);
    observer.observe(content);
    return () => {
      cancelFollow();
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
    };
  }, [active, scheduleFollow, cancelFollow, updateHasNewContent]);

  return { viewportRef, contentRef, hasNewContent, resetFollow, scrollToBottom };
}
