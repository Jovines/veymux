import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

export { codexColdLaunchArgv, codexPreparedResumeCommand } from '../shared/codexLaunchCommand.js';

/** Use the installed CLI's local App Server protocol to allocate a durable
 * thread without starting a model turn. No transcript guessing or Agent hook. */
export async function prepareCodexThread(argv: string[], cwd: string, timeoutMs = 30_000): Promise<{ sessionId: string; launchArgv: string[] }> {
  const bootstrap: string[] = [];
  const configFlags: Record<string, string> = { '-m': 'model', '--model': 'model', '-p': 'profile', '--profile': 'profile', '-s': 'sandbox_mode', '--sandbox': 'sandbox_mode', '-a': 'approval_policy', '--ask-for-approval': 'approval_policy' };
  for (let i = 1; i < argv.length; i++) {
    const [flag, ...equal] = argv[i].split('=');
    if (flag === '--no-alt-screen') continue;
    if (flag === '--dangerously-bypass-approvals-and-sandbox' || flag === '--full-auto') {
      bootstrap.push('-c', `approval_policy=${JSON.stringify(flag === '--full-auto' ? 'on-request' : 'never')}`, '-c', `sandbox_mode=${JSON.stringify(flag === '--full-auto' ? 'workspace-write' : 'danger-full-access')}`); continue;
    }
    if (flag === '--search') { bootstrap.push('-c', 'web_search="live"'); continue; }
    const value = equal.length ? equal.join('=') : argv[++i];
    if (configFlags[flag]) bootstrap.push('-c', `${configFlags[flag]}=${JSON.stringify(value)}`);
    else bootstrap.push(flag, value);
  }
  const child = spawn(argv[0], ['app-server', ...bootstrap, '--listen', 'stdio://'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  let nextId = 0, closed = false, stderr = '';
  const requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const error = (message: string) => Object.assign(new Error(message), { code: 'CODEX_RECOVERY_PREPARATION_FAILED' });
  const fail = (failure: Error) => { for (const request of requests.values()) request.reject(failure); requests.clear(); };
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
  child.on('error', e => fail(error(e.message)));
  const exited = new Promise<void>(resolve => child.once('close', () => { closed = true; fail(error('Codex thread preparation closed before responding')); resolve(); }));
  const deadline = setTimeout(() => { fail(error('Codex thread preparation timed out')); child.kill('SIGTERM'); }, timeoutMs);
  lines.on('line', line => {
    if (line.length > 2 * 1024 * 1024) { fail(error('Codex preparation response exceeded limit')); return; }
    let value: any; try { value = JSON.parse(line); } catch { return; }
    const pending = requests.get(value.id);
    if (!pending) return;
    requests.delete(value.id);
    if (value.error) pending.reject(error(typeof value.error.message === 'string' ? value.error.message.slice(0, 512) : 'Codex rejected thread preparation'));
    else pending.resolve(value.result);
  });
  const send = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    if (closed) { reject(error('Codex preparation process is unavailable')); return; }
    const id = ++nextId; requests.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', e => { if (e) { requests.delete(id); reject(error(e.message)); } });
  });
  let thread: { id?: string; path?: string; ephemeral?: boolean } | undefined;
  try {
    await send('initialize', { clientInfo: { name: 'veymux', title: 'Veymux recovery', version: '1' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const effective = await send('config/read', { cwd, includeLayers: false });
    const effort = effective?.config?.model_reasoning_effort;
    // An empty resumed thread has no prior turn configuration. Explicitly
    // retain the CLI's resolved effort rather than resetting it to "default".
    const launchArgv = typeof effort === 'string' && /^[a-z_]+$/.test(effort)
      ? [...argv, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : argv;
    const result = await send('thread/start', { cwd, ephemeral: false });
    thread = result?.thread;
    if (!thread?.id || !/^[a-zA-Z0-9._-]{8,160}$/.test(thread.id) || thread.ephemeral === true || !thread.path || !path.isAbsolute(thread.path)) {
      throw error('Codex did not return a persistent conversation identity');
    }
    // Empty threads flush their initial metadata when this short-lived owner
    // closes. Release it first, then verify persistence before starting TUI.
    child.stdin.end();
    child.kill('SIGTERM');
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([exited, new Promise<void>(resolve => { releaseTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
    if (releaseTimer) clearTimeout(releaseTimer);
    const until = Date.now() + Math.min(timeoutMs, 10_000);
    let verified = false;
    while (Date.now() < until) {
      try {
        const handle = await fs.open(thread.path, 'r');
        try {
          const bytes = Buffer.alloc(256 * 1024), result = await handle.read(bytes, 0, bytes.length, 0);
          const first = JSON.parse(bytes.subarray(0, result.bytesRead).toString('utf8').split('\n')[0]);
          verified = first.type === 'session_meta' && (first.payload?.id ?? first.payload?.session_id) === thread.id;
        } finally { await handle.close(); }
      } catch { /* Wait for this newly allocated thread's first durable write. */ }
      if (verified) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!verified) throw error('Codex conversation metadata was not persisted; launch has not been sent');
    return { sessionId: thread.id, launchArgv };
  } catch (failure) {
    if ((failure as { code?: string }).code === 'CODEX_RECOVERY_PREPARATION_FAILED') throw failure;
    throw error(`${failure instanceof Error ? failure.message : 'Codex preparation failed'}${stderr ? `: ${stderr.slice(-256)}` : ''}`);
  } finally {
    clearTimeout(deadline); lines.close(); child.stdin.end();
    if (!closed) child.kill('SIGTERM');
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([exited, new Promise<void>(resolve => { killTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); })]);
    if (killTimer) clearTimeout(killTimer);
  }
}
