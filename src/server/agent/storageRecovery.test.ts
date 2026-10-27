// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollaborationTaskStore } from './collaborationTaskStore.js';
import { TodoStore } from '../todos/store.js';
import { CollaborationStore } from './collaborationStore.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veymux-recovery-capacity-')); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });
const owner = `12D3KooW${'a'.repeat(40)}`;
const taskInput = { groupId: 'group', title: 'Task', spec: 'Work', idempotencyKey: 'original-request' };
const config = { agentSlug: 'fixture', command: 'fixture', cwd: '/tmp', prompt: 'Original work' };

it('keeps task close and delivery receipts writable while new tasks are capacity-blocked', () => {
  const file = path.join(dir, 'tasks.json'), initial = new CollaborationTaskStore(file);
  const task = initial.create(owner, { ...taskInput, assignee: { serviceId: owner, sessionId: 'worker' } }, null);
  const store = new CollaborationTaskStore(file, { maxBytes: 1 });
  expect(() => store.create(owner, { ...taskInput, idempotencyKey: 'new-request' }, null)).toThrow(expect.objectContaining({ code: 'TASK_STORAGE_FULL' }));
  const delivery = store.pending()[0]!;
  store.delivered(delivery.id, { messageId: 'original-message', status: 'delivered', deliveredAt: 123, error: null });
  const current = store.get(task.id)!;
  store.apply(task.id, { kind: 'close', expectedRevision: current.revision, idempotencyKey: 'original-close' }, null);
  const restarted = new CollaborationTaskStore(file);
  expect(restarted.get(task.id)).toMatchObject({ id: task.id, status: 'closed' });
  expect(restarted.pending()).toEqual([]);
  expect(restarted.create(owner, { ...taskInput, assignee: { serviceId: owner, sessionId: 'worker' } }, null).id).toBe(task.id);
});

it('fsyncs the task decision and outbox before notifying, and never commits a failed decision', () => {
  const file = path.join(dir, 'tasks.json'), store = new CollaborationTaskStore(file), changed = vi.fn(); store.subscribe(changed);
  vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('flush failed'); });
  expect(() => store.create(owner, taskInput, null)).toThrow('flush failed'); expect(store.snapshot()).toEqual([]); expect(changed).not.toHaveBeenCalled();
  vi.restoreAllMocks(); const fsync = vi.spyOn(fs, 'fsyncSync'); let callsAtNotify = 0;
  store.subscribe(() => { callsAtNotify = fsync.mock.calls.length; });
  const task = store.create(owner, taskInput, null);
  expect(callsAtNotify).toBeGreaterThanOrEqual(2); expect(new CollaborationTaskStore(file).get(task.id)?.id).toBe(task.id);
});

it('reconciles an interrupted Todo launch at startup even above its quota without replaying it', () => {
  const file = path.join(dir, 'todos.json'), initial = new TodoStore(file);
  const todo = initial.create({ title: 'Original', idempotencyKey: 'original' }), run = initial.begin('execute', todo.id, config, 'run-original').run;
  const store = new TodoStore(file, { maxBytes: 1 });
  expect(store.run(run.id)).toMatchObject({ id: run.id, status: 'failed' });
  expect(store.begin('execute', todo.id, config, 'run-original')).toMatchObject({ fresh: false, run: { id: run.id, status: 'failed' } });
  expect(() => store.create({ title: 'New', idempotencyKey: 'new' })).toThrow('容量');
  expect(store.update(todo.id, { revision: store.get(todo.id).revision, status: 'completed' }).status).toBe('completed');
  expect(new TodoStore(file).create({ title: 'Original', idempotencyKey: 'original' }).id).toBe(todo.id);
});

it('keeps bounded Todo result and delivery outcomes while blocking new content or launches', () => {
  const file = path.join(dir, 'todos.json'), initial = new TodoStore(file), todo = initial.create({ title: 'Original' });
  const run = initial.begin('execute', todo.id, config, 'original-run').run; initial.mark(run.id, { status: 'delivered', sessionId: 'original-session' });
  const store = new TodoStore(file, { maxBytes: 1 });
  expect(() => store.update(todo.id, { revision: store.get(todo.id).revision, description: 'New content' })).toThrow('容量');
  expect(() => store.begin('execute', todo.id, config, 'new-launch')).toThrow('容量');
  store.report(run.id, 'complete', 'Original result');
  expect(new TodoStore(file).run(run.id)).toMatchObject({ status: 'complete', sessionId: 'original-session', result: 'Original result' });
});

it('bounds settled message history by bytes without removing pending messages or unexpired idempotency receipts', () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const file = path.join(dir, 'messages.json'), store = new CollaborationStore(file, undefined, { historyBytes: 700 });
  const group = store.save({ name: 'Group', sessionIds: ['sender', 'recipient'] });
  const sent = (key?: string) => store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['recipient'], kind: 'message', content: 'x'.repeat(400), idempotencyKey: key })[0]!;
  const pending = sent(), old = sent(); store.markDelivered([old.id]);
  expect(store.receipt(old.id).status).toBe('delivered');
  vi.advanceTimersByTime(5 * 60_000 + 1);
  const protectedMessage = sent('original-key'); store.markDelivered([protectedMessage.id]);
  expect(store.getMessage(pending.id)?.status).toBe('pending'); expect(store.getMessage(protectedMessage.id)?.id).toBe(protectedMessage.id);
  expect(store.getMessage(old.id)).toBeNull();
  expect(sent('original-key').id).toBe(protectedMessage.id);
});

it('rejects new messages without changing their IDs/sequence or losing pending outcomes, and makes ordinary enqueue durable', () => {
  const file = path.join(dir, 'messages.json'), initial = new CollaborationStore(file);
  const group = initial.save({ name: 'Group', sessionIds: ['sender', 'recipient'] });
  const fsync = vi.spyOn(fs, 'fsyncSync');
  const [message] = initial.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['recipient'], kind: 'message', content: 'Original', idempotencyKey: 'original' });
  expect(fsync.mock.calls.length).toBeGreaterThanOrEqual(2);
  const store = new CollaborationStore(file, undefined, { maxBytes: 1 }); const before = fs.readFileSync(file);
  expect(() => store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['recipient'], kind: 'message', content: 'New', idempotencyKey: 'new' }))
    .toThrow(expect.objectContaining({ code: 'MESSAGE_STORAGE_FULL' }));
  expect(fs.readFileSync(file)).toEqual(before); store.markDelivered([message!.id]);
  expect(new CollaborationStore(file).getMessage(message!.id)).toMatchObject({ id: message!.id, status: 'delivered' });
});

it('fsyncs inbox cursor confirmation, avoids duplicate writes, and reports I/O failure without mislabeling the cursor', () => {
  const file = path.join(dir, 'messages.json'), store = new CollaborationStore(file);
  const group = store.save({ name: 'Group', sessionIds: ['sender', 'recipient'] });
  store.send({ groupId: group.id, fromSessionId: 'sender', toSessionIds: ['recipient'], kind: 'message', content: 'Original' });
  const cursor = store.page('recipient', { consumer: 'inbox' }).next_cursor;
  vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('disk flush failed'); });
  expect(() => store.commitCursor('recipient', cursor, 'inbox')).toThrow('disk flush failed');
  expect(new CollaborationStore(file).page('recipient', { consumer: 'inbox' }).messages).toHaveLength(1);
  vi.restoreAllMocks(); const fsync = vi.spyOn(fs, 'fsyncSync'); store.commitCursor('recipient', cursor, 'inbox');
  expect(fsync.mock.calls.length).toBeGreaterThanOrEqual(2);
  fsync.mockClear(); store.commitCursor('recipient', cursor, 'inbox'); expect(fsync).not.toHaveBeenCalled();
  expect(new CollaborationStore(file).page('recipient', { consumer: 'inbox' }).messages).toEqual([]);
});
