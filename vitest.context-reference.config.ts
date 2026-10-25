import { defineConfig } from 'vitest/config';
import base from './vitest.chat-viewport.config';
export default defineConfig({ ...base, cacheDir: 'node_modules/.vite/context-reference', test: { ...base.test, include: ['src/lib/components/chat/chatContextReferences.browser.tsx'] } });
