import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import type { AuthUser } from "@/lib/auth"
import type { CompassEmailAttachment } from "@/lib/email/mime-message"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"

/** The order form's tab; the workbook's other tabs (disclaimer, addendum) stay out of the PDF. */
const ORDER_FORM_TAB = "USLvl3"

type DriveContext = Awaited<ReturnType<typeof getOrganizationDriveContext>>

/** The filled order form tab alone, on one letter page. */
export async function exportNuTechOrderFormPdf(
  drive: DriveContext,
  workbookId: string
): Promise<Response> {
  const metadata = await drive.sheetsClient.getSpreadsheetMetadata(drive.userEmail, workbookId)
  const formTab =
    metadata.sheets.find((sheet) => sheet.title === ORDER_FORM_TAB) ??
    metadata.sheets.find((sheet) => sheet.index === 0)
  return drive.client.exportSpreadsheetPdf(drive.userEmail, workbookId, formTab?.sheetId)
}

/**
 * The manufacturer's filled order form for a PO linked to a Nu-Tech order, as
 * the PDF sent with the PO email. Null for other POs; throws when the linked
 * order's form hasn't been filled yet, so the PO isn't sent without it.
 */
export async function nuTechOrderFormAttachments(input: {
  readonly db: ReturnType<typeof getDb>
  readonly environment: unknown
  readonly organizationId: string
  readonly user: AuthUser
  readonly purchaseOrderId: string
  readonly purchaseOrderNumber: string | null
}): Promise<readonly CompassEmailAttachment[] | null> {
  const workflow = await input.db
    .select({ workbookId: nuTechOrderWorkflows.airliteWorkbookId, workbookStatus: nuTechOrderWorkflows.airliteWorkbookStatus })
    .from(nuTechOrderWorkflows)
    .where(eq(nuTechOrderWorkflows.airlitePurchaseOrderOperationId, input.purchaseOrderId))
    .get()
  if (!workflow) return null
  if (!workflow.workbookId) throw new Error("Fill the order form first; it's sent with this PO.")
  if (workflow.workbookStatus === "stale") throw new Error("The order changed since the form was filled; refill the order form first.")
  const drive = await getOrganizationDriveContext({
    db: input.db,
    environment: input.environment,
    organizationId: input.organizationId,
    user: input.user,
  })
  const pdf = await exportNuTechOrderFormPdf(drive, workflow.workbookId)
  if (!pdf.ok) throw new Error(`Couldn't export the order form from Drive (${pdf.status}).`)
  return [
    {
      filename: `PO ${input.purchaseOrderNumber ?? "order form"}.pdf`,
      contentType: "application/pdf",
      content: new Uint8Array(await pdf.arrayBuffer()),
    },
  ]
}
