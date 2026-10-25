import fs from 'node:fs/promises';

interface ProcessIdentity {
  pid: number; ppid: number; pgid: number; tty: string; tpgid: number; start: string; comm: string;
}
/** Wrapper and executable can name the same resume UUID in one foreground
 * group. A second terminal/group is a different owner, never a tie to guess. */
export function hasUniqueForegroundResumeGroup(rows: Array<{ pid: number; tty: string; pgid: number; tpgid: number }>, pid: number): boolean {
  const owners = rows.filter(row => row.tty && row.tty !== '?' && row.pgid > 0 && row.pgid === row.tpgid);
  return owners.some(row => row.pid === pid) && new Set(owners.map(row => `${row.tty}:${row.pgid}`)).size === 1;
}
function parseStat(pid: number, text: string): ProcessIdentity | null {
  const open = text.indexOf('('), close = text.lastIndexOf(')');
  if (open < 0 || close <= open || Number(text.slice(0, open).trim()) !== pid) return null;
  const fields = text.slice(close + 1).trim().split(/\s+/);
  if (['Z', 'X'].includes(fields[0]) || !/^\d+$/.test(fields[19] ?? '') || !/^-?\d+$/.test(fields[4] ?? '') || fields[4] === '0') return null;
  return { pid, ppid: Number(fields[1]), pgid: Number(fields[2]), tty: fields[4], tpgid: Number(fields[5]), start: fields[19], comm: text.slice(open + 1, close) };
}

/** Ordinary terminal recovery only. Proves the exact observed resume process
 * is alive in this pane's foreground group, not a cached argv/native UUID.
 * Integration sessions retain their separate exclusive-writer requirement. */
export async function readForegroundResumeIdentity(input: {
  panePid: number; processPid: number; rawArgs: string; processComm?: string;
}): Promise<string | null> {
  if (process.platform !== 'linux' || !process.getuid || !input.rawArgs
    || !Number.isSafeInteger(input.panePid) || input.panePid <= 1 || !Number.isSafeInteger(input.processPid) || input.processPid <= 1) return null;
  const uid = process.getuid();
  const read = async (pid: number) => {
    if ((await fs.stat(`/proc/${pid}`)).uid !== uid) return null;
    return parseStat(pid, await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
  };
  const args = async () => (await fs.readFile(`/proc/${input.processPid}/cmdline`, 'utf8')).replace(/\0$/, '').split('\0').join(' ').trim();
  try {
    const process = await read(input.processPid), pane = await read(input.panePid);
    if (!process || !pane || process.pgid <= 0 || process.pgid !== process.tpgid
      || process.tty !== pane.tty || pane.tpgid !== process.pgid
      || input.processComm && process.comm !== input.processComm || await args() !== input.rawArgs.trim()) return null;
    const chain = [process];
    while (chain.at(-1)!.pid !== input.panePid) {
      const parent = await read(chain.at(-1)!.ppid);
      if (!parent || parent.tty !== pane.tty || parent.tpgid !== process.pgid
        || chain.length >= 32 || chain.some(row => row.pid === parent.pid)) return null;
      chain.push(parent);
    }
    for (const before of chain) {
      if (JSON.stringify(await read(before.pid)) !== JSON.stringify(before)) return null;
    }
    if (await args() !== input.rawArgs.trim()) return null;
    return chain.map(row => `${row.pid}:${row.start}`).join('/');
  } catch { return null; }
}
