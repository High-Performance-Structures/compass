"use server"

import { eq, sql } from "drizzle-orm"

import { sageCostCodes } from "@/db/schema"
import { SAGE_COST_CODE_SOURCE } from "@/lib/domain/sage-bridge/cost-code-sync-rules"
import { orgContext } from "@/lib/server/action-context"
import { sageContactOrganizationMatches } from "@/lib/sage/contact-bridge"
import {
  loadSageCostCodeSyncState,
  requestSageCostCodeRefresh,
  sageCostCodeReaderRunning,
} from "@/lib/sage/cost-code-sync"

export type SageCostCodeSyncStatus = {
  readonly available: boolean
  readonly lastSyncedAt: string | null
  readonly refreshRequestedAt: string | null
  readonly readerRunning: boolean
  readonly activeFromSage: number
  readonly inactive: number
}

type StatusResult = { readonly success: true; readonly data: SageCostCodeSyncStatus } | { readonly success: false; readonly error: string }

/** Settings: when the cost code list last came from Sage, and how many codes it has. */
export async function getSageCostCodeSyncStatus(): Promise<StatusResult> {
  const context = await orgContext({ feature: "sage-sync", action: "read" })
  if (!context.success) return context
  const { db, env, organizationId } = context.data
  const available = sageContactOrganizationMatches(env, organizationId)
  const [state, counts] = await Promise.all([
    loadSageCostCodeSyncState(db),
    db
      .select({
        activeFromSage: sql<number>`coalesce(sum(case when ${sageCostCodes.active} = 1 and ${eq(sageCostCodes.sourceSystem, SAGE_COST_CODE_SOURCE)} then 1 else 0 end), 0)`,
        inactive: sql<number>`coalesce(sum(case when ${sageCostCodes.active} = 0 then 1 else 0 end), 0)`,
      })
      .from(sageCostCodes)
      .get(),
  ])
  return {
    success: true,
    data: {
      available,
      lastSyncedAt: state.lastSyncedAt,
      refreshRequestedAt: state.refreshRequestedAt,
      readerRunning: sageCostCodeReaderRunning(state, new Date()),
      activeFromSage: Number(counts?.activeFromSage ?? 0),
      inactive: Number(counts?.inactive ?? 0),
    },
  }
}

/** "Refresh from Sage": the reader reads Sage's cost code list on its next check. */
export async function refreshSageCostCodes(): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const context = await orgContext({ feature: "sage-sync", action: "update", mutation: true })
  if (!context.success) return context
  const { env, organizationId } = context.data
  if (!sageContactOrganizationMatches(env, organizationId)) {
    return { success: false, error: "Sage isn't connected for this company." }
  }
  await requestSageCostCodeRefresh(env.DB, new Date().toISOString())
  return { success: true }
}
