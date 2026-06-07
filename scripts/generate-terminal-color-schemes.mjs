import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const sourceDir = process.argv[2] || process.env.ITERM2_COLOR_SCHEMES_DIR;

if (!sourceDir) {
  throw new Error("Usage: node scripts/generate-terminal-color-schemes.mjs <path-to-schemes-dir>");
}

const outputPath = new URL("../src/features/settings/terminalColorSchemes.ts", import.meta.url);
const files = readdirSync(sourceDir)
  .filter((file) => file.endsWith(".itermcolors"))
  .sort((left, right) => left.localeCompare(right, "en"));

if (files.length === 0) {
  throw new Error(`No .itermcolors files found in ${sourceDir}`);
}

const usedIds = new Set(["mxterm-default"]);
const schemes = files.map((file) => {
  const name = basename(file, ".itermcolors");
  return parseScheme(name, readFileSync(join(sourceDir, file), "utf8"), usedIds);
});

writeFileSync(outputPath, renderTypeScript(schemes));
console.log(`Generated ${schemes.length} iTerm2 color schemes.`);

function parseScheme(name, source, usedIds) {
  const id = uniqueId(slugify(name), usedIds);
  const colors = new Map();
  const colorBlockPattern = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let match;

  while ((match = colorBlockPattern.exec(source)) !== null) {
    colors.set(match[1], parseColor(match[2]));
  }

  return {
    id,
    name,
    theme: {
      background: colorOr(colors, "Background Color", "#000000"),
      foreground: colorOr(colors, "Foreground Color", "#CCCCCC"),
      cursor: colorOr(colors, "Cursor Color", colorOr(colors, "Foreground Color", "#FFFFFF")),
      selectionBackground: colorOr(colors, "Selection Color", "#444444"),
      black: colorOr(colors, "Ansi 0 Color", "#000000"),
      red: colorOr(colors, "Ansi 1 Color", "#CC0000"),
      green: colorOr(colors, "Ansi 2 Color", "#4E9A06"),
      yellow: colorOr(colors, "Ansi 3 Color", "#C4A000"),
      blue: colorOr(colors, "Ansi 4 Color", "#3465A4"),
      magenta: colorOr(colors, "Ansi 5 Color", "#75507B"),
      cyan: colorOr(colors, "Ansi 6 Color", "#06989A"),
      white: colorOr(colors, "Ansi 7 Color", "#D3D7CF"),
      brightBlack: colorOr(colors, "Ansi 8 Color", "#555753"),
      brightRed: colorOr(colors, "Ansi 9 Color", "#EF2929"),
      brightGreen: colorOr(colors, "Ansi 10 Color", "#8AE234"),
      brightYellow: colorOr(colors, "Ansi 11 Color", "#FCE94F"),
      brightBlue: colorOr(colors, "Ansi 12 Color", "#729FCF"),
      brightMagenta: colorOr(colors, "Ansi 13 Color", "#AD7FA8"),
      brightCyan: colorOr(colors, "Ansi 14 Color", "#34E2E2"),
      brightWhite: colorOr(colors, "Ansi 15 Color", "#EEEEEC"),
    },
  };
}

function parseColor(block) {
  const red = readComponent(block, "Red Component");
  const green = readComponent(block, "Green Component");
  const blue = readComponent(block, "Blue Component");
  return rgbToHex(red, green, blue);
}

function readComponent(block, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<key>${escapedKey}<\\/key>\\s*<real>([^<]+)<\\/real>`).exec(block);
  const value = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map(componentToHex).join("")}`;
}

function componentToHex(component) {
  const value = Math.max(0, Math.min(255, Math.round(component * 255)));
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function colorOr(colors, key, fallback) {
  return colors.get(key) || fallback;
}

function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "scheme";
}

function uniqueId(baseId, usedIds) {
  let id = baseId;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${index.toString()}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function renderTypeScript(schemes) {
  return `import type { ITheme } from "@xterm/xterm";

export type TerminalColorSchemeId = string;

export interface TerminalColorScheme {
  id: TerminalColorSchemeId;
  name: string;
  source: "mXterm" | "iTerm2-Color-Schemes";
  theme: Required<Pick<
    ITheme,
    | "background"
    | "foreground"
    | "cursor"
    | "selectionBackground"
    | "black"
    | "red"
    | "green"
    | "yellow"
    | "blue"
    | "magenta"
    | "cyan"
    | "white"
    | "brightBlack"
    | "brightRed"
    | "brightGreen"
    | "brightYellow"
    | "brightBlue"
    | "brightMagenta"
    | "brightCyan"
    | "brightWhite"
  >>;
}

export const terminalColorSchemes: TerminalColorScheme[] = [
  {
    id: "mxterm-default",
    name: "mXterm Default",
    source: "mXterm",
    theme: {
      background: "#111827",
      foreground: "#D1D5DB",
      cursor: "#F9FAFB",
      selectionBackground: "#374151",
      black: "#111827",
      red: "#EF4444",
      green: "#22C55E",
      yellow: "#EAB308",
      blue: "#3B82F6",
      magenta: "#A855F7",
      cyan: "#06B6D4",
      white: "#D1D5DB",
      brightBlack: "#4B5563",
      brightRed: "#F87171",
      brightGreen: "#4ADE80",
      brightYellow: "#FACC15",
      brightBlue: "#60A5FA",
      brightMagenta: "#C084FC",
      brightCyan: "#22D3EE",
      brightWhite: "#F9FAFB",
    },
  },
${schemes.map(renderScheme).join(",\n")},
];

export const defaultTerminalColorSchemeId: TerminalColorSchemeId = "mxterm-default";

export function getTerminalColorScheme(id: string | null | undefined) {
  return (
    terminalColorSchemes.find((scheme) => scheme.id === id) ||
    terminalColorSchemes.find((scheme) => scheme.id === defaultTerminalColorSchemeId) ||
    terminalColorSchemes[0]
  );
}

export function getTerminalAnsiSwatches(scheme: TerminalColorScheme) {
  const { theme } = scheme;
  return [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ];
}
`;
}

function renderScheme(scheme) {
  return `  {
    id: ${JSON.stringify(scheme.id)},
    name: ${JSON.stringify(scheme.name)},
    source: "iTerm2-Color-Schemes",
    theme: ${renderTheme(scheme.theme)},
  }`;
}

function renderTheme(theme) {
  const entries = Object.entries(theme)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
  return `{ ${entries} }`;
}
