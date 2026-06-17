const shellPromptPattern =
  /(?:\[[^\]\r\n]{1,180}@[^\]\r\n]{1,180}\]\s*[#$>]|[^\s@]+@[^\s:]+:[^\r\n]{0,120}[#$>])/;
const adjacentDuplicatePromptPattern = new RegExp(
  `(${shellPromptPattern.source})([ \\t]+)\\1(?=\\s|$)`,
  "g",
);

export function normalizeStartupOutput(output: string) {
  const trimmedLeading = output.replace(/^[\r\n]+/, "");
  const withoutDuplicatePrompt = stripLeadingDuplicateStartupPrompt(trimmedLeading);
  const withoutDuplicateBanner = stripRepeatedLeadingLoginBanner(withoutDuplicatePrompt);
  return collapseAdjacentDuplicatePrompts(withoutDuplicateBanner);
}

function stripLeadingDuplicateStartupPrompt(output: string) {
  const firstLineMatch = output.match(/^([^\r\n]{1,180})(\r?\n)([\s\S]+)$/);
  if (!firstLineMatch) {
    return output;
  }

  const firstLine = stripAnsi(firstLineMatch[1]).trim();
  const firstLineBreak = firstLineMatch[2];
  const rest = firstLineMatch[3];
  const plainRest = stripAnsi(rest);
  const promptMatch = firstLine.match(new RegExp(`^(${shellPromptPattern.source})(?:[ \\t]+(.+))?$`));
  if (!promptMatch) {
    return output;
  }

  const prompt = promptMatch[1].trim();
  const firstLineRemainder = promptMatch[2]?.trim() || "";
  const bannerText = firstLineRemainder ? `${firstLineRemainder}\n${plainRest}` : plainRest;
  if (!looksLikeLoginBanner(bannerText)) {
    return output;
  }

  const restLines = plainRest.split(/\r?\n/).map((line) => line.trim());
  if (!restLines.some((line) => line === prompt)) {
    return output;
  }

  if (firstLineRemainder) {
    return `${firstLineRemainder}${firstLineBreak}${rest}`;
  }

  return rest;
}

function stripRepeatedLeadingLoginBanner(output: string) {
  const lines = splitLinesPreservingEndings(output);
  if (lines.length < 3) {
    return output;
  }

  const promptLineIndex = lines.findIndex((line) => {
    const text = normalizeLineForComparison(line);
    return shellPromptPattern.test(text);
  });
  if (promptLineIndex < 2) {
    return output;
  }

  const maxBlockSize = Math.floor(promptLineIndex / 2);
  for (let blockSize = 1; blockSize <= maxBlockSize; blockSize += 1) {
    const firstBlock = lines.slice(0, blockSize).map(normalizeLineForComparison);
    const secondBlock = lines.slice(blockSize, blockSize * 2).map(normalizeLineForComparison);
    if (!firstBlock.some((line) => line.length > 0)) {
      continue;
    }
    if (!sameLines(firstBlock, secondBlock)) {
      continue;
    }
    if (!looksLikeLoginBanner(firstBlock.join("\n"))) {
      continue;
    }
    return lines.slice(blockSize).join("");
  }

  return output;
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

function looksLikeLoginBanner(output: string) {
  return /Welcome to|Last login|System load|security updates|updates total|Linux/i.test(output);
}

function splitLinesPreservingEndings(value: string) {
  const parts = value.split(/(\r\n|\n|\r)/);
  const lines: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index] || "";
    const ending = parts[index + 1] || "";
    if (text || ending) {
      lines.push(`${text}${ending}`);
    }
  }
  return lines;
}

function normalizeLineForComparison(line: string) {
  return stripAnsi(line.replace(/(?:\r\n|\n|\r)$/, "")).trim();
}

function sameLines(left: string[], right: string[]) {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function stripAnsi(value: string) {
  return value.replace(
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g,
    "",
  );
}
