/**
 * Pure rules for the settings domain. No database or network access.
 */

/**
 * Saved views are moving from one table per screen to saved_views. Reads use
 * saved_views only once it holds every view the old table would have shown
 * this reader; until the backfill reaches them, the old table answers.
 * Writes go to both tables with the same ids, so after the backfill the new
 * table always covers the old one. `consolidated` is null when saved_views
 * could not be read (for example before migration 0282 is applied).
 */
export function savedViewReadSource(
  legacyIds: readonly string[],
  consolidatedIds: readonly string[] | null,
): "consolidated" | "legacy" {
  if (consolidatedIds === null) return "legacy"
  const consolidated = new Set(consolidatedIds)
  return legacyIds.every((id) => consolidated.has(id)) ? "consolidated" : "legacy"
}

/**
 * A person's stored default for one screen. A saved_view_defaults row wins
 * (its inline snapshot, else the named view it points at); without one, the
 * pre-0282 preference value still applies. Null means no default.
 */
export function savedViewDefaultValue(
  consolidated: { readonly inlineDefinition: string | null; readonly viewDefinition: string | null } | undefined | null,
  legacyValue: string | null,
): string | null {
  if (consolidated) return consolidated.inlineDefinition ?? consolidated.viewDefinition
  return legacyValue
}
