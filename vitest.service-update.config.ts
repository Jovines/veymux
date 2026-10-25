import { defineConfig } from 'vitest/config';
import base from './vitest.chat-viewport.config';
export default defineConfig({ ...base, cacheDir: 'node_modules/.vite/service-update-experience', test: { ...base.test, include: ['src/lib/components/settings/serviceUpdateExperience.browser.tsx'] } });
