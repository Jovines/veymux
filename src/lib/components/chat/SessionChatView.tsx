import { useTerminalStore } from '../../stores/useTerminalStore';
import { chatDisplayCutoff, visibleChatMessages, readChatDisplayCutoff } from './localChatDisplay';
import { shouldShowTuiLoading } from '../../utils/agentAttention';
import { useTerminalOutputActivity } from '../../hooks/useTerminalOutputActivity';
import { useChatTerminalInputCheck } from './useChatTerminalInputCheck';
import { useTouchScrollBoundary } from '../../hooks/useTouchScrollBoundary';
import { usePreserveInputFocus } from '../../hooks/usePreserveInputFocus';
import { focusKeyboardInput, usesNativeKeyboardLayout } from '../../hooks/nativeKeyboardLayout';
import { getKeyboardPanelStyles } from '../layout/keyboardPanelLayout';
import { useInputViewportDiagnostics } from '../../hooks/useInputViewportDiagnostics';
import { clipboardEventContent } from '../../terminal/clipboardContent';
import { hasReplyToLatestMessage, hasUnansweredMessage, mergeChatMessages, type ChatMessage } from './chatMessages';
import { readChatHistory } from './chatHistoryRequest';
import { SECURE_READY_EVENT } from '../../federation/connectionRecovery';
import { useAppFeedback } from '../ui/AppFeedback';
import { ChatLoading } from './ChatLoading';
import { ChatDeliveryNotice } from './ChatDeliveryNotice';
import { SessionModeWelcomeHint } from './SessionModeWelcomeHint';
import { ChatFileNavigation } from './ChatFileNavigation';
import { loadChatRichContent } from './chatRenderers';
import { chatSnapshotGeneration, readChatSnapshot, saveChatSnapshot } from './chatSnapshot';
import { useViewportKeyboardState } from '../../hooks/useViewportKeyboardState';
import { usesTouchTerminalLayout } from '../../utils/touchTerminalLayout';
import { useKeyboardFocusGuard } from '../../hooks/useKeyboardFocusGuard';
import './sessionChat.css';
import { authorizeOwnedTerminalPaste } from '../../terminal/ownedPaste';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, ArrowDown, ArrowUp, ChevronUp, CornerDownRight, LoaderCircle, MessageCircle, Paperclip, Quote, RefreshCw, TerminalSquare, X } from 'lucide-react';
import { currentSecureClient, savedConnection } from '../../federation/browserIntegration';
import { ChatTimeline, ChatReferenceCard, ChatUserMessage, chatTime } from './ChatTimeline';
import { composeChatContent, parseChatContent, type ChatReference } from './chatReferences';
import { readChatTextSelection, type ChatTextSelection } from './chatTextSelection';
import { useChatInputTransfer } from './useChatInputTransfer';
import { getTermdockDesktopBridge } from '../../desktop/nativeBridge';
import { writeTerminalClipboardText } from '../../terminal/clipboardText';
import { useShareAccess, useSessionCapabilities } from '../../federation/ShareAccessContext';
import { readContextReferenceDrag, readFileReferenceDrag } from './fileReferenceTransfer';
import { getActiveKeyboardLayer } from '../../hooks/useKeyboardLayer';
import { activeChatMentions, attachmentToken, chatAttachmentKind, chatDraftSummary, composeChatDraft, mentionToken, parseChatDraft, type ChatAttachment, type ChatInsertionPoint, type ChatMention } from './chatComposerContent';
import { TerminalPeekTrigger } from './SessionTerminalPeek';
import { LoadingSpinner } from '../ui/Loading';
import { ChatComposerActions } from './ChatComposerActions';
import { ChatMediaSettingsDialog } from './ChatMediaSettingsDialog';
import { MediaUploadToast } from '../terminal/MediaUploadToast';
import { ChatRichEditor, readChatEditor, setChatEditorCaret } from './ChatRichEditor';
import { ChatInlineContent } from './ChatInlineContent';
import { useChatMentions } from './useChatMentions';
import { useSessionChatReview } from './useSessionChatReview';
import { useChatScrollAnchor, type ChatReadingPosition } from './useChatScrollAnchor';
import { finishSessionChatStartup, useSessionChatStartup } from './sessionChatStartup';
import { SessionChatStartupStatus } from './SessionChatStartupStatus';
import { isContextReference } from '../../terminal/contextReference';
interface Pending { content: string; requestId: string; createdAt: number }
interface ReplyVisit {
  position: ChatReadingPosition; reply: string; messages: ChatMessage[];
  page: { hasOlder: boolean; hasNewer: boolean }; revision?: string;
}
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm transition hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const floatingButton = 'inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/70 bg-surface px-2.5 text-[11px] leading-4 shadow-sm transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7';
const noUnreadMessages: string[] = [];
function SessionChatContent({ sessionId, name = '当前会话', canWrite: requestedWrite = true, active = true, visible = active, terminalLink = false, onKeyboardChange, onReadyChange, onTerminal }: { sessionId: string; name?: string; canWrite?: boolean; active?: boolean; visible?: boolean; terminalLink?: boolean; onKeyboardChange?: (open: boolean) => void; onReadyChange?: (ready: boolean) => void; onTerminal: () => void }) {
  const startup = useSessionChatStartup(sessionId);
  const startupRef = useRef(startup); startupRef.current = startup;
  const [freshLaunch] = useState(!!startup);
  const touchLayout = usesTouchTerminalLayout();
  const keyboardLayout = getKeyboardPanelStyles(touchLayout);
  const keyboard = useViewportKeyboardState({ enabled: active && touchLayout });
  const keyboardChanged = useRef(onKeyboardChange); keyboardChanged.current = onKeyboardChange;
  useEffect(() => { keyboardChanged.current?.(active && keyboard.isOpen); }, [active, keyboard.isOpen]);
  const capabilities = useSessionCapabilities();
  const canWrite = requestedWrite && capabilities.has('session.chat-send');
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);
  useEffect(() => setMediaSettingsOpen(false), [sessionId, active, canWrite]);
  // The chat shell owns its loading/error UI. Showing it must not depend on
  // either an offscreen terminal handshake or the history request completing.
  useEffect(() => { onReadyChange?.(true); return () => onReadyChange?.(false); }, [onReadyChange]);
  const storageKey = `termdock:chat:${savedConnection()?.targetPeerId || location.origin}:${sessionId}`;
  const [snapshot] = useState(() => readChatSnapshot(storageKey));
  const [hasOlder, setHasOlder] = useState(snapshot?.hasOlder ?? false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [replyPending, setReplyPending] = useState(snapshot?.replyPending);
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem(`${storageKey}:draft`) || ''; } catch { return ''; } });
  const [extras, setExtras] = useState(() => { try { return parseChatDraft(sessionStorage.getItem(`${storageKey}:extras`) || ''); } catch { return parseChatDraft(''); } });
  const attachments = extras.attachments, mentions = activeChatMentions(draft, extras.mentions);
  const [caret, setCaret] = useState(draft.length), [dismissedMention, setDismissedMention] = useState<string | null>(null);
  const [memberIndex, setMemberIndex] = useState(0);
  const mentionListId = useId();
  const canMention = canWrite && capabilities.has('collaboration.mention');
  const mentionMatch = canMention ? draft.slice(0, caret).match(/(?:^|\s)@([^\s@「」]*)$/u) : null;
  const mentionKey = mentionMatch ? `${caret}:${mentionMatch[1]}` : null;
  const mentionOpen = active && !!mentionMatch && dismissedMention !== mentionKey;
  const roster = useChatMentions(sessionId, active && canMention, mentionOpen);
  const memberOptions = roster.members.filter(member => `${member.name} ${member.subtitle || ''} ${member.groupName}`.toLocaleLowerCase().includes((mentionMatch?.[1] || '').toLocaleLowerCase()));
  const selectedMemberIndex = Math.min(memberIndex, Math.max(0, memberOptions.length - 1));
  useEffect(() => { setMemberIndex(0); }, [mentionKey]);
  useEffect(() => { try { sessionStorage.setItem(`${storageKey}:extras`, composeChatDraft(extras.mentions.map(mentionToken).join(' '), attachments, extras.mentions)); } catch { /* Keep in-memory attachments. */ } }, [storageKey, extras, attachments]);
  const [reference, setReference] = useState<ChatReference | null>(() => { try { const value = JSON.parse(sessionStorage.getItem(`${storageKey}:reference`) || 'null'); return value && typeof value.author === 'string' && typeof value.time === 'string' && typeof value.text === 'string' ? value : null; } catch { return null; } });
  const [selectedReference, setSelectedReference] = useState<ChatTextSelection | null>(null);
  const [agentName, setAgentName] = useState(snapshot?.agentName ?? startup?.agent.displayName ?? '助手');
  const [agentSlug, setAgentSlug] = useState<string | undefined>(snapshot?.agentSlug ?? startup?.agent.slug);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(() => { try { return JSON.parse(sessionStorage.getItem(`${storageKey}:pending`) || 'null'); } catch { return null; } });
  const [messages, setMessages] = useState<ChatMessage[]>(snapshot?.messages ?? []);
  const [displayCutoff, setDisplayCutoff] = useState(() => readChatDisplayCutoff(storageKey));
  const canClearDisplay = capabilities.has('session.chat-clear');
  const displayMessages = visibleChatMessages(messages, canClearDisplay ? displayCutoff : null);
  const clearDisplay = () => {
    const cutoff = chatDisplayCutoff(messages);
    if (!cutoff) return;
    setDisplayCutoff(cutoff);
    try { localStorage.setItem(storageKey + ':display-cutoff', JSON.stringify(cutoff)); } catch { /* In-memory display remains reversible. */ }
  };
  const restoreDisplay = () => { setDisplayCutoff(null); try { localStorage.removeItem(storageKey + ':display-cutoff'); } catch { /* Optional persistence. */ } };
  const hasChatMessages = messages.length > 0 || !!pending;
  useLayoutEffect(() => { useTerminalStore.getState().setSessionChatHasMessages(sessionId, hasChatMessages); }, [sessionId, hasChatMessages]);
  const [loading, setLoading] = useState(!snapshot);
  const [agentAvailable, setAgentAvailable] = useState<boolean | undefined>(snapshot?.agentAvailable);
  const chatUnavailable = agentAvailable === false && !startup;
  const [error, setError] = useState('');
  const [syncInterrupted, setSyncInterrupted] = useState(false);
  const [historyReady, setHistoryReady] = useState(!!snapshot);
  useEffect(() => { if (agentAvailable === true && startup) finishSessionChatStartup(sessionId); }, [agentAvailable, sessionId, startup]);
  useAppFeedback(active && syncInterrupted && !startup ? { tone: 'recovering', message: '正在恢复对话同步…' } : null);
  useAppFeedback(active && error ? { message: error } : null);
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const unreadIds = useTerminalStore(state => state.sessions.get(sessionId)?.chatAttention?.unreadIds ?? noUnreadMessages);
  const [unreadLocation, setUnreadLocation] = useState(0);
  const [unreadEntryReady, setUnreadEntryReady] = useState(false);
  const unreadScrollTarget = useRef<string>(), unreadEntry = useRef(false), locatingUnread = useRef(false);
  const liveScrollTarget = useRef<string>();
  const markViewed = useCallback((id: string) => useTerminalStore.getState().markChatMessagesViewed(sessionId, [id]), [sessionId]);
  const [copied, setCopied] = useState('');
  const scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLDivElement>(null);
  const pendingEditorCaret = useRef<number | null>(null), focusEditorAfterUpdate = useRef(false);
  usePreserveInputFocus(scroll, input, active && touchLayout);
  const composer = useRef<HTMLDivElement>(null);
  const inputMasked = useKeyboardFocusGuard(input, active && touchLayout && !usesNativeKeyboardLayout(), keyboard);
  useInputViewportDiagnostics(input, active && touchLayout);
  useLayoutEffect(() => {
    const node = input.current, caret = pendingEditorCaret.current;
    if (!node || caret === null) return;
    pendingEditorCaret.current = null;
    if (focusEditorAfterUpdate.current) { focusEditorAfterUpdate.current = false; focusKeyboardInput(node); }
    setChatEditorCaret(node, caret);
  }, [draft, attachments, mentions]);
  const nearBottom = useRef(snapshot?.nearBottom ?? true), busy = useRef(false), generation = useRef(0), refreshSequence = useRef(0);
  const content = useRef<HTMLDivElement>(null), section = useRef<HTMLElement>(null), filePicker = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  useSessionChatReview(sessionId, active && hasChatMessages && historyReady && !loading && !syncInterrupted, section);
  useTouchScrollBoundary(section, active && touchLayout);
  const pendingRequest = useRef(pending); pendingRequest.current = pending;
  const historyRevision = useRef<string>();
  const historyMessages = useRef(messages); historyMessages.current = messages;
  const pageState = useRef({ hasOlder: snapshot?.hasOlder ?? false, hasNewer: snapshot?.hasNewer ?? false });
  const olderBusy = useRef(false), olderAbort = useRef<AbortController>(), olderRetryAt = useRef(0), historyEpoch = useRef(0);
  const olderEdge = useRef<HTMLDivElement>(null);
  const [nearbyIds] = useState(() => new Set(snapshot?.visibleMessageIds));
  const [rowHeights] = useState(() => new Map(snapshot?.rowHeights));
  const scrollPosition = useRef(snapshot?.scrollTop ?? 0);
  const { capture: captureAnchor, restore: restoreAnchor, restorePosition } = useChatScrollAnchor(scroll);
  const replyVisits = useRef<ReplyVisit[]>([]), replyAbort = useRef<AbortController>();
  const [returnCount, setReturnCount] = useState(0), [locatingReply, setLocatingReply] = useState<string>();
  const [locatedMessageId, setLocatedMessageId] = useState<string>(), [replyNavigationError, setReplyNavigationError] = useState('');
  const replyScrollTarget = useRef<{ id: string } | { position: ChatReadingPosition }>();
  const programmaticScrollTop = useRef<number>();
  const conversationId = useTerminalStore(state => state.sessions.get(sessionId)?.chatAttention?.index?.conversationId);
  const replyConversation = useRef(conversationId);
  useAppFeedback(active && replyNavigationError ? { message: replyNavigationError } : null);
  const cancelReplyNavigation = useCallback((clearVisits = false) => {
    replyAbort.current?.abort(); replyAbort.current = undefined;
    replyScrollTarget.current = undefined; setLocatingReply(undefined);
    if (clearVisits) { replyVisits.current = []; setReturnCount(0); setLocatedMessageId(undefined); }
  }, []);
  useEffect(() => {
    if (replyConversation.current && conversationId && replyConversation.current !== conversationId) cancelReplyNavigation(true);
    replyConversation.current = conversationId;
  }, [conversationId, cancelReplyNavigation]);
  useEffect(() => {
    if (!locatedMessageId) return;
    const timer = setTimeout(() => setLocatedMessageId(undefined), 2200);
    return () => clearTimeout(timer);
  }, [locatedMessageId]);
  useEffect(() => { if (!visible) cancelReplyNavigation(); return () => { replyAbort.current?.abort(); }; }, [visible, cancelReplyNavigation]);
  const restoredScroll = useRef(false);
  const inputScope = useRef({ active, canWrite: canWrite && !chatUnavailable, sessionId }); inputScope.current = { active, canWrite: canWrite && !chatUnavailable, sessionId };
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const access = useShareAccess();
  const writeEditorDraft = (value: string, caret: number, focus = false) => {
    pendingEditorCaret.current = caret;
    focusEditorAfterUpdate.current = focus;
    setDraft(value);
  };
  const updateFromEditor = (value: string, start: number, end = start) => {
    setDraft(value); setCaret(end); setDismissedMention(null);
    setExtras(current => ({ ...current,
      attachments: current.attachments.filter(file => !file.reference || value.includes(attachmentToken(file))),
      mentions: current.mentions.filter(member => value.includes(mentionToken(member))),
    }));
  };
  const insertText = (text: string, focus = true, insertion?: ChatInsertionPoint) => {
    const node = input.current, scope = inputScope.current, client = currentSecureClient(), layer = getActiveKeyboardLayer();
    const selection = insertion ?? (node ? readChatEditor(node) : { value: draft, start: draft.length, end: draft.length });
    setDraft(current => {
      // A late upload can insert at its original anchor, but cannot erase text
      // typed while it was in flight. If that anchor changed, append instead.
      const anchored = current.startsWith(selection.value.slice(0, selection.start));
      const at = current === selection.value || anchored ? Math.min(selection.start, current.length) : current.length;
      const until = current === selection.value ? Math.min(selection.end, current.length) : at;
      const next = current.slice(0, at) + text + current.slice(until);
      pendingEditorCaret.current = at + text.length;
      focusEditorAfterUpdate.current = focus;
      requestAnimationFrame(() => { if (node?.isConnected && inputScope.current.active && inputScope.current.canWrite && inputScope.current.sessionId === scope.sessionId && currentSecureClient() === client && getActiveKeyboardLayer() === layer && document.activeElement !== node) { pendingEditorCaret.current = null; focusEditorAfterUpdate.current = false; } });
      return next;
    });
  };
  const removeComposerToken = (token: string) => {
    const start = draft.indexOf(token), next = draft.split(token).join('');
    writeEditorDraft(next, start < 0 ? draft.length : start, true);
    setExtras(current => ({ ...current, attachments: current.attachments.filter(file => attachmentToken(file) !== token), mentions: current.mentions.filter(member => mentionToken(member) !== token) }));
  };
  useEffect(() => {
    if (!attachments.length) return;
    let number = Math.max(0, ...attachments.map(file => Number(file.reference?.match(/\d+$/)?.[0]) || 0));
    const normalized = attachments.map(file => file.reference ? file : { ...file, reference: `${chatAttachmentKind(file)}${++number}` });
    const addition = normalized.filter(file => !draft.includes(attachmentToken(file))).map(attachmentToken).join(' ');
    if (normalized.some((file, index) => file.reference !== attachments[index]?.reference)) {
      setExtras(current => ({ ...current, attachments: normalized }));
    }
    if (addition) setDraft(current => current ? `${current} ${addition}` : addition);
  // Restore older drafts that stored attachment metadata without inline refs.
  // New uploads insert both atomically and do not pass through this migration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const attachmentNumber = useRef(0);
  attachmentNumber.current = Math.max(attachmentNumber.current, ...attachments.map(file => Number(file.reference?.match(/\d+$/)?.[0]) || 0));
  const attachFiles = (files: ChatAttachment[], focus: boolean, at: ChatInsertionPoint) => {
    const labeled = files.map(file => ({ ...file, reference: `${file.context?.kind === 'code' ? '代码' : file.context?.kind === 'directory' ? '目录' : chatAttachmentKind(file)}${++attachmentNumber.current}` }));
    setExtras(current => ({ ...current, attachments: [...current.attachments, ...labeled] }));
    insertText(`${labeled.map(attachmentToken).join(' ')} `, focus, at);
  };
  const insertReference = (text: string, reference: unknown, focus = true) => {
    if (isContextReference(reference) && reference.text === text) {
      const node = input.current;
      attachFiles([{ path: reference.path, name: reference.path.replace(/\/$/, '').split('/').pop() || '/', context: { ...reference, id: crypto.randomUUID() } }], focus, node ? readChatEditor(node) : { value: draft, start: draft.length, end: draft.length });
    } else insertText(text, focus);
  };
  const chooseMember = (member: ChatMention) => {
    if (!mentionMatch || !active || !canMention) return;
    const start = caret - mentionMatch[1].length - 1, token = `${mentionToken(member)} `;
    const next = draft.slice(0, start) + token + draft.slice(caret);
    writeEditorDraft(next, start + token.length, true); setCaret(start + token.length); setDismissedMention(mentionKey);
    setExtras(current => ({ ...current, mentions: [...current.mentions.filter(item => item.sessionId !== member.sessionId || item.groupId !== member.groupId), member] }));
  };
  const transfer = useChatInputTransfer({ sessionId, active, canWrite: canWrite && !chatUnavailable, input, selection: () => input.current ? readChatEditor(input.current) : { value: draft, start: draft.length, end: draft.length }, insert: insertText, attach: attachFiles, error: setError,
    mediaCompression: true,
    sessionAttachments: !!access,
    directory: access ? access.directories?.find(directory => directory.access === 'write')?.path : '/tmp' });
  const quoteReference = useCallback((next: ChatReference) => {
    if (!active || !canWrite) return;
    if (new TextEncoder().encode(next.text).byteLength > 8000) { setError('选中的内容较长，请缩小需要引用的范围。'); return; }
    setSelectedReference(null);
    setReference(next);
    setError(''); window.getSelection()?.removeAllRanges(); focusKeyboardInput(input.current);
  }, [active, canWrite]);
  const quoteMessage = useCallback((message: ChatMessage, selected?: string) => {
    quoteReference({ author: message.role === 'user' ? '用户' : agentName, time: chatTime(message.createdAt), text: selected || chatDraftSummary(parseChatContent(message.content).text) });
  }, [agentName, quoteReference]);
  const quoteSelection = () => {
    if (!selectedReference) return;
    const parts = selectedReference.parts.map(part => ({ ...part, message: messages.find(message => message.id === part.id) }));
    if (parts.some(part => !part.message)) return;
    if (parts.length === 1) { quoteMessage(parts[0].message!, parts[0].text); return; }
    quoteReference({ author: '对话摘录', time: chatTime(parts[0].message!.createdAt), text: parts.map(part => `${part.message!.role === 'user' ? '用户' : agentName} · ${chatTime(part.message!.createdAt)}\n${part.text}`).join('\n\n') });
  };
  useEffect(() => {
    const root = section.current;
    if (!active) { root?.removeAttribute('data-chat-text-selection'); setSelectedReference(null); return; }
    const changed = () => {
      const selected = root ? readChatTextSelection(root, root.ownerDocument.getSelection()) : null;
      // Set synchronously: selection handles must be excluded from the pager
      // before its next pointerdown, including in readonly conversations.
      root?.toggleAttribute('data-chat-text-selection', !!selected);
      const value = canWrite ? selected : null;
      setSelectedReference(previous => {
        if (!previous || !value) return value;
        return previous.text === value.text && previous.parts.length === value.parts.length && previous.parts.every((part, i) => part.id === value.parts[i].id && part.text === value.parts[i].text) ? previous : value;
      });
    };
    document.addEventListener('selectionchange', changed); return () => { document.removeEventListener('selectionchange', changed); root?.removeAttribute('data-chat-text-selection'); };
  }, [active, canWrite]);
  useEffect(() => { try { if (reference) sessionStorage.setItem(`${storageKey}:reference`, JSON.stringify(reference)); else sessionStorage.removeItem(`${storageKey}:reference`); } catch { /* Keep the current quote. */ } }, [storageKey, reference]);
  const endpoint = `/api/terminal/${encodeURIComponent(sessionId)}/chat`;
  const applyMessages = useCallback((items: ChatMessage[], replace = false) => {
    const next = mergeChatMessages(replace ? [] : historyMessages.current, items);
    historyMessages.current = next; setMessages(next);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal, latest = false) => {
    if (replyAbort.current || locatingUnread.current) return;
    signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
    const sequence = ++refreshSequence.current, client = currentSecureClient();
    const current = historyMessages.current, after = latest ? undefined : current[current.length - 1]?.id;
    const confirmation = pendingRequest.current ? { requestId: pendingRequest.current.requestId } : {};
    let payload;
    try { payload = await readChatHistory(sessionId, signal, latest ? undefined : historyRevision.current, { ...(after ? { after } : {}), ...confirmation }); }
    catch (failure) {
      if (!after || (failure as { status?: number }).status !== 404) throw failure;
      payload = await readChatHistory(sessionId, signal, undefined, confirmation); latest = true;
    }
    if (signal.aborted || sequence !== refreshSequence.current || currentSecureClient() !== client) return;
    if (payload.unchanged && payload.revision && payload.revision === historyRevision.current) { setLoading(false); setSyncInterrupted(false); setHistoryReady(true); return; }
    const items = payload.messages;
    if (!Array.isArray(items) || payload.updates !== undefined && !Array.isArray(payload.updates)) throw new Error('暂时无法读取对话，请重试');
    const incoming = [...payload.updates ?? [], ...items];
    if (incoming.some(message => message.ui)) await loadChatRichContent();
    if (signal.aborted || sequence !== refreshSequence.current || currentSecureClient() !== client) return;
    setAgentAvailable(payload.agentAvailable === true);
    if (payload.chatIndex) useTerminalStore.getState().setSessionChatIndex(sessionId, payload.chatIndex);
    setAgentName(typeof payload.agent?.displayName === 'string' && payload.agent.displayName.trim() ? payload.agent.displayName : startupRef.current?.agent.displayName ?? '助手');
    setAgentSlug(typeof payload.agent?.slug === 'string' ? payload.agent.slug : startupRef.current?.agent.slug);
    historyRevision.current = typeof payload.revision === 'string' ? payload.revision : undefined;
    const replace = latest || current.length === 0;
    if (replace) {
      nearbyIds.clear();
      historyEpoch.current++; olderAbort.current?.abort();
      pageState.current.hasOlder = payload.page?.hasOlder === true; setHasOlder(pageState.current.hasOlder);
    }
    setReplyPending(payload.replyPending);
    // The end of a loaded history page is not the live tail. Appending the
    // next page must preserve the reader rather than skip through that page.
    if (!latest && pageState.current.hasNewer) nearBottom.current = false;
    pageState.current.hasNewer = payload.page?.hasNewer === true;
    const existing = new Set(current.map(message => message.id));
    // Follow short replies, but never scroll past the opening of a new reply
    // just because a whole long result (or several replies) arrived at once.
    if (!latest && current.length && nearBottom.current) {
      liveScrollTarget.current = items.find(message => message.role === 'assistant' && !existing.has(message.id))?.id;
    }
    if (pageState.current.hasNewer || current.length && !nearBottom.current && items.some(message => !existing.has(message.id))) setUnseen(true);
    applyMessages(incoming, replace);
    setPending(previous => previous && (payload.confirmedRequestId === previous.requestId || incoming.some(message => message.requestId === previous.requestId)) ? null : previous);
    setLoading(false); setSyncInterrupted(false); setHistoryReady(true);
  }, [sessionId, applyMessages, nearbyIds]);
  const loadOlder = useCallback(async () => {
    const before = historyMessages.current[0]?.id;
    if (replyAbort.current || !inputScope.current.active || !pageState.current.hasOlder || !before || olderBusy.current || Date.now() < olderRetryAt.current) return;
    const controller = new AbortController(), client = currentSecureClient(), epoch = historyEpoch.current;
    olderAbort.current = controller; olderBusy.current = true; setOlderLoading(true);
    try {
      const payload = await readChatHistory(sessionId, controller.signal, undefined, { before });
      if (!Array.isArray(payload.messages)) throw new Error('对话分页无效');
      if (payload.messages.some(message => message.ui)) await loadChatRichContent();
      if (controller.signal.aborted || currentSecureClient() !== client || epoch !== historyEpoch.current || !inputScope.current.active) return;
      captureAnchor();
      pageState.current.hasOlder = payload.page?.hasOlder === true; setHasOlder(pageState.current.hasOlder);
      applyMessages(payload.messages); olderRetryAt.current = 0;
    } catch (failure) {
      if (!controller.signal.aborted) {
        if ((failure as { status?: number }).status === 404) { pageState.current.hasOlder = false; setHasOlder(false); }
        else { olderRetryAt.current = Date.now() + 5000; setSyncInterrupted(true); }
      }
    } finally { if (olderAbort.current === controller) { olderBusy.current = false; olderAbort.current = undefined; if (inputScope.current.active) setOlderLoading(false); } }
  }, [sessionId, applyMessages, captureAnchor]);
  useEffect(() => {
    const edge = olderEdge.current, root = scroll.current;
    if (!active || !hasOlder || !edge || !root) return;
    const resume = () => { olderRetryAt.current = 0; if (root.scrollTop < root.clientHeight) void loadOlder(); };
    window.addEventListener('online', resume);
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadOlder(); }, { root, rootMargin: `${root.clientHeight}px 0px` });
    observer?.observe(edge);
    return () => { observer?.disconnect(); window.removeEventListener('online', resume); };
  }, [active, hasOlder, messages.length, loadOlder]);
  useEffect(() => {
    if (!active) setOlderLoading(false);
    return () => { olderAbort.current?.abort(); olderAbort.current = undefined; olderBusy.current = false; };
  }, [active]);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController(); let fetching = false, failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (fetching || document.visibilityState === 'hidden') return;
      clearTimeout(timer); fetching = true;
      try { await refresh(abort.signal); failures = 0; }
      catch { if (!abort.signal.aborted) { failures++; setSyncInterrupted(true); setLoading(false); } }
      finally {
        fetching = false;
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), Math.min(30_000, 2500 * 2 ** failures));
      }
    };
    void poll();
    window.addEventListener('online', poll); window.addEventListener(SECURE_READY_EVENT, poll); document.addEventListener('visibilitychange', poll);
    return () => { abort.abort(); clearTimeout(timer); window.removeEventListener('online', poll); window.removeEventListener(SECURE_READY_EVENT, poll); document.removeEventListener('visibilitychange', poll); };
  }, [visible, refresh]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { try { sessionStorage.setItem(`${storageKey}:draft`, draft); } catch { /* Storage may be unavailable. */ } }, [storageKey, draft]);
  useEffect(() => { try { if (pending) sessionStorage.setItem(`${storageKey}:pending`, JSON.stringify(pending)); else sessionStorage.removeItem(`${storageKey}:pending`); } catch { /* Keep the in-memory draft. */ } }, [storageKey, pending]);
  const bottom = useCallback(() => { const el = scroll.current; if (el && el.clientHeight) { el.scrollTop = el.scrollHeight; scrollPosition.current = el.scrollTop; nearBottom.current = true; if (!pageState.current.hasNewer) setUnseen(false); } }, []);
  const replaceReplyPage = useCallback((items: ChatMessage[], page: ReplyVisit['page'], revision?: string) => {
    historyEpoch.current++; olderAbort.current?.abort(); nearbyIds.clear();
    pageState.current = page; setHasOlder(page.hasOlder); historyRevision.current = revision;
    applyMessages(items, true);
  }, [applyMessages, nearbyIds]);
  const jumpToReply = useCallback(async (id: string, reply: string) => {
    if (!visibleRef.current || locatingUnread.current) return;
    const position = captureAnchor();
    if (!position) return;
    cancelReplyNavigation(); setReplyNavigationError(''); setLocatedMessageId(undefined);
    const visit: ReplyVisit = { position, reply, messages: historyMessages.current, page: { ...pageState.current }, revision: historyRevision.current };
    const controller = new AbortController(), client = currentSecureClient(), conversation = replyConversation.current;
    replyAbort.current = controller; setLocatingReply(reply);
    ++refreshSequence.current; historyEpoch.current++; olderAbort.current?.abort();
    const current = () => !controller.signal.aborted && replyAbort.current === controller && currentSecureClient() === client && visibleRef.current;
    try {
      if (!historyMessages.current.some(message => message.id === id)) {
        const payload = await readChatHistory(sessionId, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), undefined, { around: id });
        if (!current()) return;
        if (!Array.isArray(payload.messages) || !payload.messages.some(message => message.id === id)) throw new Error('原消息已不可用');
        if (conversation && payload.chatIndex?.conversationId && conversation !== payload.chatIndex.conversationId) throw new Error('原消息已不可用');
        if (payload.messages.some(message => message.ui)) await loadChatRichContent();
        if (!current()) return;
        if (payload.chatIndex) useTerminalStore.getState().setSessionChatIndex(sessionId, payload.chatIndex);
        replaceReplyPage(payload.messages, { hasOlder: payload.page?.hasOlder === true, hasNewer: payload.page?.hasNewer === true }, payload.revision);
      }
      nearBottom.current = false; unreadScrollTarget.current = undefined;
      replyVisits.current = [...replyVisits.current.slice(-4), visit]; setReturnCount(replyVisits.current.length);
      replyScrollTarget.current = { id }; setLocatedMessageId(id); setUnreadLocation(value => value + 1);
    } catch (failure) {
      if (current()) setReplyNavigationError((failure as { status?: number }).status === 404 ? '原消息已不可用，当前阅读位置已保留' : '暂时无法定位原消息，请稍后再试');
    } finally {
      if (replyAbort.current === controller) { replyAbort.current = undefined; setLocatingReply(undefined); }
    }
  }, [sessionId, captureAnchor, cancelReplyNavigation, replaceReplyPage]);
  const returnToReply = () => {
    cancelReplyNavigation();
    const visit = replyVisits.current.pop();
    if (!visit) return;
    ++refreshSequence.current; historyEpoch.current++; olderAbort.current?.abort();
    nearBottom.current = false; unreadScrollTarget.current = undefined;
    if (!historyMessages.current.some(message => message.id === visit.position.messageId)) replaceReplyPage(visit.messages, visit.page, visit.revision);
    replyScrollTarget.current = { position: visit.position }; setLocatedMessageId(visit.reply);
    setReturnCount(replyVisits.current.length); setUnreadLocation(value => value + 1);
  };
  const hasConversation = useRef(false); hasConversation.current = hasChatMessages;
  useLayoutEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.chatViewportRow;
        if (id) rowHeights.set(id, entry.target.getBoundingClientRect().height);
      }
      if (!visibleRef.current || !hasConversation.current) return;
      if (nearBottom.current) bottom(); else restoreAnchor();
      scrollPosition.current = scroll.current?.scrollTop ?? scrollPosition.current; captureAnchor();
    });
    observer.observe(content.current);
    if (scroll.current) observer.observe(scroll.current);
    // Observe rows as well: simultaneous growth above and shrinkage below the
    // reader can leave the total content height unchanged.
    content.current.querySelectorAll('[data-chat-viewport-row]').forEach(row => observer.observe(row, { box: 'border-box' }));
    return () => observer.disconnect();
  }, [messages, bottom, captureAnchor, restoreAnchor, rowHeights]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!visible || !el) return;
    if (!restoredScroll.current) { restoredScroll.current = true; if (snapshot) el.scrollTop = snapshot.scrollTop; }
    const referenceTarget = replyScrollTarget.current;
    if (referenceTarget) {
      if ('position' in referenceTarget) restorePosition(referenceTarget.position);
      else {
        const original = el.querySelector(`[data-chat-viewport-row="${CSS.escape(referenceTarget.id)}"]`);
        if (original) el.scrollTop += original.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
      }
      replyScrollTarget.current = undefined;
      programmaticScrollTop.current = el.scrollTop;
      scrollPosition.current = el.scrollTop; captureAnchor();
      return;
    }
    const target = unreadScrollTarget.current;
    const row = target ? el.querySelector<HTMLElement>(`[data-chat-viewport-row="${CSS.escape(target)}"]`) : null;
    if (row) {
      // The previous page can emit a delayed scroll event while this page is
      // loading. The explicit unread destination owns follow mode as well.
      el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
      nearBottom.current = !pageState.current.hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 96;
      scrollPosition.current = el.scrollTop; unreadScrollTarget.current = undefined;
      programmaticScrollTop.current = el.scrollTop;
      setUnseen(!nearBottom.current);
    } else if (liveScrollTarget.current && nearBottom.current) {
      const incoming = [...el.querySelectorAll<HTMLElement>('[data-chat-viewport-row]')].find(row => row.dataset.chatViewportRow === liveScrollTarget.current);
      liveScrollTarget.current = undefined;
      if (incoming) {
        const start = el.scrollTop + incoming.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
        el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, Math.max(el.scrollTop, start));
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        setUnseen(!nearBottom.current || pageState.current.hasNewer);
        programmaticScrollTop.current = el.scrollTop;
      } else bottom();
    } else if (nearBottom.current && hasConversation.current) bottom();
    else restoreAnchor();
    scrollPosition.current = el.scrollTop; captureAnchor();
  }, [messages, pending, visible, hasOlder, bottom, unreadLocation, captureAnchor, restoreAnchor, restorePosition, snapshot]);
  const snapshotState = useRef({ messages, agentName, agentSlug, agentAvailable, replyPending, hasOlder, hasNewer: pageState.current.hasNewer });
  snapshotState.current = { messages, agentName, agentSlug, agentAvailable, replyPending, hasOlder, hasNewer: pageState.current.hasNewer };
  useEffect(() => {
    const client = currentSecureClient(), cacheGeneration = chatSnapshotGeneration();
    return () => {
      const state = snapshotState.current;
      if (state.agentAvailable !== undefined && currentSecureClient() === client && cacheGeneration === chatSnapshotGeneration()) saveChatSnapshot(storageKey, { ...state, agentAvailable: state.agentAvailable, scrollTop: scrollPosition.current, nearBottom: nearBottom.current, rowHeights: [...rowHeights], visibleMessageIds: [...nearbyIds] });
    };
  }, [storageKey]);
  const send = async (retry?: Pending, actionContent?: string): Promise<boolean> => {
    if (busy.current || transfer.busy || !inputScope.current.active || !inputScope.current.canWrite || agentAvailable !== true) return false;
    const item = retry || { content: actionContent ?? composeChatContent(composeChatDraft(draft, attachments, mentions), reference), requestId: crypto.randomUUID(), createdAt: Date.now() };
    if (!item.content || new TextEncoder().encode(item.content).byteLength > 32000) return false;
    cancelReplyNavigation(true);
    busy.current = true; setSending(true); setError(''); setReplyPending(undefined); setPending(item); nearBottom.current = true;
    // The pending message owns this content now. Acknowledgements must never
    // clear the next draft, including one with the same text as this message.
    if (!retry && actionContent === undefined) {
      // Moving a Selection into a contenteditable can reopen a dismissed
      // mobile keyboard even without calling focus(). Clear content only.
      pendingEditorCaret.current = null; focusEditorAfterUpdate.current = false;
      setDraft(''); setReference(null); setExtras(parseChatDraft('')); setDismissedMention(null);
    }
    const attempt = generation.current;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: item.content, requestId: item.requestId }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw new Error('发送失败，请重试。');
      if (attempt !== generation.current) return false;
      setPending(null);
      setMessages(current => current.some(m => m.id === payload.id) ? current : [...current, { ...item, id: payload.id, role: 'user', status: payload.status }]);
      try { await refresh(); } catch { setSyncInterrupted(true); }
      return true;
    } catch (failure) { if (attempt === generation.current) setError(failure instanceof Error && failure.name === 'TimeoutError' ? '发送状态待确认，请重试。' : '发送失败，请重试。'); return false; }
    finally { busy.current = false; if (attempt === generation.current) setSending(false); }
  };
  useEffect(() => { const insert = (event: Event) => { const detail = (event as CustomEvent<{ sessionId: string; text: string }>).detail; if (active && canWrite && detail.sessionId === sessionId) { insertText(detail.text); } }; window.addEventListener('termdock:chat-insert', insert); return () => window.removeEventListener('termdock:chat-insert', insert); }, [sessionId, active, canWrite, insertText]);
  useEffect(() => {
    if (!active) return;
    const insert = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; text?: string; nonce?: string; ownedPaste?: boolean; focus?: boolean; reference?: unknown }>).detail;
      if (!detail?.text || detail.sessionId !== sessionId) return;
      event.stopImmediatePropagation();
      const allowed = canWrite && (!detail.ownedPaste || !!authorizeOwnedTerminalPaste(detail, sessionId));
      if (allowed) { insertReference(detail.text!, detail.reference, detail.focus !== false); }
      if (detail.nonce) window.dispatchEvent(new CustomEvent('termdock-insert-reference-ack', { detail: { nonce: detail.nonce, ok: allowed } }));
    };
    window.addEventListener('termdock-insert-reference', insert, true);
    return () => window.removeEventListener('termdock-insert-reference', insert, true);
  }, [sessionId, active, canWrite, insertReference]);
  const sendLatest = useRef(send); sendLatest.current = send;
  const onAction = useCallback((content: string) => sendLatest.current(undefined, content), []);
  const onCopy = useCallback((text: string, id: string) => {
    void writeTerminalClipboardText(text, () => section.current?.isConnected === true).then(ok => { if (ok) setCopied(id); else setError('复制失败，请选择正文复制'); });
  }, []);
  const jumpLatest = async () => {
    cancelReplyNavigation(true);
    if (pageState.current.hasNewer) {
      nearBottom.current = true;
      try { await refresh(undefined, true); } catch { setSyncInterrupted(true); }
    }
    bottom();
  };
  const jumpUnread = useCallback(async () => {
    const id = useTerminalStore.getState().sessions.get(sessionId)?.chatAttention?.unreadIds[0];
    if (!id || locatingUnread.current || !visibleRef.current) return;
    cancelReplyNavigation(true);
    liveScrollTarget.current = undefined;
    const sequence = ++refreshSequence.current, client = currentSecureClient();
    locatingUnread.current = true; nearBottom.current = false; setUnreadEntryReady(false);
    let located = false;
    try {
      if (!historyMessages.current.some(message => message.id === id)) {
        const payload = await readChatHistory(sessionId, AbortSignal.timeout(15000), undefined, { around: id });
        if (sequence !== refreshSequence.current || currentSecureClient() !== client || !visibleRef.current) return;
        if (!Array.isArray(payload.messages) || !payload.messages.some(message => message.id === id)) throw new Error('暂时无法读取对话');
        if (payload.messages.some(message => message.ui)) await loadChatRichContent();
        if (sequence !== refreshSequence.current || currentSecureClient() !== client || !visibleRef.current) return;
        if (payload.chatIndex) useTerminalStore.getState().setSessionChatIndex(sessionId, payload.chatIndex);
        pageState.current.hasOlder = payload.page?.hasOlder === true; setHasOlder(pageState.current.hasOlder);
        pageState.current.hasNewer = payload.page?.hasNewer === true;
        historyRevision.current = payload.revision;
        historyEpoch.current++; olderAbort.current?.abort(); nearbyIds.clear();
        applyMessages(payload.messages, true);
      }
      unreadScrollTarget.current = id; setUnreadLocation(value => value + 1); located = true;
    } catch { if (visibleRef.current) { unreadEntry.current = false; setSyncInterrupted(true); } }
    finally { locatingUnread.current = false; if (visibleRef.current) setUnreadEntryReady(located); }
  }, [sessionId, applyMessages, nearbyIds, cancelReplyNavigation]);
  useEffect(() => {
    if (!visible) return;
    const open = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) void jumpUnread();
    };
    window.addEventListener('switch-terminal-session', open);
    return () => window.removeEventListener('switch-terminal-session', open);
  }, [visible, sessionId, jumpUnread]);
  useEffect(() => {
    if (!visible) { unreadEntry.current = false; setUnreadEntryReady(false); return; }
    if (!historyReady || loading || syncInterrupted || unreadEntry.current) return;
    const attention = useTerminalStore.getState().sessions.get(sessionId)?.chatAttention;
    if (!attention?.index) return;
    unreadEntry.current = true;
    if (attention.unreadIds.length) void jumpUnread();
    else setUnreadEntryReady(true);
  }, [visible, historyReady, loading, syncInterrupted, unreadIds, jumpUnread, sessionId]);
  const terminalOutputActive = useTerminalOutputActivity(sessionId, visible && hasChatMessages);
  const reportedWorking = useTerminalStore(state => {
    const session = state.sessions.get(sessionId);
    return visible && hasChatMessages && (session?.agentStatus === 'working' || shouldShowTuiLoading(session));
  });
  const reportedStopped = useTerminalStore(state => {
    const session = state.sessions.get(sessionId), progress = session?.tuiProgress;
    return session?.agentStatus === 'waiting' || !!session?.agentNeedsReview && !(session.chatAttention?.mode && session.chatAttention.index)
      || session?.agentStatus === 'done' && !shouldShowTuiLoading(session)
      || session?.agentStatus !== 'working' && !!progress && ['blocked', 'done', 'error', 'pause'].includes(progress.state);
  });
  const inputRequestLabel = useTerminalStore(state => {
    if (!visible || !hasChatMessages) return null;
    const session = state.sessions.get(sessionId), progress = session?.tuiProgress;
    // Hook waiting signals do not retain the native request kind. Only the
    // terminal's explicit typed report can distinguish a question/permission.
    if (session?.agentStatus === 'waiting') return '等你处理';
    if (session?.agentStatus === 'working' || progress?.state !== 'blocked') return null;
    return progress.kind === 'question' ? '待回答' : progress.kind === 'permission' ? '待确认'
      : progress.kind === 'auth' ? '需要登录' : '等你处理';
  });
  const waitingForReply = agentAvailable === true && !pending && (replyPending ?? hasUnansweredMessage(messages));
  const sendingReply = sending && !!pending;
  // The status entry uses one label for sending and observed activity.
  // Delivery details remain on the message itself.
  const hasUserRequest = !!pending || messages.some(message => message.role === 'user');
  const deliveryNotice = messages.slice().reverse().find(message => message.role === 'user' && message.status === 'pending' && message.delivery);
  const awaitingDelivery = messages.slice().reverse().find(message => message.role === 'user')?.status === 'pending';
  const replyPhase = inputRequestLabel ? 'input' : hasChatMessages && (!freshLaunch || hasUserRequest) && !reportedStopped && (terminalOutputActive || reportedWorking) ? 'output' : !error && !deliveryNotice && (sendingReply || awaitingDelivery) ? 'sending' : null;
  const latestQuestion = messages.slice().reverse().find(message => message.role === 'user');
  const waitingForFirstReply = (sendingReply || !reportedStopped && (waitingForReply || replyPhase === 'output')) && !inputRequestLabel && !error && !deliveryNotice && (!!pending || !!latestQuestion && !['failed', 'expired', 'cancelled'].includes(latestQuestion.status) && !hasReplyToLatestMessage(messages));
  const replyFeedback = waitingForFirstReply ? <span className="sr-only">尚未收到回复</span> : null;
  const replyLabel = inputRequestLabel ?? '处理中…';
  const inputUnconfirmed = useChatTerminalInputCheck(sessionId, replyPhase, active && visible && hasChatMessages && canWrite && capabilities.has('session.input') && agentAvailable === true && !sending && !pending, active && visible && hasChatMessages && capabilities.has('session.input'));
  const terminalAccess = <div data-chat-terminal-access data-chat-reply-status={!!replyPhase || undefined} data-chat-reply-phase={replyPhase ?? 'idle'} role={replyPhase ? 'status' : undefined} aria-label={replyPhase ? `${agentName}${replyLabel.replace('…', '')}` : undefined} aria-live="polite" title="查看终端中的详细输出" className="pointer-events-auto w-fit max-w-full shrink-0">
    <TerminalPeekTrigger label={inputUnconfirmed ? '输入响应未确认，查看终端' : '查看终端详情'} className={`${floatingButton} text-foreground/80`}>
      {replyPhase === 'input' ? <MessageCircle size={11} aria-hidden="true" className="shrink-0 text-primary" /> : replyPhase ? <LoadingSpinner size={11} className="shrink-0 text-primary" /> : <TerminalSquare size={11} aria-hidden="true" />}
      <span>{replyPhase ? replyLabel : inputUnconfirmed ? '检查终端' : '详情'}</span><ChevronUp size={10} aria-hidden="true" className="ml-0.5 text-muted-foreground" />
    </TerminalPeekTrigger>
  </div>;
  const unavailableNotice = <div role="status" data-chat-unavailable className="mx-auto w-full max-w-md rounded-2xl border [border-color:rgb(var(--warning-rgb)/0.4)] bg-surface p-6 text-center">
    <TerminalSquare size={28} aria-hidden="true" className="mx-auto mb-4 text-[var(--warning)]" />
    <h2 className="text-lg font-semibold text-foreground">当前对话暂不可用</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{capabilities.has('session.terminal-view') ? '请在终端中启动或检查 Agent，再回来继续对话。' : '请联系会话所有者启动或检查 Agent，再回来继续对话。'}</p>
    {replyPhase && <p className="mt-2 text-xs text-muted-foreground">{replyLabel}</p>}
    {capabilities.has('session.terminal-view') && <button type="button" className={`${button} mt-5 bg-primary text-primary-foreground hover:bg-primary/90`} onClick={onTerminal}><TerminalSquare size={16} aria-hidden="true" />打开终端</button>}
  </div>;
  const tooLong = new TextEncoder().encode(composeChatContent(composeChatDraft(draft, attachments, mentions), reference)).byteLength > 32000;
  return <section ref={section} style={keyboardLayout.rootStyle} data-session-chat onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; if (canWrite) setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = canWrite ? 'copy' : 'none'; } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }} onDrop={event => { let draggedReference: string | null; try { draggedReference = readFileReferenceDrag(event.dataTransfer); } catch (error) { event.preventDefault(); setError(error instanceof Error ? error.message : '文件引用无效'); return; } if (draggedReference && active && canWrite) { event.preventDefault(); event.stopPropagation(); insertReference(draggedReference, readContextReferenceDrag(event.dataTransfer)); return; } const files = Array.from(event.dataTransfer.files); if (files.length) { event.preventDefault(); event.stopPropagation(); setDragging(false); dragDepth.current = 0; transfer.addFiles(files); } else if (canWrite && (event.target as Element).closest('[data-chat-composer]')) { const text = event.dataTransfer.getData('text/plain'); if (text) { event.preventDefault(); insertText(text); } } }} onKeyDown={e => e.stopPropagation()} className="session-chat relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--chrome-bg)] text-foreground" aria-label={`${name}对话`}>
    {canClearDisplay && <div className="flex shrink-0 items-center justify-end gap-2 px-4 text-xs text-muted-foreground">{displayCutoff && <button type="button" className="min-h-11 rounded-lg px-2 hover:bg-surface-2" onClick={restoreDisplay}>恢复旧记录</button>}<button type="button" className="min-h-11 rounded-lg px-2 hover:bg-surface-2 disabled:opacity-40" disabled={!displayMessages.length} title="仅清空当前设备的显示，保留记录和 Agent 上下文" onClick={clearDisplay}>清空显示</button></div>}
    {mediaSettingsOpen && active && canWrite && <ChatMediaSettingsDialog close={() => setMediaSettingsOpen(false)} />}
    <MediaUploadToast result={active ? transfer.mediaResult : null} onDismiss={transfer.dismissMediaResult} />
    <div ref={scroll} style={keyboardLayout.contentStyle} className="session-chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 [overflow-anchor:none] sm:px-8" onScroll={() => { const el = scroll.current!; if (!active || !el.clientHeight) return; scrollPosition.current = el.scrollTop; captureAnchor(); const programmed = programmaticScrollTop.current; programmaticScrollTop.current = undefined; if (programmed !== undefined && Math.abs(el.scrollTop - programmed) < 1) return; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; setUnseen(!nearBottom.current || pageState.current.hasNewer); if (el.scrollTop < el.clientHeight) void loadOlder(); }}>
      <div ref={content} className={`mx-auto flex min-h-full w-full max-w-screen-2xl flex-col ${messages.length || pending ? 'pb-12 pt-5 sm:pt-8' : 'py-5 sm:py-8'}`}>
        {hasOlder && !displayCutoff && <div ref={olderEdge} data-chat-older-edge aria-hidden="true" className="h-12 shrink-0">{olderLoading && <div className="space-y-2 py-2"><div className="chat-loading-skeleton h-3 w-3/4 rounded bg-surface-2" /><div className="chat-loading-skeleton h-3 w-1/2 rounded bg-surface-2" /></div>}</div>}
        {!startup && (loading || !historyReady) && !displayMessages.length && !pending ? <ChatLoading /> : !displayMessages.length && !pending && chatUnavailable ? <div className="my-auto py-6">{unavailableNotice}</div> : !displayMessages.length && !pending ? <div className={`session-chat-welcome mx-auto flex shrink-0 flex-col items-center py-6 text-center ${touchLayout && keyboard.isOpen ? '' : 'my-auto'}`}><MessageCircle size={27} strokeWidth={1.5} className="mb-4 text-primary" /><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">想一起完成什么？</h2><p className="mt-2 max-w-md text-[15px] leading-7 text-muted-foreground">直接描述你的目标，或从一个问题开始。</p><div className="mt-5 flex flex-wrap justify-center gap-2">{['帮我梳理一下当前工作', '请解释一下刚才的结果', '我们继续下一步'].map(text => <button type="button" key={text} className={`${button} border border-border/60 text-left text-xs text-muted-foreground`} disabled={!canWrite} onClick={() => { writeEditorDraft(text, text.length, true); }}>{text}</button>)}</div><SessionModeWelcomeHint onTerminal={onTerminal} /></div> : <ChatTimeline replyFeedback={replyFeedback} onJumpToReply={jumpToReply} locatingReply={locatingReply} locatedMessageId={locatedMessageId} unreadIds={unreadIds} viewing={visible && unreadEntryReady && historyReady && !loading && !syncInterrupted} onViewed={markViewed} pendingMessage={pending && <ChatUserMessage content={pending.content} createdAt={pending.createdAt} status={sending ? '发送中…' : '待重试'}>{!sending && <><button type="button" className="min-h-9 rounded-lg px-2 hover:bg-surface-2" onClick={() => { const parsed = parseChatContent(pending.content); const restored = parseChatDraft(parsed.text); writeEditorDraft(restored.text, restored.text.length, true); setExtras(restored); setReference(parsed.reference); setPending(null); setError(''); focusKeyboardInput(input.current); }}>修改草稿</button><button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-primary hover:bg-surface-2" disabled={!canWrite || agentAvailable !== true} onClick={() => void send(pending)}><RefreshCw size={12} />重试发送</button></>}</ChatUserMessage>} sessionId={sessionId} uiWritable={active && canWrite && !pending && !sending && agentAvailable === true} onAction={onAction} messages={displayMessages} scrollRoot={scroll} nearbyIds={nearbyIds} agentName={agentName} agentSlug={agentSlug} canWrite={canWrite && !chatUnavailable} copied={copied} onReference={quoteMessage} onCopy={onCopy} />}
      </div>
    </div>
    {dragging && <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-surface/95 text-sm text-primary"><Paperclip size={18} className="mr-2" />松开以添加文件</div>}
    {chatUnavailable && (!!displayMessages.length || !!pending) && <div className="shrink-0 px-3 pb-4 sm:px-8">
      {deliveryNotice && <ChatDeliveryNotice message={deliveryNotice} sessionId={sessionId} canWrite={active && canWrite && capabilities.has('session.owner-menu')} onTerminal={onTerminal} onRecovered={() => void refresh().catch(() => setSyncInterrupted(true))} />}
      {unavailableNotice}
    </div>}
    <div ref={composer} hidden={chatUnavailable} className="session-chat-composer relative z-20 shrink-0 px-3 pb-3 pt-1 sm:px-8 sm:pb-4">

      <div className="relative mx-auto max-w-screen-2xl">
      {startup && agentAvailable !== true && !displayMessages.length && !pending && <div data-chat-launch-status className="mb-2"><SessionChatStartupStatus launch={startup} interrupted={syncInterrupted} onTerminal={onTerminal} /></div>}
      {deliveryNotice && !chatUnavailable && <ChatDeliveryNotice message={deliveryNotice} sessionId={sessionId} canWrite={active && canWrite && capabilities.has('session.owner-menu')} onTerminal={onTerminal} onRecovered={() => void refresh().catch(() => setSyncInterrupted(true))} />}
      {selectedReference && <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 flex justify-center"><div className="pointer-events-auto flex max-w-full items-center overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg transition-colors hover:bg-surface-elevated focus-within:bg-surface-elevated"><button type="button" aria-label="引用选中内容" className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-l-xl px-3 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onPointerDown={event => event.preventDefault()} onClick={quoteSelection}><Quote size={13} className="shrink-0 text-primary" /><span className="shrink-0 text-primary">引用选中内容</span><span className="hidden min-w-0 max-w-sm truncate text-muted-foreground sm:block">{selectedReference.text}</span></button><button type="button" aria-label="取消选中引用" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => { setSelectedReference(null); window.getSelection()?.removeAllRanges(); }}><X size={13} /></button></div></div>}
      {transfer.transfer && <div role="status" data-chat-upload-status className="absolute bottom-full right-0 z-20 mb-2 flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-xs text-muted-foreground shadow-lg">{transfer.busy && <LoaderCircle size={13} className="animate-spin text-primary" />}<span className="min-w-0 flex-1">{transfer.transfer.stage === 'reading' ? '正在读取剪贴板…' : transfer.transfer.stage === 'compressing' ? `正在压缩 ${transfer.transfer.fileName || '媒体'}${transfer.transfer.fileIndex && (transfer.transfer.files?.length || 0) > 1 ? `（${transfer.transfer.fileIndex}/${transfer.transfer.files!.length}）` : ''}${transfer.transfer.percent === undefined ? '…' : ` · ${transfer.transfer.percent}%`}` : transfer.transfer.stage === 'uploading' ? `正在上传文件${transfer.transfer.percent === undefined ? '…' : ` · ${transfer.transfer.percent}%`}` : transfer.transfer.stage === 'cancelled' ? '已取消上传' : '上传未完成，文件尚未添加'}</span>{transfer.busy ? <button type="button" className="min-h-9 px-2" onClick={transfer.cancel}>取消</button> : <><button type="button" className="min-h-9 px-2 text-primary" onClick={transfer.retry}>重试上传</button><button type="button" aria-label="关闭上传提示" className="min-h-9 px-2" onClick={transfer.dismiss}><X size={13} /></button></>}</div>}
      {mentionOpen && <div id={mentionListId} role="listbox" aria-label="选择协作成员" data-chat-no-swipe className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-[min(20rem,calc(var(--app-visible-vh,100dvh)*0.45))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-2 shrink-0 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground"><span>@ 联系会话</span><button type="button" aria-label="关闭成员选择" className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2" onPointerDown={event => event.preventDefault()} onClick={() => setDismissedMention(mentionKey)}><X size={14} /></button></div>
        {roster.unsupportedRemote && <p className="shrink-0 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">部分远端服务需更新后才能直接联系</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{roster.status === 'loading' ? <p role="status" className="px-3 py-4 text-sm text-muted-foreground">正在加载成员…</p> : roster.status === 'error' ? <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">暂时无法读取成员<button type="button" className={button} onClick={roster.retry}>重试</button></div> : !memberOptions.length ? <p className="px-3 py-4 text-sm text-muted-foreground">{roster.members.length ? '没有匹配的成员' : '暂无其他可联系的 Agent 会话'}</p> : memberOptions.map((member, index) => <button key={`${member.groupId}:${member.sessionId}`} id={`${mentionListId}-${index}`} role="option" aria-selected={index === selectedMemberIndex} type="button" className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 ${index === selectedMemberIndex ? 'bg-surface-2' : ''}`} onPointerDown={event => event.preventDefault()} onClick={() => chooseMember(member)}><AtSign size={15} className="shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate">{member.name}</span>{member.subtitle && <span className="block truncate text-xs text-muted-foreground">{member.subtitle}</span>}</span><span className="max-w-[40%] truncate text-xs text-muted-foreground">{member.groupName || '直接联系'}</span></button>)}</div>
        <p className="shrink-0 border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">让当前 Agent 按你的要求联系该成员</p>
      </div>}
      <div data-chat-terminal-dock className="pointer-events-none relative z-20 mb-1.5 flex min-h-8 items-end justify-between sm:min-h-7">
        {terminalAccess}
        {locatingReply || returnCount > 0 ? <button type="button" aria-label={locatingReply ? '取消定位' : '返回回复'} className={`${floatingButton} pointer-events-auto ml-3 text-foreground/80`} onPointerDown={event => event.preventDefault()} onClick={() => locatingReply ? cancelReplyNavigation() : returnToReply()}>
          {locatingReply ? <X size={13} aria-hidden="true" /> : <CornerDownRight size={13} aria-hidden="true" />}<span>{locatingReply ? '取消定位' : '返回回复'}</span>
        </button> : (unseen || unreadIds.length > 0) && <div data-chat-new-message-prompt className="chat-new-message-prompt pointer-events-auto ml-3 min-w-0"><button type="button" aria-label={unreadIds.length ? `${unreadIds.length} 条未读消息` : '回到最新'} className={`${floatingButton} text-foreground/80`} onPointerDown={event => event.preventDefault()} onClick={() => void (unreadIds.length ? jumpUnread() : jumpLatest())}><ArrowDown size={14} className="shrink-0" /><span className="truncate">{unreadIds.length ? `${unreadIds.length} 条未读` : '回到最新'}</span></button></div>}
      </div>
      <form data-chat-composer className="rounded-2xl border border-border bg-surface p-2.5 transition-colors focus-within:border-primary/60" onSubmit={e => { e.preventDefault(); if (!pending) void send(); }}>
        {reference && <ChatReferenceCard reference={reference} onRemove={() => setReference(null)} />}
        <input ref={filePicker} type="file" multiple tabIndex={-1} className="hidden" aria-label="选择附件" onChange={event => { transfer.addFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ''; }} />
        <div className="relative min-w-0 w-full">
        <div aria-hidden="true" className={`session-chat-input-sizer pointer-events-none col-start-1 row-start-1 overflow-hidden whitespace-pre-wrap break-words px-1 py-2 text-base leading-7 ${inputMasked ? '' : 'invisible'} ${draft ? '' : 'text-muted-foreground/60'}`}>{draft ? <ChatInlineContent text={draft + ' '} files={attachments} mentions={mentions} mirror /> : (inputMasked ? canWrite ? '输入消息… ' : '此会话仅允许查看 ' : ' ')}</div>
        <ChatRichEditor input={input} value={draft} files={attachments} mentions={mentions} masked={inputMasked} readOnly={!canWrite || chatUnavailable} label={`给${agentName}的消息`} placeholder={canWrite ? '输入消息…' : '此会话仅允许查看'}
          onInput={updateFromEditor} onFocus={() => setSelectedReference(null)} onTokenRemove={removeComposerToken}
          onPaste={event => { const { files, text } = clipboardEventContent(event.clipboardData); const native = getTermdockDesktopBridge();
            if (files.length || native?.readClipboardFiles || !text && (native || typeof navigator.clipboard?.read === 'function')) { event.preventDefault(); void transfer.paste({ files, text }); return; }
            if (text) { event.preventDefault(); const selection = input.current ? readChatEditor(input.current) : { start: draft.length, end: draft.length }; const next = draft.slice(0, selection.start) + text + draft.slice(selection.end); writeEditorDraft(next, selection.start + text.length, true); }
          }}
          onKeyDown={event => { event.stopPropagation(); const selection = input.current ? readChatEditor(input.current) : { value: draft, start: draft.length, end: draft.length };
            setCaret(selection.end);
            if (mentionOpen && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              if (event.key === 'Escape') { event.preventDefault(); setDismissedMention(mentionKey); return; }
              if (['ArrowDown', 'ArrowUp'].includes(event.key) && memberOptions.length) { event.preventDefault(); setMemberIndex((selectedMemberIndex + (event.key === 'ArrowDown' ? 1 : -1) + memberOptions.length) % memberOptions.length); return; }
              if ((event.key === 'Enter' && !event.shiftKey || event.key === 'Tab') && memberOptions.length && roster.status === 'ready') { event.preventDefault(); chooseMember(memberOptions[selectedMemberIndex]); return; }
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return; }
            }
            if (event.key === 'Enter' && !touchLayout && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!pending) void send(); return; }
            if (event.key === 'Enter' && touchLayout) { event.preventDefault(); const next = `${draft.slice(0, selection.start)}\n${draft.slice(selection.end)}`; writeEditorDraft(next, selection.start + 1, false); }
          }} />
        </div>
        <div data-chat-composer-toolbar className="mt-1 flex items-center gap-1">
        <button type="button" aria-label="添加文件" title="添加文件，也可拖入或粘贴" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-2 disabled:opacity-30" disabled={!canWrite || transfer.busy} onPointerDown={event => event.preventDefault()} onClick={() => filePicker.current?.click()}><Paperclip size={18} /></button>
        {canMention && <button type="button" aria-label="提及协作成员" title="提及协作成员" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2" onPointerDown={event => event.preventDefault()} onClick={() => { const node = input.current; const current = node ? readChatEditor(node) : { start: draft.length, end: draft.length }; const start = current.start, end = current.end; const prefix = start && !/\s$/.test(draft.slice(0, start)) ? ' @' : '@'; writeEditorDraft(draft.slice(0, start) + prefix + draft.slice(end), start + prefix.length, true); setCaret(start + prefix.length); setDismissedMention(null); focusKeyboardInput(input.current);  }}><AtSign size={18} /></button>}
        <ChatComposerActions sessionId={sessionId} active={active} canWrite={canWrite} mediaBusy={transfer.busy} onMediaSettings={() => setMediaSettingsOpen(true)} onOpen={() => { setDismissedMention(mentionKey); setSelectedReference(null); }} />
        <span className="session-chat-keyboard-hint hidden min-w-0 flex-1 px-2 text-[11px] text-muted-foreground/60 sm:block">Enter 发送 · Shift + Enter 换行</span>
        <span className="flex-1 sm:hidden" aria-hidden="true" />
        <button type="submit" aria-label="发送消息" onPointerDown={e => { if (document.activeElement === input.current) e.preventDefault(); }} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30" disabled={sending || transfer.busy || !!pending || (!draft.trim() && !attachments.length) || tooLong || !canWrite || agentAvailable !== true}><ArrowUp size={19} /></button>
        </div>
      </form>
      {tooLong ? <p className="mt-2 px-1 text-xs text-destructive">消息过长，请缩短后发送。</p> : !canWrite ? <p className="mt-2 px-1 text-[11px] text-muted-foreground">仅查看</p> : null}
      {terminalLink && capabilities.has('session.terminal-view') && <div className="mt-1 flex justify-end"><button type="button" className={`${button} min-h-9 px-2 text-xs text-muted-foreground`} onClick={onTerminal}><TerminalSquare size={13} />查看终端</button></div>}</div>
    </div>
  </section>;
}

/** A changed session or service starts a separate draft, request and viewport. */
export function SessionChatView(props: Parameters<typeof SessionChatContent>[0]) {
  return <ChatFileNavigation key={`${savedConnection()?.targetPeerId || location.origin}:${props.sessionId}`} sessionId={props.sessionId} canWrite={props.canWrite} active={props.active}>
    <SessionChatContent {...props} />
  </ChatFileNavigation>;
}
