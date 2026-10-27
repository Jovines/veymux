import { defineConfig } from 'vitest/config';
import base from './vitest.chat-viewport.config';

export default defineConfig({ ...base, cacheDir: 'node_modules/.vite/todos', test: { ...base.test, include: ['src/lib/components/todos/todoWorkspace.browser.tsx', 'src/lib/components/todos/collectionRecovery.browser.tsx'] } });
