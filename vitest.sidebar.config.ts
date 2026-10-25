import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/sidebar-visibility-tests',
  test: {
    ...viewport.test,
    include: ['src/lib/components/layout/sidebarVisibility.browser.tsx', 'src/lib/components/layout/terminalActivation.browser.tsx'],
  },
});
