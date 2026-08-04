function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim()
}

export function buildBuildertrendTemplatePilot({ inventory, capture, manifest }) {
  if (!isRecord(inventory) || !Array.isArray(inventory.templates)) throw new Error("Pilot inventory must contain a templates array.")
  if (!isRecord(capture) || !Array.isArray(capture.templates)) throw new Error("Pilot capture must contain a templates array.")
  if (!isRecord(manifest) || !isRecord(manifest.scope) || !Array.isArray(manifest.templates)) throw new Error("Pilot manifest must contain scope and templates.")
  const scope = manifest.scope
  if (scope.activeTemplatesInSource !== 40 || scope.pilotTemplatesIncluded !== 6 || scope.remainingActiveTemplatesUnverified !== 34 || scope.archivedTemplatesExcluded !== 27 || scope.archivedTemplatesIncluded !== 0) {
    throw new Error("Pilot manifest scope must preserve the reviewed 40/6/34/27 template counts.")
  }
  if (
    !isRecord(manifest.classificationPolicy) ||
    manifest.classificationPolicy.functionalCategoryField !== "tradeCategory"
  ) {
    throw new Error("Pilot manifest must use tradeCategory as its only template classification.")
  }
  if (inventory.expectedActiveCount !== scope.activeTemplatesInSource || capture.expectedActiveCount !== scope.activeTemplatesInSource) {
    throw new Error("Pilot inputs must retain the complete 40-template active source inventory.")
  }
  if (
    inventory.templates.length !== scope.activeTemplatesInSource ||
    capture.templates.length !== scope.activeTemplatesInSource
  ) {
    throw new Error("Pilot inputs must contain all 40 active templates before the six-template allowlist is applied.")
  }
  if (inventory.excludedArchivedCount !== scope.archivedTemplatesExcluded || capture.excludedArchivedCount !== scope.archivedTemplatesExcluded) {
    throw new Error("Pilot inputs must retain the reviewed archived-template exclusion count.")
  }
  if (manifest.templates.length !== scope.pilotTemplatesIncluded) throw new Error("Pilot manifest template count does not match its scope.")

  const inventoryByName = new Map()
  const inventoryBySourceId = new Map()
  for (const item of inventory.templates) {
    if (!isRecord(item)) throw new Error("Pilot inventory contains an invalid template.")
    const name = requiredString(item.name, "Pilot inventory template name")
    const normalizedName = name.toLocaleLowerCase("en-US")
    if (inventoryByName.has(normalizedName)) {
      throw new Error(`Pilot inventory has duplicate template name ${name}.`)
    }
    inventoryByName.set(normalizedName, item)
    if (typeof item.sourceTemplateId === "string" && item.sourceTemplateId.trim()) {
      if (inventoryBySourceId.has(item.sourceTemplateId)) {
        throw new Error(`Pilot inventory has duplicate sourceTemplateId ${item.sourceTemplateId}.`)
      }
      inventoryBySourceId.set(item.sourceTemplateId, item)
    }
  }
  const captureById = new Map()
  for (const item of capture.templates) {
    if (!isRecord(item)) throw new Error("Pilot capture contains an invalid template.")
    const id = requiredString(item.sourceTemplateId, "Pilot capture sourceTemplateId")
    if (captureById.has(id)) throw new Error(`Pilot capture has duplicate sourceTemplateId ${id}.`)
    captureById.set(id, item)
  }

  const ids = new Set()
  const names = new Set()
  const pilotInventory = []
  const pilotCapture = []
  for (const [index, entry] of manifest.templates.entries()) {
    if (!isRecord(entry)) throw new Error(`Pilot manifest templates[${index}] must be an object.`)
    const sourceTemplateId = requiredString(entry.sourceTemplateId, `Pilot manifest templates[${index}].sourceTemplateId`)
    const sourceName = requiredString(entry.sourceName, `Pilot manifest templates[${index}].sourceName`)
    const tradeCategory = requiredString(entry.tradeCategory, `Pilot manifest templates[${index}].tradeCategory`)
    if (ids.has(sourceTemplateId) || names.has(sourceName.toLocaleLowerCase("en-US"))) throw new Error(`Pilot manifest duplicates template ${sourceTemplateId}.`)
    ids.add(sourceTemplateId)
    names.add(sourceName.toLocaleLowerCase("en-US"))
    const captured = captureById.get(sourceTemplateId)
    if (!captured || captured.name !== sourceName) throw new Error(`Pilot manifest identity mismatch for ${sourceTemplateId}.`)
    const inventoryTemplate =
      inventoryBySourceId.get(sourceTemplateId) ??
      inventoryByName.get(sourceName.toLocaleLowerCase("en-US"))
    if (!inventoryTemplate) throw new Error(`Pilot manifest template ${sourceName} is not active inventory.`)
    if (
      typeof inventoryTemplate.sourceTemplateId === "string" &&
      inventoryTemplate.sourceTemplateId !== sourceTemplateId
    ) {
      throw new Error(`Pilot inventory identity mismatch for ${sourceTemplateId}.`)
    }
    // Department/branding belongs to the destination project, never the reusable template.
    pilotInventory.push({ ...inventoryTemplate, tradeCategory, departmentCode: null })
    pilotCapture.push(captured)
  }
  return {
    inventory: { ...inventory, expectedActiveCount: manifest.templates.length, templates: pilotInventory },
    capture: { ...capture, expectedActiveCount: manifest.templates.length, templates: pilotCapture },
    remainingActiveTemplatesUnverified: scope.remainingActiveTemplatesUnverified,
  }
}
