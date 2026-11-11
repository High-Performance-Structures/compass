import { EMPLOYEE_READER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"
import { loadSageEmployeeSyncState, sageEmployeeSyncDue } from "@/lib/sage/employee-directory-sync"

/**
 * The read-only Sage employee reader asks whether to read Sage's employee
 * list now: an hour after the last read, or as soon as someone presses
 * "Read Sage employees now" in Sage contact review.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", EMPLOYEE_READER)
  if (!bridge.success) return bridge.response
  const state = await loadSageEmployeeSyncState(bridge.db)
  return Response.json(sageEmployeeSyncDue(state, new Date()))
}
