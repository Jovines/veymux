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
