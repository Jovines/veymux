// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteAgentCommand, getAgentLaunchCommand, isConfiguredAgentCommand, LEGACY_COMMANDS_KEY, readAgentCommandPresets, rememberAgentCommand, saveAgentCommand, selectAgentCommand } from './launchCommands';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it('migrates the previous override while retaining standalone commands and other Agents', () => {
  localStorage.setItem(LEGACY_COMMANDS_KEY, JSON.stringify({ codex: 'codex --model old', claude: 'claude --verbose', '__saved_command__:htop': 'htop' }));
  saveAgentCommand('codex', 'codex', { name: 'Deep', command: 'codex --model deep' });
  expect(readAgentCommandPresets('codex', 'codex').presets.map(p => p.command)).toEqual(['codex --model old', 'codex --model deep']);
  expect(getAgentLaunchCommand('claude', 'claude')).toBe('claude --verbose');
  expect(JSON.parse(localStorage.getItem(LEGACY_COMMANDS_KEY)!)['__saved_command__:htop']).toBe('htop');
});
it('retains multiple variants, remembers selection and updates or deletes only the selected preset', () => {
  const daily = saveAgentCommand('codex', 'codex', { name: 'Daily', command: 'codex --model daily' });
  const deep = saveAgentCommand('codex', 'codex', { name: 'Deep', command: 'codex --model deep' });
  selectAgentCommand('codex', 'codex', daily.id);
  expect(getAgentLaunchCommand('codex', 'codex')).toBe(daily.command);
  saveAgentCommand('codex', 'codex', { ...daily, command: 'codex --model daily-v2' });
  deleteAgentCommand('codex', 'codex', daily.id);
  expect(getAgentLaunchCommand('codex', 'codex')).toBe('codex');
  expect(readAgentCommandPresets('codex', 'codex').presets).toEqual([deep]);
  rememberAgentCommand('codex', 'codex', deep.command);
  expect(getAgentLaunchCommand('codex', 'codex')).toBe(deep.command);
  expect(readAgentCommandPresets('codex', 'codex').presets).toHaveLength(1);
});
it('ignores corrupt storage without manufacturing an executable command', () => {
  localStorage.setItem('veymux:agent-command-presets:v1', '{broken');
  localStorage.setItem(LEGACY_COMMANDS_KEY, '[]');
  expect(getAgentLaunchCommand('codex', 'codex')).toBe('codex');
  expect(() => selectAgentCommand('codex', 'codex', 'missing')).toThrow();
});

it('upgrades and deletes a legacy non-default Agent command without reviving it or disturbing other commands', () => {
  localStorage.setItem(LEGACY_COMMANDS_KEY, JSON.stringify({ claude: 'claude --verbose', codex: 'codex --model daily', __custom__: 'htop' }));
  expect(getAgentLaunchCommand('claude', 'claude')).toBe('claude --verbose');
  deleteAgentCommand('claude', 'claude', 'legacy');
  expect(getAgentLaunchCommand('claude', 'claude')).toBe('claude');
  rememberAgentCommand('claude', 'claude', 'claude');
  expect(readAgentCommandPresets('claude', 'claude').presets).toEqual([]);
  expect(getAgentLaunchCommand('codex', 'codex')).toBe('codex --model daily');
  expect(JSON.parse(localStorage.getItem(LEGACY_COMMANDS_KEY)!).__custom__).toBe('htop');
});

it('does not resurrect a deleted preset from an editor opened before another window deleted it', () => {
  const preset = saveAgentCommand('claude', 'claude', { name: 'Old', command: 'claude --verbose' });
  deleteAgentCommand('claude', 'claude', preset.id);
  expect(() => saveAgentCommand('claude', 'claude', { ...preset, command: 'claude --debug' })).toThrow('deleted');
  expect(readAgentCommandPresets('claude', 'claude').presets).toEqual([]);
  expect(isConfiguredAgentCommand('claude --verbose')).toBe(false);
});

it('leaves a legacy installation unchanged when the authoritative preset write fails', () => {
  localStorage.setItem(LEGACY_COMMANDS_KEY, JSON.stringify({ claude: 'claude --verbose' }));
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === 'veymux:agent-command-presets:v1') throw new Error('quota');
    return original.call(this, key, value);
  });
  expect(() => deleteAgentCommand('claude', 'claude', 'legacy')).toThrow('quota');
  expect(getAgentLaunchCommand('claude', 'claude')).toBe('claude --verbose');
});

it('keeps a committed deletion when writing the legacy compatibility mirror fails', () => {
  const preset = saveAgentCommand('claude', 'claude', { name: 'Old', command: 'claude --verbose' });
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === LEGACY_COMMANDS_KEY) throw new Error('quota');
    return original.call(this, key, value);
  });
  expect(() => deleteAgentCommand('claude', 'claude', preset.id)).not.toThrow();
  expect(getAgentLaunchCommand('claude', 'claude')).toBe('claude');
  expect(readAgentCommandPresets('claude', 'claude').presets).toEqual([]);
});
