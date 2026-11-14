/**
 * How one RFQ appears to a signed-in vendor in the portal (pure; the portal
 * action src/app/actions/project-audience-preview.ts loads the rows).
 *
 * A vendor sees an RFQ when the RFQ row itself names them (recipient email,
 * or company/assignee name), or when their company is a recorded recipient
 * (project_rfq_recipients, src/lib/domain/operations/rfq-recipients.ts).
 *
 * Privacy rules:
 * - A recorded recipient that the row does not name sees none of the row's
 *   own response, company or amount (those belong to whoever the row names);
 *   it sees only its own recorded answer. Imported rows never show the row's
 *   company or amount to any vendor.
 * - Imported RFQs (not created in Compass) hide their description and every
 *   note: that text was written for staff (portalRfqVendorContent).
 */
import type { AudienceRfq } from "@/lib/project-audience-preview-types"
import {
  isImportedRfqSource,
  parsePortalRfqPayload,
  portalRfqMatchesRecipient,
  portalRfqVendorContent,
  type PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

export type VendorPortalRfqRow = {
  readonly id: string
  readonly sourceSystem: string | null
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly companyName: string | null
  readonly assigneeName: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly sagePayloadJson: string | null
}

export type VendorPortalViewer = {
  readonly email: string
  readonly companyName: string | null
  readonly displayName: string
}

/** The vendor's view of the RFQ, or null when this vendor may not see it. */
export function vendorPortalRfq(
  row: VendorPortalRfqRow,
  viewer: VendorPortalViewer,
  recordedAnswer: PortalRfqVendorResponse | null
): AudienceRfq | null {
  const payload = parsePortalRfqPayload(row.sagePayloadJson)
  const namedRecipient = portalRfqMatchesRecipient({
    recipientEmail: payload.recipientEmail,
    companyName: row.companyName,
    assigneeName: row.assigneeName,
    viewerEmail: viewer.email,
    viewerCompanyName: viewer.companyName,
    viewerDisplayName: viewer.displayName,
  })
  if (!namedRecipient && recordedAnswer === null) return null
  // The row's own company and amount belong to whoever the row names. Imported
  // rows never show them (an imported amount may be another bidder's price).
  const showRowParty = namedRecipient && !isImportedRfqSource(row.sourceSystem)
  const content = portalRfqVendorContent({
    sourceSystem: row.sourceSystem,
    description: row.description,
    payload,
  })
  return {
    id: row.id,
    number: row.sourceRecordNumber,
    title: row.title,
    description: content.description,
    status: row.status,
    priority: row.priority,
    companyName: showRowParty ? row.companyName : null,
    vendorCategory: payload.vendorCategory,
    dueDate: row.dueDate,
    amount: showRowParty ? row.amount : null,
    scopeItems: content.scopeItems,
    documentLinks: content.documentLinks,
    vendorResponse: (namedRecipient ? payload.vendorResponse : null) ?? recordedAnswer,
  }
}

/** Staff (internal viewers) see every RFQ as stored. */
export function staffPortalRfq(row: VendorPortalRfqRow): AudienceRfq {
  const payload = parsePortalRfqPayload(row.sagePayloadJson)
  return {
    id: row.id,
    number: row.sourceRecordNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    companyName: row.companyName,
    vendorCategory: payload.vendorCategory,
    dueDate: row.dueDate,
    amount: row.amount,
    scopeItems: payload.scopeItems,
    documentLinks: payload.documentLinks,
    vendorResponse: payload.vendorResponse,
  }
}
