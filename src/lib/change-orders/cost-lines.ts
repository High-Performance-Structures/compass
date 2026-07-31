export type ChangeOrderCostLineInput = {
  readonly description: string | null
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly amountCents: number | null
}

export type CleanChangeOrderCostLine = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly amountCents: number | null
}

function cleanText(
  value: string | null,
  label: string,
  maxLength: number
): string | null {
  const cleaned = value?.trim() ?? ""
  if (cleaned.length === 0) return null
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function cleanAmountCents(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value)) throw new Error("Line amount is invalid")
  const cents = Math.round(value)
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1_000_000_000_000) {
    throw new Error("Line amount is outside the supported range")
  }
  return cents
}

export function cleanChangeOrderCostLines(
  lines: readonly ChangeOrderCostLineInput[]
): readonly CleanChangeOrderCostLine[] {
  if (lines.length > 100) {
    throw new Error("A change order can have at most 100 cost lines")
  }

  const cleaned: CleanChangeOrderCostLine[] = []
  for (const [index, line] of lines.entries()) {
    const description = cleanText(line.description, "Line description", 500)
    const phaseCode = cleanText(line.phaseCode, "Phase", 100)
    const costCode = cleanText(line.costCode, "Cost code", 100)
    const amountCents = cleanAmountCents(line.amountCents)
    const hasContent =
      description !== null ||
      phaseCode !== null ||
      costCode !== null ||
      amountCents !== null
    if (!hasContent) continue
    if (!description) {
      throw new Error(`Line ${index + 1} needs a description`)
    }
    cleaned.push({
      lineNumber: cleaned.length + 1,
      description,
      phaseCode,
      costCode,
      amountCents,
    })
  }
  return cleaned
}

export function changeOrderCostLinesTotalCents(
  lines: readonly { readonly amountCents: number | null }[]
): number | null {
  if (
    lines.length === 0 ||
    lines.some((line) => line.amountCents === null)
  ) {
    return null
  }
  const total = lines.reduce(
    (sum, line) => sum + (line.amountCents ?? 0),
    0
  )
  if (!Number.isSafeInteger(total)) {
    throw new Error("Change order total is outside the supported range")
  }
  return total
}

export function cleanScheduleImpactDays(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > 3_650) {
    throw new Error("Schedule impact must be a whole number from 0 to 3650 days")
  }
  return value
}
