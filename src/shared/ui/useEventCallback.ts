import { useCallback, useLayoutEffect, useRef } from "react";

// Stable identity for event handlers, with the latest committed closure. Do not
// use this for functions whose result is consumed during another component's render.
export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => { callbackRef.current = callback; }, [callback]);
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
