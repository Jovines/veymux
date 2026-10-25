/** A program allowlist is about executable names, never window titles or arguments. */
export interface ChatStartupAgent { displayName: string; slug?: string }
export interface ChatEligibility { allowed: boolean; program: string | null; agent?: ChatStartupAgent }
export const NON_AGENT_PROGRAMS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'node', 'nodejs', 'python', 'python3', 'ruby', 'perl', 'java', 'bun', 'deno', 'npm', 'npx', 'pnpm', 'yarn', 'uv', 'uvx', 'env']);
const basename = (value: string) => value.split(/[/\\]/).pop()?.toLowerCase() || '';
export function validChatProgramName(value: string, excluded: readonly string[] = []): boolean {
  return /^[\p{L}\p{N}_.+-]{1,120}$/u.test(value) && !NON_AGENT_PROGRAMS.has(value.toLowerCase()) && !excluded.includes(value.toLowerCase());
}
export function chatProgramName(command: string): string | null {
  const tokens = (command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) || []).map(token => token.replace(/^(["'])(.*)\1$/, '$2'));
  return chatProgramNameFromArgv(tokens);
}
export function chatProgramNameFromArgv(argv: readonly string[]): string | null {
  const tokens = [...argv];
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] || '')) tokens.shift();
  if (basename(tokens[0] || '') === 'env') tokens.shift();
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] || '')) tokens.shift();
  let program = basename(tokens[0] || '');
  if (['node', 'nodejs', 'python', 'python3', 'ruby', 'perl', 'bun', 'deno', 'npx', 'uvx', 'bash', 'zsh', 'sh', 'fish'].includes(program)) {
    // Only a direct script/package operand is identifiable; flags may consume operands.
    if (!tokens[1] || tokens[1].startsWith('-')) return null;
    program = basename(tokens[1]);
  }
  return validChatProgramName(program) ? program : null;
}
