import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';
export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/sidebar-reveal-tests',
  test: {
    ...viewport.test,
    include: ['src/lib/components/sidebar/sidebarReveal.browser.tsx'],
    browser: {
      ...viewport.test!.browser,
      commands: {
        async swipeSidebar(context, dx: number) {
          const session = await context.context.newCDPSession(context.page);
          const frame = await context.iframe.locator('body').boundingBox();
          const x = (frame?.x ?? 0) + 4, y = (frame?.y ?? 0) + 240;
          try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let i = 1; i <= 12; i++) {
              await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y }] });
              await context.page.waitForTimeout(20);
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } finally { await session.detach(); }
        },
      },
    },
  },
});
