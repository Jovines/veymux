import { defineConfig } from 'vitest/config';
import base from './vitest.chat-viewport.config';
export default defineConfig({ ...base, cacheDir: 'node_modules/.vite/configuration-experience', test: { ...base.test, include: ['src/lib/components/settings/configurationExperience.browser.tsx', 'src/lib/components/settings/productFlowConsistency.browser.tsx'] } });
