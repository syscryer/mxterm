import type { RemoteFileEntry } from "./remoteFileTypes";

const vscodeIconsBaseUrl = "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons/icons";

const folderIcons: Record<string, string> = {
  dist: "folder_type_dist.svg",
  docs: "folder_type_docs.svg",
  logs: "folder_type_log.svg",
  node_modules: "folder_type_light_node.svg",
  scripts: "folder_type_script.svg",
  src: "folder_type_src.svg",
};

const fileNameIcons: Record<string, string> = {
  ".gitattributes": "file_type_git.svg",
  ".gitignore": "file_type_git.svg",
  "package-lock.json": "file_type_npm.svg",
  "package.json": "file_type_npm.svg",
  "pnpm-lock.yaml": "file_type_light_pnpm.svg",
  "pnpm-workspace.yaml": "file_type_light_pnpm.svg",
  "tsconfig.json": "file_type_tsconfig.svg",
  "vite.config.ts": "file_type_vite.svg",
};

const extensionIcons: Record<string, string> = {
  conf: "file_type_config.svg",
  css: "file_type_css.svg",
  html: "file_type_html.svg",
  js: "file_type_js.svg",
  json: "file_type_json.svg",
  log: "file_type_log.svg",
  md: "file_type_markdown.svg",
  rs: "file_type_light_rust.svg",
  ts: "file_type_typescript.svg",
  tsx: "file_type_reactts.svg",
  yaml: "file_type_yaml.svg",
  yml: "file_type_yaml.svg",
};

export function resolveRemoteFileIcon(entry: Pick<RemoteFileEntry, "name" | "type">, expanded = false) {
  const iconFile = remoteFileIconName(entry, expanded);
  return `${vscodeIconsBaseUrl}/${iconFile}`;
}

export function remoteFileIconKind(entry: Pick<RemoteFileEntry, "name" | "type">) {
  if (entry.type === "directory") {
    return "folder";
  }
  if (entry.type === "symlink") {
    return "link";
  }

  const extension = fileExtension(entry.name);
  if (extension === "tsx" || extension === "jsx") return "react";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "css" || extension === "scss" || extension === "sass" || extension === "less") return "style";
  if (extension === "md" || extension === "mdx") return "md";
  if (extension === "json" || extension === "jsonc") return "json";
  if (extension === "yaml" || extension === "yml" || extension === "toml" || extension === "conf") return "config";
  if (extension === "log") return "log";
  if (["ts", "js", "mjs", "cjs", "rs", "go", "py", "sh"].includes(extension)) return "script";
  return "file";
}

function remoteFileIconName(entry: Pick<RemoteFileEntry, "name" | "type">, expanded: boolean) {
  if (entry.type === "directory") {
    const icon = folderIcons[entry.name.toLowerCase()] || "default_folder.svg";
    return expanded ? icon.replace(/\.svg$/, "_opened.svg") : icon;
  }

  const normalizedName = entry.name.toLowerCase();
  return fileNameIcons[normalizedName] || extensionIcons[fileExtension(normalizedName)] || "default_file.svg";
}

function fileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}
