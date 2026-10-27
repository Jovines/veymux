import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { probeTmuxReadiness } from './tmuxReadinessProbe.js';
import { writeCollaborationTmuxPane } from './collaborationTmuxDelivery.js';
import { TerminalOutputActivity } from '../utils/terminalOutputActivity.js';
import { TmuxPaneOutputObserver } from '../utils/tmuxPaneOutput.js';
const exec = promisify(execFile);

it.skipIf(process.platform === 'win32').each([{ echo: true, placeholder: false }, { echo: true, placeholder: true }, { echo: false, placeholder: false }, { echo: false, placeholder: true }])('checks a real tmux editor (echo=$echo, placeholder=$placeholder) without submitting or falsely starting processing', async ({ echo, placeholder }) => {
  const dir = await mkdtemp(join(tmpdir(), 'veymux-readiness-'));
  const socket = `veymux-readiness-${process.pid}-${Date.now()}-${Number(echo)}`;
  const run = async (args: string[]) => (await exec('tmux', ['-L', socket, ...args], { timeout: 5000 })).stdout;
  const stdin = (args: string[], text: string) => new Promise<string>((resolve, reject) => {
    const child = execFile('tmux', ['-L', socket, ...args], { timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout)); child.stdin!.end(text);
  });
  const publish = vi.fn(), activity = new TerminalOutputActivity(publish);
  const observer = new TmuxPaneOutputObserver('tmux', '=peer', () => activity.record(), () => {},
    (binary, args, options) => spawn(binary, ['-L', socket, ...args], options));
  try {
    const script = join(dir, 'editor.py'), log = join(dir, 'input');
    await writeFile(script, `import os, tty
tty.setraw(0)
text = ${placeholder ? "b''" : "'草稿'.encode('utf8')"}
placeholder = b'Ask Codex to do anything'
pending = b''
os.write(1, b'\\x1b[?2004h> ' + (text or placeholder))
while True:
 data = os.read(0, 1024)
 with open('${log}', 'ab') as f: f.write(data)
 if not ${echo ? 'True' : 'False'}: continue
 pending += data
 while pending:
  if pending.startswith(b'\\x1b'):
   if len(pending) < 6: break
   pending = pending[6:]
   continue
  c, pending = pending[:1], pending[1:]
  if c in (b'\\x7f', b'\\x08'): text = text[:-1]
  elif c == b'\\r': text = b'SUBMITTED'
  else: text += c
 os.write(1, b'\\r\\x1b[2K> ' + (text or placeholder))
`);
    await run(['new-session', '-d', '-s', 'peer', '-x', '80', '-y', '24', `python3 ${script}`]);
    for (let n = 0; n < 100; n++) {
      if ((await run(['capture-pane', '-p', '-t', 'peer'])).includes(placeholder ? '> Ask Codex to do anything' : '> 草稿')) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const parts = (await run(['display-message', '-p', '-t', 'peer', '#{pid}:#{session_id}:#{pane_id}:#{pane_pid}'])).trim().split(':');
    const pane = { serverPid: Number(parts[0]), sessionId: parts[1], paneId: parts[2], panePid: Number(parts[3]), agentSlug: 'fixture', nativeSessionId: null };
    observer.start(); await new Promise(resolve => setTimeout(resolve, 100));
    const finish = activity.beginInputDiagnostic();
    const result = await probeTmuxReadiness({ pane, run, stdin, assertCurrent() {} });
    finish(result.echoOnly === true);
    expect(result.status).toBe(echo ? 'ready' : 'unconfirmed');
    const bytes = await readFile(log, 'utf8');
    expect(bytes).toMatch(/^\x1b\[200~[~^|%&@#]{2}\x1b\[201~\x7f{2}$/);
    expect(bytes).not.toMatch(/[\r\n]/);
    expect((await run(['capture-pane', '-p', '-t', pane.paneId])).trim()).toBe(placeholder ? '> Ask Codex to do anything' : '> 草稿');
    await new Promise(resolve => setTimeout(resolve, 1600)); expect(publish).not.toHaveBeenCalled();
    if (echo) {
      // The actual send path still obtains the same pane queue and submits
      // exactly one real task after the diagnostic has restored the draft.
      await writeCollaborationTmuxPane(run, pane, 'REAL TASK', stdin);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await readFile(log, 'utf8')).match(/\r/g)).toHaveLength(1);
    }
    expect(await run(['list-buffers'])).not.toContain('veymux-input-check-');
  } finally {
    observer.dispose(); activity.dispose();
    await run(['kill-server']).catch(() => {}); await rm(dir, { recursive: true, force: true });
  }
}, 15000);
