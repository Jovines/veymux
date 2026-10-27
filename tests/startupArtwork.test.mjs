import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from 'playwright';

let browser;
const root = new URL('../', import.meta.url);
const html = (await fs.readFile(new URL('index.html', root), 'utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<link\b[^>]*>/g, '');
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function glyphBounds(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    // Ignore edge antialiasing while measuring the visible brand contour.
    if (Math.abs(data[i] - 58) < 8 && Math.abs(data[i + 1] - 169) < 8 && Math.abs(data[i + 2] - 159) < 8) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  assert(right >= left && bottom >= top, 'Brand artwork must be visible');
  return { left, top, right, bottom };
}

async function startupPage(layout) {
  const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.dpr, isMobile: layout.touch, hasTouch: layout.touch });
  const page = await context.newPage(), images = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/boot-logo.png') {
      images.push(url.pathname);
      return route.fulfill({ contentType: 'image/png', body: await fs.readFile(new URL('public/boot-logo.png', root)) });
    }
    return route.abort();
  });
  await page.goto('http://startup.test/', { waitUntil: 'networkidle' });
  return { context, page, images };
}

for (const layout of [
  { width: 402, height: 874, dpr: 3, touch: true },
  { width: 874, height: 402, dpr: 3, touch: true },
  { width: 414, height: 896, dpr: 2, touch: true },
  { width: 768, height: 1024, dpr: 2, touch: true },
]) test(`HTML artwork continues the native launch image at ${layout.width}×${layout.height}, DPR ${layout.dpr}`, async () => {
  const { context, page, images } = await startupPage(layout);
  try {
    const width = layout.width * layout.dpr, height = layout.height * layout.dpr;
    const orientation = width < height ? 'portrait' : 'landscape';
    const native = await glyphBounds(await fs.readFile(new URL(`public/apple-splash-${orientation}-${width}x${height}.png`, root)));
    const document = await glyphBounds(await page.screenshot());
    for (const edge of ['left', 'top', 'right', 'bottom']) assert(Math.abs(native[edge] - document[edge]) <= 2,
      `${edge}: native ${native[edge]}, HTML ${document[edge]}; size or position would jump during handoff`);
    assert.equal(await page.locator('.veymux-boot-logo').evaluate(node => node.tagName.toLowerCase()), 'svg');
    assert.deepEqual(images, [], 'First-paint artwork must not wait for an external image request');
  } finally { await context.close(); }
});

test('desktop startup stays compact and does not paint a mobile launch logo', async () => {
  const { context, page } = await startupPage({ width: 1280, height: 900, dpr: 1, touch: false });
  try { assert.equal(await page.locator('.veymux-boot-logo').isVisible(), false); }
  finally { await context.close(); }
});
