import { readFileSync } from "node:fs";

const rdpSource = readFileSync("src-tauri/src/rdp.rs", "utf8");

if (
  !/NativeRdpHostCommand::CloseSession \{ session_id \} => \{[\s\S]*close_activex_host_session\(hwnd, state, &session_id, false\);[\s\S]*if state\.sessions\.is_empty\(\) \{[\s\S]*PostMessageW\(Some\(hwnd\), WM_CLOSE, WPARAM\(0\), LPARAM\(0\)\);[\s\S]*\}[\s\S]*keep_running = !state\.sessions\.is_empty\(\);[\s\S]*\}/.test(
    rdpSource,
  )
) {
  throw new Error(
    "RDP native host should explicitly close the host window when the last session is removed.",
  );
}

console.log("RDP host empty-close source check passed.");
