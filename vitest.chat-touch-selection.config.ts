import { defineConfig } from 'vitest/config';
import references from './vitest.chat-reference.config';

export default defineConfig({
  ...references,
  cacheDir: 'node_modules/.vite/chat-touch-selection-tests',
  test: { ...references.test, include: ['src/lib/components/chat/chatTouchSelection.browser.tsx'] },
});
