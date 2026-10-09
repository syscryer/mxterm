/** Read the live preview from the end without splitting the complete history. */
export function latestStreamTextLine(text: string): string {
  let end = text.length;
  while (end > 0) {
    let start = end - 1;
    while (start >= 0 && text[start] !== "\n" && text[start] !== "\r") start--;
    const line = text.slice(start + 1, end).trim();
    if (line) return line;
    end = start;
  }
  return "";
}
