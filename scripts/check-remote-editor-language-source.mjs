import { readFileSync } from "node:fs";

const editorSource = readFileSync("src/features/editor/RemoteFileEditor.tsx", "utf8");
const languageSource = readFileSync("src/features/editor/remoteFileLanguages.ts", "utf8");

const failures = [];

if (editorSource.includes("tab.connectionName}:{tab.path")) {
  failures.push("RemoteFileEditor must not render connectionName before tab.path");
}

if (!editorSource.includes('title={tab.path}')) {
  failures.push("RemoteFileEditor path title should use tab.path only");
}

for (const value of [
  "registerRemoteFileEditorLanguages(monaco)",
  "registerLanguage(monacoApi, \"toml\"",
  "registerLanguage(monacoApi, \"dockerfile\"",
  "registerLanguage(monacoApi, \"nginx\"",
  "toml: \"toml\"",
  "\"dockerfile\": \"dockerfile\"",
  "\"nginx.conf\": \"nginx\"",
]) {
  if (!languageSource.includes(value) && !editorSource.includes(value)) {
    failures.push(`Missing expected remote editor language source: ${value}`);
  }
}

if (!/compose\.ya?ml/.test(languageSource) || !/docker-compose\.ya?ml/.test(languageSource)) {
  failures.push("remoteFileLanguages.ts must map compose and docker-compose YAML files");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("remote editor language source check passed");
