/** Incremental framing for child-process output. Never concatenate a growing
 * partial line on each chunk, or parse an unbounded JSON record on the host. */
export function boundedLines(maxLength: number, onLine: (line: string) => void, onLimit: () => void) {
  let parts: string[] = [];
  let length = 0;
  let stopped = false;
  return (chunk: string) => {
    if (stopped) return;
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf('\n', start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.slice(start, end);
      if (length + part.length > maxLength) {
        stopped = true;
        parts = [];
        length = 0;
        onLimit();
        return;
      }
      parts.push(part);
      length += part.length;
      if (newline < 0) return;
      onLine(parts.join(''));
      parts = [];
      length = 0;
      start = newline + 1;
    }
  };
}
