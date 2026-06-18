import { readFileSync } from "node:fs";

const iconSource = readFileSync("src/features/files/remoteFileIcons.ts", "utf8");
const panelSource = readFileSync("src/features/files/RemoteFilePanel.tsx", "utf8");
const styleSource = readFileSync("src/styles/app.css", "utf8");

const forbidden = [
  "https://",
  "http://",
  "cdn.jsdelivr.net",
  "vscode-icons",
  "<img",
  "remote-file-badge",
  "remote-file-fallback",
];

const failures = [];

for (const value of forbidden) {
  if (iconSource.includes(value)) {
    failures.push(`remoteFileIcons.ts must not contain ${value}`);
  }
}

for (const value of ["<img", "remote-file-badge", "remote-file-fallback"]) {
  if (panelSource.includes(value)) {
    failures.push(`RemoteFilePanel.tsx must not contain ${value}`);
  }
}

for (const value of ["remote-file-badge", "remote-file-fallback"]) {
  if (styleSource.includes(value)) {
    failures.push(`app.css must not contain ${value}`);
  }
}

if (!/dockerfile/.test(iconSource) || !/docker-compose\.ya?ml/.test(iconSource)) {
  failures.push("remoteFileIcons.ts must map Dockerfile and docker-compose files");
}

if (!/width:\s*20px/.test(styleSource) || !/height:\s*20px/.test(styleSource)) {
  failures.push("app.css must size remote file icons at 20px");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("remote file local icon source check passed");
