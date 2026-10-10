// When to remind someone to back up. There is no cloud copy and Android's own
// auto-backup is switched off (the data never leaves the device), so an
// exported backup file is the ONLY safety net against a lost phone, a
// reinstall, or storage corruption. These helpers are pure so the rule is easy
// to test and tune.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Don't nag someone who has barely started. */
export const MIN_TRANSACTIONS_FOR_NUDGE = 5;
/** A backup older than this counts as stale — i.e. roughly a monthly reminder
 *  for someone who backs up when asked. */
export const STALE_AFTER_DAYS = 30;
/** "Later" hides the reminder for this long. */
export const SNOOZE_DAYS = 7;

export function snoozeUntil(now: number): number {
  return now + SNOOZE_DAYS * DAY_MS;
}

export function shouldNudgeBackup(input: {
  transactionCount: number;
  lastBackupAt?: number;
  /** When the oldest transaction was entered (ms). Used as the start of the
   *  clock for someone who has never exported a backup, so a new user isn't
   *  nagged on day one — only once their data is a full cycle old. */
  oldestDataAt?: number;
  snoozedUntil?: number;
  now: number;
}): boolean {
  const { transactionCount, lastBackupAt, oldestDataAt, snoozedUntil, now } = input;
  if (transactionCount < MIN_TRANSACTIONS_FOR_NUDGE) return false;
  if (snoozedUntil && snoozedUntil > now) return false;
  // Never backed up: count from when their data began. No known start, no nudge.
  const since = lastBackupAt || oldestDataAt;
  if (!since) return false;
  return now - since > STALE_AFTER_DAYS * DAY_MS;
}

/** Earliest valid `createdAt` among the given transactions, or undefined. */
export function oldestCreatedAt(
  transactions: { createdAt?: number }[],
): number | undefined {
  let oldest: number | undefined;
  for (const t of transactions) {
    const c = t.createdAt;
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      if (oldest === undefined || c < oldest) oldest = c;
    }
  }
  return oldest;
}

/** Human wording for the "Last backup" line in Settings. */
export function describeBackupAge(lastBackupAt: number | undefined, now: number): string {
  if (!lastBackupAt) return "Never";
  const days = Math.floor((now - lastBackupAt) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
