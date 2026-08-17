export type BuildertrendModuleKey =
  | "daily_logs"
  | "photos"
  | "videos"
  | "messages"
  | "schedules"
  | "tasks"
  | "rfis"
  | "rfqs"
  | "purchase_orders"
  | "owner_updates"
  | "finish_selections"
  | "files"
  | "estimates"
  | "owner_invoices"
  | "payments"
  | "change_orders"
  | "warranty_claims"

export type BuildertrendCoverageStatus =
  | "verified_captured"
  | "verified_empty"
  | "partial"
  | "blocked"
  | "unavailable"
  | "conflict"
  | "missing"

export type BuildertrendModuleDefinition = {
  readonly key: BuildertrendModuleKey
  readonly label: string
}

export const BUILDERTREND_MODULES: readonly BuildertrendModuleDefinition[] = [
  { key: "daily_logs", label: "Daily logs" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Videos" },
  { key: "messages", label: "Messages" },
  { key: "schedules", label: "Schedules" },
  { key: "tasks", label: "To-dos" },
  { key: "rfis", label: "RFIs" },
  { key: "rfqs", label: "RFQs" },
  { key: "purchase_orders", label: "Purchase orders" },
  { key: "owner_updates", label: "Owner updates" },
  { key: "finish_selections", label: "Finish selections" },
  { key: "files", label: "Files and documents" },
  { key: "estimates", label: "Estimates and proposals" },
  { key: "owner_invoices", label: "Owner invoices" },
  { key: "payments", label: "Payments" },
  { key: "change_orders", label: "Change orders" },
  { key: "warranty_claims", label: "Warranty claims" },
]

export type BuildertrendCoverageProject = {
  readonly id: string
}

export type BuildertrendCoverageEvidence = {
  readonly projectId: string
  readonly moduleKey: BuildertrendModuleKey
  readonly recordCount: number
}

export type BuildertrendCoverageAttestation = {
  readonly projectId: string
  readonly moduleKey: string
  readonly status: string
  readonly observedCount: number
}

export type BuildertrendModuleCoverageRow = {
  readonly key: BuildertrendModuleKey
  readonly label: string
  readonly projectCount: number
  readonly verifiedCapturedCount: number
  readonly verifiedEmptyCount: number
  readonly partialCount: number
  readonly blockedCount: number
  readonly unavailableCount: number
  readonly conflictCount: number
  readonly missingCount: number
  readonly verifiedCount: number
  readonly completionPercent: number
}

export type BuildertrendCoverageSummary = {
  readonly projectCount: number
  readonly moduleCount: number
  readonly totalChecks: number
  readonly verifiedChecks: number
  readonly completionPercent: number
  readonly modules: readonly BuildertrendModuleCoverageRow[]
}

function coverageKey(projectId: string, moduleKey: string): string {
  return `${projectId}\u0000${moduleKey}`
}

function normalizedCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function attestedStatus(
  evidenceCount: number,
  attestation: BuildertrendCoverageAttestation | undefined
): BuildertrendCoverageStatus {
  if (!attestation) return evidenceCount > 0 ? "partial" : "missing"

  const observedCount = normalizedCount(attestation.observedCount)
  if (attestation.status === "captured") {
    return observedCount === evidenceCount && evidenceCount > 0
      ? "verified_captured"
      : "conflict"
  }
  if (attestation.status === "verified_empty") {
    return observedCount === 0 && evidenceCount === 0
      ? "verified_empty"
      : "conflict"
  }
  if (attestation.status === "partial") return "partial"
  if (attestation.status === "blocked") return "blocked"
  if (attestation.status === "unavailable") return "unavailable"
  return "conflict"
}

function countStatuses(
  statuses: readonly BuildertrendCoverageStatus[],
  status: BuildertrendCoverageStatus
): number {
  return statuses.filter((candidate) => candidate === status).length
}

export function summarizeBuildertrendModuleCoverage(
  projects: readonly BuildertrendCoverageProject[],
  evidence: readonly BuildertrendCoverageEvidence[],
  attestations: readonly BuildertrendCoverageAttestation[]
): BuildertrendCoverageSummary {
  const evidenceByKey = new Map<string, number>()
  for (const item of evidence) {
    const key = coverageKey(item.projectId, item.moduleKey)
    evidenceByKey.set(
      key,
      (evidenceByKey.get(key) ?? 0) + normalizedCount(item.recordCount)
    )
  }

  const attestationByKey = new Map<string, BuildertrendCoverageAttestation>()
  for (const attestation of attestations) {
    attestationByKey.set(
      coverageKey(attestation.projectId, attestation.moduleKey),
      attestation
    )
  }

  const modules = BUILDERTREND_MODULES.map((module) => {
    const statuses = projects.map((project) => {
      const key = coverageKey(project.id, module.key)
      return attestedStatus(
        evidenceByKey.get(key) ?? 0,
        attestationByKey.get(key)
      )
    })
    const verifiedCapturedCount = countStatuses(statuses, "verified_captured")
    const verifiedEmptyCount = countStatuses(statuses, "verified_empty")
    const verifiedCount = verifiedCapturedCount + verifiedEmptyCount
    return {
      key: module.key,
      label: module.label,
      projectCount: projects.length,
      verifiedCapturedCount,
      verifiedEmptyCount,
      partialCount: countStatuses(statuses, "partial"),
      blockedCount: countStatuses(statuses, "blocked"),
      unavailableCount: countStatuses(statuses, "unavailable"),
      conflictCount: countStatuses(statuses, "conflict"),
      missingCount: countStatuses(statuses, "missing"),
      verifiedCount,
      completionPercent:
        projects.length === 0
          ? 100
          : Math.round((verifiedCount / projects.length) * 100),
    }
  })
  const totalChecks = projects.length * modules.length
  const verifiedChecks = modules.reduce(
    (total, module) => total + module.verifiedCount,
    0
  )

  return {
    projectCount: projects.length,
    moduleCount: modules.length,
    totalChecks,
    verifiedChecks,
    completionPercent:
      totalChecks === 0 ? 100 : Math.round((verifiedChecks / totalChecks) * 100),
    modules,
  }
}

export function moduleForSourceRecordType(
  sourceRecordType: string
): BuildertrendModuleKey | null {
  if (sourceRecordType === "daily_log") return "daily_logs"
  if (sourceRecordType === "photo_folder") return "photos"
  if (sourceRecordType === "video") return "videos"
  if (sourceRecordType === "message") return "messages"
  if (sourceRecordType === "schedule_item" || sourceRecordType === "schedule_summary") {
    return "schedules"
  }
  if (sourceRecordType === "task") return "tasks"
  if (sourceRecordType === "rfi") return "rfis"
  if (sourceRecordType === "rfq") return "rfqs"
  if (sourceRecordType === "purchase_order") return "purchase_orders"
  if (sourceRecordType === "owner_update") return "owner_updates"
  if (sourceRecordType === "finish_selection") return "finish_selections"
  if (sourceRecordType === "document_folder") return "files"
  if (
    sourceRecordType === "estimate" ||
    sourceRecordType === "estimate_category" ||
    sourceRecordType === "estimate_line_item" ||
    sourceRecordType === "lead_proposal"
  ) {
    return "estimates"
  }
  if (sourceRecordType === "owner_invoice") return "owner_invoices"
  if (sourceRecordType === "payment") return "payments"
  if (sourceRecordType === "change_order") return "change_orders"
  if (
    sourceRecordType === "warranty_claim" ||
    sourceRecordType === "message_claim_detail"
  ) {
    return "warranty_claims"
  }
  return null
}

export function moduleForArchiveFileType(
  sourceRecordType: string
): BuildertrendModuleKey | null {
  if (
    sourceRecordType === "photo" ||
    sourceRecordType === "daily_log_photo" ||
    sourceRecordType === "owner_update_photo" ||
    sourceRecordType === "photo_panorama_pointer"
  ) {
    return "photos"
  }
  if (sourceRecordType === "daily_log_video" || sourceRecordType === "video") {
    return "videos"
  }
  if (sourceRecordType === "document") return "files"
  if (sourceRecordType === "lead_proposal") return "estimates"
  if (sourceRecordType === "owner_invoice_attachment") return "owner_invoices"
  if (sourceRecordType === "message_claim_photo") return "warranty_claims"
  return null
}
