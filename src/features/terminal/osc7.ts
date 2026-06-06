export interface Osc7ParseResult {
  paths: string[];
  buffer: string;
}

const osc7Prefix = "\u001b]7;";
const stTerminator = "\u001b\\";
const maxOscBufferLength = 2048;

export function extractOsc7Directories(input: string): Osc7ParseResult {
  const paths: string[] = [];
  let cursor = 0;
  let buffer = "";

  while (cursor < input.length) {
    const start = input.indexOf(osc7Prefix, cursor);
    if (start === -1) {
      break;
    }

    const payloadStart = start + osc7Prefix.length;
    const bellEnd = input.indexOf("\u0007", payloadStart);
    const stEnd = input.indexOf(stTerminator, payloadStart);
    const end = chooseOscEnd(bellEnd, stEnd);

    if (end === -1) {
      buffer = input.slice(start);
      break;
    }

    const payload = input.slice(payloadStart, end);
    const path = osc7PayloadToPath(payload);
    if (path) {
      paths.push(path);
    }
    cursor = end + (end === stEnd ? stTerminator.length : 1);
  }

  return {
    paths,
    buffer: buffer.length > maxOscBufferLength ? buffer.slice(-maxOscBufferLength) : buffer,
  };
}

function chooseOscEnd(bellEnd: number, stEnd: number) {
  if (bellEnd === -1) {
    return stEnd;
  }
  if (stEnd === -1) {
    return bellEnd;
  }
  return Math.min(bellEnd, stEnd);
}

function osc7PayloadToPath(payload: string) {
  const value = payload.trim();
  if (!value) {
    return null;
  }

  const path = value.startsWith("file://") ? value.slice("file://".length).replace(/^[^/]+/, "") : value;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
