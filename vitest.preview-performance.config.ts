import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/preview-performance-tests',
  test: {
    ...viewport.test,
    include: ['src/lib/components/chat/chatPreviewPerformance.browser.tsx'],
    browser: {
      ...viewport.test!.browser,
      commands: {},
      instances: [
        { browser: 'chromium', provider: playwright({ launchOptions: { channel: 'chrome' } }) },
        ...(process.env.PREVIEW_WEBKIT === '1' ? [{ browser: 'webkit' as const, provider: playwright({ launchOptions: { executablePath: process.env.PREVIEW_WEBKIT_EXECUTABLE } }) }] : []),
      ],
    },
  },
});
