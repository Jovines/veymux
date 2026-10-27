import { Terminal } from 'lucide-react';
import type { TodoRun } from '../../todos/api';
import { todoSecondary } from './TodoForms';
export const todoTime = (time: number) => {
  const date = new Date(time), now = new Date(), today = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('zh-CN', { ...(today ? {} : { month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) }), hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
export const todoRunLabel: Record<TodoRun['status'], string> = { launching: '正在准备终端', delivered: '任务已发送到终端', complete: '已收到结果，待你确认', blocked: 'Agent 需要你协助', failed: '启动或处理失败' };
export function TodoRunCard({ run, onOpen, onRetry, onCancel, busy }: { run: TodoRun; onOpen: () => void; onRetry?: () => void; onCancel?: () => void; busy?: boolean }) {
  const interrupted = run.collection?.state === 'interrupted';
  const state = interrupted ? '本轮结果待核对' : run.collection?.state === 'active' && run.status === 'delivered' ? '等待本轮结果' : run.collection?.state === 'partial' ? '来源覆盖不完整' : run.status === 'complete' ? '已收到结果报告' : todoRunLabel[run.status];
  return <article className="rounded-xl border border-border/30 bg-surface p-4">
    <div className="flex flex-wrap items-center gap-2"><span className={`min-w-0 flex-1 text-sm font-medium ${run.status === 'complete' ? 'text-primary' : run.status === 'failed' || run.status === 'blocked' ? 'text-destructive' : ''}`}>{state}</span>{run.sessionId && !run.collectionSession?.recycledAt && <button type="button" className={todoSecondary} disabled={busy} onClick={onOpen}><Terminal size={15} />打开终端</button>}</div>
    <p className="mt-1 text-xs leading-6 text-muted-foreground">{run.config.agentSlug} · {todoTime(run.createdAt)}</p>
    {run.collectionSession?.recycledAt && <p className="mt-2 text-xs leading-6 text-muted-foreground">终端因持续无输出已回收 · {todoTime(run.collectionSession.recycledAt)}</p>}
    {run.status === 'delivered' && !run.collectionSession?.recycledAt && !run.result && <p className="mt-2 text-xs leading-6 text-muted-foreground">打开终端查看输出，或处理 Agent 的登录与授权。明确结果报告会显示在这里。</p>}
    {run.error && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-destructive">{run.error}</p>}
    {run.result && <div className="termdock-native-select mt-3 whitespace-pre-wrap break-words border-t border-border/20 pt-3 text-sm leading-7">{run.result}</div>}
    {interrupted && <p className="mt-2 text-xs leading-6 text-muted-foreground">先核对并关闭原终端，再重试或结束本轮。</p>}
    {(onRetry || onCancel) && <div className="mt-3 flex flex-wrap gap-2">{onRetry && <button type="button" className={todoSecondary} disabled={busy} onClick={onRetry}>重试收集</button>}{onCancel && <button type="button" className={todoSecondary} disabled={busy} onClick={onCancel}>结束此轮</button>}</div>}
    {run.trigger && <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">本轮触发 · {({ manual: '手动', schedule: '定时', webhook: '外部通知' })[run.trigger.triggerType]}</summary><p className="break-words leading-6">{run.trigger.timezone} · {todoTime(run.trigger.scheduledAt ?? run.trigger.receivedAt)}</p>{run.trigger.payload !== undefined && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3">{JSON.stringify(run.trigger.payload, null, 2)}</pre>}</details>}
    {run.collection?.outcome && <details className="mt-1 text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">声明的来源覆盖</summary><ul className="space-y-2">{run.collection.outcome.coverage.map(source => <li key={source.sourceKey} className="break-words leading-6">{source.sourceKey} · {({ success: '已声明完整', partial: '部分覆盖', failed: '读取失败' })[source.status]}{source.note ? ` · ${source.note}` : ''}</li>)}</ul>{run.collection.outcome.checkpoints?.length ? <p className="mt-2 leading-6">已提交 {run.collection.outcome.checkpoints.length} 个来源的扫描位置</p> : null}</details>}
  </article>;
}
