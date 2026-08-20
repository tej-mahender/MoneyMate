import type { Category } from "../db/db";

/**
 * "General" represents the unassigned portion of a bracket's total — the
 * part of the budget that hasn't been given a specific purpose yet. So any
 * time some *other* category's budget goes up, that increase should draw
 * from General rather than silently growing the bracket's total, whether
 * that category is one the person just added, or an existing category
 * (including a ₹0 starter category seeded by onboarding, e.g. Expenditure's
 * Rent/Food/etc.) that's being given a real budget for the first time. The
 * distinction that matters is "did this row's own budget increase", not
 * "does this row have a database id yet" — a starter category sitting at
 * ₹0 is just as unassigned as a brand-new row.
 *
 * This is computed as a pure function of the category list before vs.
 * after editing, so BracketDetail's live preview banner and its actual
 * save path can't drift apart from each other.
 *
 * Deliberately one-directional and conservative:
 * - Only *increases* draw from General — reducing a category's budget
 *   doesn't automatically refund anything back into General, since that
 *   would be its own kind of surprising magic in the other direction.
 * - General's own row is never counted toward its own shrink.
 * - If the person has already typed their own new value into General in
 *   this same edit (its draft budget no longer matches what it was before
 *   editing started), that explicit edit always wins — nothing overwrites
 *   what someone typed on purpose.
 */
export function computeGeneralAdjustment(
  original: Category[],
  draft: Category[],
): { generalId: number; oldBudget: number; newBudget: number; newlyAddedBudget: number } | null {
  const generalDraft = draft.find((c) => c.id && c.name.trim() === "General");
  if (!generalDraft?.id) return null;
  const generalOriginal = original.find((c) => c.id === generalDraft.id);
  if (!generalOriginal) return null;

  const generalDraftBudget = Number(generalDraft.budget) || 0;
  if (generalDraftBudget !== generalOriginal.budget) return null;

  const originalById = new Map(original.filter((c) => c.id != null).map((c) => [c.id, c]));
  let increase = 0;
  for (const c of draft) {
    if (c.id === generalDraft.id || !c.name.trim()) continue;
    const draftBudget = Number(c.budget) || 0;
    const originalBudget = c.id != null ? (originalById.get(c.id)?.budget ?? 0) : 0;
    if (draftBudget > originalBudget) increase += draftBudget - originalBudget;
  }
  if (increase <= 0) return null;

  return {
    generalId: generalDraft.id,
    oldBudget: generalDraftBudget,
    newBudget: Math.max(0, generalDraftBudget - increase),
    newlyAddedBudget: increase,
  };
}
