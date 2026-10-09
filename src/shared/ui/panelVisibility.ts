import { createContext, useContext } from "react";

// Portaled controls need the panel's visibility as well as their own open state.
export const PanelVisibilityContext = createContext(true);
export function usePanelVisible() {
  return useContext(PanelVisibilityContext);
}
