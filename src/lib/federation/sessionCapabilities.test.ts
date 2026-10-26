import { expect, it } from 'vitest';
import { sharedResourceTabs, sharedSessionCapabilities } from './sessionCapabilities';
it('starts shared access empty and enables only explicitly granted session capabilities', () => {
  expect([...sharedSessionCapabilities(undefined)]).toEqual([]);
  expect([...sharedSessionCapabilities({})]).toEqual(['session.view', 'session.chat-view', 'session.terminal-view']);
  expect([...sharedSessionCapabilities({ canWrite: true, canResize: true })]).toEqual(['session.view', 'session.chat-view', 'session.terminal-view', 'session.chat-send', 'session.input', 'session.resize']);
  expect([...sharedSessionCapabilities({ canWrite: 'true', canResize: 1 } as never)]).toEqual(['session.view', 'session.chat-view', 'session.terminal-view']);
});
it('separates chat sending, terminal viewing and local display clearing without inheriting terminal control', () => {
  const chat = sharedSessionCapabilities({ canViewChat: true, canViewTerminal: false, canSendChat: true, canClearChat: false });
  expect(chat.has('session.chat-send')).toBe(true);
  expect(chat.has('session.terminal-view')).toBe(false); expect(chat.has('session.input')).toBe(false); expect(chat.has('session.chat-clear')).toBe(false);
  const preview = sharedSessionCapabilities({ canViewChat: false, canViewTerminal: true, canClearChat: true });
  expect(preview.has('session.terminal-view')).toBe(true); expect(preview.has('session.chat-view')).toBe(false);
  expect(preview.has('session.chat-clear')).toBe(true); expect(preview.has('session.input')).toBe(false);
});
it('does not inherit owner or newly added capabilities from writable shares', () => {
  const capabilities = sharedSessionCapabilities({ canWrite: true, canResize: true, 'service:*': true, 'todo.guidance': true } as never);
  for (const capability of ['session.owner-menu', 'session.share', 'todo.guidance', 'future.feature', 'service:*']) expect(capabilities.has(capability as never)).toBe(false);
});
it('opens only named resource kinds in the shared resource grant', () => {
  const resources = { android: [{ serial: 'fixture', access: 'view' as const }], directories: [{ path: '/shared', access: 'read' as const }], future: [{}] };
  expect(sharedResourceTabs(resources)).toEqual(['android', 'files']);
  expect([...sharedSessionCapabilities(undefined, resources)]).toEqual(['resource.android', 'resource.files']);
});
