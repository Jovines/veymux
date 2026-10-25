// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { codexColdLaunchArgv, codexPreparedResumeCommand, prepareCodexThread } from './codexLaunchPreparation';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it('prepares only direct prompt-free launches and preserves quoted configuration values', () => {
  expect(codexColdLaunchArgv('codex --dangerously-bypass-approvals-and-sandbox')).toEqual(['codex', '--dangerously-bypass-approvals-and-sandbox']);
  const argv = codexColdLaunchArgv(`'/opt/my tools/codex' -c 'model_reasoning_effort="high"' --model=chosen`)!;
  expect(argv).toEqual(['/opt/my tools/codex', '-c', 'model_reasoning_effort="high"', '--model=chosen']);
  expect(codexPreparedResumeCommand(argv, 'original-native')).toBe(`'/opt/my tools/codex' '-c' 'model_reasoning_effort="high"' '--model=chosen' 'resume' 'original-native'`);
  for (const command of ['codex resume old', 'codex exec task', 'codex --remote unix://', 'codex "do the work"', 'codex; echo unsafe', 'env CODEX_HOME=/other codex', 'codex -c "$HOME"', 'codex | tee log', 'codex -m', 'claude', 'codex "unterminated']) {
    expect(codexColdLaunchArgv(command)).toBeNull();
  }
});

function fakeCodex(mode: 'normal' | 'wrong-id' | 'no-response') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'td-codex-prepare-')); directories.push(directory);
  const executable = path.join(directory, 'codex'), rollout = path.join(directory, 'rollout.jsonl');
  const native = 'original-native-thread';
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});\nlet allocated=false; rl.on('line',line=>{const m=JSON.parse(line); if(!m.id)return; if(m.method==='initialize')console.log(JSON.stringify({id:m.id,result:{}})); else if(m.method==='config/read')console.log(JSON.stringify({id:m.id,result:{config:{model_reasoning_effort:'high'}}})); else if(m.method==='thread/start' && ${JSON.stringify(mode)}!=='no-response'){allocated=true;console.log(JSON.stringify({id:m.id,result:{thread:{id:${JSON.stringify(native)},path:${JSON.stringify(rollout)},ephemeral:false}}}));}});\nprocess.on('SIGTERM',()=>{if(allocated)fs.writeFileSync(${JSON.stringify(rollout)},JSON.stringify({type:'session_meta',payload:{id:${JSON.stringify(mode === 'wrong-id' ? 'different-thread' : native)}}})+'\\n');process.exit(0)});\n`, { mode: 0o755 });
  return { directory, executable, rollout, native };
}
it('verifies the exact durable ID after releasing the short-lived bootstrap owner', async () => {
  const f = fakeCodex('normal');
  expect(await prepareCodexThread([f.executable], f.directory, 1000)).toEqual({ sessionId: f.native, launchArgv: [f.executable, '-c', 'model_reasoning_effort=\"high\"'] });
  expect(JSON.parse(fs.readFileSync(f.rollout, 'utf8')).payload.id).toBe(f.native);
});
it('refuses an identity mismatch and a hanging preparation without starting a terminal command', async () => {
  for (const mode of ['wrong-id', 'no-response'] as const) {
    const f = fakeCodex(mode);
    await expect(prepareCodexThread([f.executable], f.directory, 200)).rejects.toMatchObject({ code: 'CODEX_RECOVERY_PREPARATION_FAILED' });
  }
});
