import { defineConfig } from 'vitest/config';
import { chatUIAdapter } from './scripts/chat-ui-adapter';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [chatUIAdapter()],
  cacheDir: 'node_modules/.vite/keyboard-layout-tests',
  resolve: { dedupe: ['react', 'react-dom'], alias: { 'node:diagnostics_channel': fileURLToPath(new URL('./src/lib/shims/diagnosticsChannel.ts', import.meta.url)) } },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'zustand/react/shallow',
      '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl', '@xterm/addon-web-links',
      '@xterm/addon-unicode11', '@xterm/addon-search', '@xterm/addon-serialize', '@xterm/addon-image',
      '@xterm/addon-ligatures', '@xterm/addon-progress', 'browser-haptic', 'qrcode', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities',
      '@noble/hashes/sha2.js', '@noble/hashes/utils.js'],
  },
  test: {
    include: ['src/lib/components/chat/chatFullUI.browser.tsx', 'src/lib/components/chat/previewSafeArea.browser.tsx', 'src/lib/components/chat/chatViewport.browser.tsx', 'src/lib/components/chat/nativeChatViewport.browser.tsx', 'src/lib/components/terminal/nativeTerminalInput.browser.tsx', 'src/lib/components/terminal/desktopTerminalInput.browser.tsx', 'src/lib/components/layout/keyboardPanelLayout.browser.tsx', 'src/lib/components/layout/serviceWorkspaceLayout.browser.tsx', 'src/lib/components/layout/toolbarCustomization.browser.tsx'],
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      viewport: { width: 390, height: 844 },
      instances: [{ browser: 'chromium', provider: playwright({ launchOptions: { channel: 'chrome' }, contextOptions: { hasTouch: true } }) }],
      commands: {
        async toolbarActionDrag(context, from: string, to: string, touch = false) {
          const handle = context.iframe.locator(`[data-toolbar-action-key="${from}"] button`).first();
          const target = context.iframe.locator(`[data-toolbar-action-key="${to}"]`);
          const start = await handle.boundingBox(), end = await target.boundingBox();
          if (!start || !end) throw new Error('Missing toolbar drag target');
          const x = start.x + start.width / 2, y = start.y + start.height / 2;
          const endX = end.x + end.width / 2, endY = end.y + end.height / 2;
          if (!touch) {
            await context.page.mouse.move(x, y); await context.page.mouse.down();
            await context.page.mouse.move(endX, endY, { steps: 16 }); await context.page.mouse.up();
            // dnd-kit briefly captures the synthetic click after a pointer drop.
            await context.page.waitForTimeout(80);
            return;
          }
          const session = await context.context.newCDPSession(context.page);
          try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await context.page.waitForTimeout(180);
            for (let step = 1; step <= 12; step++) {
              await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (endX - x) * step / 12, y: y + (endY - y) * step / 12 }] });
              await context.page.waitForTimeout(16);
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            // Match the pointer path: let dnd-kit's post-drop click guard end
            // before the next action is synthesized by the test driver.
            await context.page.waitForTimeout(80);
          } finally { await session.detach(); }
        },
        async desktopTerminalPointer(context, action: 'click' | 'right-click' | 'drag' | 'wheel') {
          const box = await context.iframe.locator('.xterm-screen').boundingBox();
          if (!box) throw new Error('Missing terminal screen');
          const x = box.x + 10, y = box.y + 10;
          await context.page.mouse.move(x, y);
          if (action === 'click') await context.page.mouse.click(x, y);
          if (action === 'right-click') await context.page.mouse.click(x, y, { button: 'right' });
          if (action === 'wheel') await context.page.mouse.wheel(0, -120);
          if (action === 'drag') {
            await context.page.mouse.down();
            await context.page.mouse.move(x + 100, y, { steps: 8 });
            await context.page.mouse.up();
          }
        },
        async desktopTerminalComposition(context, text: string, commit = false) {
          const session = await context.context.newCDPSession(context.page);
          try {
            if (commit) await session.send('Input.insertText', { text });
            else await session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
          } finally { await session.detach(); }
        },
        async inputPanelDrag(context, selector: string, dy: number) {
          const box = await context.iframe.locator(selector).boundingBox();
          if (!box) throw new Error(`Missing touch target: ${selector}`);
          const session = await context.context.newCDPSession(context.page);
          const x = box.x + box.width / 2, y = box.y + box.height / 2;
          try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            for (let i = 1; i <= 12; i++) {
              await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * i / 12 }] });
              await context.page.waitForTimeout(16);
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } finally { await session.detach(); }
        },
      },
    },
  },
});
