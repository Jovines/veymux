import { defineConfig } from 'vitest/config';
import references from './vitest.chat-reference.config';
export default defineConfig({
  ...references,
  cacheDir: 'node_modules/.vite/multi-message-reference-tests',
  test: {
    ...references.test,
    include: ['src/lib/components/chat/chatMultiMessageReference.browser.tsx'],
    browser: {
      ...references.test!.browser,
      commands: {
        async selectMessageRange(context, reverse: boolean) {
          const endpoints = [];
          for (const [id, text, atEnd] of [['first', 'First selected', false], ['last', 'Last selected', true]] as const) {
            const target = context.iframe.locator(`[data-chat-message="${id}"] p`).first();
            await target.scrollIntoViewIfNeeded();
            const local = await target.evaluate((element, { text, atEnd }) => {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let node: Node | null;
              while ((node = walker.nextNode())) {
                const index = node.textContent!.indexOf(text);
                if (index < 0) continue;
                const range = document.createRange(); range.setStart(node, index + (atEnd ? text.length : 0)); range.collapse(true);
                const caret = range.getBoundingClientRect(), body = element.getBoundingClientRect();
                return { x: caret.left - body.left, y: caret.top - body.top + caret.height / 2, width: body.width };
              }
              throw new Error('Missing message text');
            }, { text, atEnd });
            const box = await target.boundingBox(); if (!box) throw new Error('Missing selection endpoint');
            const scale = box.width / local.width;
            endpoints.push({ x: box.x + local.x * scale, y: box.y + local.y * scale });
          }
          if (reverse) endpoints.reverse();
          await context.page.mouse.move(endpoints[0].x, endpoints[0].y); await context.page.mouse.down();
          await context.page.mouse.move(endpoints[1].x, endpoints[1].y, { steps: 18 }); await context.page.mouse.up();
        },
      },
    },
  },
});
