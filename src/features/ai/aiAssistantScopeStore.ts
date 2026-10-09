import { useCallback, useRef, useSyncExternalStore, type SetStateAction } from "react";

import type { AiChatMessage, AiContextBlock } from "./aiTypes";

export const AI_HISTORY_SCOPE_CURRENT = "__current__";

const DEFAULT_SCOPE_KEY = "__default__";

export interface AiAssistantStreamState {
  assistantMessageId: string;
  sessionId: string;
  streamId: string;
}

export interface AiAssistantScopeState {
  activeSessionId: string | null;
  messages: AiChatMessage[];
  streamState: AiAssistantStreamState | null;
  contextBlocks: AiContextBlock[];
  input: string;
  remoteWorkspacePath: string | null;
  historyScopeChoice: string;
  selectedUserOptionIds: Record<string, string>;
  userInputDrafts: Record<string, string>;
  expandedToolCallIds: Record<string, boolean>;
}

export type AiAssistantScopeEffect =
  | { kind: "stream_ended"; status: "finished" | "stopped" | "error"; error: string | null }
  | { kind: "background_task"; status: string };

type AiAssistantScopeEffectHandler = (effect: AiAssistantScopeEffect) => void;

const scopeStates = new Map<string, AiAssistantScopeState>();
const scopeListeners = new Map<string, Set<() => void>>();
const scopeEffectHandlers = new Map<string, AiAssistantScopeEffectHandler>();

function createDefaultScopeState(): AiAssistantScopeState {
  return {
    activeSessionId: null,
    messages: [],
    streamState: null,
    contextBlocks: [],
    input: "",
    remoteWorkspacePath: null,
    historyScopeChoice: AI_HISTORY_SCOPE_CURRENT,
    selectedUserOptionIds: {},
    userInputDrafts: {},
    expandedToolCallIds: {},
  };
}

export function normalizeAiScopeKey(key: string | null | undefined): string {
  return key?.trim() || DEFAULT_SCOPE_KEY;
}

export function readAiScopeState(key: string): AiAssistantScopeState {
  let state = scopeStates.get(key);
  if (!state) {
    state = createDefaultScopeState();
    scopeStates.set(key, state);
  }
  return state;
}

function notifyAiScope(key: string) {
  scopeListeners.get(key)?.forEach((listener) => listener());
}

export function updateAiScopeState(
  key: string,
  updater: (state: AiAssistantScopeState) => AiAssistantScopeState,
) {
  const current = readAiScopeState(key);
  const next = updater(current);
  if (next === current) {
    return;
  }
  scopeStates.set(key, next);
  notifyAiScope(key);
}

export function updateEveryAiScopeState(
  updater: (key: string, state: AiAssistantScopeState) => AiAssistantScopeState,
) {
  for (const key of Array.from(scopeStates.keys())) {
    updateAiScopeState(key, (state) => updater(key, state));
  }
}

function subscribeAiScope(key: string, listener: () => void) {
  let listeners = scopeListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    scopeListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      scopeListeners.delete(key);
    }
  };
}

export function setAiScopeEffectHandler(key: string, handler: AiAssistantScopeEffectHandler) {
  scopeEffectHandlers.set(key, handler);
  return () => {
    if (scopeEffectHandlers.get(key) === handler) {
      scopeEffectHandlers.delete(key);
    }
  };
}

export function emitAiScopeEffect(key: string, effect: AiAssistantScopeEffect) {
  scopeEffectHandlers.get(key)?.(effect);
}

export function useAiScopeField<K extends keyof AiAssistantScopeState>(
  key: string,
  field: K,
  active = true,
): [AiAssistantScopeState[K], (action: SetStateAction<AiAssistantScopeState[K]>) => void] {
  // Keep the last rendered snapshot while hidden. Events still update the store;
  // reactivation reads the latest value before the view becomes interactive.
  const snapshotRef = useRef({ key, field, value: readAiScopeState(key)[field] });
  const subscribe = useCallback(
    (listener: () => void) => active ? subscribeAiScope(key, listener) : () => {},
    [key, active],
  );
  const getSnapshot = useCallback(() => {
    if (active || snapshotRef.current.key !== key || snapshotRef.current.field !== field) {
      snapshotRef.current = { key, field, value: readAiScopeState(key)[field] };
    }
    return snapshotRef.current.value;
  }, [key, field, active]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  const setValue = useCallback(
    (action: SetStateAction<AiAssistantScopeState[K]>) => {
      updateAiScopeState(key, (state) => {
        const next =
          typeof action === "function"
            ? (action as (previous: AiAssistantScopeState[K]) => AiAssistantScopeState[K])(
                state[field],
              )
            : action;
        return Object.is(next, state[field]) ? state : { ...state, [field]: next };
      });
    },
    [key, field],
  );
  return [value, setValue];
}
