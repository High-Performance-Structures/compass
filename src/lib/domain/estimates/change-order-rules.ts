// Pure checks for change order input: required and length-limited text,
// audience values, document links (supporting and fully executed), and the
// estimate summary shown on a change order. No database access, so the rules
// can be tested on their own. Used by src/app/actions/project-change-orders.ts.
import { executedDocumentSource } from "@/lib/contracts/executed-document-source"
import { cleanText } from "@/lib/shared/guards"
import type { projectEstimates } from "@/db/schema-estimates"
import type {
  ChangeOrderAudience,
  ChangeOrderDocumentInput,
  ChangeOrderExecutedDocumentInput,
  ProjectChangeOrderEstimateOption,
} from "@/lib/change-orders/types"

export function requireText(value: string, label: string, maxLength = 10_000): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

export function cleanLimitedText(
  value: string | null,
  label: string,
  maxLength: number
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

export function validAudience(value: string): value is ChangeOrderAudience {
  return ["internal", "owner", "sub_vendor"].includes(value)
}

export function safeDocumentUrl(value: string): string {
  const cleaned = requireText(value, "Document URL", 2_048)
  const parsed = new URL(cleaned)
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Document links must use HTTP or HTTPS")
  }
  return parsed.toString()
}

export function cleanExecutedDocument(
  input: ChangeOrderExecutedDocumentInput
): { readonly url: string; readonly label: string } {
  if (!input.attested) {
    throw new Error(
      "Confirm that the uploaded file is the complete, fully executed change order."
    )
  }
  const url = requireText(input.url, "Executed document URL", 2_048)
  const source = executedDocumentSource(url)
  if (!source) {
    throw new Error(
      "The executed change order must use a secure Compass, Google Drive, or HTTPS document link."
    )
  }
  return {
    url: source.kind === "external" ? source.url : url,
    label: requireText(input.label, "Executed document label", 200),
  }
}

export function cleanDocuments(
  documents: readonly ChangeOrderDocumentInput[]
): readonly ChangeOrderDocumentInput[] {
  if (documents.length > 20) {
    throw new Error("A change order can have at most 20 supporting documents")
  }
  return documents
    .filter((document) => cleanText(document.url) !== null)
    .map((document) => ({
      label: document.label.trim()
        ? requireText(document.label, "Document label", 200)
        : "Supporting document",
      url: safeDocumentUrl(document.url),
      notes: cleanLimitedText(document.notes, "Document notes", 1_000),
    }))
}

export function estimateOption(
  row: typeof projectEstimates.$inferSelect
): ProjectChangeOrderEstimateOption {
  return {
    id: row.id,
    estimateNumber: row.estimateNumber,
    versionNumber: row.versionNumber,
    title: row.title,
    status: row.status,
    estimateTotalCents: row.estimateTotalCents,
  }
}
