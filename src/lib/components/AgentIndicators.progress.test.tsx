// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AgentTabIcon, AgentSessionDot } from './AgentIndicators';
import { I18nProvider } from '../i18n';
import { useTerminalStore } from '../stores/useTerminalStore';

afterEach(cleanup);
it.each([{ mode: false, hasMessages: true }, { mode: true, hasMessages: false }])('keeps Terminal activity rules for $mode/$hasMessages', attention => {
  const chatAttention = { ...attention, unreadIds: [] };
  const progress = { source: 'osc7501' as const, state: 'indeterminate' as const, progress: null, message: 'Native output' };
  const view = render(<I18nProvider><AgentSessionDot status="idle" outputActive progress={progress} chatAttention={chatAttention} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentTabIcon sessionMode="tmux" state={{ agentStatus: 'idle', tuiProgress: progress, chatAttention }} /></I18nProvider>);
  expect(view.container.querySelector('.motion-safe\\:animate-pulse')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="working" outputActive progress={progress} chatAttention={chatAttention} /></I18nProvider>);
  expect(view.container.querySelector('.animate-pulse')).not.toBeNull();
});
it('keeps native progress as a pulse and preserves question, completion, and error indicators', () => {
  const state = { chatAttention: { mode: true, hasMessages: true, unreadIds: [] }, agentStatus: 'idle' as const, tuiProgress: { source: 'osc7501' as const, state: 'indeterminate' as const, progress: null, message: 'Native working' } };
  const view = render(<AgentTabIcon sessionMode="shell" state={state} />);
  expect(screen.getByTitle('Native working').querySelector('.animate-spin')).toBeNull();
  expect(screen.getByTitle('Native working').querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
  for (const phase of ['blocked', 'done', 'error'] as const) {
    view.rerender(<AgentTabIcon sessionMode="shell" state={{ ...state, tuiProgress: { ...state.tuiProgress, state: phase, message: phase } }} />);
    expect(screen.getByTitle(phase).querySelector('.animate-spin')).toBeNull();
    expect(screen.getByTitle(phase).querySelector('svg')).not.toBeNull();
  }
});

it('retains the brand during hook and plugin working states and native progress', () => {
  const agent = { slug: 'codex', displayName: 'Codex', icon: 'codex', accentColor: 'var(--foreground)' };
  const view = render(<I18nProvider><AgentTabIcon sessionMode="tmux" state={{ agentStatus: 'idle', agent }} /></I18nProvider>);
  for (const state of [
    { agentStatus: 'working' as const, agentMessage: 'Hook work' },
    { agentStatus: 'working' as const, agentStatusDetail: { id: 'working', label: 'Plugin work', tone: 'success' as const }, agentIndicator: 'spinner' as const },
    { agentStatus: 'idle' as const, tuiProgress: { source: 'osc7501' as const, state: 'indeterminate' as const, progress: null, message: 'Native work' } },
  ]) {
    view.rerender(<I18nProvider><AgentTabIcon sessionMode="tmux" state={{ ...state, agent, chatAttention: { mode: true, hasMessages: true, unreadIds: [] } }} /></I18nProvider>);
    expect(view.container.querySelector('[title="Codex"]')).not.toBeNull();
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    expect(view.container.querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
  }
});

it('keeps explicit hook permission and review signals ahead of native progress', () => {
  const progress = { source: 'osc7501' as const, state: 'indeterminate' as const, progress: null, message: 'Native working' };
  const view = render(<AgentTabIcon sessionMode="shell" state={{ agentStatus: 'waiting', agentMessage: 'Hook permission', tuiProgress: progress }} />);
  expect(screen.getByTitle('Hook permission')).toBeTruthy();
  expect(screen.queryByTitle('Native working')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" progress={{ ...progress, state: 'blocked', message: 'Native approval' }} /></I18nProvider>);
  expect(screen.getByTitle('Native approval')).toBeTruthy();
});

it('updates changing native messages without manufacturing an Agent phase or tool activity', () => {
  const id = 'native-progress-fixture';
  const store = useTerminalStore.getState();
  store.setTerminalSession(id, { sessionId: 'native-backend', mode: 'shell', cwd: '/fixture', cols: 80, rows: 24 });
  const before = useTerminalStore.getState().sessions.get(id)!;
  store.setSessionTuiProgress(id, { source: 'osc7501', state: 'blocked', progress: null, message: 'First question' });
  store.setSessionTuiProgress(id, { source: 'osc7501', state: 'blocked', progress: null, message: 'Second question' });
  const after = useTerminalStore.getState().sessions.get(id)!;
  expect(after.tuiProgress?.message).toBe('Second question');
  expect(after.agentStatus).toBe(before.agentStatus);
  expect(after.agentActivity).toBe(before.agentActivity);
  store.removeTerminalSession(id);
});

it('shows raw output activity only in chat mode and keeps questions and copy mode ahead of it', () => {
  const view = render(<I18nProvider><AgentSessionDot status="idle" outputActive chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.querySelector('[data-terminal-output-activity]')).not.toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="waiting" outputActive chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.querySelector('[data-terminal-output-activity]')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" outputActive inCopyMode chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.querySelector('[data-terminal-output-activity]')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" outputActive={false} chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
});

it('keeps the sidebar pulse from an explicit native working report without continuing output', () => {
  const view = render(<I18nProvider><AgentSessionDot status="idle" chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} outputActive={false} progress={{ source: 'osc7501', state: 'indeterminate', progress: null, message: 'Working', app: 'codex' }} /></I18nProvider>);
  expect(view.container.querySelector('[data-terminal-output-activity]')).not.toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} outputActive={false} progress={{ source: 'osc7501', state: 'remove', progress: null, app: 'codex' }} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
});

it('removes native completion attention after acknowledgement without hiding questions', () => {
  const progress = { source: 'osc7501' as const, state: 'done' as const, progress: null, message: 'Completed', reviewed: true };
  const view = render(<AgentTabIcon sessionMode="shell" state={{ agentStatus: 'idle', tuiProgress: progress }} />);
  expect(screen.queryByTitle('Completed')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" progress={progress} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" progress={{ ...progress, state: 'blocked', message: 'Question' }} /></I18nProvider>);
  expect(screen.getByTitle('Question')).toBeTruthy();
});

it('uses actual chat messages for unread attention instead of terminal completion', () => {
  const empty = { mode: true, index: { conversationId: 'chat', messageIds: [] }, unreadIds: [] };
  const view = render(<AgentTabIcon sessionMode="shell" state={{ agentStatus: 'done', agentNeedsReview: true, chatAttention: empty, tuiProgress: { source: 'osc7501', state: 'done', progress: null, message: 'Native completion' } }} />);
  expect(screen.queryByTitle('Native completion')).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="done" needsReview chatAttention={empty} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="working" chatAttention={{ ...empty, index: { conversationId: 'chat', messageIds: ['new'] }, unreadIds: ['new'] }} /></I18nProvider>);
  expect(view.container.firstChild).not.toBeNull();
  expect(view.container.firstChild).toHaveProperty('title', '1 unread messages');
});

it('shows the shared unread yellow dot even before a background conversation was mounted', () => {
  const chatAttention = { mode: false, index: { conversationId: 'chat', messageIds: ['reply'], viewedMessageIds: [] }, unreadIds: ['reply'] };
  const view = render(<I18nProvider><AgentSessionDot status={null} chatAttention={chatAttention} /></I18nProvider>);
  expect(screen.getByTitle('1 unread messages')).toBeTruthy();
  view.rerender(<I18nProvider><AgentSessionDot status={null} chatAttention={{ ...chatAttention, index: { ...chatAttention.index, viewedMessageIds: ['reply'] }, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
});

it('does not mistake terminal output for Agent work before chat metadata or after switching to terminal', () => {
  const view = render(<I18nProvider><AgentSessionDot status="idle" outputActive /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" outputActive chatAttention={{ mode: false, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" outputActive chatAttention={{ mode: true, hasMessages: true, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.querySelector('[data-terminal-output-activity]')).not.toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="idle" outputActive chatAttention={{ mode: false, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.firstChild).toBeNull();
  view.rerender(<I18nProvider><AgentSessionDot status="working" outputActive chatAttention={{ mode: false, unreadIds: [] }} /></I18nProvider>);
  expect(view.container.querySelector('.animate-pulse')).not.toBeNull();
  expect(view.container.querySelector('[data-terminal-output-activity]')).toBeNull();
});
