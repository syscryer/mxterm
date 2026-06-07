import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url), "utf8");

if (!source.includes("loadingIndicatorDelayMs")) {
  throw new Error("RemoteFilePanel should define a loading indicator delay");
}

if (!source.includes("visibleLoadingPath")) {
  throw new Error("RemoteFilePanel should track a delayed visible loading path");
}

if (!source.includes("setTimeout(() =>")) {
  throw new Error("RemoteFilePanel should delay showing loading indicators");
}

if (!source.includes("loading={Boolean(visibleLoadingPath)}")) {
  throw new Error("Toolbar loading state should follow delayed visible loading state");
}

console.log("Remote file loading-indicator delay check passed.");
