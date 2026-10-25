import { defineConfig } from 'vitest/config';
import peek from './vitest.terminal-peek.config';

export default defineConfig({
  ...peek,
  cacheDir: 'node_modules/.vite/chat-mode-tests',
  optimizeDeps: { ...peek.optimizeDeps, include: [...(peek.optimizeDeps?.include ?? []), '@use-gesture/react', 'swiper/react', 'dompurify', 'katex', 'mermaid', 'refractor'] },
  test: { ...peek.test, include: ['src/lib/components/chat/chatModeEntry.browser.tsx'] },
});
