import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { migrateUserData, migrateProjectData } = createRequire(import.meta.url)('../scripts/migrate-user-data.cjs');
const legacy = 'termdock';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-upgrade-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('moves private state once while preserving identities, certificate bytes and file modes', t => {
  const home = temporary(t), previous = path.join(home, `.${legacy}`);
  fs.mkdirSync(path.join(previous, 'federation'), { recursive: true });
  fs.mkdirSync(path.join(previous, 'certs'));
  fs.writeFileSync(path.join(previous, 'federation', 'identity.key'), 'secret-key', { mode: 0o600 });
  fs.writeFileSync(path.join(previous, 'auth.json'), '{"hash":"password-hash"}', { mode: 0o600 });
  fs.writeFileSync(path.join(previous, 'certs', `${legacy}-local.pem`), 'certificate-bytes');
  fs.writeFileSync(path.join(previous, 'server.json'), JSON.stringify({ httpsCaPath: path.join(previous, 'certs', 'rootCA.pem'), localApiToken: 'unchanged' }));
  fs.writeFileSync(path.join(previous, '.env'), `${legacy.toUpperCase()}_PASSWORD=keep-this\nexport ${legacy.toUpperCase()}_PORT_FRONTEND=9833\nOTHER=value\n`);
  const first = migrateUserData(home, 'darwin');
  assert.equal(first.moved, true);
  assert.equal(fs.existsSync(previous), false);
  assert.equal(fs.readFileSync(path.join(first.directory, 'federation', 'identity.key'), 'utf8'), 'secret-key');
  assert.equal(fs.statSync(path.join(first.directory, 'federation', 'identity.key')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(first.directory, 'auth.json'), 'utf8'), '{"hash":"password-hash"}');
  assert.equal(fs.readFileSync(path.join(first.directory, 'certs', 'veymux-local.pem'), 'utf8'), 'certificate-bytes');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first.directory, 'server.json'))), { httpsCaPath: path.join(first.directory, 'certs', 'rootCA.pem'), localApiToken: 'unchanged' });
  assert.equal(fs.readFileSync(path.join(first.directory, '.env'), 'utf8'), 'VEYMUX_PASSWORD=keep-this\nexport VEYMUX_PORT_FRONTEND=9833\nOTHER=value\n');
  assert.equal(migrateUserData(home, 'darwin').moved, false);
});
test('existing destination wins without overwriting or removing either identity', t => {
  const home = temporary(t);
  for (const [name, value] of [[legacy, 'previous'], ['veymux', 'current']]) {
    const dir = path.join(home, `.${name}`);
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'identity'), value);
  }
  assert.equal(migrateUserData(home, 'darwin').moved, false);
  assert.equal(fs.readFileSync(path.join(home, `.${legacy}`, 'identity'), 'utf8'), 'previous');
  assert.equal(fs.readFileSync(path.join(home, '.veymux', 'identity'), 'utf8'), 'current');
});
test('desktop connection settings and WebKit credentials move before new folders are created', t => {
  const home = temporary(t), support = path.join(home, 'Library', 'Application Support');
  for (const relative of [`Application Support/com.jovines.${legacy}`, `WebKit/com.jovines.${legacy}`, `Application Support/Termdock/Partitions/${legacy}-service-abc`]) {
    const directory = path.join(home, 'Library', relative);
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'state'), 'keep');
  }
  migrateUserData(home, 'darwin');
  for (const directory of [path.join(support, 'com.jovines.veymux'), path.join(home, 'Library/WebKit/com.jovines.veymux'), path.join(support, 'Veymux/Partitions/veymux-service-abc')]) {
    assert.equal(fs.readFileSync(path.join(directory, 'state'), 'utf8'), 'keep');
  }
});
test('fresh install does not create an unnecessary configuration directory', t => {
  const home = temporary(t);
  assert.equal(migrateUserData(home, 'darwin').moved, false);
  assert.equal(fs.existsSync(path.join(home, '.veymux')), false);
});
test('migrates owned hook commands without rewriting user hooks or historical messages', t => {
  const home = temporary(t), old = path.join(home, `.${legacy}`);
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'collaboration-groups.json'), JSON.stringify({ messages: [{ text: 'historical ' + legacy, metadata: { [legacy + 'Task']: { id: 'task' } } }] }));
  const claude = path.join(home, '.claude'); fs.mkdirSync(claude);
  const hook = `node /packages/${legacy}/agentHook.js agent-hook claude done`;
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ hooks: [{ command: hook }, { command: 'echo ' + legacy }] }));
  migrateUserData(home, 'darwin');
  const hooks = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'))).hooks;
  assert.equal(hooks[0].command, hook.replace(legacy, 'veymux'));
  assert.equal(hooks[1].command, 'echo ' + legacy);
  const record = JSON.parse(fs.readFileSync(path.join(home, '.veymux/collaboration-groups.json'))).messages[0];
  assert.equal(record.text, 'historical ' + legacy);
  assert.deepEqual(record.metadata.veymuxTask, { id: 'task' });
});
test('project documents migrate on access and symlinks cannot redirect migration', t => {
  const root = temporary(t), old = path.join(root, `.${legacy}`);
  fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'architecture.json'), 'project-data');
  migrateProjectData(root);
  assert.equal(fs.readFileSync(path.join(root, '.veymux/architecture.json'), 'utf8'), 'project-data');
  const elsewhere = temporary(t); fs.symlinkSync(elsewhere, old, 'dir');
  assert.throws(() => migrateProjectData(root), /real data directory/);
  assert.equal(fs.existsSync(elsewhere), true);
});
