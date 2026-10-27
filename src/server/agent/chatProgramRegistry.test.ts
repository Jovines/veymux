import { afterEach, expect, it } from 'vitest';
import { agentBySlug, clearPluginAgents, detectAgentFromArgv, detectAgentFromCommand, listAgents, setChatProgramNames } from './registry';
import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionChatRoutes } from './sessionChatRoutes';
import { CollaborationStore } from './collaborationStore';
import { markEncryptedRequest } from '../federation/requestContext';

afterEach(() => setChatProgramNames([]));
it('makes configured programs usable identities for chat delivery and the launcher list', () => {
  expect(detectAgentFromCommand('my-agent --model fast')).toBeNull();
  setChatProgramNames(['my-agent', 'agent.py', 'my-agent.sh']);
  const identity = detectAgentFromCommand('/opt/bin/my-agent --model fast')!;
  expect(identity.displayName).toBe('my-agent'); expect(agentBySlug(identity.slug)).toEqual(identity);
  expect(listAgents()).toContainEqual(identity);
  expect(detectAgentFromArgv(['python3', '/opt/agent.py'])?.displayName).toBe('agent.py');
  expect(detectAgentFromCommand('bash /opt/my-agent.sh')?.displayName).toBe('my-agent.sh');
  expect(detectAgentFromCommand('python3 "/path with spaces/agent.py"')?.displayName).toBe('agent.py');
  expect(detectAgentFromCommand('cat my-agent')).toBeNull();
  clearPluginAgents(); expect(agentBySlug(identity.slug)).toEqual(identity);
  setChatProgramNames([]); expect(agentBySlug(identity.slug)).toBeNull(); expect(detectAgentFromCommand('my-agent')).toBeNull();
});
it('keeps built-in detection authoritative and rejects broad interpreter and shell rules', () => {
  setChatProgramNames(['codex', 'node', 'bash']);
  expect(detectAgentFromCommand('codex')?.slug).toBe('codex');
  expect(detectAgentFromCommand('node server.js')).toBeNull(); expect(detectAgentFromCommand('bash')).toBeNull();
});
it('enables chat submission and replies for a configured custom program through the existing pipeline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veymux-custom-chat-')), store = new CollaborationStore(join(dir, 'chat.json'));
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { markEncryptedRequest(req, 'owner'); next(); });
  const delivered: string[] = [];
  app.use(sessionChatRoutes({ store, resolve: id => id === 'custom' ? { sessionId: id, agent: detectAgentFromCommand('my-agent --fast') } : undefined, deliver: id => { delivered.push(id); } }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const url = `http://127.0.0.1:${address.port}/custom/chat`;
    expect((await fetch(url).then(response => response.json())).agentAvailable).toBe(false);
    setChatProgramNames(['my-agent']);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '检查构建', requestId: 'custom-request-00001' }) });
    expect(response.status).toBe(200); const message = await response.json(); expect(delivered).toEqual(['custom']);
    store.storeIntegrationReply(message.id, 'custom', '检查完成', { idempotencyKey: 'custom-reply-00001', responseKind: 'result' });
    const history = await fetch(url).then(response => response.json());
    expect(history.agentAvailable).toBe(true); expect(history.messages.map((entry: { role: string }) => entry.role)).toEqual(['user', 'assistant']);
  } finally { server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); }
});
