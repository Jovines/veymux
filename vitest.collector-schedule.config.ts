import { defineConfig } from 'vitest/config';
import base from './vitest.chat-viewport.config';

export default defineConfig({ ...base, cacheDir: 'node_modules/.vite/collector-schedule', test: { ...base.test, include: ['src/lib/components/todos/collectorSchedule.browser.tsx'] } });
