/**
 * RFQ recipients (project_rfq_recipients, migration 0326): the vendor
 * companies that received an RFQ and answered it, each with only its own
 * answer. This module is the table's reader; its only app writer is the
 * vendor-merge move in ./store.ts (companyMergeOperationStatements). Rows are
 * added by the reviewed backfill SQL, not by app code yet.
 *
 * Why a child table: an RFQ stays one project_operations row (one per bid
 * package for Buildertrend imports) while several vendors bid on it. The
 * vendor portal shows the RFQ to a signed-in vendor whose company is a
 * recipient and shows that vendor its own quote or decline. Reads here are
 * always filtered to one vendor company, so another bidder's price can never
 * reach a vendor through this module.
 *
 * Today rows come from the Buildertrend import backfill (vendors who
 * submitted, had a quote entered by the builder, or declined). The shape is
 * generic so Compass-native RFQs can record recipients here later.
 */
import { and, eq, inArray } from "drizzle-orm"

import { projectRfqRecipients, type ProjectRfqRecipient } from "@/db/schema-rfqs"
import { chunkD1Values } from "@/lib/d1-query"
import { vendorMergeFamily } from "@/lib/domain/contacts/vendor-merge-family"
import type { PortalRfqVendorResponse } from "@/lib/rfqs/portal-response"
import type { Db } from "@/lib/server/action-context"

type RecipientAnswer = Pick<
  ProjectRfqRecipient,
  "id" | "rfqOperationId" | "responseStatus" | "quoteAmountCents" | "respondedAt" | "enteredByBuilder"
>

/**
 * A recipient row as the portal's vendor-response shape. Only this vendor's
 * own fields are used; there are no line prices or notes from the source.
 */
export function rfqRecipientPortalResponse(
  row: RecipientAnswer,
  vendorCompanyName: string | null
): PortalRfqVendorResponse {
  return {
    decision: row.responseStatus === "declined" ? "decline" : "quote",
    amount:
      row.responseStatus === "quoted" && row.quoteAmountCents !== null
        ? row.quoteAmountCents / 100
        : null,
    lines: [],
    leadTime: null,
    validUntil: null,
    notes: row.enteredByBuilder ? "Recorded by the builder from your quote." : null,
    responderUserId: "",
    responderName: vendorCompanyName ?? "Your company",
    responderCompany: vendorCompanyName,
    // Empty when the source did not say when the vendor answered.
    submittedAt: row.respondedAt ?? "",
  }
}

/** Newer answers first; a quote wins over a decline on the same date. */
function preferAnswer(current: RecipientAnswer, candidate: RecipientAnswer): RecipientAnswer {
  const currentAt = current.respondedAt ?? ""
  const candidateAt = candidate.respondedAt ?? ""
  if (candidateAt !== currentAt) return candidateAt > currentAt ? candidate : current
  if (candidate.responseStatus !== current.responseStatus) {
    return candidate.responseStatus === "quoted" ? candidate : current
  }
  return candidate.id < current.id ? candidate : current
}

/**
 * One answer per RFQ for one vendor company (several rows can exist when two
 * source bidders map to the same company, or after a duplicate merge).
 */
export function pickRecipientAnswers(
  rows: readonly RecipientAnswer[]
): ReadonlyMap<string, RecipientAnswer> {
  const byRfq = new Map<string, RecipientAnswer>()
  for (const row of rows) {
    const current = byRfq.get(row.rfqOperationId)
    byRfq.set(row.rfqOperationId, current ? preferAnswer(current, row) : row)
  }
  return byRfq
}

/**
 * The RFQs on a job that `vendorId`'s company answered, with that company's
 * own answer, keyed by RFQ operation id. Follows duplicate merges both ways
 * (the viewer's vendor may be a survivor or an archived duplicate). Two or
 * three small queries per page; never reads another vendor's rows.
 */
export async function vendorRfqRecipientAnswers(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly vendorId: string | null
    readonly vendorCompanyName: string | null
  }
): Promise<ReadonlyMap<string, PortalRfqVendorResponse>> {
  if (!input.vendorId) return new Map()
  const family = await vendorMergeFamily(db, input.organizationId, input.vendorId)
  if (family.length === 0) return new Map()
  const chunks = await Promise.all(
    chunkD1Values(family).map((vendorIds) =>
      db
        .select({
          id: projectRfqRecipients.id,
          rfqOperationId: projectRfqRecipients.rfqOperationId,
          responseStatus: projectRfqRecipients.responseStatus,
          quoteAmountCents: projectRfqRecipients.quoteAmountCents,
          respondedAt: projectRfqRecipients.respondedAt,
          enteredByBuilder: projectRfqRecipients.enteredByBuilder,
        })
        .from(projectRfqRecipients)
        .where(
          and(
            eq(projectRfqRecipients.projectId, input.projectId),
            inArray(projectRfqRecipients.vendorId, vendorIds)
          )
        )
    )
  )
  const rows = chunks.flat()
  const answers = pickRecipientAnswers(rows)
  return new Map(
    [...answers].map(([rfqId, row]) => [rfqId, rfqRecipientPortalResponse(row, input.vendorCompanyName)])
  )
}

