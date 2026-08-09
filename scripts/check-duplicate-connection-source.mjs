import { readFileSync } from "node:fs";

const typeSource = readFileSync("src/features/connections/connectionTypes.ts", "utf8");
const dialogSource = readFileSync("src/features/connections/ConnectionDialog.tsx", "utf8");
const normalizationSource = readFileSync("src/features/connections/useConnections.ts", "utf8");
const backendConnectionSource = readFileSync("src-tauri/src/connections/mod.rs", "utf8");
const repositorySource = readFileSync("src-tauri/src/storage_repository.rs", "utf8");

if (!typeSource.includes("source_connection_id?: string")) {
  throw new Error("ConnectionProfileInput is missing source_connection_id.");
}

for (const snippet of [
  "source_connection_id: connection.id",
  "name: nextDuplicateConnectionName",
]) {
  if (!dialogSource.includes(snippet)) {
    throw new Error(`ConnectionDialog is missing duplicate input behavior: ${snippet}`);
  }
}

if (!normalizationSource.includes(
  "const sourceConnectionId = input.source_connection_id?.trim() || undefined",
)) {
  throw new Error("Connection input normalization must trim and preserve source_connection_id.");
}

const normalizedSourceOccurrences = normalizationSource.match(
  /source_connection_id: sourceConnectionId/g,
)?.length;
if (normalizedSourceOccurrences !== 5) {
  throw new Error(
    `Expected source_connection_id in all 5 protocol branches, found ${normalizedSourceOccurrences || 0}.`,
  );
}

if (!backendConnectionSource.includes("pub source_connection_id: Option<String>")) {
  throw new Error("Rust ConnectionProfileInput is missing source_connection_id.");
}

for (const snippet of [
  "let source_connection_id = trim_optional(input.source_connection_id.as_ref())",
  "let duplicate_source = source_connection_id",
]) {
  if (!repositorySource.includes(snippet)) {
    throw new Error(`Storage repository is missing duplicate source handling: ${snippet}`);
  }
}

console.log("Duplicate connection source check passed.");
