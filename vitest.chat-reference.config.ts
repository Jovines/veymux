import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/chat-reference-tests',
  test: {
    ...viewport.test,
    include: ['src/lib/components/chat/chatRichReference.browser.tsx'],
    browser: {
      ...viewport.test!.browser,
      commands: {
        async selectRichText(context, selector: string, text: string) {
          const target = context.iframe.locator(selector);
          await target.scrollIntoViewIfNeeded();
          const points = await target.evaluate((element, text) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const start = node.textContent?.indexOf(text) ?? -1;
              if (start < 0) continue;
              const range = document.createRange();
              range.setStart(node, start); range.setEnd(node, start + text.length);
              const boxes = Array.from(range.getClientRects());
              const first = boxes[0], last = boxes[boxes.length - 1];
              const parent = element.getBoundingClientRect();
              return { x: first.left - parent.left + 1, y: first.top - parent.top + first.height / 2,
                endX: last.right - parent.left - 1, endY: last.top - parent.top + last.height / 2,
                width: parent.width };
            }
            throw new Error(`Missing selection text: ${text}`);
          }, text);
          const box = await target.boundingBox();
          if (!box) throw new Error('Missing browser selection target');
          // Vitest scales its test iframe to fit the runner's available space.
          const scale = box.width / points.width;
          await context.page.mouse.move(box.x + points.x * scale, box.y + points.y * scale);
          await context.page.mouse.down();
          await context.page.mouse.move(box.x + points.endX * scale, box.y + points.endY * scale, { steps: 12 });
          await context.page.mouse.up();
        },
      },
    },
  },
});
