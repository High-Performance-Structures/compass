import { isRecord } from "@/lib/shared/guards"

import { isArchivedBuildertrendTemplateName } from "./buildertrend-template-inventory"

/*
 * Parses and validates a Buildertrend active-template content capture. The
 * SQL for a parsed capture is built in buildertrend-template-capture.ts.
 */

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

type BuildertrendCapturedScheduleItem = {
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

type BuildertrendCapturedScheduleDependency = {
  readonly predecessorSourceItemId: string
  readonly successorSourceItemId: string
  readonly type: "FS" | "SS" | "FF" | "SF"
  readonly lagDays: number
}

type BuildertrendCapturedSchedule = {
  readonly sourceAnchorDate: string
  readonly phases: readonly {
    readonly sourcePhaseId: string
    readonly name: string
  }[]
  readonly items: readonly BuildertrendCapturedScheduleItem[]
  readonly dependencies: readonly BuildertrendCapturedScheduleDependency[]
}

type BuildertrendTemplateCaptureItem = {
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

export const capturedDisplayColors = new Set([
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
