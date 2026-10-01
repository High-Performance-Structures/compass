export type EstimateLineOrderGroup =
  | { readonly type: "division"; readonly divisionCode: string }
  | { readonly type: "assembly"; readonly assemblyId: string | null }

type OrderedLine = {
  readonly id: string
  readonly costCode: string
  readonly sortOrder: number
}

export function compareEstimateLineOrder(left: OrderedLine, right: OrderedLine): number {
  return left.sortOrder - right.sortOrder ||
    left.costCode.localeCompare(right.costCode, "en", { numeric: true }) ||
    left.id.localeCompare(right.id)
}

export function sortEstimateLinesByCostCode<T extends OrderedLine>(lines: readonly T[]): readonly T[] {
  // Equal codes keep the user's existing sequence (including duplicate scopes).
  return [...lines].sort((left, right) =>
    left.costCode.localeCompare(right.costCode, "en", { numeric: true }) ||
    compareEstimateLineOrder(left, right)
  )
}

export function sameEstimateLineOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function reorderedEstimateLinePositions(
  lines: readonly OrderedLine[],
  orderedIds: readonly string[]
): readonly { readonly id: string; readonly sortOrder: number }[] {
  const selected = new Set(orderedIds)
  let index = 0
  // Replace only this group's slots in the shared sequence. Other groups keep
  // their relative order; both build/report views then use the same saved order.
  return [...lines].sort(compareEstimateLineOrder).map((line, sortOrder) => {
    const id = selected.has(line.id) ? orderedIds[index++] : line.id
    return { id: id ?? line.id, sortOrder }
  })
}
