import fs from 'node:fs';
import { COLLECTOR_PROTOCOL_VERSION, isTodoCategory } from './types.js';
import { normalizeDailyTimes } from '../shared/dailySchedule.js';
import { canClaimTodo } from './claimEligibility.js';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { AutomationSchedule } from '../agent/automationStore.js';

export const TODO_HELP = `td todo — persistent todos on the local Termdock service
  list [--source <name> | --collector <id>] [--category short|long|delegated|uncategorized]
  sources (show source names/IDs and available counts)
  claim (--source <name> | --collector <id> | --todo <id>) [--session <id>] [--lease 30]
  renew|release <todo-id> --claim <claim-id> [--lease 30]
  add --title <title> [--description <text> | --file <path> | --stdin]
    [--source <direction>] [--external-id <stable-id>] [--url <https-url>]
    [--collector <collector-id>] [--run <run-id>] [--category short|long|delegated|uncategorized] [--idempotency-key <key>]
  update <todo-id> [--title <title>] [--description <text> | --file <path> | --stdin]
    [--category short|long|delegated|uncategorized] [--url <https-url>] [--external-id <stable-id>]
    [--collector <id>] [--run <run-id>] [--revision <n>]
  report <run-id> --status complete|blocked|failed (--content <text> | --file <path> | --stdin)
  complete|reopen|ignore <todo-id> [--collector <id>] [--run <run-id>] [--revision <n>]
  agents (list available Agent slugs and launch commands)
  collector list
  collector create --name <name> --agent <slug> [--command <launch-command>]
    (--prompt <text> | --file <UTF-8-path> | --stdin) [--cwd <path>]
    [--every <minutes> | --at HH:MM [--weekdays 0,1,...,6]] [--disabled]
  collector save (--file <source-config.json> | --stdin)
  collector schema (JSON configuration example)
  collector run|remove <collector-id> [--idempotency-key <key> for run]
  checkpoint get --collector <id> [--source-key <key>]
  collector inspect <run-id>
  collector finish <run-id> --revision <n> (--file <outcome.json> | --stdin) [--idempotency-key <key>]
  collector retry <run-id> --revision <n> --idempotency-key <new-key>
  collector cancel <run-id> --revision <n>
  --help | --json
Collectors gather actionable todos from channels, projects or other sources. Automatic handling is
OFF by default. Ask the user to confirm any unspecified source, selection scope, schedule or
execution permission BEFORE claiming tasks, enabling automatic handling, or changing triggers.
Never assume "all sources". Start with sources/list, then claim an explicitly authorized source.
Prefer --collector with the stable source ID (from sources), which survives source renaming.
claim atomically assigns one task to the current Termdock Agent (or --session), returns its
claim ID, expiry and run ID. Process only the returned todo, report results against that run,
renew before expiry during long work, and release if unable to continue. Do not act on an
expired/replaced claim. An empty claim means no available task; do not invent a different source.
To handle a source periodically, ask/confirm the frequency, then configure the existing scheduler
or have the source dispatch automatically; a one-time claim does not install a timer.
Use td automation --help for periodic work in this Agent (--self); include the exact source
and td todo claim in its prompt, and only create the schedule after confirming the interval.
collector schema shows the shared UI/API configuration. collector save creates or updates a source;
include id to update (existing fields are retained; revision prevents overwriting concurrent edits).
processing.mode: manual | new | existing; existing requires sessionId, new can specify Agent config.
session: {mode:new|reuse,targetSessionId:null|id,beforePrompt:"/clear",idleMinutes:10}; 0 disables recycling.
webhook:{enabled:true} generates a per-source Bearer credential and enables POST /hooks/todo/<id>.
Send JSON and a stable Idempotency-Key for retries. This triggers collection, not arbitrary commands.
Choose the new/existing automatic handler only with the user's authorization; automatic new creates
one Agent session per new todo. UI and CLI share the same persisted source configuration.
Before creating a collector, use collector list to check existing directions and agents to choose
an installed Agent. Base the collection requirements on the conversation: sources/access,
selection criteria, context, source links and stable external IDs to avoid duplicates.
--command defaults to the selected Agent's launch command; --cwd defaults to the CLI directory.
No schedule means manual collection. --every uses whole minutes (1–43200); --at uses the server
timezone (e.g. --at 09:00,14:00,20:00); weekdays: 0=Sunday through 6=Saturday (default: every day). Scheduled collectors repeat
while enabled and the service runs, even with the browser closed. Creation saves configuration;
it does not immediately collect. Follow the user's requested frequency; if unspecified, save as manual.
Example: td todo collector create --name '项目巡检' --agent codex --every 1440 --file collect.txt
Collector execution is scoped by the server to its recorded session and stable collector ID.
Collector mutations require --collector and --run <active-run-id> matching that namespace; ownership mismatches are rejected.
Checkpoint commits are explicit successful collector finish operations; text reports never advance them.
One active run per collector; different keys while busy return 409 COLLECTOR_BUSY with activeRunId.
A restart leaves an interrupted run to inspect; close its terminal before owner retry/cancel.
Legacy CLIs without caller context must upgrade before writing; current manual CLI commands remain supported.
External IDs deduplicate within a source; repeated add never overwrites existing content.
Use update to edit an existing ID. Supply the revision observed during collection to reject stale
edits (409 includes currentRevision); without --revision, update reads the latest revision before writing.
An external ID change must remain unique within its collector/source. Empty --description=, --url=
or --external-id= clears that field; --category uncategorized clears the classification.
Reports attach to the exact execution run;
only complete marks a todo completed. An Agent report never accepts a todo for the user.
Use the running local service (same OS user); no unauthenticated HTTP fallback.`;
export interface TodoCommand { action: 'help' | 'list' | 'add' | 'update' | 'report' | 'complete' | 'reopen' | 'ignore' | 'agents' | 'collector' | 'checkpoint' | 'sources' | 'claim' | 'renew' | 'release'; id?: string; collectorAction?: 'list' | 'create' | 'save' | 'schema' | 'run' | 'remove' | 'inspect' | 'finish' | 'retry' | 'cancel'; schedule?: AutomationSchedule; options: Record<string, string | boolean> }
export function parseTodoCommand(argv: string[]): TodoCommand {
  const positional: string[] = [], options: TodoCommand['options'] = {};
  const values = ['title', 'description', 'file', 'source', 'external-id', 'url', 'collector', 'idempotency-key', 'status', 'content', 'name', 'agent', 'command', 'cwd', 'prompt', 'every', 'at', 'weekdays', 'todo', 'session', 'claim', 'lease', 'category', 'revision', 'run', 'source-key'];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, ...inline] = arg.slice(2).split('=');
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option --${key}`);
    if (['help', 'json', 'stdin', 'disabled'].includes(key)) { if (inline.length) throw new Error(`--${key} takes no value`); options[key] = true; }
    else if (values.includes(key)) { const value = inline.length ? inline.join('=') : argv[++i]; if (value === undefined || (!value && !['description', 'url', 'external-id'].includes(key)) || (!inline.length && value.startsWith('--'))) throw new Error(`--${key} requires a value`); options[key] = value; }
    else throw new Error(`Unknown option --${key}`);
  }
  const action = (options.help ? 'help' : positional.shift() ?? 'help') as TodoCommand['action'];
  if (!['help', 'list', 'add', 'update', 'report', 'complete', 'reopen', 'ignore', 'agents', 'collector', 'checkpoint', 'sources', 'claim', 'renew', 'release'].includes(action)) throw new Error('See td todo --help');
  if (action === 'help') return { action, options };
  if (action === 'checkpoint') {
    if (positional.shift() !== 'get' || positional.length || !options.collector) throw new Error('checkpoint get requires --collector');
    for (const key of Object.keys(options)) if (!['collector', 'source-key', 'json'].includes(key)) throw new Error(`--${key} is not supported by checkpoint get`);
    return { action, options };
  }
  if (action === 'collector') {
    const collectorAction = positional.shift();
    const id = ['run', 'remove', 'inspect', 'finish', 'retry', 'cancel'].includes(collectorAction ?? '') ? positional.shift() : undefined;
    if (!['list', 'create', 'save', 'schema', 'run', 'remove', 'inspect', 'finish', 'retry', 'cancel'].includes(collectorAction ?? '') || positional.length || ['run', 'remove', 'inspect', 'finish', 'retry', 'cancel'].includes(collectorAction ?? '') && !id) throw new Error('See td todo collector --help');
    const allowed = ['list', 'schema', 'remove', 'inspect'].includes(collectorAction!) ? ['json'] : collectorAction === 'run' ? ['json', 'idempotency-key'] : ['finish', 'retry', 'cancel'].includes(collectorAction!) ? ['json', 'revision', ...(collectorAction === 'cancel' ? [] : ['idempotency-key']), ...(collectorAction === 'finish' ? ['file', 'stdin'] : [])] : collectorAction === 'save' ? ['json', 'file', 'stdin'] : ['json', 'name', 'agent', 'command', 'cwd', 'prompt', 'file', 'stdin', 'every', 'at', 'weekdays', 'disabled'];
    for (const flag of Object.keys(options)) if (!allowed.includes(flag)) throw new Error(`--${flag} is not supported by collector ${collectorAction}`);
    const command: TodoCommand = { action, collectorAction: collectorAction as TodoCommand['collectorAction'], id, options };
    if (['finish', 'retry', 'cancel'].includes(collectorAction!)) {
      if (!/^[1-9]\d*$/.test(String(options.revision ?? '')) || !Number.isSafeInteger(Number(options.revision))) throw new Error('--revision is required and must be a positive integer');
      if (collectorAction === 'finish' && ['file', 'stdin'].filter(k => options[k]).length !== 1) throw new Error('collector finish requires --file or --stdin');
      if (collectorAction === 'retry' && !options['idempotency-key']) throw new Error('collector retry requires a new --idempotency-key');
      return command;
    }
    if (collectorAction === 'save') { if (['file', 'stdin'].filter(key => options[key]).length !== 1) throw new Error('collector save requires --file or --stdin'); return command; }
    if (collectorAction !== 'create') return command;
    if (!String(options.name ?? '').trim() || !String(options.agent ?? '').trim()) throw new Error('collector create requires --name and --agent');
    if (['prompt', 'file', 'stdin'].filter(key => options[key]).length !== 1) throw new Error('Choose one collection prompt input: --prompt, --file or --stdin');
    if (options.every && options.at) throw new Error('Choose --every or --at');
    if (options.weekdays && !options.at) throw new Error('--weekdays requires --at');
    if (options.every) {
      const minutes = Number(options.every);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200) throw new Error('--every must be an integer from 1 to 43200');
      command.schedule = { kind: 'interval', everyMinutes: minutes };
    } else if (options.at) {
      const times = normalizeDailyTimes(String(options.at).split(',').map(time => time.trim()));
      if (!times) throw new Error('--at must be HH:MM or comma-separated times');
      if (options.weekdays && !/^[0-6](,[0-6])*$/.test(String(options.weekdays))) throw new Error('--weekdays must be comma-separated numbers 0–6');
      command.schedule = { kind: 'daily', time: times[0], ...(times.length > 1 ? { times } : {}), weekdays: options.weekdays ? [...new Set(String(options.weekdays).split(',').map(Number))] : [0, 1, 2, 3, 4, 5, 6] };
    }
    return command;
  }
  const allowed: Record<string, string[]> = { list: ['source', 'collector', 'category'], sources: [], claim: ['source', 'collector', 'todo', 'session', 'lease', 'idempotency-key'], renew: ['claim', 'lease'], release: ['claim'], agents: [], add: ['run', 'title', 'description', 'file', 'stdin', 'source', 'external-id', 'url', 'collector', 'idempotency-key', 'category'], update: ['run', 'collector', 'title', 'description', 'file', 'stdin', 'category', 'url', 'external-id', 'revision'], report: ['status', 'content', 'file', 'stdin'], complete: ['collector', 'revision', 'run'], reopen: ['collector', 'revision', 'run'], ignore: ['collector', 'revision', 'run'] };
  for (const flag of Object.keys(options)) if (flag !== 'json' && !allowed[action].includes(flag)) throw new Error(`--${flag} is not supported by ${action}`);
  const id = !['list', 'add', 'agents', 'sources', 'claim'].includes(action) ? positional.shift() : undefined;
  if ((!['list', 'add', 'agents', 'sources', 'claim'].includes(action) && !id) || positional.length) throw new Error('Invalid arguments; see td todo --help');
  if (action === 'claim' && !['source', 'collector', 'todo'].some(k => String(options[k] ?? '').trim())) throw new Error('Confirm the source with the user, then specify --source, --collector or --todo');
  if (['renew', 'release'].includes(action) && !options.claim) throw new Error('--claim is required');
  if (options.lease && (!Number.isInteger(Number(options.lease)) || Number(options.lease) < 1 || Number(options.lease) > 1440)) throw new Error('--lease must be whole minutes from 1 to 1440');
  if (options.category !== undefined && !isTodoCategory(options.category)) throw new Error('--category must be short, long, delegated or uncategorized');
  if (options.revision !== undefined && (!/^[1-9]\d*$/.test(String(options.revision)) || !Number.isSafeInteger(Number(options.revision)))) throw new Error('--revision must be a positive integer');
  if (action === 'update' && !['title', 'description', 'file', 'stdin', 'category', 'url', 'external-id'].some(k => Object.hasOwn(options, k))) throw new Error('update requires at least one field');
  if (action === 'add' && !options.title) throw new Error('--title is required');
  if (['description', 'content', 'file', 'stdin'].filter(k => Object.hasOwn(options, k)).length > 1) throw new Error('Choose one content input');
  if (action === 'report' && (!['complete', 'blocked', 'failed'].includes(String(options.status)) || !['content', 'file', 'stdin'].some(k => options[k]))) throw new Error('report requires --status and content');
  return { action, id, options };
}
export async function executeTodoCommand(command: TodoCommand, io: {
  request(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<{ statusCode: number; body: string }>;
  self?(): Promise<string>; stdin(): Promise<string>; write(line: string): void;
}): Promise<number> {
  try {
    if (command.action === 'help') { io.write(TODO_HELP); return 0; }
    const base = '/api/terminal/operations/todos', o = command.options;
    if (command.action === 'collector' && command.collectorAction === 'schema') {
      io.write(JSON.stringify({ name: '项目巡检', config: { agentSlug: 'codex', command: 'codex', cwd: process.cwd(), prompt: '收集可执行事项，保留来源与稳定标识，不直接执行' },
        enabled: true, schedule: null, session: { mode: 'reuse', targetSessionId: null, beforePrompt: '/clear', idleMinutes: 10 },
        processing: { mode: 'manual', sessionId: null, config: null, note: '' }, webhook: { enabled: false } }, null, 2)); return 0;
    }
    const request = async (method: 'GET' | 'POST', suffix = '', body?: unknown) => { const response = await io.request(method, base + suffix, body); const data = JSON.parse(response.body); if (response.statusCode < 200 || response.statusCode >= 300) throw Object.assign(new Error(data.error || 'Todo request failed'), { currentRevision: data.currentRevision, code: data.code, activeRunId: data.activeRunId }); return data; };
    const content = o.file ? fs.readFileSync(String(o.file), 'utf8') : o.stdin ? await io.stdin() : String(o.content ?? o.description ?? '');
    const needsCollectionProtocol = command.action === 'checkpoint' || command.action === 'collector' && ['run', 'inspect', 'finish', 'retry', 'cancel'].includes(command.collectorAction!)
      || !!o.run || !!o.collector && ['add', 'update', 'complete', 'ignore', 'reopen'].includes(command.action);
    if (needsCollectionProtocol && (await request('GET', '/summary')).collectorProtocolVersion !== COLLECTOR_PROTOCOL_VERSION) throw new Error('请将 CLI 与服务端一起升级到 1.4.386 或更新版本；旧服务不支持收集轮次与 checkpoint 门禁');
    let result;
    if (command.action === 'checkpoint') {
      result = await request('GET', `/collectors/${encodeURIComponent(String(o.collector))}/checkpoints${o['source-key'] ? `?sourceKey=${encodeURIComponent(String(o['source-key']))}` : ''}`);
    } else if (command.action === 'collector' && command.collectorAction === 'inspect') {
      result = await request('GET', `/runs/${encodeURIComponent(command.id!)}`);
    } else if (command.action === 'collector' && command.collectorAction === 'finish') {
      const outcome = JSON.parse(content);
      const idempotencyKey = o['idempotency-key'] || `finish:${command.id}:${createHash('sha256').update(JSON.stringify(outcome)).digest('hex')}`;
      result = await request('POST', `/runs/${encodeURIComponent(command.id!)}/finish`, { ...outcome, revision: Number(o.revision), idempotencyKey });
    } else if (command.action === 'collector' && ['retry', 'cancel'].includes(command.collectorAction!)) {
      result = await request('POST', `/runs/${encodeURIComponent(command.id!)}/${command.collectorAction}`, { revision: Number(o.revision), ...(command.collectorAction === 'retry' ? { idempotencyKey: o['idempotency-key'] } : {}) });
    } else if (command.action === 'agents') {
      const response = await io.request('GET', '/api/terminal/agent-launchers');
      result = JSON.parse(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(result.error || 'Agent request failed');
    } else if (command.action === 'collector' && command.collectorAction === 'list') {
      result = { collectors: (await request('GET')).collectors };
    } else if (command.action === 'collector' && command.collectorAction === 'save') {
      const input = JSON.parse(content);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Source config must be a JSON object');
      let body = input;
      if (input.id) {
        const existing = (await request('GET')).collectors.find((c: { id: string }) => c.id === input.id);
        if (!existing) throw new Error('Collector not found');
        body = { ...existing, ...input, revision: input.revision ?? existing.revision,
          ...Object.fromEntries(['config', 'session', 'processing', 'webhook'].filter(key => input[key] !== undefined).map(key => [key, { ...existing[key], ...input[key] }])) };
      }
      result = await request('POST', '/collectors', body);
    } else if (command.action === 'collector' && command.collectorAction === 'run') {
      result = await request('POST', `/collectors/${encodeURIComponent(command.id!)}/run`, { idempotencyKey: o['idempotency-key'] || randomUUID() });
    } else if (command.action === 'collector' && command.collectorAction === 'remove') {
      const collector = (await request('GET')).collectors.find((c: { id: string }) => c.id === command.id);
      if (!collector) throw new Error('Collector not found');
      result = await request('POST', `/collectors/${encodeURIComponent(command.id!)}/remove`, { revision: collector.revision });
    } else if (command.action === 'collector') {
      const prompt = o.file ? content : o.stdin ? content : String(o.prompt ?? '');
      if (!prompt.trim()) throw new Error('Collection prompt must not be empty');
      let launchCommand = String(o.command ?? '');
      if (!launchCommand) {
        const response = await io.request('GET', '/api/terminal/agent-launchers');
        const data = JSON.parse(response.body);
        if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(data.error || 'Agent request failed');
        const agent = data.agents.find((item: { slug: string }) => item.slug === o.agent);
        if (!agent) throw new Error('Agent not available; use td todo agents');
        launchCommand = agent.command;
      }
      result = await request('POST', '/collectors', { name: o.name,
        config: { agentSlug: o.agent, command: launchCommand, cwd: path.resolve(String(o.cwd ?? process.cwd())), prompt },
        enabled: !o.disabled, schedule: command.schedule ?? null });
    } else if (command.action === 'sources') {
      const snapshot = await request('GET');
      const groups = new Map<string, { id: string | null; source: string; open: number; available: number }>();
      for (const collector of snapshot.collectors) groups.set(`collector:${collector.id}`, { id: collector.id, source: collector.name, open: 0, available: 0 });
      for (const todo of snapshot.todos) {
        const key = todo.collectorId ? `collector:${todo.collectorId}` : `source:${todo.source}`;
        const entry = groups.get(key) ?? { id: todo.collectorId, source: todo.source, open: 0, available: 0 };
        if (todo.status === 'open') { entry.open++; if (canClaimTodo(todo, snapshot.runs)) entry.available++; }
        groups.set(key, entry);
      }
      result = { sources: [...groups.values()] };
    } else if (command.action === 'claim') result = await request('POST', '/claim', { source: o.source, collectorId: o.collector, todoId: o.todo,
      sessionId: o.session || (io.self ? await io.self() : undefined), backendSessionId: !o.session && !io.self ? process.env.TERMDOCK_BACKEND_SESSION_ID : undefined,
      leaseMinutes: Number(o.lease ?? 30), requestId: o['idempotency-key'] || randomUUID() });
    else if (command.action === 'renew') result = await request('POST', `/${encodeURIComponent(command.id!)}/renew`, { claimId: o.claim, minutes: Number(o.lease ?? 30) });
    else if (command.action === 'release') {
      const todo = (await request('GET')).todos.find((t: { id: string }) => t.id === command.id);
      if (!todo) throw new Error('Todo not found');
      result = await request('POST', `/${encodeURIComponent(command.id!)}/release`, { claimId: o.claim, revision: todo.revision });
    } else if (command.action === 'list') {
      result = await request('GET', o.collector ? `?collectorId=${encodeURIComponent(String(o.collector))}` : '');
      result.todos = result.todos.filter((t: { source: string; collectorId: string; category?: string }) => (!o.source || t.source === o.source) && (!o.collector || t.collectorId === o.collector) && (!o.category || (t.category ?? 'uncategorized') === o.category));
    }
    else if (command.action === 'add') result = await request('POST', '', { title: o.title, description: content, source: o.source || (o.collector ? undefined : '外部注入'), sourceUrl: o.url, category: o.category, externalId: o['external-id'], collectorId: o.collector, runId: o.run, idempotencyKey: o['idempotency-key'] || randomUUID() });
    else if (command.action === 'update') {
      const revision = o.revision !== undefined ? Number(o.revision) : (await request('GET')).todos.find((t: { id: string }) => t.id === command.id)?.revision;
      if (revision === undefined) throw new Error('Todo not found');
      const fields = Object.fromEntries(['collector', 'run', 'title', 'category', 'url', 'external-id'].filter(k => Object.hasOwn(o, k)).map(k => [k === 'collector' ? 'collectorId' : k === 'run' ? 'runId' : k === 'url' ? 'sourceUrl' : k === 'external-id' ? 'externalId' : k, o[k]]));
      if (['description', 'file', 'stdin'].some(k => Object.hasOwn(o, k))) fields.description = content;
      result = await request('POST', `/${encodeURIComponent(command.id!)}`, { ...fields, revision });
    }
    else if (command.action === 'report') result = await request('POST', `/runs/${encodeURIComponent(command.id!)}/report`, { status: o.status, content });
    else {
      const revision = o.revision !== undefined ? Number(o.revision) : (await request('GET')).todos.find((t: { id: string }) => t.id === command.id)?.revision;
      if (revision === undefined) throw new Error('Todo not found');
      result = await request('POST', `/${encodeURIComponent(command.id!)}`, { revision, ...(o.collector ? { collectorId: o.collector } : {}), ...(o.run ? { runId: o.run } : {}), status: command.action === 'complete' ? 'completed' : command.action === 'ignore' ? 'ignored' : 'open' });
    }
    io.write(JSON.stringify(result)); return 0;
  } catch (error) { io.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), ...(error instanceof Error && 'currentRevision' in error && error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}), ...(error instanceof Error && 'code' in error && error.code ? { code: error.code } : {}), ...(error instanceof Error && 'activeRunId' in error && error.activeRunId ? { activeRunId: error.activeRunId } : {}) })); return 1; }
}
