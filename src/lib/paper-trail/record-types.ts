import type { getDb } from "@/db"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
import type { PaperTrailSettings } from "@/lib/feature-settings/registry"
import type { ProjectFileCategoryKey } from "@/lib/project-files"
import { loadChangeOrderRecord } from "@/lib/paper-trail/records/change-order"
import { loadEstimateRecord } from "@/lib/paper-trail/records/estimate"
import { loadPurchaseOrderRecord } from "@/lib/paper-trail/records/purchase-order"
import { loadRfiRecord } from "@/lib/paper-trail/records/rfi"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

type RecordTypeDefinition = {
  readonly label: string
  /** The project subfolder the copy is written to. */
  readonly category: ProjectFileCategoryKey
  /** The company setting that turns this record type on or off. */
  readonly setting: keyof Pick<PaperTrailSettings, "purchaseOrders" | "estimates" | "rfis" | "changeOrders">
  readonly load:
    | ((db: ReturnType<typeof getDb>, recordId: string) => Promise<LoadedPaperTrailRecord | null>)
    | null
}

export const PAPER_TRAIL_RECORDS: { readonly [K in PaperTrailRecordType]: RecordTypeDefinition } = {
  purchase_order: { label: "Purchase orders", category: "purchasing", setting: "purchaseOrders", load: loadPurchaseOrderRecord },
  estimate: { label: "Estimates", category: "estimate", setting: "estimates", load: loadEstimateRecord },
  rfi: { label: "RFIs", category: "communications", setting: "rfis", load: loadRfiRecord },
  change_order: { label: "Change orders", category: "change-orders", setting: "changeOrders", load: loadChangeOrderRecord },
}

/** Whether the company's settings allow saving this record type for this project. */
export function paperTrailAllows(
  settings: PaperTrailSettings,
  recordType: PaperTrailRecordType,
  projectId: string,
): boolean {
  if (settings.mode === "off") return false
  if (settings.mode === "pilot" && !settings.pilotProjectIds.includes(projectId)) return false
  return settings[PAPER_TRAIL_RECORDS[recordType].setting]
}
