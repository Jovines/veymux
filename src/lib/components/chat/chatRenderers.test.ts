import { expect, it, vi } from 'vitest';
const ready = vi.hoisted(() => {
  let finish!: () => void;
  const full = new Promise<void>(resolve => { finish = resolve; });
  return { full, finish };
});
vi.mock('./ChatRichContent', () => ({ ChatRichContent: () => null }));
vi.mock('./ChatFullContent', async () => {
  await ready.full;
  return { ChatFullContent: () => null };
});
import { getChatFullContent, getChatRichContent, loadChatRichContent } from './chatRenderers';
it('does not commit rich history while its nested full renderer is still loading', async () => {
  let committed = false;
  const loading = loadChatRichContent().then(() => { committed = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(committed).toBe(false);
  expect(getChatRichContent()).toBeUndefined();
  expect(getChatFullContent()).toBeUndefined();
  ready.finish(); await loading;
  expect(getChatRichContent()).toBeTypeOf('function');
  expect(getChatFullContent()).toBeTypeOf('function');
});
