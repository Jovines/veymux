import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export interface TmuxClientProcess {
  pid: number;
  parentPid: number;
  uid: number;
  started: string;
  command: string;
}
export function parseTmuxProcessList(output: string): TmuxClientProcess[] {
  return output.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), uid: Number(match[3]), started: match[4], command: match[5] }] : [];
  });
}
const psFields = 'pid=,ppid=,uid=,lstart=,args=';
function readProcess(pid: number): TmuxClientProcess | null {
  try {
    if (process.platform === 'linux') {
      const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const stat = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
      const uid = /^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      if (stat[0] === 'Z' || !uid) return null;
      return { pid, parentPid: Number(stat[1]), uid: Number(uid[1]), started: stat[19],
        command: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() };
    }
    return parseTmuxProcessList(execFileSync('ps', ['-p', String(pid), '-o', psFields], { encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C' } }))[0] ?? null;
  } catch { return null; }
}

/** Only attach clients on a confirmed Veymux session qualify. No pane,
 * server, shell wrapper, live owner's client, or arbitrary tmux command does. */
export function isLegacyTmuxClient(command: string, targets: ReadonlySet<string>, serverArgs: readonly string[] = []): boolean {
  const args = command.trim().split(/\s+/);
  if (args.shift()?.split('/').pop() !== 'tmux') return false;
  for (const expected of serverArgs) if (args.shift() !== expected) return false;
  let clientFlag = false, control = false, controlFlags = false;
  while (args.length && !['attach', 'attach-session'].includes(args[0])) {
    const flag = args.shift();
    if (flag === '-u') clientFlag = true;
    else if (flag === '-C') control = true;
    else if (flag === '-T' && args.shift() === 'RGB,sync') clientFlag = true;
    else return false;
  }
  if (!args.shift()) return false;
  let target: string | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === '-r') { controlFlags = true; continue; }
    if (flag === '-f' && args.shift() === 'ignore-size') { controlFlags = true; continue; }
    if (flag === '-t' && !target) { target = args.shift(); continue; }
    return false;
  }
  return (clientFlag || control && controlFlags) && !!target && targets.has(target.replace(/^=/, ''));
}

interface OwnedClient {
  pid: number;
  identity: TmuxClientProcess | null;
  finish(): void;
  done: Promise<void>;
  stopping: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
interface ClientPty {
  pid?: number;
  kill(): void;
  onExit(handler: () => void): { dispose(): void };
}
interface ReaperOptions {
  read?: (pid: number) => TmuxClientProcess | null;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  graceMs?: number;
}

export class TmuxClientReaper {
  private readonly clients = new Map<object, OwnedClient>();
  private readonly retired = new WeakSet<object>();
  private readonly read: (pid: number) => TmuxClientProcess | null;
  private readonly signal: (pid: number, signal: NodeJS.Signals) => void;
  private readonly graceMs: number;
  private closing = false;
  private maintenance?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<number>;
  constructor(options: ReaperOptions = {}) {
    this.read = options.read ?? readProcess;
    this.signal = options.signal ?? ((pid, signal) => { process.kill(pid, signal); });
    this.graceMs = options.graceMs ?? 750;
  }

  trackPty<T extends ClientPty>(child: T): T {
    if (!child.pid || process.platform === 'win32') return child;
    const entry = this.track(child, child.pid);
    const subscription = child.onExit(() => entry.finish());
    void entry.done.then(() => subscription.dispose());
    if (this.closing) this.stop(child);
    return child;
  }

  trackControl<T extends { pid?: number; once(event: 'exit', handler: () => void): unknown; kill(): unknown }>(child: T): T {
    if (!child.pid || process.platform === 'win32') return child;
    const entry = this.track(child, child.pid);
    child.once('exit', () => entry.finish());
    if (this.closing) this.stop(child);
    return child;
  }

  private track(key: object, pid: number, identity = this.read(pid)): OwnedClient {
    let resolve!: () => void;
    const entry: OwnedClient = { pid, identity, stopping: false, done: new Promise<void>(done => { resolve = done; }),
      finish: () => {
        if (entry.timer) clearTimeout(entry.timer);
        this.clients.delete(key); this.retired.add(key); resolve();
      } };
    this.clients.set(key, entry);
    return entry;
  }

  private matches(entry: OwnedClient): boolean {
    const current = this.read(entry.pid), expected = entry.identity;
    return !!current && !!expected && current.uid === expected.uid && current.started === expected.started
      && current.parentPid === expected.parentPid;
  }

  private send(entry: OwnedClient, signal: NodeJS.Signals): void {
    if (this.matches(entry)) {
      try { this.signal(entry.pid, signal); } catch { /* Already exited. */ }
    }
  }

  stop(child: { kill(): unknown }): void {
    const entry = this.clients.get(child);
    if (!entry) { if (!this.retired.has(child)) child.kill(); return; }
    if (entry.stopping) return;
    entry.stopping = true;
    this.send(entry, 'SIGTERM');
    entry.timer = setTimeout(() => { this.send(entry, 'SIGKILL'); entry.finish(); }, this.graceMs);
    entry.timer.unref();
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.stopMaintenance();
    const pending = [...this.clients.entries()];
    for (const [child] of pending) this.stop(child as { kill(): unknown });
    await Promise.all(pending.map(([, entry]) => entry.done));
  }

  /** process.exit and unexpected JS exits cannot wait for PTY callbacks. */
  killOnExit(): void {
    this.closing = true;
    this.stopMaintenance();
    for (const entry of this.clients.values()) { this.send(entry, 'SIGKILL'); entry.finish(); }
  }

  async sweepLegacy(targets: ReadonlySet<string>, snapshot?: TmuxClientProcess[], serverArgs: readonly string[] = []): Promise<number> {
    if (this.closing || process.platform === 'win32' || process.pid === 1) return 0;
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      const processes = snapshot ?? parseTmuxProcessList((await exec('ps', ['-axo', psFields],
        { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })).stdout);
      let count = 0;
      for (const candidate of processes) {
        if (this.closing) break;
        if (candidate.parentPid !== 1 || candidate.uid !== process.getuid?.() || !isLegacyTmuxClient(candidate.command, targets, serverArgs)) continue;
        const current = this.read(candidate.pid);
        if (!current || current.parentPid !== 1 || current.uid !== candidate.uid || current.command !== candidate.command) continue;
        const child = { kill() {} };
        this.track(child, current.pid, current);
        this.stop(child); count++;
      }
      return count;
    })().finally(() => { this.sweeping = undefined; });
    return this.sweeping;
  }

  startMaintenance(getTargets: () => Promise<ReadonlySet<string>>, log: (message: string) => void): Promise<void> {
    const sweep = async () => {
      if (this.closing) return;
      try {
        const count = await this.sweepLegacy(await getTargets());
        if (count) log(`[tmux-clients] reclaiming ${count} orphaned Veymux display clients`);
      } catch (error) { log(`[tmux-clients] orphan check deferred: ${(error as Error).message}`); }
    };
    if (!this.maintenance && !this.closing) {
      this.maintenance = setInterval(() => { void sweep(); }, 60_000);
      this.maintenance.unref();
    }
    return sweep();
  }
  private stopMaintenance() { if (this.maintenance) clearInterval(this.maintenance); this.maintenance = undefined; }
}
