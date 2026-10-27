import express, { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { TodoError, type TodoStore } from './store.js';
import type { TodoRunner } from './routes.js';

/** A narrowly scoped external trigger, separate from all encrypted application APIs. */
export function createTodoWebhookRouter(store: TodoStore, runner: TodoRunner): Router {
  const router = Router(), recent = new Map<string, { since: number; count: number }>();
  router.post('/:id', (req, res, next) => {
    const address = req.socket.remoteAddress ?? '';
    if (!req.secure && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) { res.status(426).json({ error: 'Webhook requires HTTPS' }); return; }
    let secret = '';
    try { secret = store.collector(req.params.id).webhook?.secret ?? ''; } catch { /* Uniform unauthorized response. */ }
    const supplied = req.header('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1] ?? '';
    const a = Buffer.from(secret), b = Buffer.from(supplied);
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: 'Invalid webhook credential' }); return; }
    const previous = recent.get(req.params.id), now = Date.now();
    const bucket = previous && now - previous.since < 60_000 ? previous : { since: now, count: 0 };
    recent.set(req.params.id, bucket);
    if (++bucket.count > 10) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Webhook rate limit' }); return; }
    next();
  }, express.json({ limit: '32kb', type: ['application/json', 'application/*+json'] }), async (req, res) => {
    try {
      const collector = store.collector(req.params.id);
      if (!collector.enabled || !collector.webhook?.enabled) throw new TodoError('Webhook source disabled', 410);
      if (!req.is(['application/json', 'application/*+json']) || req.body === undefined) throw new TodoError('Send a JSON notification');
      const event = req.header('Idempotency-Key') ?? req.header('X-Webhook-Id') ?? req.header('X-GitHub-Delivery');
      if (!event || event.length > 120) throw new TodoError('A stable Idempotency-Key is required');
      const notification = JSON.stringify(req.body);
      if (notification.length > 16000) throw new TodoError('Notification too large', 413);
      const run = await runner.start('collect', collector.id, undefined, event, undefined, { triggerType: 'webhook', payload: req.body });
      res.status(202).json({ runId: run.id, status: run.status, state: run.collection?.state, revision: run.collection?.revision });
    } catch (error) { res.status(error instanceof TodoError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error), ...(error instanceof TodoError && error.code ? { code: error.code } : {}), ...(error instanceof TodoError && error.activeRunId ? { activeRunId: error.activeRunId } : {}) }); }
  });
  return router;
}
