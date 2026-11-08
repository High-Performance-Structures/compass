"use server"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { loadSageBillingCheck, type SageBillingCheckView } from "@/lib/financials/sage-billing-check"
import { payRequestOrigin } from "@/lib/financials/sage-pay-request-sync"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { projectContext } from "@/lib/server/action-context"

/*
 * Pay requests built in Sage: the "Enter in Sage" checklist and the Sage
 * check of the posted AR invoice, for the pay request page and its Print
 * Preview. Office staff with finance access only; read only.
 */

export async function getPayRequestSageBillingCheck(projectId: string, applicationId: string): Promise<ActionResult<SageBillingCheckView>> {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { db, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure("Only office staff with finance access can see the Sage checklist.")
  if ((await payRequestOrigin(db, organizationId)) !== "sage") return actionFailure("Pay requests are created in Compass for this company.")
  const view = await loadSageBillingCheck(db, { organizationId, projectId, applicationId })
  if (!view) return actionFailure("Pay request not found")
  return { success: true, data: view }
}
