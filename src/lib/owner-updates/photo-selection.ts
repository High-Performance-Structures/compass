export function retainSelectedAndScopedRows<
  Row extends { readonly id: string },
>(
  rows: readonly Row[],
  selectedIds: readonly string[],
  isInScope: (row: Row) => boolean,
): readonly Row[] {
  const selectedIdSet = new Set(selectedIds)
  return rows.filter(
    (row) => selectedIdSet.has(row.id) || isInScope(row),
  )
}
