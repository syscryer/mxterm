export const terminalSplitMinRatio = 0.2;
export const terminalSplitMaxRatio = 0.8;
export const terminalSplitMaxPanes = 4;

export type TerminalPaneBinding =
  | { kind: "ssh"; tabId: string }
  | { kind: "local"; tabId: string };

export interface TerminalSplitLeaf {
  binding?: TerminalPaneBinding;
  id: string;
  kind: "leaf";
}

export interface TerminalSplitBranch {
  direction: "row" | "column";
  first: TerminalSplitNode;
  id: string;
  kind: "split";
  ratio: number;
  second: TerminalSplitNode;
}

export type TerminalSplitNode = TerminalSplitLeaf | TerminalSplitBranch;

export interface TerminalSplitBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface TerminalSplitPane {
  binding?: TerminalPaneBinding;
  bounds: TerminalSplitBounds;
  id: string;
}

export interface TerminalSplitResizer {
  bounds: TerminalSplitBounds;
  direction: TerminalSplitBranch["direction"];
  id: string;
  ratio: number;
}

export function terminalPaneBindingKey(binding: TerminalPaneBinding) {
  return `${binding.kind}:${binding.tabId}`;
}

export function terminalPaneBindingsEqual(
  first: TerminalPaneBinding | undefined,
  second: TerminalPaneBinding | undefined,
) {
  return Boolean(first && second && terminalPaneBindingKey(first) === terminalPaneBindingKey(second));
}

export function createTerminalSplitLayout(
  paneId: string,
  binding: TerminalPaneBinding,
): TerminalSplitLeaf {
  return {
    binding,
    id: paneId,
    kind: "leaf",
  };
}

export function collectTerminalSplitPanes(layout: TerminalSplitNode): TerminalSplitPane[] {
  const panes: TerminalSplitPane[] = [];
  collectTerminalSplitGeometry(layout, emptyTerminalSplitBounds(), panes, []);
  return panes.sort(compareTerminalSplitPanePosition);
}

export function collectTerminalSplitResizers(layout: TerminalSplitNode): TerminalSplitResizer[] {
  const resizers: TerminalSplitResizer[] = [];
  collectTerminalSplitGeometry(layout, emptyTerminalSplitBounds(), [], resizers);
  return resizers;
}

export function findTerminalSplitPaneByBinding(
  layout: TerminalSplitNode,
  binding: TerminalPaneBinding,
) {
  return collectTerminalSplitPanes(layout).find((pane) => terminalPaneBindingsEqual(pane.binding, binding));
}

export function splitTerminalPane(
  layout: TerminalSplitNode,
  paneId: string,
  direction: TerminalSplitBranch["direction"],
  splitId: string,
  newPaneId: string,
  newBinding?: TerminalPaneBinding,
): TerminalSplitNode {
  if (layout.kind === "leaf") {
    return layout.id === paneId
      ? {
          direction,
          first: layout,
          id: splitId,
          kind: "split",
          ratio: 0.5,
          second: { binding: newBinding, id: newPaneId, kind: "leaf" },
        }
      : layout;
  }

  return {
    ...layout,
    first: splitTerminalPane(layout.first, paneId, direction, splitId, newPaneId, newBinding),
    second: splitTerminalPane(layout.second, paneId, direction, splitId, newPaneId, newBinding),
  };
}

export function createTerminalFourPaneLayout(
  bindings: readonly TerminalPaneBinding[],
  ids: {
    bottomLeft: string;
    bottomRight: string;
    leftSplit: string;
    rightSplit: string;
    root: string;
    topLeft: string;
    topRight: string;
  },
): TerminalSplitBranch {
  return {
    direction: "row",
    first: {
      direction: "column",
      first: { binding: bindings[0], id: ids.topLeft, kind: "leaf" },
      id: ids.leftSplit,
      kind: "split",
      ratio: 0.5,
      second: { binding: bindings[2], id: ids.bottomLeft, kind: "leaf" },
    },
    id: ids.root,
    kind: "split",
    ratio: 0.5,
    second: {
      direction: "column",
      first: { binding: bindings[1], id: ids.topRight, kind: "leaf" },
      id: ids.rightSplit,
      kind: "split",
      ratio: 0.5,
      second: { binding: bindings[3], id: ids.bottomRight, kind: "leaf" },
    },
  };
}

export function equalizeTerminalSplitLayout(layout: TerminalSplitNode): TerminalSplitNode {
  if (layout.kind === "leaf") {
    return layout;
  }

  return {
    ...layout,
    first: equalizeTerminalSplitLayout(layout.first),
    ratio: 0.5,
    second: equalizeTerminalSplitLayout(layout.second),
  };
}

export function replaceTerminalSplitPane(
  layout: TerminalSplitNode,
  paneId: string,
  replacement: TerminalSplitNode,
): TerminalSplitNode {
  if (layout.kind === "leaf") {
    return layout.id === paneId ? replacement : layout;
  }

  return {
    ...layout,
    first: replaceTerminalSplitPane(layout.first, paneId, replacement),
    second: replaceTerminalSplitPane(layout.second, paneId, replacement),
  };
}

export function updateTerminalSplitRatio(
  layout: TerminalSplitNode,
  splitId: string,
  ratio: number,
): TerminalSplitNode {
  if (layout.kind === "leaf") {
    return layout;
  }

  if (layout.id === splitId) {
    return { ...layout, ratio: clampTerminalSplitRatio(ratio) };
  }

  return {
    ...layout,
    first: updateTerminalSplitRatio(layout.first, splitId, ratio),
    second: updateTerminalSplitRatio(layout.second, splitId, ratio),
  };
}

export function moveTerminalSplitBinding(
  layout: TerminalSplitNode,
  paneId: string,
  binding: TerminalPaneBinding,
): TerminalSplitNode {
  if (layout.kind === "leaf") {
    if (layout.id === paneId) {
      return { ...layout, binding };
    }
    return terminalPaneBindingsEqual(layout.binding, binding)
      ? { ...layout, binding: undefined }
      : layout;
  }

  return {
    ...layout,
    first: moveTerminalSplitBinding(layout.first, paneId, binding),
    second: moveTerminalSplitBinding(layout.second, paneId, binding),
  };
}

export function closeTerminalSplitPane(
  layout: TerminalSplitNode,
  paneId: string,
): TerminalSplitNode | null {
  if (layout.kind === "leaf") {
    return layout.id === paneId ? null : layout;
  }

  const first = closeTerminalSplitPane(layout.first, paneId);
  const second = closeTerminalSplitPane(layout.second, paneId);

  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  if (first === layout.first && second === layout.second) {
    return layout;
  }
  return { ...layout, first, second };
}

export function removeTerminalSplitBindings(
  layout: TerminalSplitNode,
  bindings: ReadonlySet<string>,
): TerminalSplitNode | null {
  const paneIds = collectTerminalSplitPanes(layout)
    .filter((pane) => pane.binding && bindings.has(terminalPaneBindingKey(pane.binding)))
    .map((pane) => pane.id);

  return paneIds.reduce<TerminalSplitNode | null>(
    (nextLayout, paneId) => (nextLayout ? closeTerminalSplitPane(nextLayout, paneId) : null),
    layout,
  );
}

export function clampTerminalSplitRatio(ratio: number) {
  return Math.min(terminalSplitMaxRatio, Math.max(terminalSplitMinRatio, ratio));
}

function emptyTerminalSplitBounds(): TerminalSplitBounds {
  return { height: 1, left: 0, top: 0, width: 1 };
}

function collectTerminalSplitGeometry(
  node: TerminalSplitNode,
  bounds: TerminalSplitBounds,
  panes: TerminalSplitPane[],
  resizers: TerminalSplitResizer[],
) {
  if (node.kind === "leaf") {
    panes.push({ binding: node.binding, bounds, id: node.id });
    return;
  }

  const ratio = clampTerminalSplitRatio(node.ratio);
  if (node.direction === "row") {
    const firstWidth = bounds.width * ratio;
    const firstBounds = { ...bounds, width: firstWidth };
    const secondBounds = {
      ...bounds,
      left: bounds.left + firstWidth,
      width: bounds.width - firstWidth,
    };
    resizers.push({
      bounds,
      direction: node.direction,
      id: node.id,
      ratio,
    });
    collectTerminalSplitGeometry(node.first, firstBounds, panes, resizers);
    collectTerminalSplitGeometry(node.second, secondBounds, panes, resizers);
    return;
  }

  const firstHeight = bounds.height * ratio;
  const firstBounds = { ...bounds, height: firstHeight };
  const secondBounds = {
    ...bounds,
    height: bounds.height - firstHeight,
    top: bounds.top + firstHeight,
  };
  resizers.push({
    bounds,
    direction: node.direction,
    id: node.id,
    ratio,
  });
  collectTerminalSplitGeometry(node.first, firstBounds, panes, resizers);
  collectTerminalSplitGeometry(node.second, secondBounds, panes, resizers);
}

function compareTerminalSplitPanePosition(first: TerminalSplitPane, second: TerminalSplitPane) {
  const verticalDelta = first.bounds.top - second.bounds.top;
  if (Math.abs(verticalDelta) > 0.0001) {
    return verticalDelta;
  }
  return first.bounds.left - second.bounds.left;
}
