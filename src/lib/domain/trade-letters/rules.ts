/**
 * Pure trade letter rules used by the server: the letter summary and its
 * signed-copy link, the scope a letter covers, when a saved letter can still
 * change, and how a Foxit envelope event moves a letter. The composer's
 * shared helpers stay in src/lib/trade-letters/letter.ts. No database or
 * network access (architecture standard, section 1).
 */
import type { TradeLetter, tradeLetters } from "@/db/schema-trade-docs"
import { isTradeLetterStatus, type TradeLetterKind, type TradeLetterScopeItem, type TradeLetterStatus } from "@/lib/trade-letters/letter"

export type TradeLetterSummary = {
  readonly id: string
  readonly kind: TradeLetterKind
  readonly letterNumber: string
  readonly status: TradeLetterStatus
  readonly totalCents: number
  readonly signerName: string
  readonly signerEmail: string
  readonly includesAgreement: boolean
  readonly createdAt: string
  readonly sentAt: string | null
  readonly signedAt: string | null
  /** Where the signed copy opens: the vendor's Drive folder copy, else Foxit. */
  readonly signedUrl: string | null
  readonly embeddedSessionUrl: string | null
}

type LetterValues = Partial<typeof tradeLetters.$inferInsert>
type TradeCodeLine ={ readonly costCode: string | null; readonly description: string; readonly amountCents: number }

/** Reads legacy or unknown stored values as a letter of intent. */
export function tradeLetterKindOf(letter: { readonly kind: string }): TradeLetterKind {
  return letter.kind === "award" ? "award" : "intent"
}

/** Reads legacy or unknown stored values as a draft. */
export function tradeLetterStatusOf(letter: { readonly status: string }): TradeLetterStatus {
  return isTradeLetterStatus(letter.status) ? letter.status : "draft"
}

export function summarizeTradeLetter(letter: TradeLetter): TradeLetterSummary {
  const status = tradeLetterStatusOf(letter)
  return {
    id: letter.id,
    kind: tradeLetterKindOf(letter),
    letterNumber: letter.letterNumber,
    status,
    totalCents: letter.totalCents,
    signerName: letter.signerName,
    signerEmail: letter.signerEmail,
    includesAgreement: letter.includesAgreement,
    createdAt: letter.createdAt,
    sentAt: letter.sentAt,
    signedAt: letter.signedAt,
    signedUrl: status !== "signed"
      ? null
      : letter.signedDriveFileId
        ? `https://drive.google.com/file/d/${letter.signedDriveFileId}/view`
        : letter.foxitEnvelopeId
          ? `/api/integrations/foxit/envelopes/${encodeURIComponent(letter.foxitEnvelopeId)}/document`
          : null,
    embeddedSessionUrl: status === "preparing" ? letter.foxitEmbeddedSessionUrl : null,
  }
}

/** The chosen accepted codes, ignoring repeats and indexes out of range. */
export function tradeLetterScope(codes: readonly TradeCodeLine[], codeIndexes: readonly number[]): TradeLetterScopeItem[] {
  const indexes = [...new Set(codeIndexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < codes.length)
  return indexes.map((index) => {
    const code = codes[index]
    return { costCode: code?.costCode ?? null, description: code?.description ?? "", amountCents: code?.amountCents ?? 0 }
  })
}

/** The letter's total is the sum of its scope, in cents. */
export function tradeLetterTotalCents(scope: readonly TradeLetterScopeItem[]): number {
  return scope.reduce((sum, item) => sum + item.amountCents, 0)
}

/** Which of the trade's accepted codes a saved letter covers, for reopening it. */
export function tradeLetterCodeIndexes(codes: readonly TradeCodeLine[], scope: readonly TradeLetterScopeItem[]): number[] {
  return codes.flatMap((code, index) =>
    scope.some((item) => item.costCode === code.costCode && item.description === code.description) ? [index] : [],
  )
}

/** A letter can be rewritten (or put in Foxit) until it goes out. */
export function tradeLetterIsEditable(status: string): boolean {
  return status === "draft" || status === "preparing"
}

export type TradeLetterEventChange =
  | { readonly kind: "sent"; readonly values: LetterValues }
  | { readonly kind: "closed"; readonly outcome: "declined" | "cancelled"; readonly values: LetterValues }
  | { readonly kind: "signed"; readonly values: LetterValues }
  | { readonly kind: "none"; readonly ignored: boolean }

/** How a Foxit envelope event moves a letter. Repeats change nothing. */
export function tradeLetterEventChange(letter: Pick<TradeLetter, "status">, event: string, now: string): TradeLetterEventChange {
  if (event === "folder_sent") {
    return tradeLetterIsEditable(letter.status)
      ? { kind: "sent", values: { status: "sent", sentAt: now, foxitEmbeddedSessionUrl: null, updatedAt: now } }
      : { kind: "none", ignored: false }
  }
  if (event === "folder_cancelled" || event === "folder_declined") {
    const outcome = event === "folder_declined" ? "declined" : "cancelled"
    if (letter.status === outcome || letter.status === "signed") return { kind: "none", ignored: false }
    return { kind: "closed", outcome, values: { status: outcome, updatedAt: now } }
  }
  if (event !== "folder_executed" || letter.status === "signed") return { kind: "none", ignored: true }
  return { kind: "signed", values: { status: "signed", signedAt: now, updatedAt: now } }
}
