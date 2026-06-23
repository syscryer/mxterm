import type { RemoteFileEntry } from "./remoteFileTypes";

import { isDockerfileName, remoteFileExtension } from "../../shared/remoteFiles/fileNames";

export type RemoteFileIconShape =
  | "archive"
  | "certificate"
  | "code"
  | "config"
  | "database"
  | "docker"
  | "document"
  | "executable"
  | "folder"
  | "git"
  | "image"
  | "key"
  | "license"
  | "log"
  | "markdown"
  | "node"
  | "package"
  | "python"
  | "rust"
  | "script"
  | "style"
  | "symlink";

export interface RemoteFileIconDescriptor {
  accent: string;
  label?: string;
  shape: RemoteFileIconShape;
  tone: string;
}

const defaultFolderIcon: RemoteFileIconDescriptor = {
  accent: "#f4b940",
  shape: "folder",
  tone: "#f8d56f",
};

const defaultFileIcon: RemoteFileIconDescriptor = {
  accent: "#94a3b8",
  label: ".",
  shape: "document",
  tone: "#f8fafc",
};

const folderIcons: Record<string, RemoteFileIconDescriptor> = {
  ".cache": folder("#f0b43a", "#f9d56d"),
  ".claude": folder("#8b5cf6", "#c4b5fd"),
  ".config": folder("#38bdf8", "#93c5fd"),
  ".docker": folder("#2496ed", "#7dd3fc"),
  ".git": folder("#f05032", "#fca5a5"),
  ".local": folder("#4f7d63", "#9fd4ad"),
  ".npm": folder("#cb3837", "#fca5a5"),
  ".ssh": folder("#64748b", "#cbd5e1"),
  "bin": folder("#ef4444", "#fecaca"),
  "boot": folder("#f59e0b", "#fde68a"),
  "config": folder("#38bdf8", "#93c5fd"),
  "dev": folder("#64748b", "#cbd5e1"),
  "dist": folder("#8b5cf6", "#ddd6fe"),
  "docker": folder("#2496ed", "#7dd3fc"),
  "docs": folder("#3b82f6", "#bfdbfe"),
  "etc": folder("#64748b", "#cbd5e1"),
  "home": folder("#22c55e", "#bbf7d0"),
  "lib": folder("#06b6d4", "#a5f3fc"),
  "logs": folder("#475569", "#cbd5e1"),
  "media": folder("#ec4899", "#fbcfe8"),
  "mnt": folder("#14b8a6", "#99f6e4"),
  "node_modules": { accent: "#539e43", label: "N", shape: "node", tone: "#c7f0c2" },
  "opt": folder("#f59e0b", "#fde68a"),
  "proc": folder("#94a3b8", "#e2e8f0"),
  "root": folder("#f97316", "#fed7aa"),
  "run": folder("#0ea5e9", "#bae6fd"),
  "scripts": folder("#0284c7", "#bae6fd"),
  "src": folder("#2563eb", "#bfdbfe"),
  "sys": folder("#64748b", "#cbd5e1"),
  "tmp": folder("#fbbf24", "#fde68a"),
  "var": folder("#a855f7", "#e9d5ff"),
};

const fileNameIcons: Record<string, RemoteFileIconDescriptor> = {
  ".dockerignore": { accent: "#2496ed", label: "D", shape: "docker", tone: "#dbeafe" },
  ".env": { accent: "#16a34a", label: "ENV", shape: "config", tone: "#dcfce7" },
  ".gitattributes": { accent: "#f05032", shape: "git", tone: "#fee2e2" },
  ".gitignore": { accent: "#f05032", shape: "git", tone: "#fee2e2" },
  "docker-compose.yaml": { accent: "#2496ed", label: "D", shape: "docker", tone: "#dbeafe" },
  "docker-compose.yml": { accent: "#2496ed", label: "D", shape: "docker", tone: "#dbeafe" },
  "dockerfile": { accent: "#2496ed", label: "D", shape: "docker", tone: "#dbeafe" },
  "license": { accent: "#7c3aed", label: "L", shape: "license", tone: "#ede9fe" },
  "makefile": { accent: "#475569", label: "MK", shape: "script", tone: "#e2e8f0" },
  "package-lock.json": { accent: "#cb3837", label: "N", shape: "node", tone: "#fee2e2" },
  "package.json": { accent: "#cb3837", label: "N", shape: "node", tone: "#fee2e2" },
  "pnpm-lock.yaml": { accent: "#f59e0b", label: "P", shape: "package", tone: "#fef3c7" },
  "pnpm-workspace.yaml": { accent: "#f59e0b", label: "P", shape: "package", tone: "#fef3c7" },
  "readme": { accent: "#2563eb", label: "R", shape: "markdown", tone: "#dbeafe" },
  "readme.md": { accent: "#2563eb", label: "R", shape: "markdown", tone: "#dbeafe" },
  "tsconfig.json": { accent: "#3178c6", label: "TS", shape: "config", tone: "#dbeafe" },
  "vite.config.ts": { accent: "#646cff", label: "V", shape: "code", tone: "#ede9fe" },
};

const extensionIcons: Record<string, RemoteFileIconDescriptor> = {
  "7z": archive(),
  "bz2": archive(),
  "conf": config("C"),
  "crt": { accent: "#059669", label: "CRT", shape: "certificate", tone: "#d1fae5" },
  "css": { accent: "#2563eb", label: "CSS", shape: "style", tone: "#dbeafe" },
  "deb": packageIcon("DEB"),
  "env": config("ENV"),
  "exe": { accent: "#475569", label: "EXE", shape: "executable", tone: "#e2e8f0" },
  "gz": archive(),
  "htm": { accent: "#ea580c", label: "H", shape: "code", tone: "#ffedd5" },
  "html": { accent: "#ea580c", label: "H", shape: "code", tone: "#ffedd5" },
  "ini": config("INI"),
  "jpeg": imageIcon(),
  "jpg": imageIcon(),
  "js": { accent: "#ca8a04", label: "JS", shape: "code", tone: "#fef9c3" },
  "json": { accent: "#d97706", label: "{}", shape: "config", tone: "#fff7ed" },
  "key": { accent: "#64748b", label: "KEY", shape: "key", tone: "#e2e8f0" },
  "less": { accent: "#2563eb", label: "LS", shape: "style", tone: "#dbeafe" },
  "log": { accent: "#475569", label: "LOG", shape: "log", tone: "#f1f5f9" },
  "md": { accent: "#2563eb", label: "MD", shape: "markdown", tone: "#dbeafe" },
  "mdx": { accent: "#2563eb", label: "MD", shape: "markdown", tone: "#dbeafe" },
  "msi": { accent: "#0f766e", label: "MSI", shape: "package", tone: "#ccfbf1" },
  "pem": { accent: "#059669", label: "PEM", shape: "certificate", tone: "#d1fae5" },
  "png": imageIcon(),
  "py": { accent: "#2563eb", label: "PY", shape: "python", tone: "#dbeafe" },
  "rpm": packageIcon("RPM"),
  "rs": { accent: "#b45309", label: "RS", shape: "rust", tone: "#fed7aa" },
  "sass": { accent: "#db2777", label: "S", shape: "style", tone: "#fce7f3" },
  "scss": { accent: "#db2777", label: "S", shape: "style", tone: "#fce7f3" },
  "sh": { accent: "#0284c7", label: "SH", shape: "script", tone: "#e0f2fe" },
  "sql": { accent: "#0f766e", label: "SQL", shape: "database", tone: "#ccfbf1" },
  "svg": imageIcon(),
  "tar": archive(),
  "toml": config("T"),
  "ts": { accent: "#3178c6", label: "TS", shape: "code", tone: "#dbeafe" },
  "tsx": { accent: "#0891b2", label: "R", shape: "code", tone: "#cffafe" },
  "txt": { accent: "#64748b", label: "TXT", shape: "document", tone: "#f8fafc" },
  "xz": archive(),
  "yaml": config("Y"),
  "yml": config("Y"),
  "zip": archive(),
};

export function resolveRemoteFileIcon(
  entry: Pick<RemoteFileEntry, "name" | "type">,
): RemoteFileIconDescriptor {
  if (entry.type === "directory") {
    return folderIcons[entry.name.toLowerCase()] || defaultFolderIcon;
  }

  if (entry.type === "symlink") {
    return { accent: "#4f46e5", label: "@", shape: "symlink", tone: "#eef2ff" };
  }

  const normalizedName = entry.name.toLowerCase();
  return (
    fileNameIcons[normalizedName] ||
    (isDockerfileName(normalizedName) ? fileNameIcons.dockerfile : undefined) ||
    extensionIcons[remoteFileExtension(normalizedName)] ||
    defaultFileIcon
  );
}

function folder(accent: string, tone: string): RemoteFileIconDescriptor {
  return { accent, shape: "folder", tone };
}

function archive(): RemoteFileIconDescriptor {
  return { accent: "#d97706", label: "ZIP", shape: "archive", tone: "#fef3c7" };
}

function config(label: string): RemoteFileIconDescriptor {
  return { accent: "#d97706", label, shape: "config", tone: "#fff7ed" };
}

function imageIcon(): RemoteFileIconDescriptor {
  return { accent: "#16a34a", label: "IMG", shape: "image", tone: "#dcfce7" };
}

function packageIcon(label: string): RemoteFileIconDescriptor {
  return { accent: "#0f766e", label, shape: "package", tone: "#ccfbf1" };
}
