import { useEffect, useState } from 'react';

export function chatTime(at: number, now = Date.now()): string {
  const date = new Date(at), today = new Date(now);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return time;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear() === today.getFullYear() ? day : `${date.getFullYear()}年${day}`} ${time}`;
}

export function ChatTime({ at, className }: { at: number; className?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const midnight = new Date(current);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, midnight.getTime() - current);
    };
    refresh();
    // A suspended tab may resume after its midnight timer was throttled.
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return <time className={className} dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{chatTime(at, now)}</time>;
}
