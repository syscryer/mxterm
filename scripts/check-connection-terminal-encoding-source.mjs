import { readFileSync } from "node:fs";

const typeSource = readFileSync("src/features/connections/connectionTypes.ts", "utf8");
const dialogSource = readFileSync("src/features/connections/ConnectionDialog.tsx", "utf8");
const useConnectionsSource = readFileSync("src/features/connections/useConnections.ts", "utf8");
const backendConnectionSource = readFileSync("src-tauri/src/connections/mod.rs", "utf8");
const backendConfigSource = readFileSync("src-tauri/src/ssh_config.rs", "utf8");
const terminalSessionSource = readFileSync("src-tauri/src/terminal/session.rs", "utf8");
const terminalManagerSource = readFileSync("src-tauri/src/terminal/manager.rs", "utf8");

const requiredFrontendTypeSnippets = [
  "export type ConnectionTerminalEncoding",
  "terminal_encoding: ConnectionTerminalEncoding;",
  "terminalEncodingOptions",
  "normalizeTerminalEncoding",
  'terminal_encoding: "utf-8"',
];

for (const snippet of requiredFrontendTypeSnippets) {
  if (!typeSource.includes(snippet)) {
    throw new Error(`connectionTypes.ts is missing terminal encoding contract: ${snippet}`);
  }
}

const requiredDialogSnippets = [
  "终端显示编码",
  "terminalEncodingOptions.map",
  "normalizeTerminalEncoding(form.advanced.terminal_encoding)",
  "connection_terminal_encoding_invalid",
];

for (const snippet of requiredDialogSnippets) {
  if (!dialogSource.includes(snippet)) {
    throw new Error(`ConnectionDialog is missing terminal encoding UI or error routing: ${snippet}`);
  }
}

if (!useConnectionsSource.includes("terminal_encoding: normalizeTerminalEncoding")) {
  throw new Error("useConnections should normalize terminal_encoding before persistence.");
}

const requiredBackendConnectionSnippets = [
  "pub terminal_encoding: String",
  "SUPPORTED_TERMINAL_ENCODINGS",
  "normalize_terminal_encoding",
  "connection_terminal_encoding_invalid",
];

for (const snippet of requiredBackendConnectionSnippets) {
  if (!backendConnectionSource.includes(snippet)) {
    throw new Error(`connections/mod.rs is missing terminal encoding validation: ${snippet}`);
  }
}

if (!backendConfigSource.includes("self.advanced")) {
  throw new Error("ResolvedSshConfig signature should include advanced settings.");
}

const requiredTerminalSnippets = [
  "encoding_rs",
  "TerminalOutputDecoder",
  "decode_terminal_output",
  "encode_terminal_input",
  "terminal_encoding(&self)",
  "terminal_encoding_decode_failed",
  "terminal_encoding_encode_failed",
  "writer.data_bytes(bytes)",
];

for (const snippet of requiredTerminalSnippets) {
  if (!terminalSessionSource.includes(snippet)) {
    throw new Error(`terminal/session.rs is missing terminal encoding behavior: ${snippet}`);
  }
}

for (const snippet of [
  "TerminalOutputDecoder::new",
  "decoder.decode(&data, false)",
  "decoder.decode(&[], true)",
]) {
  if (!terminalManagerSource.includes(snippet)) {
    throw new Error(`terminal/manager.rs should decode terminal output before emitting: ${snippet}`);
  }
}

console.log("Connection terminal encoding source check passed.");
