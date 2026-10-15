import { env } from '../config/env';

/**
 * All billing logic uses the configured application timezone (APP_TIMEZONE) and
 * calendar months. "Date-only" values are stored as UTC-midnight `date` columns.
 */
export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export function nowInAppTz(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export const currentYearMonth = (now?: Date): YearMonth => {
  const { year, month } = nowInAppTz(now);
  return { year, month };
};

/** Date-only (UTC midnight) value for a calendar day. */
export const dateOnly = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));

export const todayDateOnly = (now?: Date) => {
  const { year, month, day } = nowInAppTz(now);
  return dateOnly(year, month, day);
};

export const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Parse "YYYY-MM-DD" into a date-only value, or null if not a real calendar date. */
export function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = dateOnly(Number(m[1]), Number(m[2]), Number(m[3]));
  return ymd(d) === value ? d : null;
}

export const compareYm = (a: YearMonth, b: YearMonth) => a.year * 12 + a.month - (b.year * 12 + b.month);

export const addMonths = (ym: YearMonth, n: number): YearMonth => {
  const idx = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};

export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let cur = from; compareYm(cur, to) <= 0; cur = addMonths(cur, 1)) out.push(cur);
  return out;
}

export const monthLabel = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
