/** tmux consumes one XTVERSION reply per query. A second reply (for example
 * from a browser repainting old output) is interpreted as pane keyboard input.
 * Keep ownership on the display connection, including for older clients.
 */
export class TerminalVersionReplies {
  private pending = 0;
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text';
  private csi = '';
  private osc = false;

  observe(data: string): void {
    for (const char of data) {
      if (this.state === 'string' || this.state === 'string-escape') {
        if (char === '\x9c' || char === '\x18' || char === '\x1a'
          || (this.osc && char === '\x07') || (this.state === 'string-escape' && char === '\\')) {
          this.state = 'text';
        } else this.state = char === '\x1b' ? 'string-escape' : 'string';
        continue;
      }
      if (char === '\x1b') { this.state = 'escape'; continue; }
      if (char === '\x9b' || (this.state === 'escape' && char === '[')) {
        this.state = 'csi'; this.csi = ''; continue;
      }
      if ('\x90\x98\x9d\x9e\x9f'.includes(char)
        || (this.state === 'escape' && 'P]X^_'.includes(char))) {
        this.osc = char === '\x9d' || char === ']';
        this.state = 'string'; continue;
      }
      if (this.state === 'csi') {
        if (char >= '@' && char <= '~') {
          if (char === 'q' && /^>0?$/.test(this.csi)) this.pending++;
          this.state = 'text';
        } else if (char >= ' ' && char <= '?' && this.csi.length < 32) this.csi += char;
        else if (char >= ' ') this.state = 'text';
        else if (char === '\x18' || char === '\x1a') this.state = 'text';
      } else this.state = 'text';
    }
  }

  filter(data: string): string {
    // xterm emits a complete reply in one onData record. Never rewrite keys,
    // mouse reports or paste records (which may contain literal escape bytes).
    const replies = data.match(/(?:\x1bP|\x90)>\|[^\x1b\x9c]*(?:\x1b\\|\x9c)/g);
    if (!replies || replies.join('') !== data) return data;
    return replies.filter(() => {
      if (!this.pending) return false;
      this.pending--;
      return true;
    }).join('');
  }
}
