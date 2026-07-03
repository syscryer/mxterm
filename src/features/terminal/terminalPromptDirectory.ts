import { resolveTerminalInputDirectoryLine } from "./terminalInputDirectory";

export function promptLineToDirectory(line: string, homeDirectory: string | null) {
  const cleanLine = promptLineKey(line);
  const prompt = parsePromptLine(cleanLine);
  if (!prompt || prompt.command !== null) {
    return null;
  }
  return promptPathToDirectory(prompt.label, homeDirectory);
}

export function promptSnapshotLinesToDirectory(
  lines: readonly string[],
  homeDirectory: string | null,
  currentDirectory: string | null = null,
) {
  const cleanLines = lines.map(promptLineKey);
  const latestPrompt = cleanLines
    .map(parsePromptLine)
    .find((prompt): prompt is PromptLine => Boolean(prompt));
  if (!latestPrompt) {
    return null;
  }

  const promptLabel = latestPrompt.label;
  const labelDirectory = promptPathToDirectory(promptLabel, homeDirectory);
  if (labelDirectory) {
    return labelDirectory;
  }

  if (currentDirectory && directoryMatchesPromptLabel(currentDirectory, promptLabel, homeDirectory)) {
    return normalizeAbsolutePath(currentDirectory);
  }

  const replayedDirectory = replayPromptSnapshotDirectory(cleanLines, homeDirectory);
  if (replayedDirectory && directoryMatchesPromptLabel(replayedDirectory, promptLabel, homeDirectory)) {
    return replayedDirectory;
  }

  return null;
}

interface PromptLine {
  command: string | null;
  label: string;
}

function parsePromptLine(line: string): PromptLine | null {
  const colonPrompt = line.match(/^\s*[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:([^:#$]+)([#\$])(?:\s*(.*))?$/);
  if (colonPrompt) {
    return {
      command: normalizePromptCommand(colonPrompt[3]),
      label: colonPrompt[1].trim(),
    };
  }

  const bracketPrompt = line.match(/^\s*\[[A-Za-z0-9._-]+@[A-Za-z0-9._-]+\s+([^\]\r\n]+)\](?:[#\$])(?:\s*(.*))?$/);
  if (bracketPrompt) {
    return {
      command: normalizePromptCommand(bracketPrompt[2]),
      label: bracketPrompt[1].trim(),
    };
  }

  return null;
}

function normalizePromptCommand(command: string | undefined) {
  const trimmedCommand = command?.trim();
  return trimmedCommand ? trimmedCommand : null;
}

function promptPathToDirectory(promptPath: string, homeDirectory: string | null) {
  if (promptPath === "~") {
    return homeDirectory;
  }
  if (promptPath.startsWith("~/")) {
    return homeDirectory ? normalizeAbsolutePath(`${homeDirectory}${promptPath.slice(1)}`) : null;
  }
  if (!promptPath.startsWith("/")) {
    return null;
  }

  return normalizeAbsolutePath(promptPath);
}

function directoryMatchesPromptLabel(
  directory: string,
  promptLabel: string,
  homeDirectory: string | null,
) {
  const promptDirectory = promptPathToDirectory(promptLabel, homeDirectory);
  if (promptDirectory) {
    return normalizeAbsolutePath(directory) === promptDirectory;
  }

  const normalizedDirectory = normalizeAbsolutePath(directory);
  const directoryName = normalizedDirectory.split("/").filter(Boolean).pop() || "/";
  return directoryName === promptLabel;
}

function replayPromptSnapshotDirectory(
  cleanLinesNewestFirst: readonly string[],
  homeDirectory: string | null,
) {
  let currentDirectory: string | null = null;
  const chronologicalLines = [...cleanLinesNewestFirst].reverse();

  for (let index = 0; index < chronologicalLines.length; index += 1) {
    const prompt = parsePromptLine(chronologicalLines[index]);
    if (!prompt) {
      continue;
    }

    const promptDirectory = promptPathToDirectory(prompt.label, homeDirectory);
    if (promptDirectory) {
      currentDirectory = promptDirectory;
    }

    if (!prompt.command) {
      continue;
    }

    const commandDirectory = resolveTerminalInputDirectoryLine(
      prompt.command,
      currentDirectory,
      homeDirectory,
    );
    if (!commandDirectory || commandOutputHasCdFailure(chronologicalLines, index)) {
      continue;
    }

    currentDirectory = commandDirectory;
  }

  return currentDirectory;
}

function commandOutputHasCdFailure(chronologicalLines: readonly string[], commandIndex: number) {
  for (let index = commandIndex + 1; index < chronologicalLines.length; index += 1) {
    if (parsePromptLine(chronologicalLines[index])) {
      return false;
    }
    if (isCdFailureLine(chronologicalLines[index])) {
      return true;
    }
  }
  return false;
}

function isCdFailureLine(line: string) {
  return /cd:.*(?:No such file or directory|Not a directory|Permission denied|没有那个文件或目录|不是目录|权限不够|权限被拒绝)/i.test(line);
}

function promptLineKey(line: string) {
  return stripAnsiSequences(line).trimEnd();
}

function stripAnsiSequences(input: string) {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== "\u001b") {
      output += input[index];
      continue;
    }
    index = skipEscapeSequence(input, index);
  }
  return output;
}

function normalizeAbsolutePath(path: string) {
  const parts: string[] = [];
  path.replace(/\\/g, "/").split("/").forEach((part) => {
    if (!part || part === ".") {
      return;
    }
    if (part === "..") {
      parts.pop();
      return;
    }
    parts.push(part);
  });

  return `/${parts.join("/")}`;
}

function skipEscapeSequence(data: string, start: number) {
  const marker = data[start + 1];
  if (marker === "[") {
    return skipControlSequence(data, start + 2);
  }
  if (marker === "]") {
    return skipOperatingSystemCommand(data, start + 2);
  }

  for (let index = start + 1; index < data.length; index += 1) {
    const code = data.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return data.length - 1;
}

function skipControlSequence(data: string, start: number) {
  for (let index = start; index < data.length; index += 1) {
    const code = data.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return data.length - 1;
}

function skipOperatingSystemCommand(data: string, start: number) {
  for (let index = start; index < data.length; index += 1) {
    if (data[index] === "\u0007") {
      return index;
    }
    if (data[index] === "\u001b" && data[index + 1] === "\\") {
      return index + 1;
    }
  }
  return data.length - 1;
}
