import fs from 'node:fs/promises';
import path from 'node:path';

/** Codex TUIs reconnect to this user's managed daemon. Its thread writer is
 * shared by those clients, so its open rollout is not a second terminal. */
export function isSharedCodexDaemonCommand(executable: string, argv: string[], codexHome: string): boolean {
  const releases = path.join(codexHome, 'packages', 'app-server-daemon', 'releases');
  const relative = path.relative(releases, executable);
  const listen = argv.indexOf('--listen');
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    && path.basename(executable) === 'codex' && argv[1] === 'app-server'
    && argv.includes('--managed-daemon') && listen > 1 && argv[listen + 1] === 'unix://';
}

export async function isSharedCodexDaemon(pid: number, codexHome: string): Promise<boolean> {
  if (process.platform !== 'linux' || !process.getuid) return false;
  try {
    const directory = `/proc/${pid}`;
    const [stat, executable, command, home] = await Promise.all([
      fs.stat(directory), fs.readlink(`${directory}/exe`), fs.readFile(`${directory}/cmdline`, 'utf8'), fs.realpath(codexHome),
    ]);
    return stat.uid === process.getuid() && isSharedCodexDaemonCommand(executable, command.split('\0').filter(Boolean), home);
  } catch { return false; }
}
