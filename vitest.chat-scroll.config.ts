import { defineConfig } from 'vitest/config';
import peek from './vitest.terminal-peek.config';
export default defineConfig({ ...peek, cacheDir: 'node_modules/.vite/chat-scroll-tests', test: {
  ...peek.test, include: ['src/lib/components/chat/chatScroll.browser.tsx'],
  browser: { ...peek.test?.browser, instances: peek.test?.browser?.instances?.slice(0, 1), commands: {
    async chatWheel(context, dy: number) {
      await context.iframe.locator('.session-chat-scroll').hover();
      await context.page.mouse.wheel(0, dy);
    },
  } },
} });
