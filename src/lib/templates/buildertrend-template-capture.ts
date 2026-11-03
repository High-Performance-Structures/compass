import { createHash } from "node:crypto"

import {
  buildertrendCapturedDependencyUpsertSql,
  buildertrendCapturedModuleUpsertSql,
  buildertrendCapturedPublishSql,
  buildertrendCapturedScheduleItemUpsertSql,
  buildertrendCapturedTemplateUpsertSql,
  buildertrendCapturedVersionUpsertSql,
} from "@/lib/domain/templates/store"

import {
  capturedDisplayColors,
  type BuildertrendTemplateCapture,
  type BuildertrendTemplateModuleCounts,
} from "./buildertrend-template-capture-parse"
import type {
  BuildertrendTemplateInventory,
  BuildertrendTemplateInventoryItem,
} from "./buildertrend-template-inventory"

export {
  parseBuildertrendTemplateCapture,
  type BuildertrendTemplateCapture,
} from "./buildertrend-template-capture-parse"

function sourceKey(name: string): string {
  const slug = name
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 10)
  return `template:${slug}:${suffix}`
}

function itemId(templateId: string, sourceItemId: string): string {
  return `bt-template-item:${templateId}:${sourceItemId}`
}

function businessDayOffset(anchorDate: string, targetDate: string): number {
  const anchor = new Date(`${anchorDate}T00:00:00Z`)
  const target = new Date(`${targetDate}T00:00:00Z`)
  if (target.getTime() < anchor.getTime()) return -1
  let offset = 0
  const cursor = new Date(anchor)
  while (cursor.getTime() < target.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) offset += 1
  }
  return offset
}

const compassColorHex = {
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f97316",
  purple: "#a855f7",
  red: "#ef4444",
  yellow: "#eab308",
  teal: "#14b8a6",
  gray: "#6b7280",
} as const

function hexChannels(value: string): readonly [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function compassDisplayColor(value: string): string {
  if (capturedDisplayColors.has(value)) return value
  const [red, green, blue] = hexChannels(value)
  let closest = "blue"
  let distance = Number.POSITIVE_INFINITY
  for (const [name, hex] of Object.entries(compassColorHex)) {
    const [candidateRed, candidateGreen, candidateBlue] = hexChannels(hex)
    const candidateDistance =
      (red - candidateRed) ** 2 +
      (green - candidateGreen) ** 2 +
      (blue - candidateBlue) ** 2
    if (candidateDistance < distance) {
      closest = name
      distance = candidateDistance
    }
  }
  return closest
}

const moduleMappings: readonly {
  readonly type: string
  readonly key: keyof BuildertrendTemplateModuleCounts
}[] = [
  { type: "invoices", key: "invoices" },
  { type: "tasks", key: "tasks" },
  { type: "bid_packages", key: "bidPackages" },
  { type: "estimates", key: "estimates" },
  { type: "purchase_orders", key: "purchaseOrders" },
  { type: "bills", key: "bills" },
  { type: "schedule", key: "scheduleItems" },
  { type: "document_folders", key: "documentFolders" },
  { type: "photo_folders", key: "photoFolders" },
  { type: "selections", key: "selections" },
  { type: "specifications", key: "specifications" },
]

function templateByName(
  inventory: BuildertrendTemplateInventory
): ReadonlyMap<string, BuildertrendTemplateInventoryItem> {
  return new Map(
    inventory.templates.map((template) => [
      template.name.toLocaleLowerCase("en-US"),
      template,
    ])
  )
}

export function buildBuildertrendTemplateCaptureSql(input: {
  readonly organizationId: string
  readonly inventory: BuildertrendTemplateInventory
  readonly capture: BuildertrendTemplateCapture
  readonly publishCapturedSchedules?: boolean
}): {
  readonly sql: string
  readonly capturedTemplateCount: number
  readonly capturedScheduleCount: number
  readonly capturedScheduleItemCount: number
} {
  const inventoryByName = templateByName(input.inventory)
  if (input.capture.excludedArchivedCount !== input.inventory.excludedArchivedCount) {
    throw new Error("Capture and inventory archived-template counts do not match.")
  }
  if (input.capture.templates.length !== input.inventory.templates.length) {
    throw new Error("Capture must contain every active inventory template.")
  }
  if (inventoryByName.size !== input.inventory.templates.length) {
    throw new Error("Active inventory contains duplicate template names.")
  }
  for (const inventoryTemplate of input.inventory.templates) {
    const captured = input.capture.templates.some(
      (template) =>
        template.name.toLocaleLowerCase("en-US") ===
        inventoryTemplate.name.toLocaleLowerCase("en-US")
    )
    if (!captured) {
      throw new Error(
        `Active inventory template “${inventoryTemplate.name}” is missing from capture.`
      )
    }
  }
  const statements: string[] = [
    `-- Buildertrend active template content captured ${input.capture.capturedAt}`,
    `-- ${input.capture.excludedArchivedCount} archived templates were excluded.`,
    "-- Run as one D1 SQL file; explicit BEGIN/COMMIT statements are intentionally omitted.",
  ]
  let capturedScheduleCount = 0
  let capturedScheduleItemCount = 0

  for (const captured of input.capture.templates) {
    const inventoryTemplate = inventoryByName.get(
      captured.name.toLocaleLowerCase("en-US")
    )
    if (!inventoryTemplate) {
      throw new Error(`Captured template “${captured.name}” is not in the active inventory.`)
    }
    const templateSourceKey = sourceKey(captured.name)
    const templateId = `bt-${templateSourceKey}`
    const versionId = `bt-template-version:${captured.sourceTemplateId}:1`
    const departmentCode = inventoryTemplate.departmentCode
    const scheduleCaptured = captured.schedule !== null
    if (scheduleCaptured) {
      capturedScheduleCount += 1
      capturedScheduleItemCount += captured.schedule?.items.length ?? 0
    }
    const sourceMetadata = JSON.stringify({
      inventoryCapturedAt: input.inventory.capturedAt,
      contentCapturedAt: input.capture.capturedAt,
      excludedArchivedTemplateCount: input.capture.excludedArchivedCount,
      contentCaptureStatus: scheduleCaptured
        ? "schedule_captured"
        : "module_counts_captured",
      scheduleDurationDays: captured.scheduleDurationDays,
      moduleCounts: captured.moduleCounts,
    })
    statements.push(
      buildertrendCapturedTemplateUpsertSql({
        id: templateId,
        organizationId: input.organizationId,
        sourceKey: templateSourceKey,
        sourceTemplateId: captured.sourceTemplateId,
        name: captured.name,
        templateKind: inventoryTemplate.templateKind,
        departmentCode,
        tradeCategory: inventoryTemplate.tradeCategory,
        reviewStatus: scheduleCaptured ? "content_captured" : "inventory_only",
        sourceMetadataJson: sourceMetadata,
        capturedAt: input.capture.capturedAt,
      })
    )
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(captured))
      .digest("hex")
    statements.push(
      buildertrendCapturedVersionUpsertSql({
        id: versionId,
        templateId,
        fingerprint,
        capturedAt: input.capture.capturedAt,
      })
    )

    for (const moduleMapping of moduleMappings) {
      const moduleCount = captured.moduleCounts[moduleMapping.key]
      const moduleId = `bt-template-module:${captured.sourceTemplateId}:${moduleMapping.type}`
      const normalized = moduleMapping.type === "schedule" && scheduleCaptured
      const payload = JSON.stringify(
        moduleMapping.type === "schedule"
          ? {
              sourceItemCount: moduleCount,
              scheduleDurationDays: captured.scheduleDurationDays,
              phases: captured.schedule?.phases ?? [],
              fieldReviewPending: [
                "milestone",
                "assignee",
                "ownerVisibility",
                "subVendorVisibility",
                "notes",
              ],
            }
          : { sourceItemCount: moduleCount }
      )
      statements.push(
        buildertrendCapturedModuleUpsertSql({
          id: moduleId,
          versionId,
          moduleType: moduleMapping.type,
          sourceItemCount: moduleCount,
          normalizationStatus: normalized ? "captured" : "inventory_only",
          payloadJson: payload,
        })
      )
    }

    if (!captured.schedule) continue
    captured.schedule.items.forEach((item, index) => {
      const startOffsetWorkdays = businessDayOffset(
        captured.schedule?.sourceAnchorDate ?? item.startDate,
        item.startDate
      )
      if (startOffsetWorkdays < 0) {
        throw new Error(`Schedule item “${item.title}” starts before its anchor.`)
      }
      const id = itemId(captured.sourceTemplateId, item.sourceItemId)
      statements.push(
        buildertrendCapturedScheduleItemUpsertSql({
          id,
          versionId,
          sourceItemId: item.sourceItemId,
          title: item.title,
          startOffsetWorkdays,
          workdays: item.workdays,
          phase: item.phase,
          displayColor: compassDisplayColor(item.displayColor),
          isMilestone: item.isMilestone,
          assigneePlaceholder: item.assigneePlaceholder,
          ownerVisible: item.ownerVisible,
          subVendorVisible: item.subVendorVisible,
          notes: item.notes,
          sortOrder: index,
        })
      )
    })
    captured.schedule.dependencies.forEach((dependency) => {
      const predecessorItemId = itemId(
        captured.sourceTemplateId,
        dependency.predecessorSourceItemId
      )
      const successorItemId = itemId(
        captured.sourceTemplateId,
        dependency.successorSourceItemId
      )
      const dependencyId = `bt-template-dependency:${captured.sourceTemplateId}:${dependency.predecessorSourceItemId}:${dependency.successorSourceItemId}:${dependency.type}`
      statements.push(
        buildertrendCapturedDependencyUpsertSql({
          id: dependencyId,
          versionId,
          predecessorItemId,
          successorItemId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        })
      )
    })
    if (input.publishCapturedSchedules) {
      statements.push(
        ...buildertrendCapturedPublishSql({
          templateId,
          versionId,
          expectedItemCount: captured.schedule.items.length,
          expectedDependencyCount: captured.schedule.dependencies.length,
          capturedAt: input.capture.capturedAt,
        })
      )
    }
  }
  return {
    sql: `${statements.join("\n")}\n`,
    capturedTemplateCount: input.capture.templates.length,
    capturedScheduleCount,
    capturedScheduleItemCount,
  }
}
