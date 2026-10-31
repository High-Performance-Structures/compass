import type { InfoSheetField } from "@/lib/trade-docs/settings"
import type { TradeDocLine } from "@/lib/trade-docs/status"

/**
 * The no-login docs link a vendor (or their insurance agent) uses to send
 * trade docs. Tokens and hashing are shared with the RFQ price links.
 */
export const TRADE_DOC_LINK_PATH = "/vendor-docs"

/** Activity action for an email reply to a docs request; the vendor dialog lists these. */
export const TRADE_DOC_REPLY_ACTION = "trade_docs_email_reply_received"

/** Uploads one link accepts, so a leaked link can't fill the Drive folder. */
export const TRADE_DOC_LINK_UPLOAD_LIMIT = 40
export const TRADE_DOC_LINK_MAX_BYTES = 25 * 1024 * 1024

const TRADE_DOC_LINK_AUDIENCES = ["vendor", "agent"] as const
export type TradeDocLinkAudience = (typeof TRADE_DOC_LINK_AUDIENCES)[number]

export function isTradeDocLinkAudience(value: string): value is TradeDocLinkAudience {
  return TRADE_DOC_LINK_AUDIENCES.some((audience) => audience === value)
}

export function parseRequestedTypes(json: string | null): readonly string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function tradeDocLinkExpiresAt(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString()
}

/** What the vendor sees for each requested document. */
export type TradeDocLinkItemState = "needed" | "renew" | "received" | "on_file"

export function tradeDocLinkItemState(line: TradeDocLine, receivedThroughLink: boolean): TradeDocLinkItemState {
  if (receivedThroughLink) return "received"
  if (line.state === "expiring") return "renew"
  if (line.state === "on_file" || line.state === "waived") return "on_file"
  return "needed"
}

const EMAIL = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/

function isLinkEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value)
}

export type InfoSheetAnswer = { readonly field: InfoSheetField; readonly value: string }

export type InfoSheetCheck =
  | { readonly ok: true; readonly answers: readonly InfoSheetAnswer[] }
  | { readonly ok: false; readonly error: string }

/** Checks the vendor's answers against the company's active info sheet fields. */
export function checkInfoSheetAnswers(fields: readonly InfoSheetField[], raw: Readonly<Record<string, unknown>>): InfoSheetCheck {
  const answers: InfoSheetAnswer[] = []
  for (const field of fields) {
    if (!field.active) continue
    const given = raw[field.id]
    const value = typeof given === "string" ? given.trim().slice(0, field.kind === "long_text" ? 1000 : 200) : ""
    if (!value) {
      if (field.required) return { ok: false, error: `Answer "${field.label}".` }
      answers.push({ field, value: "" })
      continue
    }
    if (field.kind === "email" && !isLinkEmail(value)) return { ok: false, error: `Check the email in "${field.label}".` }
    if (field.kind === "phone" && value.replace(/\D/g, "").length < 7) return { ok: false, error: `Check the phone number in "${field.label}".` }
    if (field.kind === "yes_no" && value !== "Yes" && value !== "No") return { ok: false, error: `Answer yes or no to "${field.label}".` }
    if (field.kind === "choice" && field.options.length > 0 && !field.options.includes(value)) {
      return { ok: false, error: `Pick one of the choices for "${field.label}".` }
    }
    answers.push({ field, value })
  }
  return { ok: true, answers }
}

/** The insurance agent named on the info sheet, when there's a usable email. */
export function infoSheetAgent(answers: readonly InfoSheetAnswer[]): { readonly name: string | null; readonly email: string } | null {
  const email = answers.find((answer) => answer.field.purpose === "agent_email")?.value.toLowerCase() ?? ""
  if (!email || !isLinkEmail(email)) return null
  const name = answers.find((answer) => answer.field.purpose === "agent_name")?.value || null
  return { name, email }
}

/** Who certificates must name: the company's own text, or its name and contact lines. */
export function certificateHolderLines(text: string, brand: { readonly legalName: string; readonly contactLines: readonly string[] }): readonly string[] {
  const own = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return own.length > 0 ? own : [brand.legalName, ...brand.contactLines]
}

/** "fox-excavation-info-sheet-2026-10-28.pdf" style names for files Compass writes. */
export function tradeDocFileName(vendorName: string, label: string, date: string): string {
  const clean = (value: string): string => value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  return `${clean(vendorName).slice(0, 80)} - ${clean(label).slice(0, 60)} ${date}.pdf`
}

/** The Drive file id from a finished resumable upload's response body. */
export function uploadedDriveFileId(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") return parsed.id
  } catch {
    return null
  }
  return null
}
