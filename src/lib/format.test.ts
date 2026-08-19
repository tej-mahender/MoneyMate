import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  todayISO,
  monthKey,
  fmtMoney,
  monthLabel,
  shortDate,
  longDate,
  fmtDateTime,
  daysInMonth,
  dayOfMonthProgress,
  weekdayName,
  isWeekend,
  quarterOf,
  isoWeek,
  addMonths,
  daysBetween,
  iconBadgeStyle,
} from './format';

describe('todayISO', () => {
  // Regression guard for the original bug: an earlier implementation used
  // `.toISOString()`, which converts through UTC first and rolls back to
  // the previous day for any timezone ahead of UTC once local time is past
  // 6:30pm-ish. Pinning the system clock to just before local midnight in a
  // UTC+5:30 zone reproduces that exact failure mode.
  it('returns the LOCAL calendar date, not the UTC one, near local midnight in a positive-offset timezone', () => {
    vi.useFakeTimers();
    // 2026-03-15 23:30 IST == 2026-03-15 18:00 UTC — a naive .toISOString()
    // based implementation would still correctly say the 15th here...
    vi.setSystemTime(new Date('2026-03-15T23:30:00+05:30'));
    expect(todayISO()).toBe('2026-03-15');

    // ...but at 00:15 IST (still the 16th locally), .toISOString() would
    // report 2026-03-15 (18:15 UTC, previous day) — this is the exact class
    // of bug that froze the Analytics page. The fix must return the 16th.
    vi.setSystemTime(new Date('2026-03-16T00:15:00+05:30'));
    expect(todayISO()).toBe('2026-03-16');
    vi.useRealTimers();
  });

  it('returns a zero-padded YYYY-MM-DD string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00+05:30'));
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISO()).toBe('2026-01-05');
    vi.useRealTimers();
  });
});

describe('monthKey', () => {
  it('extracts the YYYY-MM prefix from an ISO date', () => {
    expect(monthKey('2026-08-06')).toBe('2026-08');
  });
  it('handles the first and last day of a month identically', () => {
    expect(monthKey('2026-02-01')).toBe('2026-02');
    expect(monthKey('2026-02-28')).toBe('2026-02');
  });
});

describe('fmtMoney', () => {
  it('formats a positive whole number with the given currency symbol', () => {
    expect(fmtMoney(500, '₹')).toBe('₹500');
  });
  it('formats large numbers with Indian-style digit grouping', () => {
    expect(fmtMoney(1234567, '₹')).toBe('₹12,34,567');
  });
  it('rounds to at most 2 decimal places', () => {
    expect(fmtMoney(99.999, '$')).toBe('$100');
    expect(fmtMoney(10.005, '$')).toBe('$10.01');
  });
  it('prefixes negative amounts with a minus sign before the currency symbol', () => {
    expect(fmtMoney(-250, '₹')).toBe('-₹250');
  });
  it('treats -0 as non-negative (no stray minus sign)', () => {
    expect(fmtMoney(-0, '₹')).toBe('₹0');
  });
  it('formats zero without a sign', () => {
    expect(fmtMoney(0, '$')).toBe('$0');
  });
});

describe('monthLabel', () => {
  it('renders a YYYY-MM key as a full month name and year', () => {
    expect(monthLabel('2026-08')).toBe('August 2026');
  });
  it('is correct for December (year-end edge)', () => {
    expect(monthLabel('2025-12')).toBe('December 2025');
  });
});

describe('shortDate / longDate / fmtDateTime', () => {
  it('shortDate renders an abbreviated month and day with no year', () => {
    expect(shortDate('2026-08-06')).toBe('Aug 6');
  });
  it('longDate renders the full weekday, month, day, and year', () => {
    // 2026-08-06 is a Thursday.
    expect(longDate('2026-08-06')).toBe('Thursday, August 6, 2026');
  });
  it('longDate and shortDate agree on which calendar day a date-only string represents', () => {
    // Regression guard: both must parse via local date components, not UTC,
    // or they could disagree on which day e.g. a New Year's Eve transaction
    // falls on depending on which formatter is used.
    expect(shortDate('2025-12-31')).toBe('Dec 31');
    expect(longDate('2025-12-31')).toContain('December 31, 2025');
  });
  it('fmtDateTime renders a month/day/year and a 12-hour time', () => {
    const ms = new Date('2026-08-06T21:41:00+05:30').getTime();
    const out = fmtDateTime(ms);
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });
});

describe('daysInMonth', () => {
  it('returns 31 for a 31-day month', () => {
    expect(daysInMonth('2026-01')).toBe(31);
  });
  it('returns 30 for a 30-day month', () => {
    expect(daysInMonth('2026-04')).toBe(30);
  });
  it('returns 28 for February in a non-leap year', () => {
    expect(daysInMonth('2026-02')).toBe(28);
  });
  it('returns 29 for February in a leap year', () => {
    expect(daysInMonth('2024-02')).toBe(29);
  });
  it('correctly identifies 2000 as a leap year (divisible by 400)', () => {
    expect(daysInMonth('2000-02')).toBe(29);
  });
  it('correctly identifies 1900 as NOT a leap year (divisible by 100 but not 400)', () => {
    expect(daysInMonth('1900-02')).toBe(28);
  });
});

describe('dayOfMonthProgress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the current day-of-month for the current month', () => {
    vi.setSystemTime(new Date('2026-08-06T12:00:00+05:30'));
    expect(dayOfMonthProgress('2026-08')).toBe(6);
  });
  it('returns the full day count for a past month (fully elapsed)', () => {
    vi.setSystemTime(new Date('2026-08-06T12:00:00+05:30'));
    expect(dayOfMonthProgress('2026-07')).toBe(31); // July has 31 days
  });
});

describe('weekdayName', () => {
  it('names the weekday for a known date (2026-08-06 is a Thursday)', () => {
    expect(weekdayName('2026-08-06')).toBe('Thursday');
  });
  it('names a Sunday correctly', () => {
    expect(weekdayName('2026-08-02')).toBe('Sunday');
  });
});

describe('isWeekend', () => {
  it('returns true for Saturday', () => {
    expect(isWeekend('2026-08-08')).toBe(true);
  });
  it('returns true for Sunday', () => {
    expect(isWeekend('2026-08-09')).toBe(true);
  });
  it('returns false for a weekday', () => {
    expect(isWeekend('2026-08-06')).toBe(false);
  });
});

describe('quarterOf', () => {
  it('maps January-March to Q1', () => {
    expect(quarterOf('2026-01-15')).toBe(1);
    expect(quarterOf('2026-03-31')).toBe(1);
  });
  it('maps April-June to Q2', () => {
    expect(quarterOf('2026-04-01')).toBe(2);
  });
  it('maps July-September to Q3', () => {
    expect(quarterOf('2026-08-06')).toBe(3);
  });
  it('maps October-December to Q4', () => {
    expect(quarterOf('2026-12-25')).toBe(4);
  });
});

describe('isoWeek', () => {
  it('computes ISO week 1 for a date at the very start of the year', () => {
    expect(isoWeek('2026-01-01')).toBe(1);
  });
  it('handles the year-boundary case where Dec 31 belongs to week 1 of the next ISO year', () => {
    // 2025-12-31 is a Wednesday in the same ISO week as 2026-01-01.
    expect(isoWeek('2025-12-31')).toBe(1);
  });
  it('computes a mid-year week number correctly', () => {
    expect(isoWeek('2026-08-06')).toBe(32);
  });
});

describe('addMonths', () => {
  // Regression suite for a previously-buggy helper (per project history:
  // "Could fail to advance months correctly under certain timezone
  // conditions"). These pin down the exact contract so a regression here
  // fails loudly instead of silently mis-scheduling recurring transactions.
  it('advances forward within the same year', () => {
    expect(addMonths('2026-03', 1)).toBe('2026-04');
  });
  it('advances backward within the same year', () => {
    expect(addMonths('2026-03', -1)).toBe('2026-02');
  });
  it('rolls forward over a year boundary', () => {
    expect(addMonths('2025-12', 1)).toBe('2026-01');
  });
  it('rolls backward over a year boundary', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('handles multi-month jumps forward', () => {
    expect(addMonths('2026-01', 6)).toBe('2026-07');
  });
  it('handles multi-month jumps that cross more than one year boundary', () => {
    expect(addMonths('2025-06', 20)).toBe('2027-02');
  });
  it('n=0 is a no-op', () => {
    expect(addMonths('2026-05', 0)).toBe('2026-05');
  });
});

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-08-06', '2026-08-06')).toBe(0);
  });
  it('returns a positive count when b is after a', () => {
    expect(daysBetween('2026-08-01', '2026-08-06')).toBe(5);
  });
  it('returns a negative count when b is before a', () => {
    expect(daysBetween('2026-08-06', '2026-08-01')).toBe(-5);
  });
  it('is correct across a month boundary', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
  });
  it('is correct across a DST-adjacent period (no off-by-one from local time parsing)', () => {
    // Regression guard for the same class of bug as todayISO: both dates
    // are parsed via `T00:00:00` local time, so the diff must land on a
    // whole-number day boundary regardless of the runtime's timezone.
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('iconBadgeStyle', () => {
  it('applies a visibly-tinted background and a color-matched border, not the old barely-visible 15% tint', () => {
    const style = iconBadgeStyle('#7C93F0');
    expect(style.background).toBe('#7C93F040');
    expect(style.color).toBe('#7C93F0');
    expect(style.borderColor).toBe('#7C93F080');
    // Regression guard: the previous inline pattern this replaced used a
    // "26" hex-alpha suffix (~15% opacity) for the background and never
    // set a border color at all, which is what made every bracket/category
    // badge read as the same dull grey box regardless of its own color.
    expect(style.background).not.toContain('26');
  });

  it('falls back to a neutral grey rather than crashing on an uncategorized/undefined color', () => {
    const style = iconBadgeStyle(undefined);
    expect(style.color).toBe('#888888');
    expect(style.background).toBe('#88888840');
    expect(style.borderColor).toBe('#88888880');
  });
});
