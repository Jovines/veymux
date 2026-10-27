import { defineConfig } from 'vitest/config';
import references from './vitest.chat-reference.config';

export default defineConfig({
  ...references,
  cacheDir: 'node_modules/.vite/chart-reference-tests',
  test: {
    ...references.test,
    include: ['src/lib/components/chat/chatChartReference.browser.tsx'],
    browser: {
      ...references.test!.browser,
      commands: {
        ...references.test!.browser!.commands,
        async chartPointer(context, selector: string, touch: boolean, xRatio = 0.5) {
          const target = context.iframe.locator(selector).first();
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          if (!box) throw new Error('Missing chart target');
          const x = box.x + box.width * xRatio, y = box.y + box.height / 2;
          if (touch) await context.page.touchscreen.tap(x, y);
          else await context.page.mouse.click(x, y);
        },
        async captureChartReference(context, width: number) {
          await context.iframe.locator('[data-session-chat]').screenshot({ path: `/tmp/veymux-chart-reference/selected-${width}.png` });
        },
      },
    },
  },
});
