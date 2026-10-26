export interface DailySchedule {
  /** First time retained for existing clients and persisted single-time schedules. */
  time: string;
  times?: string[];
  weekdays: number[];
}

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];
export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const isDailyTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function normalizeDailyTimes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isDailyTime)) return null;
  return [...new Set(value)].sort();
}

export function dailyScheduleTimes(schedule: Pick<DailySchedule, 'time' | 'times'>): string[] {
  return normalizeDailyTimes(schedule.times) ?? [schedule.time];
}

export function dailyScheduleLabel(schedule: DailySchedule): string {
  const weekdays = [...new Set(schedule.weekdays)].sort();
  const days = weekdays.join() === ALL_WEEKDAYS.join() ? '每天'
    : weekdays.join() === WORKDAYS.join() ? '工作日'
    : weekdays.join() === WEEKEND.join() ? '周末'
    : weekdays.length ? [...weekdays].sort((a, b) => (a || 7) - (b || 7)).map(day => WEEKDAY_LABELS[day]).join('、') : '请选择日期';
  return `${days} ${dailyScheduleTimes(schedule).filter(Boolean).join('、') || '请选择时间'}`;
}

export function nextDailyRunAt(schedule: DailySchedule, now: number): number {
  const times = dailyScheduleTimes(schedule);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    if (!schedule.weekdays.includes(day.getDay())) continue;
    for (const time of times) {
      const [hours, minutes] = time.split(':').map(Number);
      const candidate = new Date(day);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate.getTime() > now) return candidate.getTime();
    }
  }
  return now + 24 * 60 * 60_000;
}
