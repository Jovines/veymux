import { useSessionPresentations } from '../../stores/useSessionDirectory';
import { useState } from 'react';
import { ChevronRight, LayoutDashboard, MessageCircle, Plus, Search, Settings2, Users } from 'lucide-react';
import { collaborationMemberLabel } from '../../collaboration/display';
import type { CollaborationGroup, OrchestrationSession } from '../../terminal/api';

export function CollaborationGroupLauncher({ groups, sessions: sessionFacts, busy, onOpen, onSettings, onCreate }: {
  groups: CollaborationGroup[];
  sessions: OrchestrationSession[];
  busy: boolean;
  onOpen: (id: string, view: 'tasks' | 'messages') => void;
  onSettings: (id: string, trigger: HTMLButtonElement) => void;
  onCreate: () => void;
}) {
  const sessions = useSessionPresentations(sessionFacts);
  const [query, setQuery] = useState('');
  const rows = groups.filter(group => !query.trim() || `${group.name} ${group.sessionIds.map(id => sessions.find(session => session.sessionId === id)?.displayName ?? '').join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const createButton = <button type="button" disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40" onClick={onCreate}><Plus size={17} />新建协作组</button>;
  return <section aria-label="协作组列表" className="space-y-4 font-sans">
    {!!groups.length && <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{groups.length} 个协作组</span>{createButton}</div>}
    {(groups.length > 5 || query) && <label className="relative block"><span className="sr-only">搜索协作组</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索组名或成员" className="min-h-11 w-full rounded-xl border border-border/30 bg-surface-2 py-2 pl-10 pr-3 text-sm text-foreground outline-none focus:border-primary" /></label>}
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map(group => {
        const members = group.sessionIds.flatMap(id => { const member = sessions.find(session => session.sessionId === id); return member ? [member] : []; });
        return <article key={group.id} aria-label={group.name} className="min-w-0 rounded-2xl border border-border/30 bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-primary"><Users size={21} /></span>
            <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold leading-6 text-foreground">{group.name}</h3><p className="text-xs leading-5 text-muted-foreground">{group.sessionIds.length ? `${group.sessionIds.length} 位成员` : '尚无成员'}</p></div>
            <button type="button" aria-label={`设置：${group.name}`} title="组设置" disabled={busy} className="-mr-2 -mt-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-2 disabled:opacity-40" onClick={event => onSettings(group.id, event.currentTarget)}><Settings2 size={18} /></button>
          </div>
          <div className="mt-4 flex min-h-9 flex-wrap items-center gap-1.5" aria-label="组成员">
            {members.slice(0, 4).map(member => <span key={member.sessionId} title={member.displaySubtitle || undefined} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-1 pr-2.5 text-xs text-muted-foreground"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-medium text-primary">{Array.from(member.displayName)[0]}</span><span className="truncate">{collaborationMemberLabel(member, members)}</span></span>)}
            {group.sessionIds.length > members.slice(0, 4).length && <span className="text-xs text-muted-foreground">+{group.sessionIds.length - members.slice(0, 4).length}</span>}
            {!group.sessionIds.length && <button type="button" disabled={busy} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border/50 px-3 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40" onClick={event => onSettings(group.id, event.currentTarget)}><Plus size={14} />添加成员</button>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/20 pt-3">
            <button type="button" aria-label={`成员消息：${group.name}`} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-2 px-2 text-sm text-foreground hover:bg-surface-elevated disabled:opacity-40" onClick={() => onOpen(group.id, 'messages')}><MessageCircle size={18} />成员消息<ChevronRight size={13} className="text-muted-foreground" /></button>
            <button type="button" aria-label={`看板：${group.name}`} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-2 px-2 text-sm text-foreground hover:bg-surface-elevated disabled:opacity-40" onClick={() => onOpen(group.id, 'tasks')}><LayoutDashboard size={18} />看板<ChevronRight size={13} className="text-muted-foreground" /></button>
          </div>
        </article>;
      })}
    </div>
    {!groups.length ? <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/40 px-5 py-10 text-center"><div aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2 text-primary"><Users size={30} /></div><h3 className="text-base font-medium text-foreground">创建第一个协作组</h3>{createButton}</div> : !rows.length && <div className="py-8 text-center"><Search size={24} className="mx-auto mb-3 text-muted-foreground" /><p className="text-sm text-muted-foreground">没有匹配的协作组</p><button type="button" className="mt-2 min-h-11 px-3 text-sm text-primary" onClick={() => setQuery('')}>清除搜索</button></div>}
  </section>;
}
