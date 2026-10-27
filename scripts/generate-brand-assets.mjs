import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const write = (file, bytes) => fs.writeFile(path.join(root, file), bytes);
const css = await fs.readFile(path.join(root, 'src/index.css'), 'utf8');
const token = name => {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing brand token: ${name}`);
  return value;
};
const background = token('chrome-bg');
const brand = token('brand-mark');

// Furl: a continuous, open return with a rounded lip and a broad flowing body.
// This is the approved vector silhouette, shared by color and monochrome assets.
const passage = (mono = false) => `
  <path fill="${mono ? 'currentColor' : brand}" d="M180 208 C173 211 168 204 173 196 C218 137 286 112 337 120 C414 132 454 200 452 277 C450 344 415 388 369 388 C322 388 279 353 230 344 C178 334 123 340 86 363 C69 374 54 360 46 339 C33 306 35 283 55 259 C74 236 104 230 134 232 C179 235 213 260 250 287 C280 309 308 330 337 330 C360 330 368 310 366 287 C362 248 333 220 298 209 C261 197 222 191 180 208 Z"/>`;
const glyph = (scale = 1, mono = false) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${passage(mono)}</g>`;
function svg(content, size = 512) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="Veymux">${content}\n</svg>\n`;
}
const tile = scale => `<rect width="512" height="512" rx="112" fill="${background}"/>${glyph(scale)}`;
const app = svg(tile(1));
// macOS icons share an inset optical footprint; transparency stays outside the tile.
const desktop = svg(`<g transform="translate(50 50) scale(0.8046875)">${tile(1)}</g>`, 1024);

await write('public/brand.svg', app);
await write('public/pwa-512x512.svg', app);
await write('public/pwa-192x192.svg', svg(tile(1), 192));
await write('public/mask-icon.svg', svg(glyph(1, true)));

// Inline the same source into the HTML first paint. A separate PNG request
// could finish after iOS releases its launch image, leaving an empty frame.
const launch = app.replace('role="img" aria-label="Veymux"', 'class="veymux-boot-logo" aria-hidden="true" focusable="false"').trim();
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const launchSlot = /<!-- veymux-launch-artwork:start -->[\s\S]*?<!-- veymux-launch-artwork:end -->|<img class="veymux-boot-logo"[^>]*\/>/;
if (!launchSlot.test(html)) throw new Error('Missing HTML launch artwork slot');
await write('index.html', html.replace(launchSlot, `<!-- veymux-launch-artwork:start -->\n        ${launch}\n        <!-- veymux-launch-artwork:end -->`));

// Generate every launch image from the same source before finishing platform variants.
const generator = fileURLToPath(new URL('./bin/pwa-assets-generator.mjs', import.meta.resolve('@vite-pwa/assets-generator/package.json')));
await promisify(execFile)(process.execPath, [generator, '--config', 'pwa-assets.config.ts'], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
await fs.copyFile(path.join(root, 'public/apple-splash-portrait-1170x2532.png'), path.join(root, 'public/apple-splash-default-1170x2532.png'));
// Android mask shapes can crop everything outside the central 80% circle.
// Reduce only the glyph, retaining a full opaque background behind that mask.
await sharp(Buffer.from(svg(tile(0.9)))).flatten({ background }).png()
  .toFile(path.join(root, 'public/maskable-icon-512x512.png'));

for (const [file, size, source] of [
  ['public/boot-logo.png', 512, app],
  ['desktop/assets/veymux-macos-icon.png', 1024, desktop],
  ['desktop-rust/src-tauri/.runtime-icons/icon.png', 1024, desktop],
]) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(path.join(root, file));
}

// ICO has an individually rasterized, optically enlarged 16/24/32px mark.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(size => sharp(Buffer.from(svg(tile(size <= 32 ? 1.04 : 1))))
  .resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await write('public/favicon.ico', Buffer.concat([directory, ...images]));

const icns = [];
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const png = await sharp(Buffer.from(desktop)).resize(size, size).png().toBuffer();
  const head = Buffer.alloc(8);
  head.write(type); head.writeUInt32BE(png.length + 8, 4);
  icns.push(head, png);
}
const header = Buffer.alloc(8);
header.write('icns'); header.writeUInt32BE(icns.reduce((size, block) => size + block.length, 8), 4);
await write('desktop/assets/Veymux.icns', Buffer.concat([header, ...icns]));
console.log('Generated Veymux Furl icons, optical favicons, native icons and all PWA launch screens.');
