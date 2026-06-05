import { listen } from "@tauri-apps/api/event";
import type {
  TerminalOutputEvent,
  TerminalStateChangedEvent,
} from "../../features/terminal/terminalTypes";

export function listenTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
  return listen<TerminalOutputEvent>("terminal.output", (event) => handler(event.payload));
}

export function listenTerminalStateChanged(handler: (event: TerminalStateChangedEvent) => void) {
  return listen<TerminalStateChangedEvent>("terminal.state_changed", (event) =>
    handler(event.payload),
  );
}
