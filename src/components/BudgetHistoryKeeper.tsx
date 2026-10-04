import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, syncBudgetHistory } from "../db/db";

/** Renders nothing. Keeps the budget timeline (db.budgetHistory) in step
 *  with the categories: it re-runs whenever any category's budget or
 *  archived state (its own, or its bracket's) changes, on app launch, and after backup restore. Doing
 *  it here, rather than at every place a budget can be edited, means no
 *  write path can forget to record a change. */
export default function BudgetHistoryKeeper() {
  const signature = useLiveQuery(async () => {
    const [cats, brackets] = await Promise.all([
      db.categories.toArray(),
      db.brackets.toArray(),
    ]);
    const archivedBrackets = new Set(
      brackets.filter((b) => b.archived).map((b) => b.id),
    );
    return cats
      .map((c) => `${c.id}:${c.archived || archivedBrackets.has(c.bracketId) ? 0 : c.budget}`)
      .sort()
      .join("|");
  }, []);

  useEffect(() => {
    if (signature === undefined) return;
    syncBudgetHistory().catch(() => {
      /* best-effort bookkeeping — never block the UI on it */
    });
  }, [signature]);

  return null;
}
