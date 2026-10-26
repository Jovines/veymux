import { useSessionCapabilities } from '../../federation/ShareAccessContext';
import type { ChatMessage } from './chatMessages';
import { useEffect, useRef, useState } from 'react';
import { currentSecureClient } from '../../federation/browserIntegration';

export function ChatDeliveryNotice({ message, sessionId, canWrite, onTerminal, onRecovered }: {
  message: ChatMessage; sessionId: string; canWrite: boolean; onTerminal: () => void; onRecovered: () => void;
}) {
  const canViewTerminal = useSessionCapabilities().has('session.terminal-view');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { setBusy(false); setError(''); setDetails(false); return () => { request.current?.abort(); request.current = null; }; }, [sessionId, message.id]);
  const delivery = message.status === 'pending' ? message.delivery : undefined;
  if (!delivery) return null;
  const recover = async (resolution?: 'retry' | 'cancel') => {
    if (request.current || !canWrite) return;
    const controller = new AbortController(), client = currentSecureClient(); request.current = controller;
    setBusy(true); setError('');
    try {
      const endpoint = `/api/terminal/${encodeURIComponent(sessionId)}/chat/${resolution ? `${encodeURIComponent(message.id)}/delivery` : 'recover'}`;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: resolution ? JSON.stringify({ action: resolution, attempt: delivery.blockedBy?.attemptCount ?? delivery.attemptCount,
        ...(delivery.blockedBy ? { blockingMessageId: delivery.blockedBy.messageId } : {}) }) : '{}', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (controller.signal.aborted || currentSecureClient() !== client) return;
      if (!response.ok) throw new Error('unavailable');
      onRecovered();
    } catch { if (!controller.signal.aborted && currentSecureClient() === client) setError('暂时无法恢复，消息已保留。可查看终端中的会话。'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const text = delivery.blockedBy ? '前一条投递未确认，后续消息已暂停。请检查终端后重新投递。' : delivery.inputCheckFailed ? delivery.state === 'outcome-unknown'
    ? '终端输入检测未通过，已暂停投递。请查看终端，检查是否有残留输入。'
    : '终端暂时无法接收输入，消息已保留。请查看终端。' : {
    'binding-required': '终端连接已变化，消息尚未投递。',
    retrying: '暂时无法投递，连接恢复后会继续发送。',
    starting: '正在等待终端启动，消息已保留。',
    'shell-confirmation-required': '终端当前未运行 Agent，消息尚未投递。',
    'outcome-unknown': '上次投递结果待确认，已暂停自动重试。请查看终端，避免重复发送。',
  }[delivery.state];
  if (delivery.inputCheckFailed) return <div role="status" data-chat-delivery-notice className="mb-1 px-1 text-xs leading-5 text-muted-foreground">
    <div className="flex min-h-11 items-center gap-3"><span className="min-w-0 flex-1">未发送成功</span><button type="button" aria-expanded={details} className="min-h-11 px-1 hover:text-foreground" onClick={() => setDetails(value => !value)}>详情</button>
      {canWrite && (delivery.blockedBy || delivery.state === 'outcome-unknown' && delivery.attemptCount) && <button type="button" disabled={busy} aria-busy={busy} className="min-h-11 px-1 text-primary disabled:opacity-50" onClick={() => void recover('retry')}>{busy ? '重试中…' : '重试'}</button>}
    </div>
    {details && <div className="rounded-lg bg-surface px-3 py-2"><p>{text}</p><div className="flex flex-wrap justify-end gap-3">{canViewTerminal && <button type="button" className="min-h-11 text-primary" onClick={onTerminal}>查看终端</button>}{canWrite && (delivery.blockedBy || delivery.state === 'outcome-unknown' && delivery.attemptCount) && <button type="button" disabled={busy} className="min-h-11" onClick={() => void recover('cancel')}>{delivery.blockedBy ? '停止阻塞的投递' : '停止这条投递'}</button>}</div></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
  return <div role="status" data-chat-delivery-notice className="mb-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted-foreground">
    <div className="flex flex-wrap items-center gap-x-3"><span className="min-w-0 flex-1">{text}</span>{delivery.canReconnect && canWrite && <button type="button" disabled={busy} aria-busy={busy} className="min-h-11 shrink-0 text-primary disabled:opacity-50" onClick={() => void recover()}>{busy ? '连接中…' : '重新连接'}</button>}{canViewTerminal && <button type="button" className="min-h-11 shrink-0 text-primary" onClick={onTerminal}>查看终端</button>}</div>
    {(delivery.blockedBy || delivery.state === 'outcome-unknown' && delivery.attemptCount) && canWrite && <div className="flex flex-wrap justify-end gap-x-3"><button type="button" disabled={busy} className="min-h-11 text-muted-foreground disabled:opacity-50" onClick={() => void recover('cancel')}>{delivery.blockedBy ? '停止阻塞的投递' : '停止这条投递'}</button><button type="button" disabled={busy} className="min-h-11 text-primary disabled:opacity-50" onClick={() => void recover('retry')}>{delivery.inputCheckFailed ? '已检查并清理，重新投递' : '确认未发送，重新投递'}</button></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
