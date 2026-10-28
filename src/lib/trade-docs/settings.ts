import { z } from "zod/v4"

/**
 * Settings → Workflows → Trade docs: what each kind of vendor must have on
 * file. Vendor kinds are the directory's vendor categories ("Subcontractor",
 * "Supplier", ...), so every company can use its own.
 */

export const TRADE_DOC_BILL_MODES = ["flag", "hold", "off"] as const
export type TradeDocBillMode = (typeof TRADE_DOC_BILL_MODES)[number]

export const TRADE_DOC_BILL_MODE_LABELS: Readonly<Record<TradeDocBillMode, string>> = {
  flag: "Flag the bill",
  hold: "Hold payment",
  off: "Do nothing",
}

export const tradeDocTypeSchema = z.object({
  /** Stored on documents; never reuse an id for a different meaning. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes for the id."),
  label: z.string().trim().min(1).max(60),
  /** Vendor categories that must have this document. */
  requiredFor: z.array(z.string().trim().min(1).max(60)).max(20),
  expires: z.boolean(),
  /** Days before expiry to start warning (and, later, to remind the vendor). */
  remindDaysBefore: z.number().int().min(0).max(180),
  /** An accepted alternative, e.g. "No employees" forms instead of a workers' comp certificate. */
  waiverLabel: z.string().trim().max(160).nullable(),
  /** Show the certificate checklist when staff record this document. */
  certificateChecks: z.boolean(),
  active: z.boolean(),
})
export type TradeDocType = z.infer<typeof tradeDocTypeSchema>

export const tradeDocSettingsSchema = z.object({
  docTypes: z.array(tradeDocTypeSchema).min(1).max(30),
  /** What staff confirm on an insurance certificate before accepting it. */
  certificateChecks: z.array(z.string().trim().min(1).max(120)).max(20),
  /** Drive folder that holds one folder per vendor; blank uses the company's Drive root. */
  driveFolderId: z.string().trim().max(200).nullable(),
  /** What happens to a vendor's bills while required docs are missing. */
  billModeDefault: z.enum(TRADE_DOC_BILL_MODES),
})
export type TradeDocSettings = z.infer<typeof tradeDocSettingsSchema>

export const DEFAULT_TRADE_DOC_TYPES: readonly TradeDocType[] = [
  { id: "w9", label: "W-9", requiredFor: ["Subcontractor", "Supplier"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true },
  { id: "gl-certificate", label: "General liability certificate", requiredFor: ["Subcontractor"], expires: true, remindDaysBefore: 30, waiverLabel: null, certificateChecks: true, active: true },
  {
    id: "wc-certificate",
    label: "Workers' comp certificate",
    requiredFor: ["Subcontractor"],
    expires: true,
    remindDaysBefore: 30,
    waiverLabel: "No employees: coverage rejection and independent contractor declaration",
    certificateChecks: true,
    active: true,
  },
  { id: "business-license", label: "Business license", requiredFor: ["Subcontractor"], expires: true, remindDaysBefore: 30, waiverLabel: null, certificateChecks: false, active: true },
  { id: "trade-agreement", label: "Trade contractor agreement", requiredFor: ["Subcontractor"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true },
  { id: "info-sheet", label: "Subcontractor info sheet", requiredFor: ["Subcontractor"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true },
]

export const DEFAULT_CERTIFICATE_CHECKS: readonly string[] = [
  "Limits meet our minimums",
  "We are named as additional insured",
  "Waiver of subrogation included",
  "30-day notice of cancellation",
  "Expiration date entered",
]

export const DEFAULT_TRADE_DOC_SETTINGS: TradeDocSettings = {
  docTypes: [...DEFAULT_TRADE_DOC_TYPES],
  certificateChecks: [...DEFAULT_CERTIFICATE_CHECKS],
  driveFolderId: null,
  billModeDefault: "flag",
}

/** Accepts a Drive folder link or a bare id; returns the id or null. */
export function driveFolderIdFromInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
  if (fromUrl?.[1]) return fromUrl[1]
  const fromQuery = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (fromQuery?.[1]) return fromQuery[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null
}

export function isTradeDocBillMode(value: unknown): value is TradeDocBillMode {
  return TRADE_DOC_BILL_MODES.some((mode) => mode === value)
}
