import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

test('previous identity is confined to the one-way migration and its tests', () => {
  const allowed = new Set([
    'scripts/migrate-user-data.cjs', 'public/brand-migration.js',
    'desktop-rust/src-tauri/src/brand_migration.rs',
    'tests/brandMigration.test.mjs', 'tests/browserBrandMigration.test.mjs',
    'tests/brandBoundary.test.mjs',
  ]);
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const unexpected = [];
  for (const file of new Set(files)) {
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || allowed.has(file)) continue;
    if (/termdock/i.test(file) || /termdock/i.test(fs.readFileSync(file).toString('utf8'))) unexpected.push(file);
  }
  assert.deepEqual(unexpected, [], 'Old identity must not leak into product code, documentation or filenames');
  const pkg = JSON.parse(fs.readFileSync('package.json'));
  assert.equal(pkg.name, 'veymux');
  assert.deepEqual(Object.keys(pkg.bin), ['veymux']);
  assert.equal(pkg.homepage, 'https://veymux.com');
});
