import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ALL_WEEKDAYS, nextDailyRunAt, normalizeDailyTimes, type DailySchedule } from '../shared/dailySchedule.js';

export type AutomationSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | ({ kind: 'daily' } & DailySchedule);

export interface AgentAutomation {
  id: string;
  name: string;
  enabled: boolean;
  cwd: string;
  command: string;
  prompt: string;
  targetSessionId: string | null;
  /** Captured when configured; scheduled runs have no browser preferences. */
  mode?: 'shell' | 'tmux';
  schedule: AutomationSchedule;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: 'running' | 'success' | 'failed' | null;
  lastRunMessage: string | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'failed';
  frontendSessionId: string | null;
  message: string | null;
}

interface AutomationDocument {
  version: 1;
  automations: AgentAutomation[];
  runs: AutomationRun[];
}

const MAX_RUNS = 100;

export function normalizeAutomationSchedule(value: unknown): AutomationSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'interval') {
    const everyMinutes = Number(candidate.everyMinutes);
    if (!Number.isFinite(everyMinutes) || everyMinutes < 1 || everyMinutes > 43_200) return null;
    return { kind: 'interval', everyMinutes: Math.floor(everyMinutes) };
  }
  if (candidate.kind === 'daily') {
    const times = normalizeDailyTimes(candidate.times === undefined ? [candidate.time] : candidate.times);
    if (!times) return null;
    if (candidate.weekdays !== undefined && (!Array.isArray(candidate.weekdays) || candidate.weekdays.length === 0 || !candidate.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))) return null;
    const weekdays = Array.isArray(candidate.weekdays)
      ? Array.from(new Set(candidate.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)))
      : [];
    return { kind: 'daily', time: times[0], ...(times.length > 1 ? { times } : {}), weekdays: weekdays.length > 0 ? weekdays : [...ALL_WEEKDAYS] };
  }
  return null;
}

export function nextAutomationRunAt(schedule: AutomationSchedule, now = Date.now(), createdAt = now): number {
  if (schedule.kind === 'interval') {
    const intervalMs = schedule.everyMinutes * 60_000;
    const elapsed = Math.max(0, now - createdAt);
    return createdAt + (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
  }
  return nextDailyRunAt(schedule, now);
}

export class AutomationStore {
  private document: AutomationDocument = { version: 1, automations: [], runs: [] };

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): AgentAutomation[] {
    return [...this.document.automations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listRuns(automationId?: string): AutomationRun[] {
    return this.document.runs
      .filter((run) => !automationId || run.automationId === automationId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): AgentAutomation | null {
    return this.document.automations.find((item) => item.id === id) ?? null;
  }

  save(input: {
    id?: string;
    name: string;
    enabled: boolean;
    cwd: string;
    command: string;
    prompt?: string;
    targetSessionId?: string | null;
    mode?: 'shell' | 'tmux';
    schedule: AutomationSchedule;
  }): AgentAutomation {
    const now = Date.now();
    const existing = input.id ? this.get(input.id) : null;
    const createdAt = existing?.createdAt ?? now;
    const item: AgentAutomation = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      enabled: input.enabled,
      cwd: input.cwd,
      command: input.command.trim(),
      prompt: input.prompt?.trim() ?? '',
      targetSessionId: input.targetSessionId?.trim() || null,
      mode: input.mode ?? existing?.mode ?? 'shell',
      schedule: input.schedule,
      createdAt,
      updatedAt: now,
      nextRunAt: input.enabled ? nextAutomationRunAt(input.schedule, now, createdAt) : null,
      lastRunAt: existing?.lastRunAt ?? null,
      lastRunStatus: existing?.lastRunStatus ?? null,
      lastRunMessage: existing?.lastRunMessage ?? null,
    };
    this.document.automations = existing
      ? this.document.automations.map((candidate) => candidate.id === item.id ? item : candidate)
      : [...this.document.automations, item];
    this.persist();
    return item;
  }

  remove(id: string): boolean {
    const before = this.document.automations.length;
    this.document.automations = this.document.automations.filter((item) => item.id !== id);
    if (before === this.document.automations.length) return false;
    this.persist();
    return true;
  }

  setEnabled(id: string, enabled: boolean): AgentAutomation | null {
    const automation = this.get(id);
    if (!automation) return null;
    if (automation.enabled === enabled) return automation;
    const now = Date.now();
    automation.enabled = enabled;
    automation.updatedAt = now;
    automation.nextRunAt = enabled
      ? nextAutomationRunAt(automation.schedule, now, automation.createdAt)
      : null;
    this.persist();
    return automation;
  }

  due(now = Date.now()): AgentAutomation[] {
    return this.document.automations.filter((item) => item.enabled && item.nextRunAt !== null && item.nextRunAt <= now);
  }

  beginRun(automation: AgentAutomation): AutomationRun {
    const run: AutomationRun = {
      id: crypto.randomUUID(), automationId: automation.id, startedAt: Date.now(), finishedAt: null,
      status: 'running', frontendSessionId: null, message: null,
    };
    automation.lastRunAt = run.startedAt;
    automation.lastRunStatus = 'running';
    automation.lastRunMessage = null;
    automation.nextRunAt = automation.enabled ? nextAutomationRunAt(automation.schedule, run.startedAt, automation.createdAt) : null;
    this.document.runs = [run, ...this.document.runs].slice(0, MAX_RUNS);
    this.persist();
    return run;
  }

  finishRun(runId: string, status: 'success' | 'failed', frontendSessionId: string | null, message: string | null): void {
    const run = this.document.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    run.status = status;
    run.frontendSessionId = frontendSessionId;
    run.message = message;
    run.finishedAt = Date.now();
    const automation = this.get(run.automationId);
    if (automation) {
      automation.lastRunStatus = status;
      automation.lastRunMessage = message;
      automation.updatedAt = Date.now();
    }
    this.persist();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<AutomationDocument>;
      if (!Array.isArray(raw.automations)) return;
      this.document = {
        version: 1,
        automations: raw.automations.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const candidate = item as AgentAutomation;
          const schedule = normalizeAutomationSchedule(candidate.schedule);
          if (!schedule || typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.command !== 'string') return [];
          const createdAt = Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now();
          return [{ ...candidate, createdAt, schedule, nextRunAt: candidate.enabled ? nextAutomationRunAt(schedule, Date.now(), createdAt) : null }];
        }),
        runs: Array.isArray(raw.runs) ? raw.runs.slice(0, MAX_RUNS) as AutomationRun[] : [],
      };
    } catch { /* first run or invalid old file */ }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.document, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }
}
