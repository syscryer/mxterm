export interface DockerVirtualWindowInput {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  gap?: number;
  overscan?: number;
}

export interface DockerVirtualWindow {
  startIndex: number;
  endIndexExclusive: number;
  rowStep: number;
  totalHeight: number;
  topPadding: number;
  bottomPadding: number;
}

const dockerContainerCardHeight = 76;
const dockerContainerListGap = 8;
const dockerContainerWindowOverscan = 2;

export function calculateDockerVirtualWindow({
  itemCount,
  scrollTop,
  viewportHeight,
  rowHeight = dockerContainerCardHeight,
  gap = dockerContainerListGap,
  overscan = dockerContainerWindowOverscan,
}: DockerVirtualWindowInput): DockerVirtualWindow {
  const safeCount = Math.max(0, Math.floor(itemCount));
  const safeRowHeight = Math.max(1, Math.floor(rowHeight));
  const safeGap = Math.max(0, Math.floor(gap));
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const rowStep = safeRowHeight + safeGap;
  const totalHeight = safeCount === 0 ? 0 : safeCount * rowStep - safeGap;
  if (safeCount === 0) {
    return {
      startIndex: 0,
      endIndexExclusive: 0,
      rowStep,
      totalHeight,
      topPadding: 0,
      bottomPadding: 0,
    };
  }

  const safeScrollTop = Math.max(0, Math.floor(scrollTop));
  const safeViewportHeight = Math.max(0, Math.floor(viewportHeight));
  const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / rowStep));
  const startIndex = clamp(
    Math.floor(safeScrollTop / rowStep) - safeOverscan,
    0,
    Math.max(0, safeCount - 1),
  );
  const endIndexExclusive = clamp(
    startIndex + visibleCount + safeOverscan * 2,
    startIndex + 1,
    safeCount,
  );
  const topPadding = startIndex * rowStep;
  const renderedHeight = (endIndexExclusive - startIndex) * rowStep - safeGap;
  const bottomPadding = Math.max(0, totalHeight - topPadding - renderedHeight);

  return {
    startIndex,
    endIndexExclusive,
    rowStep,
    totalHeight,
    topPadding,
    bottomPadding,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
