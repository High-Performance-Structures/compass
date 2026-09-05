import { z } from "zod/v4"

export const selectionSpecificationSchema = z.object({
  roomName: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  colorFinish: z.string().nullable(),
  supplierName: z.string().nullable(),
  productUrl: z.string().nullable(),
})
export type SelectionSpecification = z.infer<
  typeof selectionSpecificationSchema
>

export function selectionSpecification(
  row: SelectionSpecification
): SelectionSpecification {
  return selectionSpecificationSchema.parse(row)
}
export function specificationJson(row: SelectionSpecification): string {
  return JSON.stringify(selectionSpecification(row))
}
export function parseSpecification(
  value: string
): SelectionSpecification | null {
  try {
    const parsed = selectionSpecificationSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
export function moneyCents(value: string): number | null {
  if (!value.trim()) return null
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(
      "Enter a non-negative amount with at most two decimal places."
    )
  return Math.round(Number(value) * 100)
}
export function selectionMoney(cents: number | null): string {
  return cents === null
    ? "Pricing pending"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100)
}
export function safeSelectionUrl(value: string | null): string | null {
  if (!value?.trim()) return null
  const url = new URL(value.trim())
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Use a public HTTP or HTTPS product link.")
  return url.toString()
}
export function approvedChangeOrder(status: string | null): boolean {
  return (
    status !== null &&
    ["executed", "sage_pending", "synced", "closed"].includes(status)
  )
}
export function approvalBlocker(input: {
  readonly current: boolean
  readonly published: boolean
  readonly approvedAt: string | null
  readonly allowanceCents: number | null
  readonly quotedCents: number | null
  readonly scheduleImpact: string | null
  readonly requiresChangeOrder: boolean
  readonly changeOrderStatus: string | null
  readonly openRequests: number
}): string | null {
  if (!input.published)
    return "This selection has not been published for your review."
  if (!input.current)
    return "The specification changed. Your team must publish the revised selection before approval."
  if (input.approvedAt) return "This revision is already approved."
  if (input.openRequests > 0)
    return "Your team must resolve the outstanding pricing or alternative request before approval."
  if (
    input.allowanceCents === null ||
    input.quotedCents === null ||
    !input.scheduleImpact?.trim()
  )
    return "Your team is preparing the price, allowance, and schedule impact."
  if (
    (input.requiresChangeOrder || input.quotedCents !== input.allowanceCents) &&
    !approvedChangeOrder(input.changeOrderStatus)
  )
    return "Approve the associated change order before approving this selection."
  return null
}

export function parseApprovalHistory(value: string): {
  readonly specification: SelectionSpecification
  readonly priceCents: number | null
  readonly allowanceCents: number | null
  readonly scheduleImpact: string | null
} | null {
  try {
    const terms = z
      .object({
        specificationJson: z.string(),
        quotedCents: z.number().nullable(),
        allowanceCents: z.number().nullable(),
        scheduleImpact: z.string().nullable(),
      })
      .parse(JSON.parse(value))
    const specification = parseSpecification(terms.specificationJson)
    return specification
      ? {
          specification,
          priceCents: terms.quotedCents,
          allowanceCents: terms.allowanceCents,
          scheduleImpact: terms.scheduleImpact,
        }
      : null
  } catch {
    return null
  }
}
