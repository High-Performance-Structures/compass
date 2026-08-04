function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim()
}

function requireReviewedForty(value, path) {
  if (
    !isRecord(value) ||
    value.expectedActiveCount !== 40 ||
    value.excludedArchivedCount !== 27 ||
    !Array.isArray(value.templates) ||
    value.templates.length !== 40
  ) {
    throw new Error(`${path} must retain all 40 active templates and 27 archived exclusions.`)
  }
}

function uniqueMap(items, key, path) {
  const result = new Map()
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) throw new Error(`${path}[${index}] must be an object.`)
    const value = requiredString(item[key], `${path}[${index}].${key}`)
    if (result.has(value)) throw new Error(`${path} duplicates ${key} ${value}.`)
    result.set(value, item)
  }
  return result
}

function validateSchedule(template, path) {
  const expectedItems = template.moduleCounts?.scheduleItems ?? 0
  if (!Number.isInteger(expectedItems) || expectedItems < 0) {
    throw new Error(`${path}.moduleCounts.scheduleItems must be a non-negative integer.`)
  }
  if (expectedItems === 0) {
    if (template.schedule !== null) {
      throw new Error(`${path}.schedule must be null when scheduleItems is zero.`)
    }
    return { scheduleItemCount: 0, scheduleDependencyCount: 0 }
  }
  if (!isRecord(template.schedule) || !Array.isArray(template.schedule.items)) {
    throw new Error(`${path}.schedule.items must contain reviewed schedule content.`)
  }
  if (template.schedule.items.length !== expectedItems) {
    throw new Error(
      `${path} schedule count mismatch: expected ${expectedItems}, found ${template.schedule.items.length}.`
    )
  }
  const itemIds = new Set()
  for (const [index, item] of template.schedule.items.entries()) {
    const id = requiredString(item?.sourceItemId, `${path}.schedule.items[${index}].sourceItemId`)
    if (itemIds.has(id)) throw new Error(`${path}.schedule.items duplicates sourceItemId ${id}.`)
    itemIds.add(id)
  }
  if (!Array.isArray(template.schedule.dependencies)) {
    throw new Error(`${path}.schedule.dependencies must be an array.`)
  }
  const dependencyKeys = new Set()
  for (const [index, dependency] of template.schedule.dependencies.entries()) {
    const predecessor = requiredString(
      dependency?.predecessorSourceItemId,
      `${path}.schedule.dependencies[${index}].predecessorSourceItemId`
    )
    const successor = requiredString(
      dependency?.successorSourceItemId,
      `${path}.schedule.dependencies[${index}].successorSourceItemId`
    )
    if (!itemIds.has(predecessor) || !itemIds.has(successor)) {
      throw new Error(`${path}.schedule.dependencies[${index}] references an unknown item.`)
    }
    if (!["FS", "SS", "FF", "SF"].includes(dependency.type)) {
      throw new Error(`${path}.schedule.dependencies[${index}].type is invalid.`)
    }
    if (!Number.isInteger(dependency.lagDays)) {
      throw new Error(`${path}.schedule.dependencies[${index}].lagDays must be an integer.`)
    }
    const key = `${predecessor}:${successor}:${dependency.type}`
    if (dependencyKeys.has(key)) throw new Error(`${path}.schedule.dependencies duplicates ${key}.`)
    dependencyKeys.add(key)
  }
  return {
    scheduleItemCount: template.schedule.items.length,
    scheduleDependencyCount: template.schedule.dependencies.length,
  }
}

export function buildBuildertrendTemplateScheduleScope({
  inventory,
  capture,
  workplan,
  pilotManifest,
  manifest,
}) {
  requireReviewedForty(inventory, "Schedule-scope inventory")
  requireReviewedForty(capture, "Schedule-scope capture")
  if (
    !isRecord(workplan) ||
    !isRecord(workplan.scope) ||
    workplan.scope.activeTemplatesIncluded !== 40 ||
    workplan.scope.archivedTemplatesExcluded !== 27 ||
    workplan.scope.archivedTemplatesIncluded !== 0 ||
    !Array.isArray(workplan.templates) ||
    workplan.templates.length !== 40
  ) {
    throw new Error("Schedule-scope workplan must retain the reviewed 40/27 scope.")
  }
  if (!isRecord(pilotManifest) || !Array.isArray(pilotManifest.templates)) {
    throw new Error("Schedule-scope pilot manifest must contain templates.")
  }
  if (!isRecord(manifest) || !isRecord(manifest.scope) || !Array.isArray(manifest.templates)) {
    throw new Error("Non-pilot schedule manifest must contain scope and templates.")
  }
  const scope = manifest.scope
  if (
    scope.activeTemplatesInSource !== 40 ||
    scope.pilotTemplatesExcluded !== 6 ||
    scope.nonPilotTemplatesIncluded !== 34 ||
    scope.scheduleBearingTemplatesIncluded !== 24 ||
    scope.scheduleItemsIncluded !== 93 ||
    scope.scheduleDependenciesIncluded !== 70 ||
    scope.archivedTemplatesExcluded !== 27 ||
    scope.archivedTemplatesIncluded !== 0
  ) {
    throw new Error("Non-pilot schedule manifest must preserve the reviewed 40/6/34/24/93/70/27 scope.")
  }
  if (
    !isRecord(manifest.classificationPolicy) ||
    manifest.classificationPolicy.functionalCategoryField !== "tradeCategory" ||
    manifest.classificationPolicy.departmentSource !== "destinationProject"
  ) {
    throw new Error("Non-pilot schedule manifest must use category-only project classification.")
  }
  if (
    !isRecord(manifest.releasePolicy) ||
    manifest.releasePolicy.scheduleContent !== "draft_import_only" ||
    manifest.releasePolicy.wholeTemplateVerificationAllowed !== false ||
    JSON.stringify(manifest.releasePolicy.gatedModules) !==
      JSON.stringify(["tasks", "selections", "bid_packages"])
  ) {
    throw new Error("Non-pilot schedule manifest must keep incomplete modules gated.")
  }

  const captureById = uniqueMap(capture.templates, "sourceTemplateId", "capture.templates")
  const workplanById = uniqueMap(workplan.templates, "sourceTemplateId", "workplan.templates")
  const inventoryByName = uniqueMap(inventory.templates, "name", "inventory.templates")
  const pilotIds = new Set(
    pilotManifest.templates.map((entry, index) =>
      requiredString(entry?.sourceTemplateId, `pilotManifest.templates[${index}].sourceTemplateId`)
    )
  )
  if (pilotIds.size !== scope.pilotTemplatesExcluded) {
    throw new Error("Pilot manifest must contain exactly six unique templates.")
  }
  const expectedNonPilotIds = new Set(
    [...captureById.keys()].filter((sourceTemplateId) => !pilotIds.has(sourceTemplateId))
  )
  if (expectedNonPilotIds.size !== scope.nonPilotTemplatesIncluded) {
    throw new Error("The reviewed capture does not have the expected 34-template pilot complement.")
  }

  const scopedInventory = []
  const scopedCapture = []
  const seenManifestIds = new Set()
  let scheduleBearingTemplates = 0
  let scheduleItems = 0
  let scheduleDependencies = 0
  for (const [index, entry] of manifest.templates.entries()) {
    if (!isRecord(entry)) throw new Error(`manifest.templates[${index}] must be an object.`)
    const id = requiredString(entry.sourceTemplateId, `manifest.templates[${index}].sourceTemplateId`)
    const name = requiredString(entry.sourceName, `manifest.templates[${index}].sourceName`)
    const tradeCategory = requiredString(entry.tradeCategory, `manifest.templates[${index}].tradeCategory`)
    if (!expectedNonPilotIds.has(id)) throw new Error(`Manifest template ${id} is not in the non-pilot complement.`)
    if (seenManifestIds.has(id)) throw new Error(`Manifest duplicates template ${id}.`)
    seenManifestIds.add(id)
    const captured = captureById.get(id)
    const planned = workplanById.get(id)
    const inventoryItem = inventoryByName.get(name)
    if (!captured || captured.name !== name || !planned || planned.sourceName !== name || !inventoryItem) {
      throw new Error(`Manifest identity mismatch for ${id} (${name}).`)
    }
    if (inventoryItem.tradeCategory !== tradeCategory) {
      throw new Error(`Manifest category mismatch for ${id} (${name}).`)
    }
    const plannedScheduleCount = planned.moduleCounts?.scheduleItems ?? 0
    const capturedScheduleCount = captured.moduleCounts?.scheduleItems ?? 0
    if (
      plannedScheduleCount !== capturedScheduleCount ||
      entry.scheduleItemCount !== capturedScheduleCount
    ) {
      throw new Error(`Schedule item audit mismatch for ${id} (${name}).`)
    }
    const audited = validateSchedule(captured, `capture template ${id}`)
    if (entry.scheduleDependencyCount !== audited.scheduleDependencyCount) {
      throw new Error(`Schedule dependency audit mismatch for ${id} (${name}).`)
    }
    if (audited.scheduleItemCount > 0) scheduleBearingTemplates += 1
    scheduleItems += audited.scheduleItemCount
    scheduleDependencies += audited.scheduleDependencyCount
    scopedInventory.push({ ...inventoryItem, sourceTemplateId: id, departmentCode: null })
    scopedCapture.push(captured)
  }
  if (seenManifestIds.size !== expectedNonPilotIds.size) {
    const missing = [...expectedNonPilotIds].filter((id) => !seenManifestIds.has(id))
    throw new Error(`Non-pilot schedule manifest is incomplete; missing [${missing.join(", ")}].`)
  }
  if (
    scheduleBearingTemplates !== scope.scheduleBearingTemplatesIncluded ||
    scheduleItems !== scope.scheduleItemsIncluded ||
    scheduleDependencies !== scope.scheduleDependenciesIncluded
  ) {
    throw new Error("Non-pilot schedule aggregate audit does not match the manifest scope.")
  }

  return {
    inventory: { ...inventory, expectedActiveCount: scopedInventory.length, templates: scopedInventory },
    capture: { ...capture, expectedActiveCount: scopedCapture.length, templates: scopedCapture },
    summary: {
      nonPilotTemplateCount: scopedCapture.length,
      scheduleBearingTemplateCount: scheduleBearingTemplates,
      scheduleItemCount: scheduleItems,
      scheduleDependencyCount: scheduleDependencies,
      gatedModuleTypes: ["tasks", "selections", "bid_packages"],
    },
  }
}
