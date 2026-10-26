// @vitest-environment node
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { TmuxClientReaper } from './tmuxClientReaper.js';
import { TerminalClientAttachment } from './terminalClientAttachment.js';

const exec = promisify(execFile);
const pty = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
const supported = process.platform !== 'win32';

it.skipIf(!supported)('bounds real display clients through churn, shutdown and a replacement service while preserving the running pane', async () => {
  const socket = `td-client-life-${process.pid}-${Date.now()}`;
  const run = async (...args: string[]) => (await exec('tmux', ['-L', socket, ...args], { timeout: 5000, killSignal: 'SIGKILL' })).stdout.trim();
  const reaper = new TmuxClientReaper({ graceMs: 100 });
  const replacement = new TmuxClientReaper({ graceMs: 100 });
  const displays: import('node-pty').IPty[] = [];
  try {
    await run('new-session', '-d', '-s', 'task', '-x', '80', '-y', '24', 'sleep 120');
    await run('set-option', '-t', 'task', 'status', 'off');
    const pane = await run('list-panes', '-t', 'task', '-F', '#{pane_pid}');
    const size = await run('display-message', '-p', '-t', 'task', '#{window_width} #{window_height}');
    const display = (owner: TmuxClientReaper) => async (cols: number, rows: number) => {
      const child = owner.trackPty(pty.spawn('tmux', ['-L', socket, '-u', '-T', 'RGB,sync', 'attach-session', '-f', 'ignore-size', '-t', 'task'],
        { cols, rows, env: { ...process.env, TERM: 'xterm-256color', TMUX: '' } }));
      displays.push(child); return child;
    };
    const count = async () => (await run('list-clients', '-t', 'task', '-F', '#{client_pid}')).split('\n').filter(Boolean).length;
    for (let index = 0; index < 24; index++) {
      const attachment = new TerminalClientAttachment(display(reaper), () => {}, () => {}, child => reaper.stop(child));
      await attachment.open(80, 24);
      await vi.waitFor(async () => expect(await count()).toBe(1));
      attachment.close(); attachment.close();
      await vi.waitFor(async () => expect(await count()).toBe(0));
    }
    // Service shutdown must clean both subscribed displays and its observer.
    const a = await display(reaper)(80, 24), b = await display(reaper)(80, 24);
    a.onData(() => {}); b.onData(() => {});
    await vi.waitFor(async () => expect(await count()).toBe(2));
    await reaper.shutdown();
    await vi.waitFor(async () => expect(await count()).toBe(0));
    const next = await display(replacement)(80, 24); next.onData(() => {});
    await vi.waitFor(async () => expect(await count()).toBe(1));
    expect(await run('list-panes', '-t', 'task', '-F', '#{pane_pid}')).toBe(pane);
    expect(await run('display-message', '-p', '-t', 'task', '#{window_width} #{window_height}')).toBe(size);
    await replacement.shutdown();
    await vi.waitFor(async () => expect(await count()).toBe(0));
  } finally {
    reaper.killOnExit(); replacement.killOnExit();
    for (const display of displays) { try { display.kill('SIGKILL'); } catch { /* Exited. */ } }
    await run('kill-server').catch(() => {});
  }
}, 20_000);

it.skipIf(!supported || !process.getuid)('an upgrade automatically reclaims an old unmarked orphan, leaving live clients, other sessions and their Agents running', async () => {
  const socket = `td-client-upgrade-${process.pid}-${Date.now()}`;
  const run = async (...args: string[]) => (await exec('tmux', ['-L', socket, ...args], { timeout: 5000, killSignal: 'SIGKILL' })).stdout.trim();
  const reaper = new TmuxClientReaper({ graceMs: 100 });
  const launchers: ChildProcess[] = [];
  const clientPids: number[] = [];
  const directory = mkdtempSync(path.join(os.tmpdir(), 'td-client-upgrade-'));
  const fifo = path.join(directory, 'stdin');
  await exec('mkfifo', [fifo]);
  const inputFd = openSync(fifo, 'r+');
  async function oldClient(target: string, orphan: boolean): Promise<number> {
    // The test retains stdin while this obsolete service exits. This creates
    // an actual parentless control client with the old command shape, without
    // introducing a marker that only a new release would have written.
    const launcher = spawn(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const child=spawn('tmux',['-L',process.argv[1],'-C','attach-session','-f','ignore-size','-t',process.argv[2]],{stdio:[0,1,2]});
      console.log('CLIENT_PID='+child.pid);
      ${orphan ? 'setTimeout(()=>process.exit(0),100);' : 'setInterval(()=>{},1000);'}
    `, socket, target], { stdio: [inputFd, 'pipe', 'pipe'] });
    launchers.push(launcher);
    launcher.stderr!.resume();
    const exited = orphan ? once(launcher, 'exit') : undefined;
    const pid = await new Promise<number>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Legacy client did not spawn')), 3000);
      launcher.stdout!.on('data', data => { text += data; const match = /CLIENT_PID=(\d+)/.exec(text); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      launcher.once('error', reject);
    });
    clientPids.push(pid);
    if (exited) await exited;
    return pid;
  }
  try {
    await run('new-session', '-d', '-s', 'historical', '-x', '90', '-y', '30', 'sleep 120');
    await run('new-session', '-d', '-s', 'unrelated', 'sleep 120');
    const pane = await run('list-panes', '-t', 'historical', '-F', '#{pane_pid}');
    const size = await run('display-message', '-p', '-t', 'historical', '#{window_width} #{window_height}');
    const orphan = await oldClient('historical', true);
    const live = await oldClient('historical', false);
    const unrelated = await oldClient('unrelated', true);
    const clients = async (target: string) => (await run('list-clients', '-t', target, '-F', '#{client_pid}')).split('\n').filter(Boolean).map(Number);
    await vi.waitFor(async () => expect(await clients('historical')).toEqual(expect.arrayContaining([orphan, live])));
    expect(await reaper.sweepLegacy(new Set(['historical']), undefined, ['-L', socket])).toBe(1);
    await vi.waitFor(async () => expect(await clients('historical')).toEqual([live]));
    expect(await clients('unrelated')).toContain(unrelated);
    expect(await run('list-panes', '-t', 'historical', '-F', '#{pane_pid}')).toBe(pane);
    expect(await run('display-message', '-p', '-t', 'historical', '#{window_width} #{window_height}')).toBe(size);
    // The same check runs again while the upgraded service remains alive.
    await oldClient('historical', true);
    expect(await reaper.sweepLegacy(new Set(['historical']), undefined, ['-L', socket])).toBe(1);
    await vi.waitFor(async () => expect(await clients('historical')).toEqual([live]));
  } finally {
    await reaper.shutdown();
    for (const launcher of launchers) { launcher.stdin?.destroy(); launcher.kill('SIGKILL'); }
    for (const pid of clientPids) { try { process.kill(pid, 'SIGKILL'); } catch { /* Exited. */ } }
    await run('kill-server').catch(() => {});
    closeSync(inputFd); rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

it.skipIf(!supported)('real service processes reclaim their registered clients on graceful and immediate JS exit', async () => {
  const socket = `td-client-exit-${process.pid}-${Date.now()}`;
  const run = async (...args: string[]) => (await exec('tmux', ['-L', socket, ...args], { timeout: 5000, killSignal: 'SIGKILL' })).stdout.trim();
  const services: ChildProcess[] = [];
  const source = `
    import {TmuxClientReaper} from ${JSON.stringify(new URL('./tmuxClientReaper.ts', import.meta.url).href)};
    import pty from 'node-pty';
    const reaper=new TmuxClientReaper({graceMs:100});
    process.once('exit',()=>reaper.killOnExit());
    process.once('SIGTERM',()=>void reaper.shutdown().then(()=>process.exit(0)));
    for(let i=0;i<4;i++){
      const p=reaper.trackPty(pty.spawn('tmux',['-L',process.argv[1],'-u','attach-session','-f','ignore-size','-t','task'],
        {cols:80,rows:24,env:{...process.env,TERM:'xterm-256color',TMUX:''}}));
      p.onData(()=>{});
    }
    console.log('READY');
    process.stdin.on('data',()=>process.exit(0));
  `;
  try {
    await run('new-session', '-d', '-s', 'task', '-x', '80', '-y', '24', 'sleep 120');
    await run('set-option', '-t', 'task', 'status', 'off');
    const pane = await run('list-panes', '-t', 'task', '-F', '#{pane_pid}');
    for (const mode of ['graceful', 'immediate', 'graceful', 'immediate']) {
      const service = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, socket], { stdio: ['pipe', 'pipe', 'pipe'] });
      services.push(service); service.stdout!.resume(); service.stderr!.resume();
      await vi.waitFor(async () => expect((await run('list-clients', '-t', 'task', '-F', '#{client_pid}')).split('\n').filter(Boolean)).toHaveLength(4));
      const exited = once(service, 'exit');
      if (mode === 'graceful') service.kill('SIGTERM');
      else service.stdin!.write('exit');
      expect((await exited)[0]).toBe(0);
      await vi.waitFor(async () => expect(await run('list-clients', '-t', 'task', '-F', '#{client_pid}')).toBe(''));
      expect(await run('list-panes', '-t', 'task', '-F', '#{pane_pid}')).toBe(pane);
      expect(await run('display-message', '-p', '-t', 'task', '#{window_width} #{window_height}')).toBe('80 24');
    }
  } finally {
    for (const service of services) service.kill('SIGKILL');
    await run('kill-server').catch(() => {});
  }
}, 20_000);

it.skipIf(!supported)('forces a real unresponsive owned child to exit within the cleanup grace period', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("READY"); setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const reaper = new TmuxClientReaper({ graceMs: 100 });
  try {
    await once(child.stdout!, 'data');
    reaper.trackControl(child);
    const exited = once(child, 'exit');
    await reaper.shutdown();
    expect((await exited)[1]).toBe('SIGKILL');
  } finally { child.kill('SIGKILL'); }
}, 5000);
