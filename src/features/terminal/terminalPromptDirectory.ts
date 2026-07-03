export function promptLineToDirectory(line: string, homeDirectory: string | null) {
  const cleanLine = promptLineKey(line);
  const match = cleanLine.match(/^\s*([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+):([^:#$]+)([#\$])\s*$/);
  if (!match) {
    return null;
  }

  const promptPath = match[3].trim();
  if (!promptPath) {
    return null;
  }
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

export function promptSnapshotLinesToDirectory(
  lines: readonly string[],
  homeDirectory: string | null,
) {
  for (const line of lines) {
    const directory = promptLineToDirectory(line, homeDirectory);
    if (directory) {
      return directory;
    }
  }
  return null;
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
