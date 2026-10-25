import { useSessionViewMode } from '../components/chat/sessionViewMode';
import { useViewportHeight } from '../hooks/useViewportHeight';
import { lazy, Suspense } from 'react';
import { Columns2, Copy, MessageCircle, Paperclip, PanelRight, RefreshCw, TerminalSquare } from 'lucide-react';
import { mergeShareResources, type ShareResources } from '../../server/shared/shareResources';
import { savedConnection } from './browserIntegration';
const ResourceSidebar = lazy(() => import('./SessionResourceSidebar').then(m => ({ default: m.SessionResourceSidebar })));
const Chat = lazy(() => import('../components/chat/SessionChatView').then(m => ({ default: m.SessionChatView })));
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { createBrowserTerminal, TerminalGeometry, type TerminalGeometryPhase } from '../terminal/geometry';
import { acknowledgeResize, createResizeSyncState, observeServerSize, requestResize } from '../terminal/resizeSync';
import '@xterm/xterm/css/xterm.css';
import { getTerminalTheme, type TermdockColorTheme } from '../terminal/theme';
import type { SecureClient } from './secureClient';
import { beginSidebarResize } from '../components/sidebar/sidebarResize';
import { useSidebarStore } from '../stores/useSidebarStore';
import { ShareAccessContext, SessionCapabilitiesContext, sharedSessionContextMenu } from './ShareAccessContext';
import { sharedResourceTabs, sharedSessionCapabilities } from './sessionCapabilities';
import { requestReferenceInsertion } from '../components/sidebar/requestReferenceInsertion';
import { buildBracketedPastePayload } from '../terminal/bracketedPaste';
import { SessionIcon } from './SessionIcon';
import { useChatInputTransfer } from '../components/chat/useChatInputTransfer';
import { clipboardEventContent } from '../terminal/clipboardContent';
import { copyTmuxTerminalSelection, writeTerminalClipboardText, type RequestTmuxSelection } from '../terminal/clipboardText';
import { createOsc52ClipboardHandler } from '../terminal/osc52Clipboard';
import { sanitizeTerminalInput } from '../terminal/inputNormalization';
import { readFileReferenceDrag } from '../components/chat/fileReferenceTransfer';

interface RemoteSession { sessionId: string; sourceSessionId?: string; attachmentRoot?: string; name: string; icon?: string; live: boolean; canWrite: boolean; canResize: boolean }
function SharedSessionPane({ client, initialSessionId, initialViewMode, sessions, resources, directoryError }: { client: SecureClient; initialSessionId?: string; initialViewMode?: 'terminal' | 'chat'; sessions: RemoteSession[]; resources: ShareResources; directoryError: string }) {
  const [selected, setSelected] = useState<RemoteSession>();
  const pane = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null), stopResize = useRef<(() => void) | null>(null);
  const sidebarWidth = useSidebarStore(state => state.rightSidebarWidth);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [wide, setWide] = useState(() => window.innerWidth >= 1024);
  const [invitedMode] = useState(() => { try { return sessionStorage.getItem(`termdock:shared-view:${client.targetPeerId}`); } catch { return null; } });
  const defaultMode = initialViewMode || (invitedMode === 'chat' ? 'chat' : invitedMode === 'terminal' ? 'terminal' : savedConnection()?.viewMode) || 'terminal';
  const [mode, changeMode, modeError] = useSessionViewMode(selected?.sourceSessionId || selected?.sessionId || '', true, defaultMode, !!(initialViewMode || invitedMode || savedConnection()?.viewMode));
  useLayoutEffect(() => {
    let wasWide = window.innerWidth >= 1024;
    const resize = () => {
      const width = pane.current?.getBoundingClientRect().width || window.innerWidth;
      const nextWide = width >= 1024;
      setWide(nextWide);
      if (wasWide && !nextWide) setSidebarOpen(false);
      wasWide = nextWide;
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (pane.current) observer?.observe(pane.current);
    window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
  }, []);
  const [terminalStarted, setTerminalStarted] = useState(defaultMode === 'terminal');
  useEffect(() => { if (mode === 'terminal') setTerminalStarted(true); }, [mode]);
  const modeRef = useRef(mode); modeRef.current = mode;
  const resizeTerminal = useRef<(phase?: TerminalGeometryPhase) => void>(() => {});
  useLayoutEffect(() => { if (mode === 'terminal') resizeTerminal.current('reveal'); }, [mode]);
  useEffect(() => () => stopResize.current?.(), []);
  const inputTerminal = useRef<(text: string) => boolean>(() => false);
  const previewResources: ShareResources = selected?.attachmentRoot ? { ...resources, directories: [...resources.directories ?? [], { path: selected.attachmentRoot, access: 'read' }] } : resources;
  const capabilities = sharedSessionCapabilities(selected, previewResources);
  const canView = capabilities.has('session.view'), canWrite = capabilities.has('session.input'), canResize = capabilities.has('session.resize');
  const hasResources = sharedResourceTabs(resources).length > 0;
  const insert = async (text: string, source?: HTMLElement) => { if (!selected || !canWrite) return false; const accepted = mode === 'chat' ? await requestReferenceInsertion(text, selected.sourceSessionId || selected.sessionId, () => !client.closed, source) : inputTerminal.current(buildBracketedPastePayload(text, false)); if (accepted && !wide) setSidebarOpen(false); return accepted; };
  const autoSelected = useRef<string>();
  useEffect(() => {
    if (!initialSessionId || autoSelected.current === initialSessionId) return;
    const session = sessions.find(item => item.sessionId === initialSessionId || item.sourceSessionId === initialSessionId);
    if (session) { autoSelected.current = initialSessionId; setSelected(session); }
  }, [sessions, initialSessionId]);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);
  const [status, setStatus] = useState('正在读取会话…');
  const [theme, setTheme] = useState<TermdockColorTheme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const element = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionText = useRef<() => string>(() => '');
  const copySelection = useRef<() => Promise<boolean>>(async () => false);
  const [transferError, setTransferError] = useState('');
  const transfer = useChatInputTransfer({ sessionId: selected?.sourceSessionId || selected?.sessionId || '', active: mode === 'terminal', canWrite, input: element, sessionAttachments: true, error: setTransferError,
    insert: text => { if (!inputTerminal.current(buildBracketedPastePayload(sanitizeTerminalInput(text), false))) throw new Error('终端未连接，内容尚未插入，请重连后重试'); } });
  const copy = async () => {
    const request = copySelection.current;
    try { const copied = await request(); if (request === copySelection.current) setTransferError(copied ? '' : '请先选择需要复制的终端内容'); }
    catch (error) { if (request === copySelection.current) setTransferError(error instanceof Error ? error.message : '复制失败，请重试'); }
  };
  useEffect(() => {
    setSelected(previous => {
      if (!previous) { if (sessions.length === 1) return sessions[0]; setStatus(directoryError || (sessions.length ? '请选择会话' : '暂无可用会话')); return previous; }
      const latest = sessions.find(item => item.sessionId === previous.sessionId);
      if (!latest) { setStatus(directoryError || '会话已不可用，请联系分享者'); return undefined; }
      return latest.name === previous.name && latest.icon === previous.icon && latest.attachmentRoot === previous.attachmentRoot && latest.canWrite === previous.canWrite && latest.canResize === previous.canResize ? previous : latest;
    });
  }, [sessions, directoryError]);
  useEffect(() => {
    if (!selected || !canView || !element.current || !terminalStarted) return;
    let disposed = false;
    const disposables: Array<() => void> = [];
    const teardown = () => {
      resizeTerminal.current = () => {};
      inputTerminal.current = () => false;
      selectionText.current = () => '';
      copySelection.current = async () => false;
      for (const dispose of disposables.splice(0).reverse()) dispose();
    };
    const initialize = async () => {
      let lastSeq = 0; let epoch: string | undefined;
      const terminal = await createBrowserTerminal({ theme: getTerminalTheme(theme), cursorBlink: canWrite, disableStdin: !canWrite, mouseEventsRequireAlt: !canWrite, convertEol: false }, () => !disposed && !!element.current);
      if (!terminal || !element.current) return;
      disposables.push(() => terminal.dispose());
      selectionText.current = () => terminal.getSelection();
      terminal.attachCustomKeyEventHandler(event => {
        if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && !event.altKey) {
          if (event.key.toLowerCase() === 'v') { event.preventDefault(); if (canWrite) void transfer.paste(); return false; }
          if (event.key.toLowerCase() === 'c' && (terminal.hasSelection() || event.metaKey || event.shiftKey)) { event.preventDefault(); void copy(); return false; }
        }
        return true;
      });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element.current);
      const geometry = new TerminalGeometry(terminal, fit, element.current, { authority: canResize ? 'viewport' : 'server' });
      if (canResize) geometry.fit('initialize', modeRef.current === 'terminal');
      const measured = geometry.dimensions;
      setStatus('正在连接…');
      const query = new URLSearchParams({ flow: '2', ...(canResize ? { transport: 'tmux-client', ...(measured ? { cols: String(measured.cols), rows: String(measured.rows) } : {}) } : {}) });
      const socket = client.openSocket(`/api/terminal/${encodeURIComponent(selected.sessionId)}/ws?${query}`);
      let streamReady = false, replayPending = 0;
      const current = () => !disposed && !client.closed && modeRef.current === 'terminal';
      const copies = new Map<string, { resolve: (value: Awaited<ReturnType<RequestTmuxSelection>>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      const rejectCopies = () => { for (const pending of copies.values()) { clearTimeout(pending.timer); pending.reject(new Error('连接已断开，请重连后复制')); } copies.clear(); };
      disposables.push(rejectCopies);
      const requestSelection: RequestTmuxSelection = () => new Promise((resolve, reject) => {
        if (!current() || socket.readyState !== 1) { reject(new Error('终端未连接，请重连后复制')); return; }
        const reqId = crypto.randomUUID();
        const timer = setTimeout(() => { copies.delete(reqId); reject(new Error('复制超时，请重试')); }, 10_000);
        copies.set(reqId, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ type: 'tmux', action: 'copy-selection', reqId })); }
        catch (error) { clearTimeout(timer); copies.delete(reqId); reject(error); }
      });
      copySelection.current = async () => {
        const text = terminal.getSelection();
        return text ? writeTerminalClipboardText(text, current) : canWrite ? copyTmuxTerminalSelection(selected.sessionId, current, requestSelection) : false;
      };
      // Use the ordinary terminal's OSC 52 framing and clipboard writer. Old
      // snapshots must never overwrite the clipboard on first load/reconnect.
      const clipboard = terminal.parser.registerOscHandler(52, createOsc52ClipboardHandler(
        () => current() && replayPending === 0,
        () => { if (current()) setTransferError('复制失败，请重试'); },
      ));
      disposables.push(() => clipboard.dispose());
      let resizeState = createResizeSyncState();
      disposables.push(() => { socket.onclose = null; socket.onerror = null; socket.close(); });
      const resize = (phase: TerminalGeometryPhase = 'update') => {
        if (disposed || modeRef.current !== 'terminal' || !element.current?.clientWidth || !element.current?.clientHeight) return;
        if (!canResize) {
          const screen = element.current.querySelector<HTMLElement>('.xterm-screen'), mount = element.current.querySelector<HTMLElement>('.xterm');
          if (screen && mount && screen.offsetWidth && screen.offsetHeight) { const scale = Math.min(1, (element.current.clientWidth - 16) / screen.offsetWidth, (element.current.clientHeight - 16) / screen.offsetHeight); mount.style.transformOrigin = 'top left'; mount.style.transform = `scale(${Math.max(0.1, scale)})`; }
          return;
        }
        geometry.fit(phase, true, 'resize');
        const size = geometry.dimensions;
        if (size && streamReady && socket.readyState === 1) {
          const next = requestResize(resizeState, size);
          resizeState = next.state;
          if (next.request) socket.send(JSON.stringify({ type: 'resize', ...size, seq: next.request.seq }));
        }
      };
      resizeTerminal.current = resize;
      socket.onopen = () => { setStatus(canWrite ? '' : '只读'); resize(); };
      socket.onmessage = event => {
        try {
          const frame = JSON.parse(event.data);
          if (disposed) return;
          if (frame.type === 'connected') {
            streamReady = true;
            resizeState = observeServerSize(createResizeSyncState(), frame);
            epoch = typeof frame.streamEpoch === 'string' ? frame.streamEpoch : undefined;
            lastSeq = Number.isSafeInteger(frame.replayLastSeq) ? frame.replayLastSeq : 0;
            if (!canResize) geometry.applyRemoteSize(frame);
            const replay = Array.isArray(frame.replayChunks) ? frame.replayChunks.filter((chunk: unknown) => typeof chunk === 'string').join('') : '';
            // Reset in xterm's write queue, preserving order with earlier writes and subsequent output.
            replayPending++;
            terminal.write((frame.replayOutOfWindow ? '\x1bc' : '') + replay, () => { replayPending--; resize(); });
          } else if (frame.type === 'tmux-result') {
            const pending = copies.get(frame.reqId);
            if (pending) { copies.delete(frame.reqId); clearTimeout(pending.timer); if (frame.success === true) pending.resolve(frame); else pending.reject(new Error(frame.error || '复制失败，请重试')); }
          } else if (frame.type === 'resize-ack') {
            resizeState = acknowledgeResize(resizeState, { ...frame, ok: frame.ok !== false }).state;
          } else if (frame.type === 'data' && typeof frame.data === 'string') terminal.write(frame.data, () => {
            if (disposed) return;
            if (Number.isSafeInteger(frame.seq)) lastSeq = Math.max(lastSeq, frame.seq);
            if (socket.readyState === 1 && Number.isSafeInteger(frame.flowSeq)) socket.send(JSON.stringify({ type: 'output-ack', flowSeq: frame.flowSeq, since: lastSeq, epoch }));
          });
          else if (frame.type === 'pty-size' && Number.isSafeInteger(frame.cols) && Number.isSafeInteger(frame.rows) && frame.cols > 0 && frame.rows > 0) {
            resizeState = observeServerSize(resizeState, frame);
            if (!canResize) { geometry.applyRemoteSize(frame); requestAnimationFrame(() => resize()); }
          }
          else if (frame.type === 'error') setStatus('无法连接，请联系分享者');
        } catch { setStatus('终端数据无效'); socket.close(); }
      };
      socket.onclose = () => { rejectCopies(); setStatus('连接已断开，请重连'); };
      socket.onerror = () => setStatus('连接失败，请重试');
      inputTerminal.current = text => { if (!canWrite || socket.readyState !== 1) return false; socket.send(JSON.stringify({ type: 'input', data: text })); return true; };
      const input = terminal.onData(data => { if (canWrite && socket.readyState === 1) socket.send(JSON.stringify({ type: 'input', data })); });
      disposables.push(() => input.dispose());
      const heartbeat = setInterval(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' })); }, 20_000);
      disposables.push(() => clearInterval(heartbeat));
      const observer = new ResizeObserver(() => resize());
      disposables.push(() => observer.disconnect());
      observer.observe(element.current);
    };
    void initialize().catch(() => { if (!disposed) { teardown(); setStatus('终端初始化失败，请重试'); } });
    return () => { disposed = true; teardown(); };
  }, [client, selected?.sessionId, canView, canWrite, canResize, theme, terminalStarted, reconnectEpoch]);
  return <ShareAccessContext.Provider value={previewResources}><SessionCapabilitiesContext.Provider value={capabilities}><div ref={pane} className="flex h-full min-h-0 flex-col bg-[var(--chrome-bg)] text-foreground">
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-3 pt-[env(safe-area-inset-top)] text-sm">
      <span data-session-icon className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-primary"><SessionIcon icon={selected?.icon} /></span><div className="min-w-0 flex-1"><p className="truncate font-medium">{selected?.name || '共享工作空间'}</p><p className="truncate text-[10px] text-muted-foreground" role="status">{selected && !canWrite ? '只读' : mode === 'terminal' ? status : ''}</p></div>
      <button type="button" onClick={() => changeMode(mode === 'chat' ? 'terminal' : 'chat')} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs hover:bg-surface-2">{mode === 'chat' ? <TerminalSquare size={15} /> : <MessageCircle size={15} />}{mode === 'chat' ? '终端' : '对话'}</button>
      <button type="button" aria-label="重新连接会话" onClick={() => setReconnectEpoch(value => value + 1)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2"><RefreshCw size={15} /></button>
      {mode === 'terminal' && selected && <><button type="button" aria-label="复制终端选区" title="选择终端内容后复制" onClick={() => void copy()} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-2"><Copy size={15} /></button>{canWrite && <><button type="button" aria-label="粘贴到终端" onClick={() => void transfer.paste()} className="min-h-11 rounded-lg px-3 text-xs hover:bg-surface-2">粘贴</button><button type="button" aria-label="上传文件到终端" onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface-2"><Paperclip size={15} /></button><input ref={fileInput} type="file" multiple className="hidden" aria-label="选择终端附件" onChange={event => { transfer.addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} /></>}</>}
      {hasResources && <button type="button" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(v => !v)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs hover:bg-surface-2"><PanelRight size={15} />侧栏</button>}

    </header>
    {transferError && <p role="alert" className="px-3 py-2 text-xs text-destructive">{transferError}</p>}
    {transfer.transfer && <div role="status" className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1">{transfer.transfer.stage === 'reading' ? '正在读取剪贴板…' : transfer.transfer.stage === 'uploading' ? `正在上传文件 · ${transfer.transfer.percent ?? 0}%` : transfer.transfer.stage === 'cancelled' ? '已取消上传' : '上传未完成，内容尚未插入'}</span>{transfer.busy ? <button type="button" className="min-h-9 px-2" onClick={transfer.cancel}>取消</button> : <><button type="button" className="min-h-9 px-2" onClick={transfer.retry}>重试上传</button><button type="button" className="min-h-9 px-2" onClick={transfer.dismiss}>关闭上传提示</button></>}</div>}
    {modeError && <p role="alert" className="px-3 py-2 text-xs text-destructive">{modeError}</p>}
    {sessions.length > 1 && <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border/30 p-2">{sessions.map(session => <button key={`${client.targetPeerId}:${session.sessionId}`} aria-pressed={selected?.sessionId === session.sessionId} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-xs ${selected?.sessionId === session.sessionId ? 'bg-surface-2' : 'text-muted-foreground hover:bg-surface-2'}`} onClick={() => setSelected({ ...session })}><SessionIcon icon={session.icon} size={15} />{session.name}{!session.canWrite ? ' · 只读' : ''}</button>)}</div>}
    <div className="flex min-h-0 flex-1"><main className="flex min-h-0 min-w-0 flex-1 flex-col" onContextMenuCapture={event => { if (mode === 'terminal' && selectionText.current()) event.stopPropagation(); else sharedSessionContextMenu(event); }}>

      <div ref={element} aria-label="共享终端" onCopyCapture={event => { const text = selectionText.current(); event.preventDefault(); event.stopPropagation(); if (text) event.clipboardData.setData('text/plain', text); else void copy(); }} onPasteCapture={event => { if (mode !== 'terminal') return; event.preventDefault(); event.stopPropagation(); if (canWrite) void transfer.paste(clipboardEventContent(event.clipboardData)); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = canWrite ? 'copy' : 'none'; }} onDrop={event => {
        event.preventDefault(); event.stopPropagation(); if (!canWrite) return;
        try { const reference = readFileReferenceDrag(event.dataTransfer); if (reference) { inputTerminal.current(buildBracketedPastePayload(sanitizeTerminalInput(reference), false)); return; } const files = Array.from(event.dataTransfer.files); if (files.length) transfer.addFiles(files); else { const text = event.dataTransfer.getData('text/plain'); if (text) inputTerminal.current(buildBracketedPastePayload(sanitizeTerminalInput(text), false)); } }
        catch (error) { setTransferError(error instanceof Error ? error.message : '文件引用无效'); }
      }} className={`min-h-0 flex-1 overflow-auto p-2 ${mode !== 'terminal' ? 'hidden' : ''}`} />
      {selected && canView && mode === 'chat' && <div className="min-h-0 flex-1"><Suspense fallback={<p className="p-6 text-sm text-muted-foreground">正在打开对话…</p>}><Chat key={selected.sourceSessionId || selected.sessionId} sessionId={selected.sourceSessionId || selected.sessionId} name={selected.name} terminalLink={false} canWrite={canWrite} onTerminal={() => changeMode('terminal')} /></Suspense></div>}
      {!selected && <p className="p-6 text-sm text-muted-foreground">{status}</p>}
    </main>{hasResources && <div ref={panel} className={wide ? sidebarOpen ? 'relative shrink-0 border-l border-border' : 'hidden' : ''} style={wide && sidebarOpen ? { width: Math.max(280, Math.min(sidebarWidth, window.innerWidth - 360)) } : undefined}>{wide && sidebarOpen && <button type="button" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" className="absolute inset-y-0 -left-0.5 z-20 w-[5px] cursor-col-resize bg-transparent transition hover:bg-primary/30 focus-visible:bg-primary/30" onMouseDown={event => { if (!panel.current) return; event.preventDefault(); stopResize.current?.(); stopResize.current = beginSidebarResize(panel.current, event.clientX, panel.current.getBoundingClientRect().width, width => Math.max(280, Math.min(width, window.innerWidth - 360)), width => useSidebarStore.getState().setRightSidebarWidth(width), -1); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); useSidebarStore.getState().setRightSidebarWidth(Math.max(280, Math.min(sidebarWidth + (event.key === 'ArrowLeft' ? 24 : -24), window.innerWidth - 360))); } }} />}<Suspense fallback={<p className="p-4 text-xs text-muted-foreground">正在打开侧栏…</p>}><ResourceSidebar resources={resources} canWrite={canWrite} sessionId={selected?.sourceSessionId || selected?.sessionId} pinned={wide} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onInsert={insert} /></Suspense></div>}</div>
  </div></SessionCapabilitiesContext.Provider></ShareAccessContext.Provider>;
}

export function SessionAccessView({ client, initialSessionId, initialViewMode, initialViewLayout }: { client: SecureClient; initialSessionId?: string; initialViewMode?: 'terminal' | 'chat'; initialViewLayout?: 'split' }) {
  useViewportHeight();
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [resources, setResources] = useState<ShareResources>({});
  const [directoryError, setDirectoryError] = useState('');
  const [split, setSplit] = useState(() => { try { const saved = sessionStorage.getItem(`termdock:shared-layout:${client.targetPeerId}`); if (saved) return saved === 'split'; } catch { /* Optional layout preference. */ } return initialViewLayout === 'split'; });
  useEffect(() => { if (initialViewLayout !== 'split') return; try { if (sessionStorage.getItem(`termdock:shared-layout:${client.targetPeerId}`)) return; } catch { /* Optional layout preference. */ } setSplit(true); }, [initialViewLayout, client.targetPeerId]);
  useEffect(() => {
    let active = true, running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const result = await client.request({ type: 'session-list' });
        if (active) { setSessions(result.items as RemoteSession[]); setDirectoryError(''); }
      } catch { if (active) { setSessions([]); setDirectoryError('连接暂时中断，请重试'); } }
      try {
        const permissions = await client.request({ type: 'permissions' });
        if (active) setResources(Array.isArray(permissions.grants) ? mergeShareResources((permissions.grants as { resources?: ShareResources }[]).map(g => g.resources)) : {});
      } catch { if (active) setResources({}); }
      finally { running = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);
  const first = sessions.find(session => session.sessionId === initialSessionId || session.sourceSessionId === initialSessionId) || sessions[0];
  const second = sessions.find(session => session.sessionId !== first?.sessionId);
  const showSplit = split && !!second;
  return <div className="flex h-full min-h-0 flex-col bg-[var(--chrome-bg)] text-foreground">
    {sessions.length > 1 && <div className="flex shrink-0 justify-end border-b border-border/30 px-2"><button type="button" aria-pressed={showSplit} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs hover:bg-surface-2" onClick={() => { setSplit(!showSplit); try { sessionStorage.setItem(`termdock:shared-layout:${client.targetPeerId}`, showSplit ? 'single' : 'split'); } catch { /* Optional layout preference. */ } }}><Columns2 size={15} />{showSplit ? '单会话' : '分屏查看'}</button></div>}
    <div className={`flex min-h-0 flex-1 ${showSplit ? 'flex-col lg:flex-row' : ''}`}>
      <section className="min-h-0 min-w-0 flex-1" aria-label={showSplit ? '第一个共享会话' : '共享会话'}><SharedSessionPane client={client} initialSessionId={showSplit ? first?.sessionId : initialSessionId} initialViewMode={initialViewMode} sessions={showSplit ? sessions.filter(session => session.sessionId !== second?.sessionId) : sessions} resources={resources} directoryError={directoryError} /></section>
      {showSplit && <section className="min-h-0 min-w-0 flex-1 border-t border-border lg:border-l lg:border-t-0" aria-label="第二个共享会话"><SharedSessionPane client={client} initialSessionId={second.sessionId} initialViewMode={initialViewMode} sessions={sessions.filter(session => session.sessionId !== first?.sessionId)} resources={resources} directoryError={directoryError} /></section>}
    </div>
  </div>;
}
