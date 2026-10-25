import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/session-recovery-tests',
  test: { ...viewport.test, include: ['src/lib/components/sidebar/recoverableSessions.browser.tsx'] },
});
