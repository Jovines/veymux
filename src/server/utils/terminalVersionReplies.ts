export const TERMINAL_VERSION_REPLY = '\x1bP>|Veymux\x1b\\';

/** Only discard complete parser records, never keys or literal pasted bytes. */
export function filterTerminalVersionReplies(data: string): string {
  return /^(?:(?:\x1bP|\x90)>\|[^\x1b\x9c]*(?:\x1b\\|\x9c))+$/.test(data) ? '' : data;
}

/** The service owns tmux identification. Browser replies can be delayed,
 * replayed, or produced by multiple observers of the same PTY, so they must
 * never be allowed to answer a server-side display's query.
 */
export class TerminalVersionReplies {
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text';
  private csi = '';
  private osc = false;

  constructor(private readonly reply: (data: string) => void) {}

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
          if (char === 'q' && /^>0?$/.test(this.csi)) this.reply(TERMINAL_VERSION_REPLY);
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
    return filterTerminalVersionReplies(data);
  }
}
