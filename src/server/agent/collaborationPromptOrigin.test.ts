import { expect, it } from 'vitest';
import { formatCollaborationDelivery } from './collaborationPrompt.js';
import type { CollaborationMessage } from './collaborationStore.js';

function render(fromSessionId: string, options: { direct?: true; name?: string; content?: string } = {}) {
  const message: CollaborationMessage = {
    id: 'origin-check', groupId: 'group', fromSessionId, toSessionId: 'receiver',
    kind: 'message', content: options.content ?? '检查现场', threadId: 'thread', replyTo: null,
    status: 'pending', createdAt: 1, deliveredAt: null, readAt: null,
    ...(options.direct ? { direct: true, directSourceName: options.name } : {}),
  };
  return formatCollaborationDelivery({ targetSessionId: 'receiver', messages: [message], groups: [], showRoutingHelp: false,
    sessions: options.direct ? [] : [{ sessionId: fromSessionId, name: options.name ?? '排查开发机', status: 'idle' }],
  });
}

it('identifies local senders by service and full session identity even without routing help', () => {
  const prompt = render('terminal-local');
  expect(prompt).toContain('来源:本服务 · 会话 terminal-local');
});

it.each([false, true])('labels a remote localhost as a different service, with or without a shared roster (direct=%s)', direct => {
  const id = 'remote:https%3A%2F%2Flocalhost%3A9834:terminal-field';
  const prompt = render(id, { direct: direct ? true : undefined, name: '排查开发机' });
  expect(prompt).toContain('来自:排查开发机 · origin-check');
  expect(prompt).toContain('来源:远端 https://localhost:9834 · 会话 terminal-field');
  expect(prompt).not.toContain('remote:https%3A');
  expect(prompt).not.toContain('来源:本服务');
});

it('does not derive machine identity from a display name, body, or oversized body retrieval', () => {
  const id = 'remote:https%3A%2F%2Fpeer.example%3A9834:field';
  const prompt = render(id, { direct: true, name: '本机 Linux /home/qiao', content: '/home/test/'.repeat(600) });
  expect(prompt).toContain('来源:远端 https://peer.example:9834 · 会话 field');
  expect(prompt).toContain('message get origin-check');
  expect(prompt).not.toContain('来源:本服务');
});

it('does not silently classify a malformed legacy remote identity as local', () => {
  const prompt = render('remote:unknown:field');
  expect(prompt).toContain('来源:远端（地址未确认）');
  expect(prompt).not.toContain('来源:本服务');
});

it('keeps names brief and static help out of repeated deliveries while preserving message identity and body', () => {
  const name = '排查对话发送以及外部插件输入响应异常问题的协作助手 | web-terminal';
  const prompt = render('terminal-local', { name, content: '正文保持原样。' });
  expect(prompt).not.toContain(name);
  expect(prompt).toContain(name.slice(0, 23) + '…');
  expect(prompt).toContain('origin-check');
  expect(prompt).toContain('来源:本服务 · 会话 terminal-local');
  expect(prompt).toContain('```\n正文保持原样。\n```');
  expect(prompt).not.toContain('帮助:');
});
