import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { createRoot, type Root } from 'react-dom/client';
import { SessionChatView } from './SessionChatView';
import { useTerminalStore } from '../../stores/useTerminalStore';
import { clearChatSnapshots } from './chatSnapshot';
import type { ChatMessage } from './chatMessages';
import '../../../index.css';
declare module 'vitest/browser' { interface BrowserCommands { chatWheel(dy: number): Promise<void> } }
let root: Root | undefined;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = undefined; useTerminalStore.getState().clearAllTerminalSessions(); clearChatSnapshots(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); });
async function mount(width: number) {
  await page.viewport(width, 900);
  const messages: ChatMessage[] = Array.from({ length: 96 }, (_, n) => ({ id: `scroll-${n}`, sequence: n + 1, createdAt: n + 1, role: n % 3 === 0 ? 'user' : 'assistant', status: 'stored', content: `记录 ${n}\n\n${'保留当前阅读位置，也保留原生文字选择。'.repeat(n % 7 + 1)}\n\n第二段内容。` }));
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input), location.origin), before = url.searchParams.get('before'), after = url.searchParams.get('after');
    const anchor = messages.findIndex(m => m.id === (before || after));
    const end = before ? anchor : messages.length, start = after ? anchor + 1 : Math.max(0, end - 30);
    if (before) await pause(180);
    return Response.json({ agentAvailable: true, messages: messages.slice(start, end), page: { hasOlder: start > 0, hasNewer: false, mode: before ? 'before' : after ? 'after' : 'latest' } });
  }));
  const host = document.createElement('main'); host.style.cssText = 'height:100vh;display:flex;flex-direction:column'; document.body.append(host); root = createRoot(host);
  root.render(<SessionChatView sessionId="scroll-browser" onTerminal={() => {}} />);
  await expect.poll(() => document.querySelectorAll('[data-chat-viewport-row]').length).toBe(30);
  await pause(100);
  return document.querySelector<HTMLElement>('.session-chat-scroll')!;
}
it.each([390, 1280])('keeps visible text steady throughout delayed prepends at width %i', async width => {
  const scroll = await mount(width);
  const retained = scroll.querySelector('[data-chat-message="scroll-95"] p')!;
  const drifts: number[] = [];
  for (let i = 0; i < 18; i++) {
    await commands.chatWheel(-440); await pause(35);
    const bounds = scroll.getBoundingClientRect();
    const pin = [...scroll.querySelectorAll('p')].find(node => { const r = node.getBoundingClientRect(); return r.bottom > bounds.top + 20 && r.top < bounds.bottom; });
    if (!pin) continue;
    const top = pin.getBoundingClientRect().top, until = performance.now() + 260;
    while (performance.now() < until) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(pin.isConnected).toBe(true); drifts.push(Math.abs(pin.getBoundingClientRect().top - top));
    }
  }
  expect(scroll.querySelectorAll('[data-chat-viewport-row]').length).toBeGreaterThanOrEqual(60);
  expect(Math.max(...drifts)).toBeLessThanOrEqual(1);
  expect(retained.isConnected).toBe(true);
  // Text selected across rows survives leaving and re-entering overscan.
  const paragraphs = [...scroll.querySelectorAll('p')];
  const range = document.createRange(); range.setStart(paragraphs[2].firstChild!, 0); range.setEndAfter(paragraphs[5]);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); const selected = selection.toString();
  await commands.chatWheel(2000); await pause(80);
  expect(selection.toString()).toBe(selected); selection.removeAllRanges();
});
it.each([390, 1280])('anchors late row sizing even if total height stays constant at width %i', async width => {
  const scroll = await mount(width);
  scroll.scrollTop = scroll.scrollHeight / 2; scroll.dispatchEvent(new Event('scroll')); await pause(50);
  const rows = [...scroll.querySelectorAll<HTMLElement>('[data-chat-viewport-row]')];
  const bounds = scroll.getBoundingClientRect();
  const pin = rows.find(row => row.getBoundingClientRect().top > bounds.top + 20)!;
  const top = pin.getBoundingClientRect().top;
  const before = rows[0], after = rows.at(-1)!;
  before.style.paddingBottom = '120px'; after.style.paddingBottom = '120px'; await pause(60);
  const grownTop = pin.getBoundingClientRect().top;
  expect(Math.abs(grownTop - top)).toBeLessThanOrEqual(1);
  const height = scroll.scrollHeight;
  before.style.paddingBottom = '240px'; after.style.paddingBottom = '0px'; await pause(60);
  expect(scroll.scrollHeight).toBe(height);
  expect(Math.abs(pin.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
});
