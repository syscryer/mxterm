import { readFileSync } from "node:fs";

const selectSource = readFileSync("src/shared/ui/AppSelect.tsx", "utf8");
const styleSource = readFileSync("src/styles/app.css", "utf8");

const requiredSnippets = [
  '@radix-ui/react-dismissable-layer',
  "DismissableLayerBranch",
  "<DismissableLayerBranch asChild>",
  "createPortal(",
  "document.body",
  "onPointerDown={(event) => {",
  "onClick={(event) => {",
  "chooseOption(option);",
];

for (const snippet of requiredSnippets) {
  if (!selectSource.includes(snippet)) {
    throw new Error(`AppSelect dialog portal interaction guard is missing: ${snippet}`);
  }
}

if (!/createPortal\([\s\S]*<DismissableLayerBranch asChild>[\s\S]*className="app-select-menu select-menu-content"[\s\S]*document\.body/.test(selectSource)) {
  throw new Error(
    "AppSelect portal menu should be wrapped in DismissableLayerBranch so Radix dialogs treat it as an interactive branch.",
  );
}

if (!/onClick=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*chooseOption\(option\);[\s\S]*\}\}/.test(selectSource)) {
  throw new Error("AppSelect option click should select the option, not only stop the event.");
}

if (!/\.app-select-menu\s*\{(?:(?!\n\})[\s\S])*pointer-events:\s*auto;(?:(?!\n\})[\s\S])*\n\}/.test(styleSource)) {
  throw new Error(
    "AppSelect portal menu should opt back into pointer events inside Radix modal dialogs.",
  );
}

const selectedStyleMatch = styleSource.match(
  /\.app-select-item\[aria-selected="true"\]\s*\{(?:(?!\n\})[\s\S])*\n\}/,
);
if (!selectedStyleMatch) {
  throw new Error("AppSelect should define a selected option style.");
}
if (selectedStyleMatch[0].includes("var(--mx-primary)")) {
  throw new Error("AppSelect selected option should stay neutral instead of using blue primary text/background.");
}

console.log("AppSelect source check passed.");
