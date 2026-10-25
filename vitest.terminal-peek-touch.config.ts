import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import base from './vitest.terminal-peek.config';

export default defineConfig({
  ...base,
  cacheDir: 'node_modules/.vite/terminal-peek-touch-tests',
  test: {
    ...base.test,
    include: ['src/lib/components/chat/sessionTerminalPeekTouch.browser.tsx'],
    browser: {
      ...base.test!.browser,
      viewport: { width: 390, height: 844 },
      commands: {
        async peekDrag(context, selector: string, dy: number) {
          const box = await context.iframe.locator(selector).boundingBox();
          if (!box) throw new Error('Missing terminal gesture target');
          const session = await context.context.newCDPSession(context.page);
          const x = box.x + box.width / 2, y = box.y + box.height / 2;
          const states: boolean[] = [];
          const sample = async () => states.push(await context.iframe.locator('[data-terminal-peek]').evaluate(node => node.hasAttribute('data-terminal-peek-input-expanded')));
          try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await context.page.waitForTimeout(32); await sample();
            for (let i = 1; i <= 8; i++) {
              await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 8 }] });
              await context.page.waitForTimeout(16); await sample();
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await sample();
            return states;
          } finally { await session.detach(); }
        },
        async peekTap(context, selector: string) { await context.iframe.locator(selector).tap({ timeout: 5000 }); },
        async peekTapOutside(context) {
          const box = await context.iframe.locator('html').boundingBox();
          if (!box) throw new Error('Missing document bounds');
          await context.page.touchscreen.tap(box.x + 1, box.y + 1);
        },
      },
      instances: [{
        browser: 'chromium', name: 'peek-touch',
        provider: playwright({
          launchOptions: { channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
          contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
        }),
      }],
    },
  },
});
