export function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}
