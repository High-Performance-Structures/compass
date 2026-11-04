/**
 * Sage record ids (`_idnum` / `_idref`) are SQL Server GUIDs, and SQL Server
 * compares them case-insensitively. Compass does not: the Sage contact writer
 * prints them the .NET way (lower case) while older client imports stored them
 * upper case, so the same Sage record arrived under two spellings and exact
 * comparisons rejected genuine read-backs (HTTP 409 on client company reads).
 *
 * Only a well-formed GUID is folded to lower case. Anything else is returned
 * unchanged and compared exactly, so a different or malformed id never matches.
 */
const SAGE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSageRecordId(value: string): string
export function normalizeSageRecordId(value: string | null): string | null
export function normalizeSageRecordId(value: string | null | undefined): string | null | undefined
export function normalizeSageRecordId(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string") return value
  return SAGE_GUID.test(value) ? value.toLowerCase() : value
}

/** True when both ids name the same Sage record (both absent counts as the same). */
export function sameSageRecordId(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left ?? null
  const b = right ?? null
  if (a === null || b === null) return a === b
  return normalizeSageRecordId(a) === normalizeSageRecordId(b)
}

/** A writer snapshot with its Sage ids in the one spelling Compass stores for snapshots. */
export function withNormalizedSageRecordIds<T extends {
  readonly sageRecordId: string
  readonly parentSageRecordId: string | null
}>(snapshot: T): T {
  return {
    ...snapshot,
    sageRecordId: normalizeSageRecordId(snapshot.sageRecordId),
    parentSageRecordId: normalizeSageRecordId(snapshot.parentSageRecordId),
  }
}
