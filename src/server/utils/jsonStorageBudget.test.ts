// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JsonStorageBudget } from './jsonStorageBudget.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-budget-')); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const full = () => new Error('admission capacity full');
it('uses exact UTF-8 bytes, rejects growth, and permits control outcomes without inventing free space', () => {
  const file = path.join(dir, 'store.json'), budget = new JsonStorageBudget(file, 'test', 'TEST_STORAGE_BYTES', 5, full);
  budget.write('"汉"'); expect(budget.status()).toMatchObject({ bytes: 5, state: 'full' });
  expect(() => budget.write('"汉字"')).toThrow('capacity full'); expect(fs.readFileSync(file, 'utf8')).toBe('"汉"');
  budget.write('"控制完成"', true); expect(budget.status()).toMatchObject({ state: 'full', control_writes_use_admission_budget: false });
  budget.write('"控制"'); expect(fs.readFileSync(file, 'utf8')).toBe('"控制"');
});
it('admits a shrinking oversized legacy document and preserves exact boundaries after restart', () => {
  const file = path.join(dir, 'store.json'); fs.writeFileSync(file, '"old oversized content"');
  const budget = new JsonStorageBudget(file, 'test', 'TEST_STORAGE_BYTES', 5, full);
  budget.write('"still large"'); budget.write('"ok"');
  expect(new JsonStorageBudget(file, 'test', 'TEST_STORAGE_BYTES', 5, full).status()).toMatchObject({ bytes: 4, state: 'warning' });
});
it('does not advance capacity state before durable commit and quarantines uncertain renames', () => {
  const file = path.join(dir, 'store.json'), budget = new JsonStorageBudget(file, 'test', 'TEST_STORAGE_BYTES', 100, full);
  budget.write('{"value":1}');
  const fsync = fs.fsyncSync; vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('file flush failed'); });
  expect(() => budget.write('{"value":2}')).toThrow('file flush failed');
  expect(fs.readFileSync(file, 'utf8')).toBe('{"value":1}'); expect(budget.status().commit_unconfirmed).toBe(false);
  vi.restoreAllMocks(); let calls = 0;
  vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (++calls === 2) throw new Error('directory flush failed'); fsync(fd); });
  expect(() => budget.write('{"value":3}')).toThrow('directory flush failed');
  expect(budget.status().commit_unconfirmed).toBe(true);
  expect(() => budget.write('{"value":4}', true)).toThrow('commit unconfirmed');
  vi.restoreAllMocks(); expect(new JsonStorageBudget(file, 'test', 'TEST_STORAGE_BYTES', 100, full).status().commit_unconfirmed).toBe(false);
});
it('validates configuration and logs capacity facts without content', () => {
  vi.stubEnv('TEST_STORAGE_BYTES', '-1'); expect(() => new JsonStorageBudget(path.join(dir, 'x'), 'test', 'TEST_STORAGE_BYTES', 100, full)).toThrow('configuration');
  vi.stubEnv('TEST_STORAGE_BYTES', '100'); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const budget = new JsonStorageBudget(path.join(dir, 'y'), 'test', 'TEST_STORAGE_BYTES', 100, full);
  budget.write('"' + 'private'.repeat(12) + '"'); budget.write('"' + 'private'.repeat(13) + '"'); budget.write('"' + 'private'.repeat(13) + '"');
  expect(warn).toHaveBeenCalledTimes(1); expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});
