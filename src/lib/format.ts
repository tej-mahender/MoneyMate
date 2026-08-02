/** Formats a Date using its LOCAL calendar fields, never converting through UTC.
 *  Using .toISOString() here would be wrong: it converts to UTC first, which
 *  silently rolls back to the previous day/month for any timezone ahead of UTC
 *  (e.g. IST, UTC+5:30) whenever the local time is near midnight. That bug was
 *  causing addMonths() to sometimes fail to advance at all, which froze the
 *  Analytics page in an infinite while loop. */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toLocalDateStr(new Date());
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function fmtMoney(n: number, currency: string): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? '-' : '';
  return sign + currency + Math.abs(rounded).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function monthLabel(key: string): string {
  const d = new Date(key + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonthProgress(key: string): number {
  const today = new Date();
  const cur = monthKey(todayISO());
  if (key !== cur) return daysInMonth(key); // past month = fully elapsed
  return today.getDate();
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[new Date(iso + 'T00:00:00').getDay()];
}

export function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}

export function quarterOf(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return Math.ceil(m / 3);
}

export function isoWeek(iso: string): number {
  // ISO 8601 week number
  const d = new Date(iso + 'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/** Adds `n` months to a YYYY-MM key, e.g. addMonths('2026-01', -1) -> '2025-12' */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/** Difference in whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').valueOf();
  const db = new Date(b + 'T00:00:00').valueOf();
  return Math.round((db - da) / 86400000);
}
