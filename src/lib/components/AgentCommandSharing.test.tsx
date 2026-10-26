// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NewSessionComposer } from './sidebar/NewSessionComposer';
import { CollectorEditor, resolveTodoConfig } from './todos/TodoForms';
import { deleteAgentCommand, getAgentLaunchCommand, readAgentCommandPresets, saveAgentCommand } from '../terminal/launchCommands';
import { useTodoWorkspace } from '../todos/workspace';

const codex = { slug: 'codex', displayName: 'Codex', command: 'codex', accentColor: 'var(--primary)', icon: null };
const claude = { ...codex, slug: 'claude', displayName: 'Claude Code', command: 'claude' };
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('termdock:locale', 'en');
  useTodoWorkspace.setState({ views: {}, snapshots: {}, options: {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ locale: 'en' }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function session(onLaunchAgent = vi.fn()) {
  return render(<I18nProvider><NewSessionComposer directories={[]} tmuxAvailable options={{ mode: 'tmux', cwd: '/workspace' }} agents={[codex, claude]} selectedAgent={codex} detecting={false}
    resumeHistory={[]} resumeHistoryLoading={false} resumeHistoryPendingId={null} resumeHistoryError={null} onRefreshAgents={vi.fn()} onSelectAgent={vi.fn()} onLaunchAgent={onLaunchAgent}
    onResumeHistory={vi.fn()} onRemoveResumeHistory={vi.fn()} onClose={vi.fn()} onOptionsChange={vi.fn()} /></I18nProvider>);
}
function add(name: string, command: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Command preset' }), { target: { value: '__new__' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: name } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Startup command' }), { target: { value: command } });
  fireEvent.click(screen.getByRole('button', { name: 'Save command' }));
}
it('shares multiple named Agent commands between new sessions and Todo configuration, including after remount', () => {
  const launcher = session();
  add('Daily', 'codex --model daily'); add('Deep', 'codex --model deep');
  const presets = readAgentCommandPresets('codex', 'codex').presets;
  expect(presets.map(p => p.name)).toEqual(['Daily', 'Deep']);
  launcher.unmount();
  const config = resolveTodoConfig({ agentSlug: 'codex', command: '', cwd: '/workspace', prompt: '' }, [codex]);
  expect(config.command).toBe('codex --model deep');
  const collector = render(<I18nProvider><CollectorEditor workspace="sharing" config={config} agents={[codex]} loading={false} service="local" directories={[]} currentCwd="/workspace" busy={false} onSave={vi.fn()} onCancel={vi.fn()} /></I18nProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Command preset' }), { target: { value: presets[0].id } });
  expect(getAgentLaunchCommand('codex', 'codex')).toBe('codex --model daily');
  collector.unmount();
  const launch = vi.fn(); session(launch);
  fireEvent.click(screen.getByRole('button', { name: 'Start Codex' }));
  expect(launch).toHaveBeenCalledWith(codex, 'codex --model daily');
  expect(readAgentCommandPresets('codex', 'codex').presets).toHaveLength(2);
});
it('keeps an existing Todo command and unsaved command drafts separate from the shared selection', () => {
  saveAgentCommand('codex', 'codex', { name: 'Shared', command: 'codex --model shared' });
  expect(resolveTodoConfig({ agentSlug: 'codex', command: 'codex --model scheduled', cwd: '/workspace', prompt: '' }, [codex]).command).toBe('codex --model scheduled');
  const view = session();
  fireEvent.change(screen.getByRole('combobox', { name: 'Command preset' }), { target: { value: '__new__' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Startup command' }), { target: { value: 'codex --draft' } });
  view.unmount();
  expect(getAgentLaunchCommand('codex', 'codex')).toBe('codex --model shared');
  session();
  const preset = screen.getByRole('combobox', { name: 'Command preset' }) as HTMLSelectElement;
  expect(preset.selectedOptions[0].textContent).toBe('Shared');
});
it('cancels only the command editor with Escape and restores the unchanged parent selection', () => {
  const shared = saveAgentCommand('codex', 'codex', { name: 'Shared', command: 'codex --model shared' });
  session();
  fireEvent.change(screen.getByRole('combobox', { name: 'Command preset' }), { target: { value: '__new__' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Startup command' }), { target: { value: 'codex --discard' } });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('region', { name: 'Start a session' })).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Command preset' }) as HTMLSelectElement).value).toBe(shared.id);
  expect(getAgentLaunchCommand('codex', 'codex')).toBe(shared.command);
});

it('deletes a non-default Agent preset directly and keeps it deleted after switching and remounting', () => {
  const other = saveAgentCommand('codex', 'codex', { name: 'Codex saved', command: 'codex --model daily' });
  const launch = vi.fn(), view = session(launch);
  fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
  add('Verbose', 'claude --verbose');
  add('Debug', 'claude --debug');
  fireEvent.click(screen.getByRole('button', { name: 'Delete command' }));
  expect(readAgentCommandPresets('claude', 'claude').presets.map(p => p.name)).toEqual(['Verbose']);
  expect((screen.getByRole('combobox', { name: 'Command preset' }) as HTMLSelectElement).value).toBe('__default__');
  fireEvent.click(screen.getByRole('radio', { name: 'Codex Default' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start Claude Code' }));
  expect(launch).toHaveBeenLastCalledWith(claude, 'claude');
  expect(getAgentLaunchCommand('codex', 'codex')).toBe(other.command);
  view.unmount(); session();
  fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
  expect(screen.queryByRole('option', { name: 'Debug' })).toBeNull();
  expect(screen.getByRole('option', { name: 'Verbose' })).toBeTruthy();
});

it('launches the current shared non-default Agent command when another editor changes or deletes it', () => {
  saveAgentCommand('claude', 'claude', { name: 'Old', command: 'claude --verbose' });
  const launch = vi.fn(); session(launch);
  fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
  let changed!: ReturnType<typeof saveAgentCommand>;
  act(() => { changed = saveAgentCommand('claude', 'claude', { name: 'New', command: 'claude --debug' }); });
  fireEvent.click(screen.getByRole('button', { name: 'Start Claude Code' }));
  expect(launch).toHaveBeenLastCalledWith(claude, changed.command);
  act(() => deleteAgentCommand('claude', 'claude', changed.id));
  fireEvent.click(screen.getByRole('button', { name: 'Start Claude Code' }));
  expect(launch).toHaveBeenLastCalledWith(claude, 'claude');
  expect(readAgentCommandPresets('claude', 'claude').presets.map(p => p.name)).toEqual(['Old']);
});

it('keeps a deleted non-default Agent preset deleted when a stale editor submits', () => {
  const preset = saveAgentCommand('claude', 'claude', { name: 'Old', command: 'claude --verbose' });
  session();
  fireEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change startup command' }));
  act(() => deleteAgentCommand('claude', 'claude', preset.id));
  fireEvent.click(screen.getByRole('button', { name: 'Save command' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(readAgentCommandPresets('claude', 'claude').presets).toEqual([]);
});
