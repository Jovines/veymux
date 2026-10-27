import { useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';
import { useCollaborationNavigation } from '../../stores/useCollaborationNavigation';
import { todoCount } from '../../todos/api';
import { SECURE_READY_EVENT } from '../../federation/connectionRecovery';
import { savedConnection, SECURE_STATE_EVENT } from '../../federation/browserIntegration';
import { startVisiblePolling } from '../sidebar/startVisiblePolling';

export function TodoNavigationButton({ onOpen, placement = 'sidebar' }: { onOpen: () => void; placement?: 'sidebar' | 'toolbar' }) {
  const toolbar = placement === 'toolbar';
  const active = useCollaborationNavigation(state => state.todoOpen);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true, pending = false;
    let target = savedConnection()?.targetPeerId;
    const changed = () => { const next = savedConnection()?.targetPeerId; if (target !== next) { target = next; setCount(null); } };
    window.addEventListener(SECURE_STATE_EVENT, changed);
    return (() => {
      const stop = startVisiblePolling(() => {
        if (pending || navigator.onLine === false) return;
        pending = true;
        void Promise.resolve().then(async () => { const target = savedConnection()?.targetPeerId; const result = await todoCount(); if (alive && savedConnection()?.targetPeerId === target) setCount(result.count); })
          .catch(() => {}).finally(() => { pending = false; });
      }, 15000, [SECURE_READY_EVENT, 'veymux:todos-changed']);
      return () => { alive = false; stop(); window.removeEventListener(SECURE_STATE_EVENT, changed); };
    })();
  }, []);
  return <button type="button" aria-label={placement === 'toolbar' ? '打开待办清单' : undefined} aria-description={count === null ? undefined : `${count} 项未完成`} aria-current={active ? 'page' : undefined} onClick={onOpen}
    title={count === null ? '待办清单' : `待办清单 · ${count} 项未完成`} className={`${toolbar ? 'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xs sm:h-8 sm:w-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring' : 'mx-2 my-2 flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-left text-xs'} transition ${active ? 'bg-[rgb(var(--primary-rgb)/0.1)] text-primary' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}>
    <ListTodo size={16} />{!toolbar && <span className="flex-1 font-medium">待办</span>}
    {count !== null && count > 0 && <span data-todo-count aria-hidden="true" className={`${toolbar ? `pointer-events-none absolute right-0 top-0 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 ${count > 0 ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted-foreground'}` : 'rounded-md bg-surface px-1.5 py-0.5 text-[10px]'} tabular-nums`}>{count > 99 ? '99+' : count}</span>}
  </button>;
}
