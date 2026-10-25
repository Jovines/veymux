import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import { currentSecureClient, savedConnection } from '../../federation/browserIntegration';
import { allowChatProgram, getChatEligibility } from './chatModeEntry';
import { isConfiguredAgentProgram } from '../../terminal/launchCommands';

/** Both the navigation button and the session menu use this entry guard. */
export function useChatModeEntry(sessionId: string, enter: () => void) {
  const capabilities = useSessionCapabilities(), id = useId();
  const dialogRef = useRef<HTMLElement>(null), revision = useRef(0), busy = useRef(false);
  const [pending, setPending] = useState(false), [draft, setDraft] = useState<string | null>(null), [error, setError] = useState('');
  const close = () => { revision.current++; busy.current = false; setPending(false); setDraft(null); setError(''); };
  useEffect(() => {
    busy.current = false; setPending(false); setDraft(null); setError('');
    return () => { revision.current++; busy.current = false; };
  }, [sessionId]);
  useKeyboardLayer(dialogRef, draft !== null, close);
  const run = async (save = false) => {
    if (busy.current) return;
    const owned = ++revision.current, client = currentSecureClient(), target = savedConnection()?.targetPeerId || location.origin;
    const current = () => owned === revision.current && currentSecureClient() === client && (savedConnection()?.targetPeerId || location.origin) === target;
    busy.current = true; setPending(true); setError('');
    try {
      if (save && draft !== null) await allowChatProgram(draft);
      if (!current()) return;
      let eligibility = await getChatEligibility(sessionId);
      if (current() && !save && !eligibility.allowed && eligibility.program && capabilities.has('session.owner-menu') && isConfiguredAgentProgram(eligibility.program)) {
        await allowChatProgram(eligibility.program);
        if (!current()) return;
        eligibility = await getChatEligibility(sessionId);
      }
      if (!current()) return;
      if (eligibility.allowed) { setDraft(null); enter(); }
      else if (save) setError('配置已保存，但当前程序仍未匹配。请确认程序名，或取消后重新识别');
      else setDraft(eligibility.program || '');
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '程序识别配置保存失败，请重试'); }
    finally { if (current()) { busy.current = false; setPending(false); } }
  };
  const field = 'min-h-11 w-full min-w-0 rounded-lg border border-border/40 bg-surface-2 px-3 py-2 text-base text-foreground outline-none focus:border-primary sm:text-sm';
  const dialog = draft !== null ? createPortal(<div>
    <button type="button" className="fixed inset-0 z-modal-backdrop bg-[var(--app-backdrop)] backdrop-blur-sm" aria-label="取消程序识别配置" onClick={close} />
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-3 right-3 z-modal-panel flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden rounded-2xl border border-border/30 bg-surface text-foreground shadow-xl sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
      <header className="shrink-0 border-b border-border/20 px-5 py-4"><h2 id={`${id}-title`} className="text-base font-semibold">配置 Agent 程序识别</h2></header>
      <form className="flex min-h-0 flex-col" onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (capabilities.has('session.owner-menu')) void run(true); }}>
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="text-sm leading-6 text-muted-foreground">当前程序没有在对话模式白名单内。内置和已配置的 Agent 可以自动识别。</p>
          {capabilities.has('session.owner-menu') ? <>
            <label className="block space-y-2 text-sm text-muted-foreground">程序名<input required className={field} value={draft} maxLength={120} placeholder="例如 my-agent" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} onChange={event => setDraft(event.target.value)} /></label>
            <p className="text-xs leading-6 text-muted-foreground">填入 Agent 的可执行文件名或脚本名。保存后，这个服务再次识别到该程序时即可使用对话模式。</p>
          </> : <p className="text-sm text-muted-foreground">请让服务所有者配置此程序的识别规则。</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/20 px-4 py-3">
          <button type="button" onClick={close} className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground hover:bg-surface-2">取消</button>
          {capabilities.has('session.owner-menu') && <button type="submit" disabled={pending || !draft.trim()} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40">{pending ? '正在识别…' : '保存并进入对话'}</button>}
        </footer>
      </form>
    </section>
  </div>, document.body) : error ? createPortal(<div role="alert" className="fixed inset-x-3 bottom-4 z-toast mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-foreground shadow-lg"><span className="flex-1">{error}</span><button type="button" className="min-h-9 px-2 text-primary" onClick={close}>关闭</button></div>, document.body) : null;
  return { request: () => { void run(); }, pending, dialog };
}
