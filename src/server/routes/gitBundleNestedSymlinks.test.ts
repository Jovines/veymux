import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('../utils/authProtection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/authProtection.js')>(),
  isAuthEnabled: () => false,
  isSessionValid: () => true,
}));

import router from './filesystem.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'td-linked-repos-')));
  temporaryDirectories.push(directory);
  const workspace = path.join(directory, 'workspace');
  makeRepo(workspace);
  return { directory, workspace };
}

function makeRepo(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', directory], { stdio: 'pipe' });
  fs.writeFileSync(path.join(directory, 'change.txt'), 'pending change\n');
}

async function bundle(workspace: string, discoverOnly = false) {
  const app = express();
  app.use('/api/fs', router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/fs/git-bundle?cwd=${encodeURIComponent(workspace)}&includeNested=true&refresh=true&discoverOnly=${discoverOnly}`);
    expect(response.ok).toBe(true);
    return await response.json();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('nested Git repositories reached through symlinks', () => {
  it('discovers direct repository links and keeps their workspace display paths', async () => {
    const { directory, workspace } = fixture();
    const external = path.join(directory, 'external');
    makeRepo(external);
    fs.symlinkSync(external, path.join(workspace, 'linked'), 'dir');

    const result = await bundle(workspace);
    expect(result.repositories).toHaveLength(2);
    expect(result.repositories[1]).toMatchObject({
      root: external,
      displayRoot: path.join(workspace, 'linked'),
      relativeRoot: 'linked',
      files: [expect.objectContaining({ path: 'change.txt', repoRoot: external })],
    });
  });

  it('discovers explicitly linked repositories even when the link has an excluded directory name', async () => {
    const { directory, workspace } = fixture();
    const external = path.join(directory, 'external');
    makeRepo(external);
    fs.symlinkSync('../external', path.join(workspace, 'vendor'), 'dir');

    for (const discoverOnly of [true, false]) {
      const result = await bundle(workspace, discoverOnly);
      expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, external]);
      expect(result.repositories[1]).toMatchObject({
        root: external,
        displayRoot: path.join(workspace, 'vendor'),
        relativeRoot: 'vendor',
      });
    }
  });

  it('discovers the owning repository when a link targets a directory below its root', async () => {
    const { directory, workspace } = fixture();
    const external = path.join(directory, 'external');
    makeRepo(external);
    fs.mkdirSync(path.join(external, 'packages', 'shared'), { recursive: true });
    fs.symlinkSync(path.join(external, 'packages', 'shared'), path.join(workspace, 'linked'), 'dir');
    fs.symlinkSync(path.join(external, 'packages'), path.join(workspace, 'linked-again'), 'dir');

    for (const discoverOnly of [true, false]) {
      const result = await bundle(workspace, discoverOnly);
      expect(result.truncatedRepositories).toBe(false);
      expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, external]);
      expect(result.repositories[1]).toMatchObject({
        root: external,
        displayRoot: path.join(workspace, 'linked'),
        relativeRoot: 'linked',
        ...(discoverOnly ? { deferred: true, files: [] } : { files: [expect.objectContaining({ path: 'change.txt', repoRoot: external })] }),
      });
    }
  });

  it('recognizes a repository whose Git metadata directory is a symlink', async () => {
    const { directory, workspace } = fixture();
    const child = path.join(workspace, 'child');
    makeRepo(child);
    const metadata = path.join(directory, 'child.git');
    fs.renameSync(path.join(child, '.git'), metadata);
    fs.symlinkSync(metadata, path.join(child, '.git'), 'dir');

    const result = await bundle(workspace);
    expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, child]);
  });

  it('continues through links into the workspace repository to find child repositories', async () => {
    const { workspace } = fixture();
    const container = path.join(workspace, 'z-container');
    const child = path.join(container, 'child');
    makeRepo(child);
    fs.symlinkSync(container, path.join(workspace, 'linked'), 'dir');

    const result = await bundle(workspace);
    expect(result.truncatedRepositories).toBe(false);
    expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, child]);
  });

  it('discovers repositories inside linked containers in both discovery and full refresh', async () => {
    const { directory, workspace } = fixture();
    const container = path.join(directory, 'external');
    const child = path.join(container, 'group', 'child');
    const worktree = path.join(container, 'worktree');
    makeRepo(child);
    execFileSync('git', ['-C', child, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init'], { stdio: 'pipe' });
    execFileSync('git', ['-C', child, 'worktree', 'add', '--detach', worktree], { stdio: 'pipe' });
    fs.symlinkSync(container, path.join(workspace, 'linked'), 'dir');

    for (const discoverOnly of [true, false]) {
      const result = await bundle(workspace, discoverOnly);
      expect(result.truncatedRepositories).toBe(false);
      expect(result.repositories.map((repo: any) => repo.relativeRoot)).toEqual(['.', 'linked/group/child', 'linked/worktree']);
      expect(result.repositories[1]).toMatchObject({
        root: child,
        displayRoot: path.join(workspace, 'linked', 'group', 'child'),
        ...(discoverOnly ? { deferred: true, files: [] } : { files: [expect.objectContaining({ path: 'change.txt', repoRoot: child })] }),
      });
      expect(result.repositories[2]).toMatchObject({ root: worktree, relativeRoot: 'linked/worktree' });
    }
  });

  it('deduplicates aliases, stops cycles and skips broken links and excluded directories', async () => {
    const { directory, workspace } = fixture();
    const container = path.join(directory, 'external');
    const child = path.join(container, 'child');
    makeRepo(child);
    makeRepo(path.join(container, 'node_modules', 'ignored'));
    makeRepo(path.join(workspace, '.git', 'ignored'));
    const excludedContainer = path.join(directory, 'dependencies');
    makeRepo(path.join(excludedContainer, 'ignored'));
    fs.symlinkSync(excludedContainer, path.join(workspace, 'vendor'), 'dir');
    fs.symlinkSync(container, path.join(workspace, 'linked'), 'dir');
    fs.symlinkSync(container, path.join(workspace, 'linked-again'), 'dir');
    fs.symlinkSync(container, path.join(container, 'loop'), 'dir');
    fs.symlinkSync(workspace, path.join(container, 'workspace-loop'), 'dir');
    fs.symlinkSync(path.join(directory, 'missing'), path.join(container, 'broken'), 'dir');
    fs.symlinkSync(path.join(child, 'change.txt'), path.join(container, 'file-link'));

    const result = await bundle(workspace);
    expect(result.truncatedRepositories).toBe(false);
    expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, child]);
    expect(result.repositories[1].relativeRoot).toBe('linked/child');
  });

  it('preserves repository boundaries inside linked containers', async () => {
    const { directory, workspace } = fixture();
    const container = path.join(directory, 'external');
    const child = path.join(container, 'child');
    makeRepo(child);
    makeRepo(path.join(child, 'internal'));
    fs.symlinkSync(container, path.join(workspace, 'linked'), 'dir');

    const result = await bundle(workspace);
    expect(result.repositories.map((repo: any) => repo.root)).toEqual([workspace, child]);
  });
});
