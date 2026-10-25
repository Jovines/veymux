import { afterEach, expect, it, vi } from 'vitest';
import { copyInvitationLink } from './copyInvitationLink';
afterEach(() => vi.unstubAllGlobals());
it('starts a promise-backed clipboard write in the click task before link generation completes', async () => {
  let finish!: (value: string) => void;
  const link = new Promise<string>(resolve => { finish = resolve; });
  let contents!: Record<string, Promise<Blob>>;
  vi.stubGlobal('ClipboardItem', class { constructor(value: Record<string, Promise<Blob>>) { contents = value; } });
  const write = vi.fn(async () => { await contents['text/plain']; });
  vi.stubGlobal('navigator', { clipboard: { write } });
  const copying = copyInvitationLink(link);
  expect(write).toHaveBeenCalledOnce();
  finish('https://service.example/#invite');
  expect(await copying).toBe(true);
  expect(await (await contents['text/plain']).text()).toBe('https://service.example/#invite');
});
it('leaves clipboard denial recoverable and does not report success', async () => {
  vi.stubGlobal('ClipboardItem', undefined);
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(await copyInvitationLink('https://service.example/#invite')).toBe(false);
});
it('does not write an empty or substitute link when invitation generation fails', async () => {
  vi.stubGlobal('ClipboardItem', undefined);
  const writeText = vi.fn(); vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(await copyInvitationLink(Promise.reject(new Error('offline')))).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
});
