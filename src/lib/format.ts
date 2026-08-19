/** Formats a Date using its LOCAL calendar fields, never converting through UTC.
 *  Using .toISOString() here would be wrong: it converts to UTC first, which
 *  silently rolls back to the previous day/month for any timezone ahead of UTC
 *  (e.g. IST, UTC+5:30) whenever the local time is near midnight. That bug was
 *  causing addMonths() to sometimes fail to advance at all, which froze the
 *  Analytics page in an infinite while loop. */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toLocalDateStr(new Date());
}

/** Style for a bracket/category's colored icon badge (the small rounded
 *  square around its emoji, e.g. Overview's bracket rows, Dashboard/History
 *  category rows, Settings' bracket list…). Centralized because the same
 *  three properties were being hand-duplicated at every call site with a
 *  fixed, barely-visible 15% background tint (hex alpha "26") and a flat
 *  neutral border shared by every badge regardless of its own color — the
 *  net effect was that Expenditure/Savings/Investments/Income all read as
 *  the same dull dark box, since the emoji glyph itself doesn't take the
 *  CSS `color` (emoji are fixed-color glyphs, not currentColor icons) and
 *  the only other visible cue was that faint tint. A stronger background
 *  tint plus a border actually colored to match makes each one legible as
 *  its own color at a glance instead of all reading as the same grey chip. */
export function iconBadgeStyle(color: string | undefined): {
  background: string;
  color: string;
  borderColor: string;
} {
  const c = color || "#888888";
  return { background: `${c}40`, color: c, borderColor: `${c}80` };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function fmtMoney(n: number, currency: string): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  return (
    sign +
    currency +
    Math.abs(rounded).toLocaleString("en-IN", { maximumFractionDigits: 2 })
  );
}

export function monthLabel(key: string): string {
  const d = new Date(key + "-01T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full weekday + date, e.g. "Thursday, August 6, 2026" — for detail views
 *  where shortDate's compact "Aug 6" isn't enough context. */
export function longDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Formats a createdAt epoch-ms timestamp as a local date + time, e.g.
 *  "Aug 6, 2026, 9:41 PM" — safe to pass straight to `new Date()` since this
 *  is an absolute instant, not a date-only string (the toLocalDateStr concern
 *  above only applies to yyyy-mm-dd strings). */
export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonthProgress(key: string): number {
  const today = new Date();
  const cur = monthKey(todayISO());
  if (key !== cur) return daysInMonth(key); // past month = fully elapsed
  return today.getDate();
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[new Date(iso + "T00:00:00").getDay()];
}

export function isWeekend(iso: string): boolean {
  const d = new Date(iso + "T00:00:00").getDay();
  return d === 0 || d === 6;
}

export function quarterOf(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return Math.ceil(m / 3);
}

export function isoWeek(iso: string): number {
  // ISO 8601 week number
  const d = new Date(iso + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/** Adds `n` months to a YYYY-MM key, e.g. addMonths('2026-01', -1) -> '2025-12' */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/** Difference in whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").valueOf();
  const db = new Date(b + "T00:00:00").valueOf();
  return Math.round((db - da) / 86400000);
}
