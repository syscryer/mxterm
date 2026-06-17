const shellPromptPattern =
  /(?:\[[^\]\r\n]{1,180}@[^\]\r\n]{1,180}\]\s*[#$>]|[^\s@]+@[^\s:]+:[^\r\n]{0,120}[#$>])/;
const adjacentDuplicatePromptPattern = new RegExp(
  `(${shellPromptPattern.source})([ \\t]+)\\1(?=\\s|$)`,
  "g",
);

export function normalizeStartupOutput(output: string) {
  const trimmedLeading = output.replace(/^[\r\n]+/, "");
  return collapseAdjacentDuplicatePrompts(stripLeadingDuplicateStartupPrompt(trimmedLeading));
}

function stripLeadingDuplicateStartupPrompt(output: string) {
  const firstLineMatch = output.match(/^([^\r\n]{1,180})(\r?\n)([\s\S]+)$/);
  if (!firstLineMatch) {
    return output;
  }

  const firstLine = stripAnsi(firstLineMatch[1]).trim();
  const rest = firstLineMatch[3];
  const plainRest = stripAnsi(rest);
  if (!looksLikeShellPrompt(firstLine) || !looksLikeLoginBanner(plainRest)) {
    return output;
  }

  const restLines = plainRest.split(/\r?\n/).map((line) => line.trim());
  if (!restLines.some((line) => line === firstLine)) {
    return output;
  }

  return rest;
}

function collapseAdjacentDuplicatePrompts(output: string) {
  let next = output;
  let previous: string;
  do {
    previous = next;
    next = previous.replace(adjacentDuplicatePromptPattern, "$1");
  } while (next !== previous);
  return next;
}

function looksLikeShellPrompt(line: string) {
  return shellPromptPattern.test(line);
}

function looksLikeLoginBanner(output: string) {
  return /Welcome to|Last login|System load|security updates|updates total|Linux/i.test(output);
}

function stripAnsi(value: string) {
  return value.replace(
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g,
    "",
  );
}
