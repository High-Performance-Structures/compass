/**
 * Reordering the line items inside one record (P.O., RFQ, change order, shop
 * ticket, invoice). Pure, so forms and tests share it.
 */

/** The list with the item at `from` moved to `to`; out-of-range moves return the list unchanged. */
export function moveLine<T>(lines: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= lines.length || to >= lines.length) return lines
  const next = [...lines]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return lines
  next.splice(to, 0, moved)
  return next
}

/**
 * Lines in cost-code order ("2-100" before "10-100"). Lines without a code go
 * last, and equal codes keep their current order.
 */
export function sortLinesByCostCode<T>(lines: readonly T[], costCode: (line: T) => string | null | undefined): readonly T[] {
  return lines
    .map((line, index) => ({ line, index, code: costCode(line)?.trim() ?? "" }))
    .sort((left, right) =>
      (left.code === "" ? 1 : 0) - (right.code === "" ? 1 : 0) ||
      left.code.localeCompare(right.code, "en", { numeric: true }) ||
      left.index - right.index,
    )
    .map((entry) => entry.line)
}
