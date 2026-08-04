import { createHash } from "node:crypto"

import type {
  BuildertrendTemplateInventory,
  BuildertrendTemplateInventoryItem,
} from "./buildertrend-template-inventory"
import { isArchivedBuildertrendTemplateName } from "./buildertrend-template-inventory"

export type BuildertrendTemplateModuleCounts = {
  readonly invoices: number
  readonly tasks: number
  readonly bidPackages: number
  readonly estimates: number
  readonly purchaseOrders: number
  readonly bills: number
  readonly scheduleItems: number
  readonly documentFolders: number
  readonly photoFolders: number
  readonly selections: number
  readonly specifications: number
}

export type BuildertrendCapturedScheduleItem = {
  readonly sourceItemId: string
  readonly title: string
  readonly startDate: string
  readonly workdays: number
  readonly phase: string
  readonly displayColor: string
  readonly isMilestone: boolean
  readonly assigneePlaceholder: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly notes: string | null
}

export type BuildertrendCapturedScheduleDependency = {
  readonly predecessorSourceItemId: string
  readonly successorSourceItemId: string
  readonly type: "FS" | "SS" | "FF" | "SF"
  readonly lagDays: number
}

export type BuildertrendCapturedSchedule = {
  readonly sourceAnchorDate: string
  readonly phases: readonly {
    readonly sourcePhaseId: string
    readonly name: string
  }[]
  readonly items: readonly BuildertrendCapturedScheduleItem[]
  readonly dependencies: readonly BuildertrendCapturedScheduleDependency[]
}

export type BuildertrendTemplateCaptureItem = {
  readonly name: string
  readonly sourceTemplateId: string
  readonly sourceUrl: string
  readonly scheduleDurationDays: number
  readonly moduleCounts: BuildertrendTemplateModuleCounts
  readonly schedule: BuildertrendCapturedSchedule | null
}

export type BuildertrendTemplateCapture = {
  readonly capturedAt: string
  readonly sourceUrl: string
  readonly expectedActiveCount: number
  readonly excludedArchivedCount: number
  readonly templates: readonly BuildertrendTemplateCaptureItem[]
}

export type BuildertrendTemplateCaptureParseResult =
  | { readonly success: true; readonly data: BuildertrendTemplateCapture }
  | { readonly success: false; readonly errors: readonly string[] }

const moduleCountKeys: readonly (keyof BuildertrendTemplateModuleCounts)[] = [
  "invoices",
  "tasks",
  "bidPackages",
  "estimates",
  "purchaseOrders",
  "bills",
  "scheduleItems",
  "documentFolders",
  "photoFolders",
  "selections",
  "specifications",
]

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: string[]
): string | null {
  const value = record[key]
  if (typeof value === "string" && value.trim()) return value.trim()
  errors.push(`${path}.${key} is required.`)
  return null
}

function nonnegativeInteger(
  value: unknown,
  path: string,
  errors: string[],
  defaultValue: number | null = null
): number | null {
  if (value === undefined && defaultValue !== null) return defaultValue
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value
  }
  errors.push(`${path} must be a nonnegative integer.`)
  return null
}

function positiveInteger(
  value: unknown,
  path: string,
  errors: string[]
): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }
  errors.push(`${path} must be a positive integer.`)
  return null
}

function integer(value: unknown, path: string, errors: string[]): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value
  errors.push(`${path} must be an integer.`)
  return null
}

function optionalString(value: unknown, path: string, errors: string[]): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "string") return value.trim() || null
  errors.push(`${path} must be a string or null.`)
  return null
}

function booleanWithDefault(
  value: unknown,
  path: string,
  errors: string[],
  defaultValue = false
): boolean {
  if (value === undefined) return defaultValue
  if (typeof value === "boolean") return value
  errors.push(`${path} must be a boolean.`)
  return defaultValue
}

const capturedDisplayColors = new Set([
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "yellow",
  "teal",
  "gray",
])

function displayColor(
  value: unknown,
  path: string,
  errors: string[]
): string {
  if (value === undefined) return "blue"
  if (
    typeof value === "string" &&
    (capturedDisplayColors.has(value) || /^#[0-9a-f]{6}$/i.test(value))
  ) {
    return value.toLowerCase()
  }
  errors.push(`${path} must be a Compass color or six-digit hex color.`)
  return "blue"
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseModuleCounts(
  value: unknown,
  path: string,
  errors: string[]
): BuildertrendTemplateModuleCounts | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`)
    return null
  }
  const counts = new Map<keyof BuildertrendTemplateModuleCounts, number>()
  for (const key of moduleCountKeys) {
    const parsed = nonnegativeInteger(value[key], `${path}.${key}`, errors, 0)
    if (parsed !== null) counts.set(key, parsed)
  }
  if (counts.size !== moduleCountKeys.length) return null
  return {
    invoices: counts.get("invoices") ?? 0,
    tasks: counts.get("tasks") ?? 0,
    bidPackages: counts.get("bidPackages") ?? 0,
    estimates: counts.get("estimates") ?? 0,
    purchaseOrders: counts.get("purchaseOrders") ?? 0,
    bills: counts.get("bills") ?? 0,
    scheduleItems: counts.get("scheduleItems") ?? 0,
    documentFolders: counts.get("documentFolders") ?? 0,
    photoFolders: counts.get("photoFolders") ?? 0,
    selections: counts.get("selections") ?? 0,
    specifications: counts.get("specifications") ?? 0,
  }
}

function dependencyType(value: unknown): "FS" | "SS" | "FF" | "SF" | null {
  if (value === "FS" || value === "SS" || value === "FF" || value === "SF") {
    return value
  }
  return null
}

function hasDependencyCycle(
  itemIds: ReadonlySet<string>,
  dependencies: readonly BuildertrendCapturedScheduleDependency[]
): boolean {
  const successors = new Map<string, string[]>()
  for (const itemId of itemIds) successors.set(itemId, [])
  for (const dependency of dependencies) {
    successors
      .get(dependency.predecessorSourceItemId)
      ?.push(dependency.successorSourceItemId)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(itemId: string): boolean {
    if (visiting.has(itemId)) return true
    if (visited.has(itemId)) return false
    visiting.add(itemId)
    for (const successor of successors.get(itemId) ?? []) {
      if (visit(successor)) return true
    }
    visiting.delete(itemId)
    visited.add(itemId)
    return false
  }

  for (const itemId of itemIds) {
    if (visit(itemId)) return true
  }
  return false
}

function parseSchedule(
  value: unknown,
  path: string,
  expectedItemCount: number,
  errors: string[]
): BuildertrendCapturedSchedule | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`)
    return null
  }
  const sourceAnchorDate = requiredString(
    value,
    "sourceAnchorDate",
    path,
    errors
  )
  if (sourceAnchorDate && !isIsoDate(sourceAnchorDate)) {
    errors.push(`${path}.sourceAnchorDate must be an ISO date.`)
  }
  const phaseValues = value.phases
  const itemValues = value.items
  const dependencyValues = value.dependencies
  if (!Array.isArray(phaseValues)) errors.push(`${path}.phases must be an array.`)
  if (!Array.isArray(itemValues)) errors.push(`${path}.items must be an array.`)
  if (!Array.isArray(dependencyValues)) {
    errors.push(`${path}.dependencies must be an array.`)
  }
  if (
    !Array.isArray(phaseValues) ||
    !Array.isArray(itemValues) ||
    !Array.isArray(dependencyValues)
  ) {
    return null
  }

  const phases: { readonly sourcePhaseId: string; readonly name: string }[] = []
  const phaseNames = new Set<string>()
  phaseValues.forEach((phaseValue, index) => {
    if (!isRecord(phaseValue)) {
      errors.push(`${path}.phases[${index}] must be an object.`)
      return
    }
    const phasePath = `${path}.phases[${index}]`
    const sourcePhaseId = requiredString(
      phaseValue,
      "sourcePhaseId",
      phasePath,
      errors
    )
    const name = requiredString(phaseValue, "name", phasePath, errors)
    if (!sourcePhaseId || !name) return
    if (phaseNames.has(name)) {
      errors.push(`${path} has a duplicate phase named “${name}”.`)
      return
    }
    phaseNames.add(name)
    phases.push({ sourcePhaseId, name })
  })

  const items: BuildertrendCapturedScheduleItem[] = []
  const itemIds = new Set<string>()
  itemValues.forEach((itemValue, index) => {
    if (!isRecord(itemValue)) {
      errors.push(`${path}.items[${index}] must be an object.`)
      return
    }
    const itemPath = `${path}.items[${index}]`
    const sourceItemId = requiredString(
      itemValue,
      "sourceItemId",
      itemPath,
      errors
    )
    const title = requiredString(itemValue, "title", itemPath, errors)
    const startDate = requiredString(itemValue, "startDate", itemPath, errors)
    const workdays = positiveInteger(
      itemValue.workdays,
      `${itemPath}.workdays`,
      errors
    )
    const phase = requiredString(itemValue, "phase", itemPath, errors)
    const capturedColor = displayColor(
      itemValue.displayColor,
      `${itemPath}.displayColor`,
      errors
    )
    const isMilestone = booleanWithDefault(
      itemValue.isMilestone,
      `${itemPath}.isMilestone`,
      errors
    )
    const assigneePlaceholder = optionalString(
      itemValue.assigneePlaceholder,
      `${itemPath}.assigneePlaceholder`,
      errors
    )
    const ownerVisible = booleanWithDefault(
      itemValue.ownerVisible,
      `${itemPath}.ownerVisible`,
      errors
    )
    const subVendorVisible = booleanWithDefault(
      itemValue.subVendorVisible,
      `${itemPath}.subVendorVisible`,
      errors
    )
    const notes = optionalString(itemValue.notes, `${itemPath}.notes`, errors)
    if (startDate && !isIsoDate(startDate)) {
      errors.push(`${itemPath}.startDate must be an ISO date.`)
    }
    if (
      sourceAnchorDate &&
      isIsoDate(sourceAnchorDate) &&
      startDate &&
      isIsoDate(startDate) &&
      startDate < sourceAnchorDate
    ) {
      errors.push(`${itemPath}.startDate cannot precede the schedule anchor.`)
    }
    if (phase && !phaseNames.has(phase)) {
      errors.push(`${itemPath}.phase does not match a captured phase.`)
    }
    if (!sourceItemId || !title || !startDate || workdays === null || !phase) {
      return
    }
    if (itemIds.has(sourceItemId)) {
      errors.push(`${path} has duplicate source item ${sourceItemId}.`)
      return
    }
    itemIds.add(sourceItemId)
    items.push({
      sourceItemId,
      title,
      startDate,
      workdays,
      phase,
      displayColor: capturedColor,
      isMilestone,
      assigneePlaceholder,
      ownerVisible,
      subVendorVisible,
      notes,
    })
  })
  if (items.length !== expectedItemCount) {
    errors.push(
      `${path} expected ${expectedItemCount} schedule items but captured ${items.length}.`
    )
  }

  const dependencies: BuildertrendCapturedScheduleDependency[] = []
  const dependencyKeys = new Set<string>()
  dependencyValues.forEach((dependencyValue, index) => {
    if (!isRecord(dependencyValue)) {
      errors.push(`${path}.dependencies[${index}] must be an object.`)
      return
    }
    const dependencyPath = `${path}.dependencies[${index}]`
    const predecessorSourceItemId = requiredString(
      dependencyValue,
      "predecessorSourceItemId",
      dependencyPath,
      errors
    )
    const successorSourceItemId = requiredString(
      dependencyValue,
      "successorSourceItemId",
      dependencyPath,
      errors
    )
    const type = dependencyType(dependencyValue.type)
    if (!type) errors.push(`${dependencyPath}.type is unsupported.`)
    const lagDays = integer(
      dependencyValue.lagDays,
      `${dependencyPath}.lagDays`,
      errors
    )
    if (
      !predecessorSourceItemId ||
      !successorSourceItemId ||
      !type ||
      lagDays === null
    ) {
      return
    }
    if (
      !itemIds.has(predecessorSourceItemId) ||
      !itemIds.has(successorSourceItemId)
    ) {
      errors.push(`${dependencyPath} references an unknown schedule item.`)
      return
    }
    if (predecessorSourceItemId === successorSourceItemId) {
      errors.push(`${dependencyPath} cannot link an item to itself.`)
      return
    }
    const key = `${predecessorSourceItemId}:${successorSourceItemId}:${type}`
    if (dependencyKeys.has(key)) {
      errors.push(`${dependencyPath} duplicates another dependency.`)
      return
    }
    dependencyKeys.add(key)
    dependencies.push({
      predecessorSourceItemId,
      successorSourceItemId,
      type,
      lagDays,
    })
  })

  if (hasDependencyCycle(itemIds, dependencies)) {
    errors.push(`${path}.dependencies contains a cycle.`)
  }

  if (!sourceAnchorDate || !isIsoDate(sourceAnchorDate)) return null
  return { sourceAnchorDate, phases, items, dependencies }
}

export function parseBuildertrendTemplateCapture(
  value: unknown
): BuildertrendTemplateCaptureParseResult {
  if (!isRecord(value)) {
    return { success: false, errors: ["Capture must be a JSON object."] }
  }
  const errors: string[] = []
  const capturedAt = requiredString(value, "capturedAt", "capture", errors)
  const sourceUrl = requiredString(value, "sourceUrl", "capture", errors)
  const expectedActiveCount = nonnegativeInteger(
    value.expectedActiveCount,
    "capture.expectedActiveCount",
    errors
  )
  const excludedArchivedCount = nonnegativeInteger(
    value.excludedArchivedCount,
    "capture.excludedArchivedCount",
    errors
  )
  const templateValues = value.templates
  if (capturedAt && Number.isNaN(new Date(capturedAt).getTime())) {
    errors.push("capture.capturedAt must be a valid ISO timestamp.")
  }
  if (!Array.isArray(templateValues)) {
    errors.push("capture.templates must be an array.")
    return { success: false, errors }
  }

  const templates: BuildertrendTemplateCaptureItem[] = []
  const seenNames = new Set<string>()
  const seenIds = new Set<string>()
  templateValues.forEach((templateValue, index) => {
    if (!isRecord(templateValue)) {
      errors.push(`capture.templates[${index}] must be an object.`)
      return
    }
    const path = `capture.templates[${index}]`
    const name = requiredString(templateValue, "name", path, errors)
    const sourceTemplateId = requiredString(
      templateValue,
      "sourceTemplateId",
      path,
      errors
    )
    const templateSourceUrl = requiredString(
      templateValue,
      "sourceUrl",
      path,
      errors
    )
    const scheduleDurationDays = nonnegativeInteger(
      templateValue.scheduleDurationDays,
      `${path}.scheduleDurationDays`,
      errors
    )
    const moduleCounts = parseModuleCounts(
      templateValue.moduleCounts,
      `${path}.moduleCounts`,
      errors
    )
    const sourceStatus =
      typeof templateValue.sourceStatus === "string"
        ? templateValue.sourceStatus.toLocaleLowerCase("en-US")
        : null
    const sourceMarksArchived =
      templateValue.archived === true ||
      sourceStatus === "archived" ||
      sourceStatus === "inactive" ||
      sourceStatus === "deleted"
    if (
      name &&
      (isArchivedBuildertrendTemplateName(name) || sourceMarksArchived)
    ) {
      errors.push(`Archived template “${name}” is forbidden in capture data.`)
    }
    if (sourceTemplateId && !/^\d+$/.test(sourceTemplateId)) {
      errors.push(`${path}.sourceTemplateId must be numeric.`)
    }
    if (
      templateSourceUrl &&
      !templateSourceUrl.startsWith("https://buildertrend.net/")
    ) {
      errors.push(`${path}.sourceUrl must be a Buildertrend URL.`)
    }
    if (
      sourceTemplateId &&
      templateSourceUrl &&
      !templateSourceUrl.endsWith(`/Template/${sourceTemplateId}`)
    ) {
      errors.push(`${path}.sourceUrl does not match its Buildertrend template ID.`)
    }
    if (
      name &&
      sourceTemplateId &&
      templateSourceUrl &&
      scheduleDurationDays !== null &&
      moduleCounts
    ) {
      const normalizedName = name.toLocaleLowerCase("en-US")
      if (seenNames.has(normalizedName)) {
        errors.push(`Duplicate captured template name: “${name}”.`)
        return
      }
      if (seenIds.has(sourceTemplateId)) {
        errors.push(`Duplicate Buildertrend template ID: ${sourceTemplateId}.`)
        return
      }
      seenNames.add(normalizedName)
      seenIds.add(sourceTemplateId)
      const schedule = parseSchedule(
        templateValue.schedule,
        `${path}.schedule`,
        moduleCounts.scheduleItems,
        errors
      )
      templates.push({
        name,
        sourceTemplateId,
        sourceUrl: templateSourceUrl,
        scheduleDurationDays,
        moduleCounts,
        schedule,
      })
    }
  })
  if (expectedActiveCount !== null && templates.length !== expectedActiveCount) {
    errors.push(
      `Expected ${expectedActiveCount} active templates but captured ${templates.length}.`
    )
  }
  if (errors.length > 0) return { success: false, errors }
  return {
    success: true,
    data: {
      capturedAt: capturedAt ?? "",
      sourceUrl: sourceUrl ?? "",
      expectedActiveCount: expectedActiveCount ?? 0,
      excludedArchivedCount: excludedArchivedCount ?? 0,
      templates,
    },
  }
}

function sql(value: string | number | null): string {
  if (value === null) return "NULL"
  if (typeof value === "number") return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

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
      `INSERT INTO project_templates (` +
        `id, organization_id, source_system, source_key, source_template_id, ` +
        `source_url, name, template_kind, department_code, trade_category, ` +
        `lifecycle_status, review_status, current_version_number, ` +
        `source_metadata_json, created_at, updated_at` +
        `) VALUES (` +
        [
          sql(templateId),
          sql(input.organizationId),
          sql("buildertrend"),
          sql(templateSourceKey),
          sql(captured.sourceTemplateId),
          sql(null),
          sql(captured.name),
          sql(inventoryTemplate.templateKind),
          sql(departmentCode),
          sql(inventoryTemplate.tradeCategory),
          sql("draft"),
          sql(scheduleCaptured ? "content_captured" : "inventory_only"),
          1,
          sql(sourceMetadata),
          sql(input.capture.capturedAt),
          sql(input.capture.capturedAt),
        ].join(", ") +
        `) ON CONFLICT(organization_id, source_system, source_key) DO UPDATE SET ` +
        `source_template_id=excluded.source_template_id, ` +
        `source_url=NULL, name=excluded.name, ` +
        `template_kind=excluded.template_kind, ` +
        `department_code=project_templates.department_code, ` +
        `trade_category=excluded.trade_category, ` +
        `review_status=CASE WHEN project_templates.review_status='verified' ` +
        `THEN project_templates.review_status ELSE excluded.review_status END, ` +
        `current_version_number=COALESCE(` +
        `project_templates.current_version_number, excluded.current_version_number), ` +
        `source_metadata_json=excluded.source_metadata_json, ` +
        `updated_at=excluded.updated_at;`
    )
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(captured))
      .digest("hex")
    statements.push(
      `INSERT INTO project_template_versions (` +
        `id, template_id, version_number, status, source_fingerprint, ` +
        `source_captured_at, notes, created_at` +
        `) VALUES (` +
        [
          sql(versionId),
          sql(templateId),
          1,
          sql("draft"),
          sql(fingerprint),
          sql(input.capture.capturedAt),
          sql("Captured from Buildertrend; review required before publishing."),
          sql(input.capture.capturedAt),
        ].join(", ") +
        `) ON CONFLICT(template_id, version_number) DO UPDATE SET ` +
        `source_fingerprint=excluded.source_fingerprint, ` +
        `source_captured_at=excluded.source_captured_at, ` +
        `notes=excluded.notes WHERE project_template_versions.status='draft';`
    )

    const draftVersionGuard =
      `EXISTS (SELECT 1 FROM project_template_versions ` +
      `WHERE id=${sql(versionId)} AND status='draft')`

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
        `INSERT INTO project_template_modules (` +
          `id, version_id, module_type, source_item_count, ` +
          `normalization_status, source_payload_json` +
          `) SELECT ` +
          [
            sql(moduleId),
            sql(versionId),
            sql(moduleMapping.type),
            moduleCount,
            sql(normalized ? "captured" : "inventory_only"),
            sql(payload),
          ].join(", ") +
          ` WHERE ${draftVersionGuard} ` +
          `ON CONFLICT(version_id, module_type) DO UPDATE SET ` +
          `source_item_count=excluded.source_item_count, ` +
          `normalization_status=excluded.normalization_status, ` +
          `source_payload_json=excluded.source_payload_json ` +
          `WHERE ${draftVersionGuard};`
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
        `INSERT INTO schedule_template_items (` +
          `id, version_id, source_item_id, item_key, title, ` +
          `start_offset_workdays, workdays, phase, display_color, ` +
          `is_milestone, assignee_placeholder, owner_visible, ` +
          `sub_vendor_visible, notes, sort_order` +
          `) SELECT ` +
          [
            sql(id),
            sql(versionId),
            sql(item.sourceItemId),
            sql(`buildertrend:${item.sourceItemId}`),
            sql(item.title),
            startOffsetWorkdays,
            item.workdays,
            sql(item.phase),
            sql(compassDisplayColor(item.displayColor)),
            item.isMilestone ? 1 : 0,
            sql(item.assigneePlaceholder),
            item.ownerVisible ? 1 : 0,
            item.subVendorVisible ? 1 : 0,
            sql(item.notes),
            index,
          ].join(", ") +
          ` WHERE ${draftVersionGuard} ` +
          `ON CONFLICT(version_id, item_key) DO UPDATE SET ` +
          `title=excluded.title, ` +
          `start_offset_workdays=excluded.start_offset_workdays, ` +
          `workdays=excluded.workdays, phase=excluded.phase, ` +
          `display_color=excluded.display_color, ` +
          `is_milestone=excluded.is_milestone, ` +
          `assignee_placeholder=excluded.assignee_placeholder, ` +
          `owner_visible=excluded.owner_visible, ` +
          `sub_vendor_visible=excluded.sub_vendor_visible, ` +
          `notes=excluded.notes, ` +
          `sort_order=excluded.sort_order WHERE ${draftVersionGuard};`
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
        `INSERT INTO schedule_template_dependencies (` +
          `id, version_id, predecessor_item_id, successor_item_id, type, lag_days` +
          `) SELECT ` +
          [
            sql(dependencyId),
            sql(versionId),
            sql(predecessorItemId),
            sql(successorItemId),
            sql(dependency.type),
            dependency.lagDays,
          ].join(", ") +
          ` WHERE ${draftVersionGuard} ` +
          `ON CONFLICT(version_id, predecessor_item_id, successor_item_id, type) ` +
          `DO UPDATE SET lag_days=excluded.lag_days WHERE ${draftVersionGuard};`
      )
    })
    if (input.publishCapturedSchedules) {
      const expectedItemCount = captured.schedule.items.length
      const expectedDependencyCount = captured.schedule.dependencies.length
      statements.push(
        `UPDATE project_template_versions SET ` +
          `status='published', ` +
          `notes=${sql("Captured and count-verified from active Buildertrend template.")} ` +
          `WHERE id=${sql(versionId)} AND status='draft' ` +
          `AND (SELECT COUNT(*) FROM schedule_template_items ` +
          `WHERE version_id=${sql(versionId)})=${expectedItemCount} ` +
          `AND (SELECT COUNT(*) FROM schedule_template_dependencies ` +
          `WHERE version_id=${sql(versionId)})=${expectedDependencyCount};`
      )
      statements.push(
        `UPDATE project_templates SET lifecycle_status='active', ` +
          `review_status='verified', updated_at=${sql(input.capture.capturedAt)} ` +
          `WHERE id=${sql(templateId)} AND source_system='buildertrend' ` +
          `AND EXISTS (SELECT 1 FROM project_template_versions ` +
          `WHERE id=${sql(versionId)} AND status='published');`
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
