/** Restrict preparation to direct, prompt-free Codex launches. Shell programs,
 * remote servers and existing conversation commands keep their own semantics. */
export function codexColdLaunchArgv(command: string): string[] | null {
  if (!command || /[\r\n\x00$`]/.test(command)) return null;
  const tokens: string[] = []; let token = '', quote = '', escaped = false, started = false;
  for (const char of command.trim()) {
    if (escaped) { token += char; escaped = false; started = true; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; else token += char; started = true; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) tokens.push(token); token = ''; started = false; continue; }
    if (/[;&|<>$`(){}]/.test(char)) return null;
    token += char; started = true;
  }
  if (escaped || quote) return null;
  if (started) tokens.push(token);
  if (!tokens.length || tokens[0].split(/[\\/]/).at(-1) !== 'codex') return null;
  const switches = new Set(['--dangerously-bypass-approvals-and-sandbox', '--full-auto', '--no-alt-screen', '--search']);
  const values = new Set(['-m', '--model', '-c', '--config', '-p', '--profile', '-s', '--sandbox', '-a', '--ask-for-approval', '--enable', '--disable']);
  for (let i = 1; i < tokens.length; i++) {
    const flag = tokens[i];
    if (switches.has(flag)) continue;
    if (values.has(flag) && i + 1 < tokens.length) { i++; continue; }
    const equal = flag.indexOf('=');
    if (equal > 0 && values.has(flag.slice(0, equal))) continue;
    return null;
  }
  return tokens;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export function codexPreparedResumeCommand(argv: string[], nativeId: string): string {
  if (!/^[a-zA-Z0-9._-]{8,160}$/.test(nativeId)) throw new Error('INVALID_CODEX_THREAD_ID');
  return [...argv, 'resume', nativeId].map(shellQuote).join(' ');
}

