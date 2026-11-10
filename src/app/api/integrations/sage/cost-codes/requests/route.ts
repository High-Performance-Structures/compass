import { COST_CODE_READER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"
import { loadSageCostCodeSyncState, sageCostCodeSyncDue } from "@/lib/sage/cost-code-sync"

/**
 * The read-only Sage reader asks whether to read Sage's cost code list now:
 * an hour after the last read, or as soon as someone presses "Refresh from
 * Sage" in Settings.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", COST_CODE_READER)
  if (!bridge.success) return bridge.response
  const state = await loadSageCostCodeSyncState(bridge.db)
  return Response.json(sageCostCodeSyncDue(state, new Date()))
}
