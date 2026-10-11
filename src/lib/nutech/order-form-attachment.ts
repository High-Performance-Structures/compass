import { eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import type { AuthUser } from "@/lib/auth"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export type EmailAttachment = { readonly filename: string; readonly content: string }

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/**
 * The manufacturer's filled order form (.xlsx) for a PO linked to a Nu-Tech
 * order, to send with the PO email. Null for other POs; throws when the
 * linked order's form hasn't been filled yet, so it isn't sent without it.
 */
export async function nuTechOrderFormAttachment(input: {
  readonly db: ReturnType<typeof getDb>
  readonly environment: unknown
  readonly organizationId: string
  readonly user: AuthUser
  readonly purchaseOrderId: string
  readonly purchaseOrderNumber: string | null
}): Promise<EmailAttachment | null> {
  const workflow = await input.db
    .select({ workbookId: nuTechOrderWorkflows.airliteWorkbookId, workbookStatus: nuTechOrderWorkflows.airliteWorkbookStatus })
    .from(nuTechOrderWorkflows)
    .where(eq(nuTechOrderWorkflows.airlitePurchaseOrderOperationId, input.purchaseOrderId))
    .get()
  if (!workflow) return null
  if (!workflow.workbookId) throw new Error("Fill the order form first; it's sent with this PO.")
  if (workflow.workbookStatus === "stale") throw new Error("The order changed since the form was filled; refill the order form first.")
  const { client, userEmail } = await getOrganizationDriveContext({
    db: input.db,
    environment: input.environment,
    organizationId: input.organizationId,
    user: input.user,
  })
  const response = await client.exportFile(userEmail, workflow.workbookId, XLSX_MIME)
  if (!response.ok) throw new Error(`Couldn't export the order form from Drive (${response.status}).`)
  return {
    filename: `PO ${input.purchaseOrderNumber ?? "order form"}.xlsx`,
    content: toBase64(new Uint8Array(await response.arrayBuffer())),
  }
}
