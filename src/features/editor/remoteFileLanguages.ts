const extensionLanguageMap: Record<string, string> = {
  bash: "shell",
  cjs: "javascript",
  conf: "plaintext",
  css: "css",
  env: "plaintext",
  html: "html",
  ini: "ini",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  log: "plaintext",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "shell",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const filenameLanguageMap: Record<string, string> = {
  ".bashrc": "shell",
  ".env": "plaintext",
  ".gitignore": "plaintext",
  ".profile": "shell",
  dockerfile: "dockerfile",
  makefile: "makefile",
  "nginx.conf": "plaintext",
};

export function remoteFileLanguageForPath(path: string) {
  const filename = remoteFileName(path).toLowerCase();
  const knownFilenameLanguage = filenameLanguageMap[filename];
  if (knownFilenameLanguage) {
    return knownFilenameLanguage;
  }

  const extension = filename.includes(".") ? filename.split(".").pop() || "" : "";
  return extensionLanguageMap[extension] || "plaintext";
}

export function remoteFileName(path: string) {
  return path.split("/").filter(Boolean).pop() || path || "untitled";
}
