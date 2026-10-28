import type { vendorTradeDocuments } from "@/db/schema-trade-docs"
import type { TradeDocOnFile } from "@/lib/trade-docs/status"

function parseChecks(json: string | null): readonly string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function toTradeDocOnFile(row: typeof vendorTradeDocuments.$inferSelect): TradeDocOnFile {
  return {
    id: row.id,
    docType: row.docType,
    kind: row.kind === "waiver" ? "waiver" : "document",
    fileName: row.fileName,
    webUrl: row.webUrl,
    effectiveOn: row.effectiveOn,
    expiresOn: row.expiresOn,
    checks: parseChecks(row.checksJson),
    notes: row.notes,
    source: row.source,
    createdAt: row.createdAt,
    createdByName: row.createdByName,
  }
}
