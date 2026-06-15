import type {
  IDecoration,
  IDisposable,
  IBufferLine,
  IMarker,
  ITheme,
  Terminal,
} from "@xterm/xterm";

export type TerminalSemanticTokenKind = "url" | "ip" | "version" | "date" | "number";

export interface TerminalSemanticToken {
  end: number;
  kind: TerminalSemanticTokenKind;
  start: number;
  text: string;
}

export type TerminalSemanticHighlightPalette = Record<TerminalSemanticTokenKind, string>;

interface TerminalSemanticHighlightOptions {
  palette: TerminalSemanticHighlightPalette;
}

interface TokenMatcher {
  kind: TerminalSemanticTokenKind;
  pattern: RegExp;
  priority: number;
}

interface TerminalLineCell {
  defaultForeground: boolean;
  end: number;
  start: number;
  width: number;
  x: number;
}

interface TerminalLineSnapshot {
  cells: TerminalLineCell[];
  text: string;
}

interface SemanticCellRange {
  kind: TerminalSemanticTokenKind;
  width: number;
  x: number;
}

interface DecoratedLine {
  decorations: IDecoration[];
  marker: IMarker;
  signature: string;
}

const scanBacklogLines = 180;
const retainedDecoratedLines = 360;
const maxLineCells = 4096;

const tokenMatchers: TokenMatcher[] = [
  {
    kind: "url",
    pattern: /\bhttps?:\/\/[^\s<>"'`]+/gi,
    priority: 100,
  },
  {
    kind: "date",
    pattern:
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}(?::\d{2})?\s+\d{4}\b/g,
    priority: 90,
  },
  {
    kind: "ip",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?::(?:6553[0-5]|655[0-2]\d|65[0-4]\d{2}|6[0-4]\d{3}|[1-5]?\d{1,4}))?\b/g,
    priority: 80,
  },
  {
    kind: "version",
    pattern: /\b\d+(?:\.\d+){2,}(?:[-+][A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?\b/g,
    priority: 70,
  },
  {
    kind: "number",
    pattern: /(?<![\w.:-])\d+(?![\w.:-])/g,
    priority: 10,
  },
];

const darkSemanticPalette: TerminalSemanticHighlightPalette = {
  date: "#22C55E",
  ip: "#C084FC",
  number: "#38BDF8",
  url: "#F59E0B",
  version: "#22D3EE",
};

const lightSemanticPalette: TerminalSemanticHighlightPalette = {
  date: "#15803D",
  ip: "#7C3AED",
  number: "#0284C7",
  url: "#D97706",
  version: "#0891B2",
};

export interface TerminalSemanticHighlighter extends IDisposable {
  refresh: () => void;
  setPalette: (palette: TerminalSemanticHighlightPalette) => void;
}

export function createTerminalSemanticHighlighter(
  terminal: Terminal,
  { palette }: TerminalSemanticHighlightOptions,
): TerminalSemanticHighlighter {
  const lineDecorations = new Map<number, DecoratedLine>();
  let activePalette = palette;
  let disposed = false;
  let refreshQueued = false;

  const disposeDecoratedLine = (lineIndex: number) => {
    const decoratedLine = lineDecorations.get(lineIndex);
    if (!decoratedLine) {
      return;
    }
    decoratedLine.decorations.forEach((decoration) => decoration.dispose());
    decoratedLine.marker.dispose();
    lineDecorations.delete(lineIndex);
  };

  const clearDecorations = () => {
    [...lineDecorations.keys()].forEach(disposeDecoratedLine);
  };

  const normalizeDecorationKeys = () => {
    [...lineDecorations.entries()].forEach(([lineIndex, decoratedLine]) => {
      if (decoratedLine.marker.isDisposed || decoratedLine.marker.line < 0) {
        disposeDecoratedLine(lineIndex);
        return;
      }
      if (decoratedLine.marker.line === lineIndex) {
        return;
      }
      lineDecorations.delete(lineIndex);
      const existing = lineDecorations.get(decoratedLine.marker.line);
      if (existing) {
        existing.decorations.forEach((decoration) => decoration.dispose());
        existing.marker.dispose();
      }
      lineDecorations.set(decoratedLine.marker.line, decoratedLine);
    });
  };

  const decorateLine = (lineIndex: number) => {
    const buffer = terminal.buffer.active;
    const line = buffer.getLine(lineIndex);
    if (!line) {
      disposeDecoratedLine(lineIndex);
      return;
    }

    const snapshot = readTerminalLineSnapshot(line, terminal.cols);
    const ranges = findTerminalSemanticTokens(snapshot.text)
      .map((token) => tokenToCellRange(token, snapshot))
      .filter((range): range is SemanticCellRange => Boolean(range));
    const signature = ranges
      .map((range) => `${range.kind}:${range.x}:${range.width}`)
      .join("|");
    const currentDecoration = lineDecorations.get(lineIndex);
    if (currentDecoration?.signature === signature) {
      return;
    }

    disposeDecoratedLine(lineIndex);
    if (ranges.length === 0) {
      return;
    }

    const markerOffset = lineIndex - (buffer.baseY + buffer.cursorY);
    const marker = terminal.registerMarker(markerOffset);
    if (!marker || marker.line !== lineIndex) {
      marker?.dispose();
      return;
    }

    const decorations = ranges
      .map((range) =>
        terminal.registerDecoration({
          foregroundColor: activePalette[range.kind],
          layer: "bottom",
          marker,
          width: range.width,
          x: range.x,
        }),
      )
      .filter((decoration): decoration is IDecoration => Boolean(decoration));

    if (decorations.length === 0) {
      marker.dispose();
      return;
    }

    lineDecorations.set(lineIndex, {
      decorations,
      marker,
      signature,
    });
  };

  const scanRange = (startLine: number, endLine: number) => {
    if (endLine < startLine) {
      return;
    }
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      decorateLine(lineIndex);
    }
  };

  const pruneDecorations = (recentStartLine: number, viewportStartLine: number, viewportEndLine: number) => {
    [...lineDecorations.entries()].forEach(([lineIndex, decoratedLine]) => {
      const markerLine = decoratedLine.marker.line;
      const inRecentRange = markerLine >= recentStartLine;
      const inViewportRange = markerLine >= viewportStartLine && markerLine <= viewportEndLine;
      if (markerLine < 0 || (!inRecentRange && !inViewportRange)) {
        disposeDecoratedLine(lineIndex);
      }
    });

    if (lineDecorations.size <= retainedDecoratedLines) {
      return;
    }

    [...lineDecorations.entries()]
      .sort(([, left], [, right]) => left.marker.line - right.marker.line)
      .slice(0, lineDecorations.size - retainedDecoratedLines)
      .forEach(([lineIndex]) => disposeDecoratedLine(lineIndex));
  };

  const refresh = () => {
    if (disposed) {
      return;
    }

    normalizeDecorationKeys();
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") {
      clearDecorations();
      return;
    }

    const lastBufferLine = buffer.length - 1;
    const cursorLine = Math.min(lastBufferLine, buffer.baseY + buffer.cursorY);
    const recentStartLine = Math.max(0, cursorLine - scanBacklogLines + 1);
    const viewportStartLine = Math.max(0, buffer.viewportY);
    const viewportEndLine = Math.min(lastBufferLine, buffer.viewportY + terminal.rows - 1);

    scanRange(recentStartLine, cursorLine);
    scanRange(viewportStartLine, viewportEndLine);
    pruneDecorations(recentStartLine, viewportStartLine, viewportEndLine);
  };

  const scheduleRefresh = () => {
    if (refreshQueued || disposed) {
      return;
    }
    refreshQueued = true;
    window.queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  };

  const writeDisposable = terminal.onWriteParsed(scheduleRefresh);
  const resizeDisposable = terminal.onResize(scheduleRefresh);
  const scrollDisposable = terminal.onScroll(scheduleRefresh);
  const bufferDisposable = terminal.buffer.onBufferChange(scheduleRefresh);
  scheduleRefresh();

  return {
    dispose: () => {
      disposed = true;
      writeDisposable.dispose();
      resizeDisposable.dispose();
      scrollDisposable.dispose();
      bufferDisposable.dispose();
      clearDecorations();
    },
    refresh,
    setPalette: (palette) => {
      activePalette = palette;
      clearDecorations();
      refresh();
    },
  };
}

export function findTerminalSemanticTokens(text: string): TerminalSemanticToken[] {
  const matches: Array<TerminalSemanticToken & { priority: number }> = [];

  tokenMatchers.forEach((matcher) => {
    matcher.pattern.lastIndex = 0;
    for (const match of text.matchAll(matcher.pattern)) {
      const rawText = match[0];
      const rawStart = match.index ?? 0;
      const trimmed = trimTerminalSemanticTokenText(rawText);
      if (!trimmed.text) {
        continue;
      }
      matches.push({
        end: rawStart + trimmed.end,
        kind: matcher.kind,
        priority: matcher.priority,
        start: rawStart + trimmed.start,
        text: trimmed.text,
      });
    }
  });

  const occupied = new Array<boolean>(text.length).fill(false);
  const selected: TerminalSemanticToken[] = [];
  matches
    .sort((left, right) => (
      right.priority - left.priority ||
      (right.end - right.start) - (left.end - left.start) ||
      left.start - right.start
    ))
    .forEach((match) => {
      for (let index = match.start; index < match.end; index += 1) {
        if (occupied[index]) {
          return;
        }
      }
      for (let index = match.start; index < match.end; index += 1) {
        occupied[index] = true;
      }
      selected.push({
        end: match.end,
        kind: match.kind,
        start: match.start,
        text: match.text,
      });
    });

  return selected.sort((left, right) => left.start - right.start);
}

export function getTerminalSemanticHighlightPalette(theme: ITheme): TerminalSemanticHighlightPalette {
  return getColorLuminance(theme.background) >= 0.52
    ? lightSemanticPalette
    : darkSemanticPalette;
}

export function trimTerminalSemanticTokenText(text: string) {
  let start = 0;
  let end = text.length;

  while (start < end && /[([{<"']/.test(text[start])) {
    start += 1;
  }
  while (end > start && /[\]),.;!?:"']/.test(text[end - 1])) {
    end -= 1;
  }

  return {
    end,
    start,
    text: text.slice(start, end),
  };
}

function readTerminalLineSnapshot(line: IBufferLine, cols: number): TerminalLineSnapshot {
  const cells: TerminalLineCell[] = [];
  let text = "";
  const maxCells = Math.min(line.length, cols, maxLineCells);

  for (let x = 0; x < maxCells; x += 1) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) {
      continue;
    }

    const chars = cell.getChars() || " ";
    const start = text.length;
    text += chars;
    cells.push({
      defaultForeground: cell.isFgDefault() && !cell.isInverse() && !cell.isInvisible(),
      end: text.length,
      start,
      width: Math.max(1, cell.getWidth()),
      x,
    });
  }

  const trimmedTextLength = text.replace(/\s+$/, "").length;
  return {
    cells,
    text: text.slice(0, trimmedTextLength),
  };
}

function tokenToCellRange(
  token: TerminalSemanticToken,
  snapshot: TerminalLineSnapshot,
): SemanticCellRange | null {
  const firstCellIndex = snapshot.cells.findIndex((cell) => cell.end > token.start);
  if (firstCellIndex < 0) {
    return null;
  }

  let lastCellIndex = firstCellIndex;
  for (let index = firstCellIndex; index < snapshot.cells.length; index += 1) {
    const cell = snapshot.cells[index];
    if (cell.start >= token.end) {
      break;
    }
    lastCellIndex = index;
  }

  const cells = snapshot.cells.slice(firstCellIndex, lastCellIndex + 1);
  if (cells.length === 0 || cells.some((cell) => !cell.defaultForeground)) {
    return null;
  }

  const firstCell = cells[0];
  const lastCell = cells[cells.length - 1];
  return {
    kind: token.kind,
    width: Math.max(1, (lastCell.x + lastCell.width) - firstCell.x),
    x: firstCell.x,
  };
}

function getColorLuminance(color: string | undefined) {
  const normalized = /^#?([0-9a-fA-F]{6})$/.exec((color || "").trim());
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
