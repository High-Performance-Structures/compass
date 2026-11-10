/**
 * Stepping through a list's records from an open record drawer (Previous /
 * Next): the neighbours of the open record in the list's current filtered and
 * sorted order. Pure, so drawers and tests share it.
 */

export type RecordStep =
  | {
      /** The open record is in the list. */
      readonly kind: "listed"
      /** 1-based place in the list, for "3 of 12". */
      readonly position: number
      readonly total: number
      /** null at the start of the list. */
      readonly previousId: string | null
      /** null at the end of the list. */
      readonly nextId: string | null
    }
  | {
      /** The open record is filtered out of (or missing from) the list, so there is nothing to step to. */
      readonly kind: "unlisted"
      readonly total: number
    }

/** Where `openId` sits in `orderedIds` and which records Previous and Next open. */
export function recordStep(orderedIds: readonly string[], openId: string | null): RecordStep {
  const index = openId === null ? -1 : orderedIds.indexOf(openId)
  if (index < 0) return { kind: "unlisted", total: orderedIds.length }
  return {
    kind: "listed",
    position: index + 1,
    total: orderedIds.length,
    previousId: orderedIds[index - 1] ?? null,
    nextId: orderedIds[index + 1] ?? null,
  }
}
