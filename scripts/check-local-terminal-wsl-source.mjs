import { readFileSync } from "node:fs";

const source = readFileSync("src-tauri/src/terminal/local_profiles.rs", "utf8");

function assertIncludes(value, message) {
  if (!source.includes(value)) {
    throw new Error(message);
  }
}

function assertExcludes(value, message) {
  if (source.includes(value)) {
    throw new Error(message);
  }
}

assertIncludes(
  "fn parse_wsl_distributions_stdout(stdout: &[u8]) -> Vec<String>",
  "WSL distribution parsing must be centralized so Windows encodings are handled consistently.",
);

assertIncludes(
  "fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> String",
  "WSL distribution parsing must handle UTF-16 output from wsl.exe -l -q.",
);

assertIncludes(
  "parse_wsl_distributions_accepts_utf16le_without_bom",
  "WSL parser must have a regression test for UTF-16LE output without a BOM.",
);

assertExcludes(
  "String::from_utf8_lossy(&output.stdout)\n        .lines()",
  "WSL distribution parsing must not assume wsl.exe output is UTF-8.",
);

console.log("local terminal WSL source check passed");
