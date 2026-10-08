/**
 * Sales creator **name** → creator document id.
 *
 * Infloww rows carry a name typed into the export, never an id, while shift
 * assignments carry ids — so any question that spans the two needs this join.
 * The export's names are also routinely shorter than the stage name on the
 * roster ("Liam" for "Liam Heng", "Adam" for "Adam Horváth"), so an exact fold
 * alone resolves only some of them.
 *
 * Exact match wins outright. Failing that, a name is accepted as a prefix of a
 * stage name **at a word boundary** ("liam" → "liam heng"), and only when
 * exactly one creator matches: "noah" is a prefix of both Noah Green and Noah
 * Ryder, and guessing between them would silently attribute one creator's
 * coverage to another. An ambiguous or unmatched name resolves to `null` and is
 * reported as unmeasurable rather than quietly treated as uncovered.
 *
 * Shared by CA Admin → Overview and the historical Infloww import, which stamps
 * `creatorId` onto every pre-cutover row with it (ca-salary.md §11c). BuddyX
 * rows do not need it — they carry a model id, mapped by handle.
 */

/** Fold a creator name for matching. Mirrors `normalise` in `AdminOverview.tsx`. */
export function foldName(name: string): string {
  return name.trim().toLowerCase();
}

export function buildCreatorIdResolver(
  creators: Array<{ id: string; stageName: string; isSubAccount?: boolean }>,
): (name: string) => string | null {
  const exact = new Map<string, string>();
  for (const creator of creators) exact.set(foldName(creator.stageName), creator.id);

  return (name: string) => {
    const folded = foldName(name);
    if (!folded) return null;
    const hit = exact.get(folded);
    if (hit) return hit;

    const prefixed = creators.filter(c => foldName(c.stageName).startsWith(`${folded} `));
    if (prefixed.length === 1) return prefixed[0].id;
    // "Cole" prefixes Cole Bentley *and* "Cole Bentley (Fansly)". A sub-account
    // is named after its parent, so a tie made only of one creator and their
    // own sub-accounts resolves to the creator — the Infloww export is an
    // OnlyFans export, and the parent is the OnlyFans account. Two *creators*
    // sharing the prefix are still ambiguous.
    const parents = prefixed.filter(c => !c.isSubAccount);
    return parents.length === 1 ? parents[0].id : null;
  };
}
