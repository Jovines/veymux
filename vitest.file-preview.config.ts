import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import viewport from './vitest.chat-viewport.config';

export default defineConfig({
  ...viewport,
  cacheDir: 'node_modules/.vite/file-preview-tests',
  test: {
    ...viewport.test,
    include: ['src/lib/components/chat/chatFilePreview.browser.tsx'],
    browser: {
      ...viewport.test!.browser,
      commands: {
        async filePreviewPolicy(context, policy: 'desktop' | 'server') {
          await context.page.unroute('**/preview-shell.html*');
          await context.page.route('**/preview-shell.html*', async route => {
            const response = await route.fetch();
            // Match the desktop proxy's inline trusted bootstrap. Opaque frames
            // cannot fetch loopback subresources from a synthetic routed response.
            const bootstrap = readFileSync(new URL('./public/preview-shell.js', import.meta.url), 'utf8');
            const body = (await response.text()).replace('<script src="/preview-shell.js"></script>', `<script>${bootstrap.replaceAll('</script', '<\\/script')}</script>`);
            await route.fulfill({ response, body, headers: {
              ...response.headers(),
              'content-security-policy': policy === 'desktop'
                ? "frame-ancestors 'self'; object-src 'none'; base-uri 'self'"
                : "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: https: http:; style-src 'unsafe-inline' blob: https:; img-src blob: data: https:; font-src blob: data: https:; media-src blob: data: https:; connect-src blob: https: wss:; worker-src blob:; frame-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri https://veymux-preview.invalid; form-action 'none'",
            } });
          });
        },
        async filePreviewAction(context, action: string) {
          const frame = context.iframe.frameLocator('[data-html-preview-frame] iframe');
          if (action === 'expand') await frame.getByRole('button', { name: '展开审查意见' }).click();
          if (action === 'anchor') await frame.getByRole('link', { name: '正文锚点' }).click();
          if (action === 'escape') await frame.getByRole('button', { name: '展开审查意见' }).press('Escape');
          if (action === 'state') return frame.locator('body').evaluate(body => ({
            text: body.textContent, scroll: body.ownerDocument.defaultView!.scrollY,
            storage: body.dataset.storage, parent: body.dataset.parent, blocked: body.dataset.blocked,
            base: body.ownerDocument.baseURI, module: body.dataset.module, request: body.dataset.request, requestBlocked: body.dataset.requestBlocked, images: [...body.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
          }));
          return null;
        },
      },
    },
  },
});
