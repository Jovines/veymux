// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import filesystemRouter from './filesystem.js';

describe('sidebar file search', () => {
  let root: string;
  let server: Server;
  let origin: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'veymux-fuzzy-search-'));
    await fs.mkdir(path.join(root, 'Sidebar'));
    await fs.writeFile(path.join(root, 'Sidebar/RightSidebar.tsx'), 'HelloWorld\n');
    await fs.writeFile(path.join(root, 'notes.txt'), 'other text\n');
    const app = express();
    app.use('/fs', filesystemRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });

  async function search(query: string, stream: boolean, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ path: root, query, stream: String(stream), ...extra });
    const response = await fetch(`${origin}/fs/search?${params}`);
    expect(response.status).toBe(200);
    if (!stream) return response.json();
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.at(-1).type).toBe('done');
    return {
      entries: events.flatMap(event => event.entries ?? []),
      contentEntries: events.flatMap(event => event.contentEntries ?? []),
      engine: events.at(-1).engine,
      limited: events.at(-1).limited,
    };
  }

  describe.each(['rg', 'fallback'])('%s engine', engine => {
    beforeEach(() => {
      if (engine === 'fallback') vi.stubEnv('PATH', root);
    });

    it.each([false, true])('matches lowercase, mixed case and ordered abbreviations (stream=%s)', async stream => {
      for (const query of ['rightsidebar', 'RiGhTsIdEbAr', 'rtsb', 'sbr/rtsb']) {
        const result = await search(query, stream);
        expect(result.engine).toBe(engine);
        expect(result.entries.map((entry: { name: string }) => entry.name)).toEqual(['RightSidebar.tsx']);
      }
      expect((await search('zzyyxx', stream)).entries).toEqual([]);
      expect((await search('rtsb', stream, { exclude: 'Sidebar' })).entries).toEqual([]);
    });
  });

  it('rejects oversized 3D previews before streaming while keeping explicit downloads available', async () => {
    const file = path.join(root, 'large.glb');
    await fs.writeFile(file, 'glTF'); await fs.truncate(file, 17 * 1024 * 1024);
    const preview = await fetch(`${origin}/fs/download?${new URLSearchParams({ path: file, preview: 'model' })}`);
    expect(preview.status).toBe(413);
    expect((await preview.json()).maxSize).toBe(16 * 1024 * 1024);
    const download = await fetch(`${origin}/fs/download?${new URLSearchParams({ path: file })}`);
    expect(download.status).toBe(200); await download.body?.cancel();
  });

  it('reads only the capped prefix of a 1 GiB regular file', async () => {
    const file = path.join(root, 'large-log.txt');
    await fs.writeFile(file, 'hello\n');
    await fs.truncate(file, 1024 * 1024 * 1024);
    const response = await fetch(`${origin}/fs/read?${new URLSearchParams({ path: file })}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.size).toBe(1024 * 1024 * 1024);
    expect(data.binary).toBe(true);
    expect(data.content).toBe('');
  });

  it('bounds real ripgrep JSON from a multi-megabyte single-line file', async () => {
    await fs.writeFile(path.join(root, 'large.txt'), 'needle' + 'x'.repeat(8 * 1024 * 1024));
    const result = await search('needle', true, { mode: 'content' });
    expect(result.limited).toBe(true);
    expect(result.contentEntries).toEqual([]);
    // A subsequent ordinary request must still work after terminating rg.
    expect((await search('helloworld', true, { mode: 'content' })).contentEntries).toHaveLength(1);
  });

  it('keeps content search case-insensitive by default without fuzzy matching', async () => {
    expect((await search('helloworld', true, { mode: 'content' })).contentEntries).toHaveLength(1);
    expect((await search('hlwd', true, { mode: 'content' })).contentEntries).toEqual([]);
    expect((await search('helloworld', true, { mode: 'content', caseSensitive: 'true' })).contentEntries).toEqual([]);
  });

  it.each([
    ['cancel-slot', 'name'], ['disconnect', 'name'],
    ['cancel-slot', 'content'], ['disconnect', 'content'],
  ])('terminates the running search process on %s (%s)', async (action, mode) => {
    // A real child process that stays busy until the server terminates it.
    const bin = path.join(root, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'rg'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('started', '');
process.on('SIGTERM', () => { fs.writeFileSync('stopped', ''); process.exit(0); });
setInterval(() => {}, 1000);
`, { mode: 0o755 });
    vi.stubEnv('PATH', bin);
    const controller = new AbortController();
    const params = new URLSearchParams({ path: root, query: 'ABC', stream: 'true', mode, requestSlotId: 'search-cancellation' });
    const response = await fetch(`${origin}/fs/search?${params}`, { signal: controller.signal });
    const body = response.text().catch(() => '');
    await vi.waitFor(() => fs.access(path.join(root, 'started')));
    if (action === 'cancel-slot') {
      const cancellation = await fetch(`${origin}/fs/cancel-slot?requestSlotId=search-cancellation`);
      expect(await cancellation.json()).toMatchObject({ cancelled: true });
    } else {
      controller.abort();
    }
    await vi.waitFor(() => fs.access(path.join(root, 'stopped')));
    await body;
  });
});
