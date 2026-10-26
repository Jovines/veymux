// @vitest-environment node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node-pty';
import { Terminal } from '@xterm/headless';
import { expect, it, vi } from 'vitest';
import { TerminalClientAttachment } from './terminalClientAttachment.js';

const exec = promisify(execFile);
it.skipIf(process.platform === 'win32')('answers real tmux identification once without leaking a replayed xterm version into the pane', async () => {
  const root = await mkdtemp(join(tmpdir(), 'td-version-reply-'));
  const socket = join(root, 'tmux.sock'), input = join(root, 'input'), script = join(root, 'pane.cjs');
  const run = async (...args: string[]) => (await exec('tmux', ['-S', socket, ...args], { timeout: 5000 })).stdout;
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE;
  const versions: string[] = [];
  const client = new TerminalClientAttachment(async () => spawn('tmux', ['-S', socket, 'attach-session', '-t', '=probe'], {
    name: 'xterm-256color', cols: 80, rows: 24, env,
  }), data => terminal.write(data), () => {});
  terminal.onData(data => {
    if (data.startsWith('\x1bP>|')) versions.push(data);
    client.write(data);
  });
  try {
    await writeFile(input, '');
    await writeFile(script, `const fs=require('node:fs');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',data=>fs.appendFileSync(${JSON.stringify(input)},data));process.stdout.write('READY');`);
    await run('-f', '/dev/null', 'new-session', '-d', '-s', 'probe', '-x', '80', '-y', '24', `${process.execPath} ${script}`);
    await vi.waitFor(async () => expect(await run('capture-pane', '-p', '-t', 'probe')).toContain('READY'));
    await client.open(80, 24);
    await vi.waitFor(() => expect(versions).toHaveLength(1));
    // Replay the actual identification query through the actual xterm parser.
    // Without the attachment guard, the second DCS reply reaches raw stdin.
    await new Promise<void>(resolve => terminal.write('\x1b[>q\x1b[>q', resolve));
    expect(versions).toHaveLength(3);
    client.write('sentinel');
    await vi.waitFor(async () => expect(await readFile(input, 'utf8')).toContain('sentinel'));
    expect(await readFile(input, 'utf8')).toBe('sentinel');
  } finally {
    client.close(); terminal.dispose();
    await run('kill-server').catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
