import { defineConfig } from 'vitest/config';
import peek from './vitest.terminal-peek.config';
export default defineConfig({ ...peek, cacheDir: 'node_modules/.vite/chat-unread-tests', test: {
  ...peek.test, include: ['src/lib/components/chat/chatUnread.browser.tsx', 'src/lib/components/chat/chatMessageExposure.browser.tsx'],
  browser: { ...peek.test?.browser, instances: peek.test?.browser?.instances?.slice(0, 1) },
} });
