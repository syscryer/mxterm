import type { ITheme } from "@xterm/xterm";

export type TerminalColorSchemeId = string;
export type TerminalColorSchemeTone = "dark" | "light";

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

export const defaultTerminalColorSchemeId: TerminalColorSchemeId = "mxterm-default";

// 默认配色方案的内联副本。
// 282KB 的完整配色方案数据（531 项）已拆分到 terminalColorSchemesData.ts，
// 通过动态 import 按需加载并缓存，避免被静态打进主 bundle 导致 release
// 构建下应用启动时同步解析整个数组而卡顿。在大数据加载完成前，这里提供
// 一份脱离数组的 fallback，保证 getTerminalColorScheme 始终能同步返回有效主题。
const defaultTerminalColorScheme: TerminalColorScheme = {
  id: defaultTerminalColorSchemeId,
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
};

// 完整配色方案数据的缓存与异步加载。
// 模块加载时不触碰大数组；只有在 loadTerminalColorSchemes() 被调用后，
// 数组才会被加载并缓存到内存。getTerminalColorScheme 等同步函数在缓存
// 就绪前返回 fallback，就绪后返回真实结果。
let terminalColorSchemesCache: TerminalColorScheme[] | null = null;
let terminalColorSchemesByIdCache: Map<TerminalColorSchemeId, TerminalColorScheme> | null = null;
let terminalColorSchemesLoadPromise: Promise<TerminalColorScheme[]> | null = null;
const readyListeners = new Set<(schemes: TerminalColorScheme[]) => void>();

function cacheTerminalColorSchemes(schemes: TerminalColorScheme[]) {
  terminalColorSchemesCache = schemes;
  terminalColorSchemesByIdCache = new Map(schemes.map((scheme) => [scheme.id, scheme]));
}

/**
 * 异步加载完整配色方案数据并缓存。
 * 进入终端配色设置页或低优先级预热时调用。加载完成后所有同步访问函数
 * 会返回真实结果，并通知已注册的就绪回调。
 * 重复调用是安全的，返回同一个 Promise。
 */
export function loadTerminalColorSchemes(): Promise<TerminalColorScheme[]> {
  if (terminalColorSchemesCache) {
    return Promise.resolve(terminalColorSchemesCache);
  }
  if (terminalColorSchemesLoadPromise) {
    return terminalColorSchemesLoadPromise;
  }
  terminalColorSchemesLoadPromise = import("./terminalColorSchemesData")
    .then((module) => {
      cacheTerminalColorSchemes(module.terminalColorSchemesData);
      const schemes = module.terminalColorSchemesData;
      const listeners = Array.from(readyListeners.values());
      readyListeners.clear();
      for (const listener of listeners) {
        listener(schemes);
      }
      return schemes;
    })
    .catch((error) => {
      // 加载失败时重置 promise，允许后续重试；同步函数仍可使用 fallback。
      terminalColorSchemesLoadPromise = null;
      throw error;
    });
  return terminalColorSchemesLoadPromise;
}

/**
 * 注册配色方案数据加载就绪后的回调（立即触发一次若已就绪）。
 * 返回取消注册的函数。供 React 组件在数据就绪后触发 re-render 使用。
 */
export function onTerminalColorSchemesReady(
  listener: (schemes: TerminalColorScheme[]) => void,
): () => void {
  if (terminalColorSchemesCache) {
    listener(terminalColorSchemesCache);
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

export function isTerminalColorSchemesReady(): boolean {
  return terminalColorSchemesCache !== null;
}

/**
 * 同步获取完整配色方案数据。
 * 数据未加载完成时返回仅含默认方案的退化数组，调用方应避免在此状态下
 * 依赖完整列表（如终端配色设置页应使用 onTerminalColorSchemesReady 等待就绪）。
 */
export function getTerminalColorSchemes(): TerminalColorScheme[] {
  return terminalColorSchemesCache ?? [defaultTerminalColorScheme];
}

export function getTerminalColorScheme(id: string | null | undefined): TerminalColorScheme {
  const schemes = terminalColorSchemesCache;
  const schemesById = terminalColorSchemesByIdCache;
  if (schemes && schemesById) {
    return (
      (id ? schemesById.get(id) : undefined) ||
      schemesById.get(defaultTerminalColorSchemeId) ||
      defaultTerminalColorScheme
    );
  }
  // 数据未就绪时统一返回 fallback，待 onTerminalColorSchemesReady 触发后调用方重新取值。
  return defaultTerminalColorScheme;
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

export function getTerminalColorSchemeTone(scheme: TerminalColorScheme): TerminalColorSchemeTone {
  return getColorLuminance(scheme.theme.background) >= 0.52 ? "light" : "dark";
}

function getColorLuminance(color: string) {
  const normalized = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!normalized) {
    return 0;
  }

  const red = Number.parseInt(normalized[1].slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized[1].slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized[1].slice(4, 6), 16) / 255;

  return (0.2126 * toLinearRgb(red)) + (0.7152 * toLinearRgb(green)) + (0.0722 * toLinearRgb(blue));
}

function toLinearRgb(value: number) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
