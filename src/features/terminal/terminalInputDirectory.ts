export interface TerminalInputDirectoryState {
  dirty: boolean;
  directory: string | null;
  homeDirectory: string | null;
  line: string;
}

export interface CreateTerminalInputDirectoryStateOptions {
  currentDirectory?: string | null;
  homeDirectory?: string | null;
}

export interface TerminalInputDirectoryResult {
  directory: string | null;
  state: TerminalInputDirectoryState;
}

const maxTrackedLineLength = 4096;

export function createTerminalInputDirectoryState({
  currentDirectory = null,
  homeDirectory = null,
}: CreateTerminalInputDirectoryStateOptions = {}): TerminalInputDirectoryState {
  return {
    dirty: false,
    directory: currentDirectory,
    homeDirectory,
    line: "",
  };
}

export function applyTerminalInputDirectoryData(
  initialState: TerminalInputDirectoryState,
  data: string,
): TerminalInputDirectoryResult {
  let state = initialState;
  let directory: string | null = null;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];

    if (char === "\u001b") {
      const sequenceEnd = skipEscapeSequence(data, index);
      if (!isBracketedPasteBoundary(data.slice(index, sequenceEnd + 1))) {
        state = { ...state, dirty: true };
      }
      index = sequenceEnd;
      continue;
    }

    if (char === "\r" || char === "\n") {
      const nextDirectory = state.dirty
        ? null
        : resolveCdCommand(
            state.line,
            state.directory,
            state.homeDirectory,
          );
      state = { ...state, dirty: false, line: "" };
      if (nextDirectory) {
        directory = nextDirectory;
        state = { ...state, directory };
      }
      continue;
    }

    if (char === "\u007f" || char === "\b") {
      state = { ...state, line: state.line.slice(0, -1) };
      continue;
    }

    if (char === "\t") {
      state = { ...state, dirty: true };
      continue;
    }

    if (isControlCharacter(char)) {
      state = { ...state, dirty: true };
      continue;
    }

    state = {
      ...state,
      line: `${state.line}${char}`.slice(-maxTrackedLineLength),
    };
  }

  return { directory, state };
}

export function inferRemoteHomeDirectory(username: string | null | undefined) {
  const normalizedUsername = username?.trim();
  if (!normalizedUsername || !/^[A-Za-z0-9._-]+$/.test(normalizedUsername)) {
    return null;
  }
  if (normalizedUsername === "root") {
    return "/root";
  }
  return `/home/${normalizedUsername}`;
}

export function resolveTerminalInputDirectoryLine(
  line: string,
  currentDirectory: string | null,
  homeDirectory: string | null,
) {
  return resolveCdCommand(line.trim(), currentDirectory, homeDirectory);
}

function resolveCdCommand(
  line: string,
  currentDirectory: string | null,
  homeDirectory: string | null,
) {
  const tokens = tokenizeCommand(line.trim());
  if (!tokens || tokens[0] !== "cd") {
    return null;
  }

  let pathIndex = 1;
  if (tokens[pathIndex] === "--") {
    pathIndex += 1;
  }

  if (tokens.length === 1 || (tokens.length === 2 && tokens[1] === "--")) {
    return homeDirectory;
  }

  if (tokens.length !== pathIndex + 1) {
    return null;
  }

  return resolveDirectoryToken(tokens[pathIndex], currentDirectory, homeDirectory);
}

function resolveDirectoryToken(
  token: string,
  currentDirectory: string | null,
  homeDirectory: string | null,
) {
  if (token === "-") {
    return null;
  }
  if (token === "~") {
    return homeDirectory;
  }
  if (token.startsWith("~/")) {
    return homeDirectory ? normalizeAbsolutePath(`${homeDirectory}${token.slice(1)}`) : null;
  }
  if (token.startsWith("~")) {
    return null;
  }
  if (token.startsWith("/")) {
    return normalizeAbsolutePath(token);
  }
  if (!currentDirectory) {
    return null;
  }
  return normalizeAbsolutePath(`${currentDirectory}/${token}`);
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

function tokenizeCommand(command: string) {
  if (!command) {
    return null;
  }

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === "\"" && index + 1 < command.length) {
        index += 1;
        token += command[index];
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      token += command[index];
      continue;
    }

    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (quote) {
    return null;
  }
  if (token) {
    tokens.push(token);
  }

  return tokens.length > 0 ? tokens : null;
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

function isBracketedPasteBoundary(sequence: string) {
  return sequence === "\u001b[200~" || sequence === "\u001b[201~";
}

function isControlCharacter(char: string) {
  const code = char.charCodeAt(0);
  return code < 0x20 && char !== "\t";
}
