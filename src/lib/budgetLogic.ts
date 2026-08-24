import type { Category } from "../db/db";

/**
 * Shared by every screen that colors a spent-vs-target percentage (the
 * hero ring and per-category rows on BracketDetail, CategoryRow on
 * Dashboard), so they can never disagree with each other about what
 * "good/warn/over" means for the same percentage. Crossing 100% means
 * opposite things depending on bracket kind: overspending a budget cap is
 * the bad outcome (→ over, red); meeting or exceeding a savings/investment
 * target is the *good* outcome, not a warning, so it's clamped back to
 * "good" instead of reusing the spend-side "over" treatment for what's
 * actually a win.
 */
export function progressState(pctRaw: number, isAllocation: boolean): "good" | "warn" | "over" {
  if (isAllocation) return pctRaw < 75 || pctRaw >= 100 ? "good" : "warn";
  return pctRaw < 75 ? "good" : pctRaw < 100 ? "warn" : "over";
}

/**
 * A bracket's "catch-all" category — either literally named "General"
 * (Expenditure's onboarding fallback when starter categories exist) or a
 * single category named after the bracket itself, e.g. a lone "Savings"
 * category (Savings/Investments' onboarding fallback when there's nothing
 * to hold it alongside) — represents the unassigned portion of the
 * bracket's total. So any time some *other* category's budget goes up,
 * that increase should draw from the catch-all rather than silently
 * growing the bracket's total, whether that category is one the person
 * just added, or an existing category (including a ₹0 starter category
 * seeded by onboarding, e.g. Expenditure's Rent/Food/etc.) that's being
 * given a real budget for the first time. The distinction that matters is
 * "did this row's own budget increase", not "does this row have a
 * database id yet" — a starter category sitting at ₹0 is just as
 * unassigned as a brand-new row.
 *
 * This is computed as a pure function of the category list before vs.
 * after editing, so BracketDetail's live preview banner and its actual
 * save path can't drift apart from each other.
 *
 * Deliberately one-directional and conservative:
 * - Only *increases* draw from the catch-all — reducing a category's
 *   budget doesn't automatically refund anything back into it, since that
 *   would be its own kind of surprising magic in the other direction.
 * - The catch-all's own row is never counted toward its own shrink.
 * - If the person has already typed their own new value into the
 *   catch-all in this same edit (its draft budget no longer matches what
 *   it was before editing started), that explicit edit always wins —
 *   nothing overwrites what someone typed on purpose.
 * - "General" is checked first; a bracket-named lump category is only
 *   used as the fallback when there's no category literally named
 *   "General" (the two are never expected to coexist, but if they
 *   somehow did, "General" is the more explicit, unambiguous signal).
 */
export function computeCatchAllAdjustment(
  original: Category[],
  draft: Category[],
  bracketName: string,
): { catchAllId: number; catchAllName: string; oldBudget: number; newBudget: number; newlyAddedBudget: number } | null {
  const catchAllDraft =
    draft.find((c) => c.id && c.name.trim() === "General") ??
    draft.find((c) => c.id && c.name.trim() === bracketName.trim());
  if (!catchAllDraft?.id) return null;
  const catchAllOriginal = original.find((c) => c.id === catchAllDraft.id);
  if (!catchAllOriginal) return null;

  const catchAllDraftBudget = Number(catchAllDraft.budget) || 0;
  if (catchAllDraftBudget !== catchAllOriginal.budget) return null;

  const originalById = new Map(original.filter((c) => c.id != null).map((c) => [c.id, c]));
  let increase = 0;
  for (const c of draft) {
    if (c.id === catchAllDraft.id || !c.name.trim()) continue;
    const draftBudget = Number(c.budget) || 0;
    const originalBudget = c.id != null ? (originalById.get(c.id)?.budget ?? 0) : 0;
    if (draftBudget > originalBudget) increase += draftBudget - originalBudget;
  }
  if (increase <= 0) return null;

  return {
    catchAllId: catchAllDraft.id,
    catchAllName: catchAllDraft.name.trim(),
    oldBudget: catchAllDraftBudget,
    newBudget: Math.max(0, catchAllDraftBudget - increase),
    newlyAddedBudget: increase,
  };
}
