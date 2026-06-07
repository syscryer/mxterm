import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url), "utf8");

if (!source.includes("connectionLoadScopeRef")) {
  throw new Error("RemoteFilePanel should track a connection-scoped load token");
}

if (!source.includes("const requestLoadScope = connectionLoadScopeRef.current")) {
  throw new Error("RemoteFilePanel should capture load scope before awaiting remote requests");
}

if (!source.includes("connectionLoadScopeRef.current !== requestLoadScope")) {
  throw new Error("RemoteFilePanel should ignore stale async results from previous connections");
}

console.log("Remote file connection-scope check passed.");
