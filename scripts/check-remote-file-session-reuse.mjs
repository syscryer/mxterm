import { readFileSync } from "node:fs";

const commands = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

if (!commands.includes("manager: State<'_, RemoteFileManager>")) {
  throw new Error("remote_file_list should receive RemoteFileManager state");
}

if (commands.includes("TerminalSession::exec(")) {
  throw new Error("remote_file_list should not use short-lived TerminalSession::exec");
}

if (!commands.includes("manager.list_directory(")) {
  throw new Error("remote_file_list should delegate to RemoteFileManager");
}

if (!lib.includes(".manage(remote_files::RemoteFileManager::default())")) {
  throw new Error("RemoteFileManager should be registered in Tauri state");
}

console.log("Remote file session reuse check passed.");
