import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/split-layout-tests',
  optimizeDeps: { ...viewport.optimizeDeps, include: [...viewport.optimizeDeps!.include!, 'uuid'] },
  test: {
    ...viewport.test,
    include: ['src/lib/components/freeSplitLayout.browser.tsx', 'src/lib/components/splitWorkspace.browser.tsx'],
    browser: {
      ...viewport.test!.browser!,
      viewport: { width: 1440, height: 900 },
      commands: {
        async splitGesture(context, source: string, target: string, rx = 0.5, ry = 0.5, finish = 'release', touch = false) {
          const start = await context.iframe.locator(source).boundingBox();
          const end = await context.iframe.locator(target).boundingBox();
          if (!start || !end) throw new Error('Missing split gesture target');
          const x = start.x + start.width / 2, y = start.y + start.height / 2;
          const tx = end.x + end.width * rx, ty = end.y + end.height * ry;
          if (touch) {
            const session = await context.context.newCDPSession(context.page);
            try {
              await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
              for (let i = 1; i <= 12; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (tx - x) * i / 12, y: y + (ty - y) * i / 12 }] });
              await session.send('Input.dispatchTouchEvent', { type: finish === 'cancel' ? 'touchCancel' : 'touchEnd', touchPoints: [] });
            } finally { await session.detach(); }
          } else {
            await context.page.mouse.move(x, y); await context.page.mouse.down();
            await context.page.mouse.move(tx, ty, { steps: 12 });
            if (finish === 'escape') await context.page.keyboard.press('Escape');
            if (finish === 'outside') await context.page.mouse.move(2, 2, { steps: 4 });
            if (finish === 'blur') await context.iframe.locator('body').evaluate(() => window.dispatchEvent(new Event('blur')));
            await context.page.mouse.up();
          }
        },
      },
    },
  },
});
