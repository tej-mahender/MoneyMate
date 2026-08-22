import type { Category } from "../db/db";

export function computeCatchAllAdjustment(
  original: Category[],
  draft: Category[],
  bracketName: string,
): {
  catchAllId: number;
  catchAllName: string;
  oldBudget: number;
  newBudget: number;
  newlyAddedBudget: number;
} | null {
  const catchAllDraft =
    draft.find((c) => c.id && c.name.trim() === "General") ??
    draft.find((c) => c.id && c.name.trim() === bracketName.trim());
  if (!catchAllDraft?.id) return null;
  const catchAllOriginal = original.find((c) => c.id === catchAllDraft.id);
  if (!catchAllOriginal) return null;

  const catchAllDraftBudget = Number(catchAllDraft.budget) || 0;
  if (catchAllDraftBudget !== catchAllOriginal.budget) return null;

  const originalById = new Map(
    original.filter((c) => c.id != null).map((c) => [c.id, c]),
  );
  let increase = 0;
  for (const c of draft) {
    if (c.id === catchAllDraft.id || !c.name.trim()) continue;
    const draftBudget = Number(c.budget) || 0;
    const originalBudget =
      c.id != null ? (originalById.get(c.id)?.budget ?? 0) : 0;
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
