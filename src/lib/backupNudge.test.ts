import { describe, it, expect } from "vitest";
import {
  shouldNudgeBackup,
  oldestCreatedAt,
  describeBackupAge,
  snoozeUntil,
  MIN_TRANSACTIONS_FOR_NUDGE,
  STALE_AFTER_DAYS,
  SNOOZE_DAYS,
} from "./backupNudge";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-04T10:00:00").getTime();

describe("backup reminder cadence", () => {
  it("is monthly: a backup counts as stale after 30 days, and a snooze lasts a week", () => {
    expect(STALE_AFTER_DAYS).toBe(30);
    expect(SNOOZE_DAYS).toBe(7);
  });
  it("does not remind 2 weeks after a backup, but does after a month", () => {
    expect(
      shouldNudgeBackup({ transactionCount: 50, lastBackupAt: NOW - 14 * DAY, now: NOW }),
    ).toBe(false);
    expect(
      shouldNudgeBackup({ transactionCount: 50, lastBackupAt: NOW - 31 * DAY, now: NOW }),
    ).toBe(true);
  });
});

describe("shouldNudgeBackup", () => {
  it("stays quiet for someone who has barely started", () => {
    expect(
      shouldNudgeBackup({ transactionCount: MIN_TRANSACTIONS_FOR_NUDGE - 1, now: NOW }),
    ).toBe(false);
  });
  it("does NOT nudge a new user who has never backed up, while their data is recent", () => {
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        oldestDataAt: NOW - 3 * DAY,
        now: NOW,
      }),
    ).toBe(false);
  });
  it("starts the clock from the oldest data when no backup has ever been made", () => {
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        oldestDataAt: NOW - (STALE_AFTER_DAYS + 1) * DAY,
        now: NOW,
      }),
    ).toBe(true);
  });
  it("does not nudge when there is neither a backup nor a known start of the data", () => {
    expect(shouldNudgeBackup({ transactionCount: 50, now: NOW })).toBe(false);
  });
  it("prefers the last backup over the oldest data once one exists", () => {
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        lastBackupAt: NOW - 2 * DAY,
        oldestDataAt: NOW - 400 * DAY,
        now: NOW,
      }),
    ).toBe(false);
  });
  it("stays quiet after a recent backup", () => {
    expect(
      shouldNudgeBackup({ transactionCount: 50, lastBackupAt: NOW - 3 * DAY, now: NOW }),
    ).toBe(false);
  });
  it("nudges once the last backup is older than the stale threshold", () => {
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        lastBackupAt: NOW - (STALE_AFTER_DAYS + 1) * DAY,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        lastBackupAt: NOW - (STALE_AFTER_DAYS - 1) * DAY,
        now: NOW,
      }),
    ).toBe(false);
  });
  it("respects a snooze, then comes back after it expires", () => {
    const snoozedUntil = snoozeUntil(NOW);
    const oldestDataAt = NOW - 100 * DAY;
    expect(snoozedUntil - NOW).toBe(SNOOZE_DAYS * DAY);
    expect(
      shouldNudgeBackup({ transactionCount: 50, oldestDataAt, snoozedUntil, now: NOW }),
    ).toBe(false);
    expect(
      shouldNudgeBackup({ transactionCount: 50, oldestDataAt, snoozedUntil, now: snoozedUntil + 1 }),
    ).toBe(true);
  });
  it("treats a 0 snooze (cleared) as not snoozed", () => {
    expect(
      shouldNudgeBackup({
        transactionCount: 50,
        oldestDataAt: NOW - 100 * DAY,
        snoozedUntil: 0,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("oldestCreatedAt", () => {
  it("returns the earliest valid timestamp", () => {
    expect(oldestCreatedAt([{ createdAt: 300 }, { createdAt: 100 }, { createdAt: 200 }])).toBe(100);
  });
  it("ignores missing, zero, negative and non-finite values", () => {
    expect(
      oldestCreatedAt([{}, { createdAt: 0 }, { createdAt: -5 }, { createdAt: NaN }, { createdAt: 50 }]),
    ).toBe(50);
  });
  it("returns undefined when there is nothing usable", () => {
    expect(oldestCreatedAt([])).toBeUndefined();
    expect(oldestCreatedAt([{ createdAt: 0 }])).toBeUndefined();
  });
});

describe("describeBackupAge", () => {
  it.each([
    [undefined, "Never"],
    [NOW - 1000, "Today"],
    [NOW - 1 * DAY, "Yesterday"],
    [NOW - 5 * DAY, "5 days ago"],
    [NOW - 21 * DAY, "3 weeks ago"],
    [NOW - 90 * DAY, "3 months ago"],
  ])("%s -> %s", (at, text) => {
    expect(describeBackupAge(at as number | undefined, NOW)).toBe(text);
  });
});
