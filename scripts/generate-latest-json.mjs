#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const updaterTargets = [
  {
    platform: "windows-x86_64",
    match: (fileName) => fileName.endsWith("-windows-x64.exe"),
  },
  {
    platform: "darwin-aarch64",
    match: (fileName) => fileName.endsWith("-macos-arm64.app.tar.gz"),
  },
  {
    platform: "linux-x86_64",
    match: (fileName) => fileName.endsWith("-linux-x64.AppImage"),
  },
];

const githubRepositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function generateLatestJson({
  assetsDir,
  repository,
  tag,
  version,
  now = new Date(),
}) {
  if (!assetsDir || !repository || !tag || !version) {
    throw new Error("generateLatestJson requires assetsDir, repository, tag, and version");
  }

  const files = (await readdir(assetsDir)).filter((fileName) => !fileName.endsWith(".sig"));
  const platforms = {};

  for (const target of updaterTargets) {
    const artifact = findUpdaterArtifact(files, target);
    const signature = await readUpdaterSignature(assetsDir, artifact);
    platforms[target.platform] = {
      signature,
      url: buildReleaseDownloadUrl(repository, tag, artifact),
    };
  }

  const latest = {
    version,
    notes: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
    pub_date: now.toISOString(),
    platforms,
  };

  const latestPath = path.join(assetsDir, "latest.json");
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
  return latestPath;
}

export function findUpdaterArtifact(files, target) {
  const matches = files.filter(target.match);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one updater artifact for ${target.platform}, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

export async function readUpdaterSignature(assetsDir, artifact) {
  const signaturePath = path.join(assetsDir, `${artifact}.sig`);
  let signature = "";
  try {
    signature = (await readFile(signaturePath, "utf8")).trim();
  } catch (error) {
    throw new Error(`Missing updater signature for ${artifact}: ${error}`);
  }
  if (!signature) {
    throw new Error(`Empty updater signature for ${artifact}`);
  }
  return signature;
}

export function buildReleaseDownloadUrl(repository, tag, artifact) {
  if (!githubRepositoryPattern.test(repository)) {
    throw new Error("repository must be an owner/repo GitHub repository name");
  }
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(artifact)}`;
}

function formatUsage() {
  return [
    "用法:",
    "node scripts/generate-latest-json.mjs <assetsDir> <owner/repo> <tag> <version>",
  ].join(" ");
}

async function main(argv = process.argv.slice(2)) {
  const [assetsDir, repository, tag, version] = argv;
  await generateLatestJson({ assetsDir, repository, tag, version });
}

function isExecutedAsCli() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isExecutedAsCli()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(formatUsage());
    process.exit(1);
  });
}
