import { readFileSync } from "node:fs";

const monitorCss = readFileSync("src/features/monitor/monitor.css", "utf8");
const appCss = readFileSync("src/styles/app.css", "utf8");
const tokenCss = readFileSync("src/styles/tokens.css", "utf8");

for (const needle of [
  "--monitor-tile-bg",
  "--monitor-bar-track",
  "--monitor-chart-bg",
  "--monitor-chart-grid",
  "--monitor-warning-bg",
  "--monitor-danger-bg",
  '.app-shell[data-theme-mode="dark"] .monitor-shell',
  '.app-shell[data-theme-mode="system"] .monitor-shell',
]) {
  if (!monitorCss.includes(needle)) {
    throw new Error(`monitor.css is missing dark-mode token hook: ${needle}`);
  }
}

for (const forbidden of [
  "background: #fbfcfe",
  "background: #e8ebf3",
  "stroke: #eef1f8",
  "border-top: 1px solid #edf1f7",
  "background: #fff7ed",
  "background: #fffafa",
]) {
  if (monitorCss.includes(forbidden)) {
    throw new Error(`monitor.css still contains a light-only monitor surface: ${forbidden}`);
  }
}

for (const needle of [
  '.app-shell[data-theme-mode="dark"] :where(',
  ".command-sender-panel",
  ".command-sender-console",
  ".command-target-pane",
  ".command-sender-actions",
  ".settings-content",
  ".custom-titlebar",
  ".repository-toolbar",
  ".repository-search",
  ".repository-primary-button",
  ".repository-primary-button:hover:not(:disabled)",
  ".repository-icon-button",
  ".appearance-preview-files",
  ".credential-form-head",
  ".settings-segmented button:hover",
  ".terminal-scheme-card:hover:not(.active)",
  ".filter-tab:hover",
  ".command-input::placeholder",
  '.app-shell[data-theme-mode="system"] :where(',
]) {
  if (!appCss.includes(needle)) {
    throw new Error(`app.css is missing dark-mode surface coverage: ${needle}`);
  }
}

for (const needle of [
  ".settings-panel,",
  ".repository-toolbar,",
  ".repository-primary-button,",
  ".settings-input,",
  ".credential-form-head,",
  ".command-target,",
  ".command-target-terminal-shell,",
]) {
  const darkIndex = appCss.indexOf('.app-shell[data-theme-mode="dark"] :where(');
  const targetIndex = appCss.indexOf(needle, darkIndex);
  if (darkIndex < 0 || targetIndex < darkIndex) {
    throw new Error(`app.css dark-mode block should cover: ${needle}`);
  }
}

const connectionHomeSelectors = [
  ".repository-toolbar",
  ".connection-head",
];

for (const selector of connectionHomeSelectors) {
  const selectorIndex = appCss.indexOf(`${selector} {`);
  const nextBlockIndex = appCss.indexOf("\n}", selectorIndex);
  const block = selectorIndex >= 0 && nextBlockIndex >= 0 ? appCss.slice(selectorIndex, nextBlockIndex) : "";
  if (!block) {
    throw new Error(`app.css is missing connection home selector: ${selector}`);
  }
  for (const forbidden of [
    "#fbfcfe",
    "#ffffff",
  ]) {
    if (block.includes(forbidden)) {
      throw new Error(`${selector} still contains a light-only connection home surface: ${forbidden}`);
    }
  }
}

const connectionBoardIndex = appCss.indexOf(".connection-board {");
const connectionBoardBlock =
  connectionBoardIndex >= 0 ? appCss.slice(connectionBoardIndex, appCss.indexOf("\n}", connectionBoardIndex)) : "";
if (!connectionBoardBlock || connectionBoardBlock.includes("overflow-x: auto")) {
  throw new Error("connection home board should avoid bottom horizontal scrolling");
}

const actionCellIndex = appCss.indexOf(".action-cell {");
const actionCellBlock = actionCellIndex >= 0 ? appCss.slice(actionCellIndex, appCss.indexOf("\n}", actionCellIndex)) : "";
if (!actionCellBlock || actionCellBlock.includes("position: sticky")) {
  throw new Error("connection action cell should stay integrated with the row");
}

for (const needle of [
  ".app-shell[data-theme-mode=\"dark\"] .connection-row:hover .action-cell",
  ".app-shell[data-theme-mode=\"dark\"] :is(",
  ".settings-toggle[aria-checked=\"true\"]",
  ".command-actions .primary-button",
  ".app-shell[data-theme-mode=\"dark\"] :where(.connection-action-icon:hover)",
  ".app-shell[data-theme-mode=\"system\"] .connection-row:hover .action-cell",
  ".app-shell[data-theme-mode=\"system\"] :is(",
  ".app-shell[data-theme-mode=\"system\"] :where(.connection-action-icon:hover)",
]) {
  if (!appCss.includes(needle)) {
    throw new Error(`app.css is missing dark connection action coverage: ${needle}`);
  }
}

const darkActionHoverIndex = appCss.indexOf('.app-shell[data-theme-mode="dark"] :where(.connection-action-icon:hover)');
const darkActionHoverBlock =
  darkActionHoverIndex >= 0 ? appCss.slice(darkActionHoverIndex, appCss.indexOf("\n}", darkActionHoverIndex)) : "";
if (!darkActionHoverBlock || !darkActionHoverBlock.includes("background: transparent")) {
  throw new Error("dark connection action icon hover should not draw a background panel");
}

const darkConnectionRowIndex = appCss.indexOf('.app-shell[data-theme-mode="dark"] :where(.connection-row)');
const darkConnectionRowBlock =
  darkConnectionRowIndex >= 0 ? appCss.slice(darkConnectionRowIndex, appCss.indexOf("\n}", darkConnectionRowIndex)) : "";
if (!darkConnectionRowBlock || !darkConnectionRowBlock.includes("transition: none")) {
  throw new Error("dark connection row hover should not fade out with a residual block");
}

const systemConnectionRowIndex = appCss.indexOf('.app-shell[data-theme-mode="system"] :where(.connection-row)');
const systemConnectionRowBlock =
  systemConnectionRowIndex >= 0 ? appCss.slice(systemConnectionRowIndex, appCss.indexOf("\n}", systemConnectionRowIndex)) : "";
if (!systemConnectionRowBlock || !systemConnectionRowBlock.includes("transition: none")) {
  throw new Error("system dark connection row hover should not fade out with a residual block");
}

const terminalSchemeHoverIndex = appCss.indexOf(".terminal-scheme-card:hover {");
const terminalSchemeHoverBlock =
  terminalSchemeHoverIndex >= 0 ? appCss.slice(terminalSchemeHoverIndex, appCss.indexOf("\n}", terminalSchemeHoverIndex)) : "";
if (!terminalSchemeHoverBlock || !terminalSchemeHoverBlock.includes("#fbfcfe")) {
  throw new Error("terminal scheme card light hover baseline should remain explicit for regression checks");
}

for (const [label, startNeedle] of [
  ["dark", '.app-shell[data-theme-mode="dark"] :where('],
  ["system dark", '.app-shell[data-theme-mode="system"] :where('],
]) {
  const startIndex = appCss.indexOf(startNeedle);
  const cardIndex = appCss.indexOf(".terminal-scheme-card:hover:not(.active)", startIndex);
  const blockEndIndex = cardIndex >= 0 ? appCss.indexOf("\n}", cardIndex) : -1;
  const block = cardIndex >= 0 && blockEndIndex >= 0 ? appCss.slice(cardIndex, blockEndIndex) : "";
  if (startIndex < 0 || cardIndex < startIndex || !block.includes("background: var(--mx-active)")) {
    throw new Error(`${label} terminal scheme card hover should stay on dark active surface`);
  }
}

for (const forbidden of [
  '--mx-chrome-fill: rgb(28 28 28 / 0%);',
  '--mx-chrome-fill: rgb(30 31 34 / 0%);',
  '--mx-chrome-fill: rgb(28 29 32 / 0%);',
]) {
  if (tokenCss.includes(forbidden)) {
    throw new Error(`tokens.css dark material chrome must not be transparent: ${forbidden}`);
  }
}

for (const needle of [
  '.app-shell[data-theme-mode="dark"][data-window-material="mica"]',
  '.app-shell[data-theme-mode="dark"][data-window-material="acrylic"]',
  '.app-shell[data-theme-mode="dark"][data-window-material="micaAlt"]',
  '.app-shell[data-theme-mode="system"][data-window-material="mica"]',
  '.app-shell[data-theme-mode="system"][data-window-material="acrylic"]',
  '.app-shell[data-theme-mode="system"][data-window-material="micaAlt"]',
  "--mx-sidebar-surface: var(--mx-chrome-fill);",
]) {
  if (!tokenCss.includes(needle)) {
    throw new Error(`tokens.css is missing unified dark chrome/sidebar token: ${needle}`);
  }
}

console.log("Dark mode source check passed.");
