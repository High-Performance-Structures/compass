export type ClientMatchRow = {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly primaryEmail: string | null
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
}

/** Legacy Sage exports were inserted into customers; keep their provenance visible. */
export function isImportedSageClient(row: ClientMatchRow): boolean {
  return row.id.startsWith("sage-customer-") &&
    Boolean(row.sageClientNumber) && !row.sageClientId
}

export function compassClientRows<T extends ClientMatchRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isImportedSageClient(row))
    .sort((a, b) => a.name.localeCompare(b.name, "en-US"))
}

export function canVerifyClientPair(
  compass: ClientMatchRow | null,
  sage: { readonly sageRecordId: string; readonly sageClientNumber: string;
    readonly claimCount: number; readonly claimedBy: { readonly id: string } | null } | null
): boolean {
  if (!compass || !sage || sage.claimCount > 1 || compass.sageClientId) return false
  if (sage.claimedBy && sage.claimedBy.id !== compass.id) return false
  return !compass.sageClientNumber || compass.sageClientNumber === sage.sageClientNumber
}

export function searchClientMatchRows<T extends ClientMatchRow>(
  rows: readonly T[], query: string, limit = 40
): { readonly matches: readonly T[]; readonly total: number } {
  const needle = query.trim().toLocaleLowerCase("en-US")
  const matches = needle
    ? rows.filter((row) => [row.name, row.email, row.primaryEmail, row.sageClientNumber]
      .some((value) => value?.toLocaleLowerCase("en-US").includes(needle)))
    : rows
  return { matches: matches.slice(0, limit), total: matches.length }
}
