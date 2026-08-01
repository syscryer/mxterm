import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const typesSource = readFileSync(new URL("../src/features/files/remoteFileTypes.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/features/files/RemoteFilePanel.tsx", import.meta.url), "utf8");
const tooltipSource = readFileSync(new URL("../src/features/files/RemoteFileInfoTooltip.tsx", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../src/shared/ui/AnchoredSurfacePortal.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

for (const field of ["owner", "uid", "group", "gid", "birthtime"]) {
  assert.match(
    typesSource,
    new RegExp(`\\b${field}\\??:\\s*(?:string|number)\\s*\\|\\s*null`),
    `RemoteFileEntryMetadata should expose nullable ${field}`,
  );
}

assert.doesNotMatch(
  panelSource,
  /title=\{entry\.path\}/,
  "remote file rows should not use the browser-native path tooltip",
);
assert.match(panelSource, /<RemoteFileInfoTooltip\b/, "the file tree should mount one shared metadata surface");
assert.match(tooltipSource, /role="tooltip"/, "the metadata surface should expose tooltip semantics");
assert.match(tooltipSource, /\bconsumeEscape\b/, "Escape should dismiss the tooltip without reaching the terminal");
assert.doesNotMatch(
  tooltipSource,
  /ariaLabel=/,
  "aria-describedby should expose the tooltip content instead of replacing it with an aria-label",
);
assert.match(panelSource, /remoteFileMetadataCacheRef/, "metadata should be cached inside the active file panel");
assert.match(panelSource, /remoteFileMetadataGenerationRef/, "cache invalidation should be scoped per connection and path");
assert.match(
  panelSource,
  /remoteFileMetadataRequestRef\.current\.delete\(cacheKey\)/,
  "refresh invalidation should release affected in-flight requests",
);
assert.match(
  panelSource,
  /remoteFileInfoCandidateRef\.current\?\.entry\.path/,
  "refresh invalidation should cancel a pending hover candidate for the refreshed tree",
);
assert.match(portalSource, /side\?:\s*"bottom"\s*\|\s*"left"\s*\|\s*"right"\s*\|\s*"top"/, "shared anchored surfaces should support side placement");
assert.match(cssSource, /\.remote-file-info-tooltip\s*\{/, "the metadata surface should use shared global styling");
assert.match(
  cssSource,
  /\.remote-file-properties div:last-child dd\s*\{[^}]*overflow-wrap:\s*anywhere/,
  "the properties dialog should keep the full remote path readable without a native title tooltip",
);

console.log("Remote file hover metadata source check passed.");
