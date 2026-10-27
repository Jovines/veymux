// One-way upgrade boundary. Product code only uses the new identity.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LEGACY_NAME = 'termdock';

function moveDirectory(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try { fs.renameSync(source, target); return true; }
  catch (error) {
    // A concurrent first launch may already have completed the rename.
    if (error.code === 'ENOENT' && fs.existsSync(target)) return false;
    throw error;
  }
}

function migrateOwnedState(root, oldRoot) {
  const renameKey = key => key.replace(/termdock/gi, match => match === match.toUpperCase() ? 'VEYMUX' : match === match.toLowerCase() ? 'veymux' : 'Veymux');
  const convert = value => Array.isArray(value) ? value.map(convert)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [renameKey(key), convert(child)]))
    : typeof value === 'string' ? value.split(oldRoot + path.sep).join(root + path.sep) : value;
  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && directory !== root && !['.git', 'node_modules'].includes(entry.name)) { visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const text = fs.readFileSync(file, 'utf8');
      let value;
      try { value = JSON.parse(text); } catch { continue; }
      const next = convert(value);
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        const temporary = `${file}.${process.pid}.migration`;
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, file);
      }
      const renamed = renameKey(entry.name);
      if (renamed !== entry.name) moveDirectory(file, path.join(directory, renamed));
    }
  };
  visit(root);
  for (const name of ['federation', 'integration-state', 'agent-plugins', 'pty-hosts']) visit(path.join(root, name));
}

function migrateAgentHooks(home) {
  const configured = (key, fallback) => home === os.homedir() ? process.env[key] || fallback : fallback;
  const replace = text => text.replace(/termdock/gi, match => match === match.toUpperCase() ? 'VEYMUX' : match === match.toLowerCase() ? 'veymux' : 'Veymux');
  const owned = [
    [path.join(home, '.copilot/hooks'), '.json'],
    [path.join(home, '.grok/hooks'), '.json'],
    [path.join(configured('XDG_CONFIG_HOME', path.join(home, '.config')), 'opencode/plugins'), '.js'],
  ];
  for (const [directory, extension] of owned) {
    const old = path.join(directory, LEGACY_NAME + extension), next = path.join(directory, 'veymux' + extension);
    if (!fs.existsSync(old) || fs.existsSync(next)) continue;
    const text = fs.readFileSync(old, 'utf8');
    if (!text.includes('agent-hook')) continue;
    const temporary = `${next}.${process.pid}.migration`;
    fs.writeFileSync(temporary, replace(text), { mode: 0o600 });
    fs.renameSync(temporary, next); fs.unlinkSync(old);
  }
  // Shared user files: update only our hook command strings, never other hooks.
  for (const file of [path.join(configured('CLAUDE_CONFIG_DIR', path.join(home, '.claude')), 'settings.json'), path.join(configured('CODEX_HOME', path.join(home, '.codex')), 'hooks.json')]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/"(?:[^"\\]|\\.)*"/g, token => token.includes('agent-hook') ? replace(token) : token);
    if (text === next) continue;
    const temporary = `${file}.${process.pid}.migration`;
    fs.writeFileSync(temporary, next, { mode: 0o600 }); fs.renameSync(temporary, file);
  }
}

function migrateUserData(home = os.homedir(), platform = process.platform) {
  const oldRoot = path.join(home, `.${LEGACY_NAME}`);
  const root = path.join(home, '.veymux');
  // Already-running terminal shells keep their original environment until exit.
  for (const [key, value] of Object.entries(process.env)) {
    if (key === LEGACY_NAME.toUpperCase() || key.startsWith(LEGACY_NAME.toUpperCase() + '_')) {
      const next = key.replace(LEGACY_NAME.toUpperCase(), 'VEYMUX');
      if (process.env[next] === undefined) process.env[next] = value;
    }
  }
  const moved = moveDirectory(oldRoot, root);
  const marker = path.join(root, '.brand-upgrade-v1');
  if (fs.existsSync(root) && !fs.existsSync(marker)) {
    migrateOwnedState(root, oldRoot);
    const envFile = path.join(root, '.env');
    if (fs.existsSync(envFile)) {
      const text = fs.readFileSync(envFile, 'utf8');
      const next = text.replace(new RegExp(`^(\\s*(?:export\\s+)?)${LEGACY_NAME.toUpperCase()}(?=_|=)`, 'gm'), '$1VEYMUX');
      if (next !== text) {
        const temporary = `${envFile}.${process.pid}.migration`;
        fs.writeFileSync(temporary, next, { mode: 0o600 });
        fs.renameSync(temporary, envFile);
      }
    }
    // Preserve the CA and keys byte-for-byte: renaming must not revoke trust.
    for (const suffix of ['-local.pem', '-local-key.pem']) {
      const from = path.join(root, 'certs', LEGACY_NAME + suffix);
      const to = path.join(root, 'certs', 'veymux' + suffix);
      moveDirectory(from, to);
    }
    for (const file of ['server.json', 'supervisor.json', 'desktop.json']) {
      const target = path.join(root, file);
      if (!fs.existsSync(target)) continue;
      const bytes = fs.readFileSync(target, 'utf8');
      // Only owned path values change; identity, tokens and user content remain intact.
      const next = bytes.split(oldRoot).join(root)
        .split(`${LEGACY_NAME}-local`).join('veymux-local');
      if (next !== bytes) {
        const temporary = `${target}.${process.pid}.migration`;
        fs.writeFileSync(temporary, next, { mode: 0o600 });
        fs.renameSync(temporary, target);
      }
    }
    migrateAgentHooks(home);
    fs.writeFileSync(marker, '1\n', { mode: 0o600 });
  }
  const nativeRoot = platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  for (const suffix of ['', '.preview']) {
    moveDirectory(path.join(nativeRoot, `com.jovines.${LEGACY_NAME}${suffix}`),
      path.join(nativeRoot, `com.jovines.veymux${suffix}`));
  }
  moveDirectory(path.join(nativeRoot, 'Termdock'), path.join(nativeRoot, 'Veymux'));
  const partitions = path.join(nativeRoot, 'Veymux', 'Partitions');
  if (fs.existsSync(partitions)) for (const name of fs.readdirSync(partitions)) {
    if (name.startsWith(`${LEGACY_NAME}-`)) moveDirectory(path.join(partitions, name), path.join(partitions, name.replace(LEGACY_NAME, 'veymux')));
  }
  for (const container of ['WebKit', 'Caches']) for (const suffix of ['', '.preview']) {
    const directory = path.join(home, 'Library', container);
    moveDirectory(path.join(directory, `com.jovines.${LEGACY_NAME}${suffix}`), path.join(directory, `com.jovines.veymux${suffix}`));
  }
  return { directory: root, moved };
}

function migrateProjectData(root) {
  const from = path.join(root, `.${LEGACY_NAME}`);
  if (!fs.existsSync(from)) return;
  if (!fs.lstatSync(from).isDirectory()) throw new Error('Project upgrade requires a real data directory');
  moveDirectory(from, path.join(root, '.veymux'));
}

module.exports = { migrateUserData, migrateProjectData };
