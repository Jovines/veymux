import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';
export default defineConfig({ ...viewport, cacheDir: 'node_modules/.vite/session-tab-tests', optimizeDeps: { ...viewport.optimizeDeps, include: [...(viewport.optimizeDeps?.include ?? []), 'lucide-react', 'zustand', '@chainsafe/libp2p-noise', '@libp2p/crypto/keys', '@libp2p/peer-id', '@libp2p/utils'] }, test: {
  ...viewport.test, include: ['src/lib/components/sessionTabs.browser.tsx', 'src/lib/components/sessionCurrentTitle.browser.tsx'],
  browser: { ...viewport.test?.browser, commands: {
    async sessionTabsSwipe(context, selector: string, dx: number) {
      const box = await context.iframe.locator(selector).boundingBox();
      if (!box) throw new Error('Missing swipe target');
      const x = dx < 0 ? box.x + box.width * .85 : box.x + box.width * .15, y = box.y + box.height * .6;
      const session = await context.context.newCDPSession(context.page);
      try {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 12; i++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y }] });
          await context.page.waitForTimeout(16);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await session.detach(); }
    },
  } },
} });
