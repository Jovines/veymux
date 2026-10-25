import { defineConfig } from 'vitest/config';
import tabs from './vitest.session-tabs.config';
export default defineConfig({ ...tabs, cacheDir: 'node_modules/.vite/reply-navigation-tests', test: {
  ...tabs.test, include: ['src/lib/components/chat/chatReplyNavigation.browser.tsx'],
  browser: { ...tabs.test?.browser, commands: {
    async replyActivate(context, selector: string) {
      const node = context.iframe.locator(selector);
      const width = await context.iframe.locator('html').evaluate(element => element.clientWidth);
      if (width < 640) await node.tap(); else await node.click();
    },
  } },
} });
