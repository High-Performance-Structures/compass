import { readdir, readFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"

export const PILOT_MODULES = ["tasks", "scheduleItems", "selections", "bidPackages"]

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim()
}

function moduleItems(template, module) {
  if (module === "scheduleItems") {
    if (Array.isArray(template.scheduleItems)) return template.scheduleItems
    if (isRecord(template.schedule) && Array.isArray(template.schedule.items)) {
      return template.schedule.items
    }
    return null
  }
  return Array.isArray(template[module]) ? template[module] : null
}

function expectedModuleCounts(template, path) {
  if (!isRecord(template.moduleCounts)) {
    throw new Error(`${path}.moduleCounts must be an object.`)
  }
  return Object.fromEntries(
    PILOT_MODULES.map((module) => {
      const count = template.moduleCounts[module] ?? 0
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`${path}.moduleCounts.${module} must be a non-negative integer.`)
      }
      return [module, count]
    })
  )
}

function reviewedScheduleItems(template, path) {
  if (!isRecord(template.schedule) || !Array.isArray(template.schedule.items)) return null
  const dependencies = template.schedule.dependencies ?? []
  if (!Array.isArray(dependencies)) throw new Error(`${path}.schedule.dependencies must be an array.`)
  const itemIds = new Set(template.schedule.items.map((item, index) =>
    requiredString(item?.sourceItemId, `${path}.schedule.items[${index}].sourceItemId`)
  ))
  const predecessorsBySuccessor = new Map()
  for (const [index, dependency] of dependencies.entries()) {
    if (!isRecord(dependency)) throw new Error(`${path}.schedule.dependencies[${index}] must be an object.`)
    const predecessorId = requiredString(
      dependency.predecessorSourceItemId,
      `${path}.schedule.dependencies[${index}].predecessorSourceItemId`
    )
    const successorId = requiredString(
      dependency.successorSourceItemId,
      `${path}.schedule.dependencies[${index}].successorSourceItemId`
    )
    if (!itemIds.has(predecessorId) || !itemIds.has(successorId)) {
      throw new Error(`${path}.schedule.dependencies[${index}] refers to an unknown schedule item.`)
    }
    const current = predecessorsBySuccessor.get(successorId) ?? []
    current.push(structuredClone(dependency))
    predecessorsBySuccessor.set(successorId, current)
  }
  return template.schedule.items.map((item) => ({
    ...structuredClone(item),
    predecessors: predecessorsBySuccessor.get(item.sourceItemId) ?? [],
  }))
}

function assertUniqueSourceItemIds(items, path) {
  const ids = new Set()
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) throw new Error(`${path}[${index}] must be an object.`)
    const id = requiredString(item.sourceItemId, `${path}[${index}].sourceItemId`)
    if (ids.has(id)) throw new Error(`${path} has duplicate sourceItemId ${id}.`)
    ids.add(id)
  }
}

function normalizeFragment(document, source) {
  if (!isRecord(document)) throw new Error(`${source} must contain a JSON object.`)
  if (Array.isArray(document.templates)) {
    return {
      templates: document.templates,
      conversionExceptions: document.conversionExceptions ?? [],
    }
  }
  if (isRecord(document.template)) {
    return {
      templates: [document.template],
      conversionExceptions: document.conversionExceptions ?? [],
    }
  }
  if (typeof document.sourceTemplateId === "string") {
    return { templates: [document], conversionExceptions: [] }
  }
  throw new Error(
    `${source} must be a capture envelope, { template, conversionExceptions }, or a template object.`
  )
}

function mergeValue(current, incoming, path) {
  if (current === undefined) return structuredClone(incoming)
  if (JSON.stringify(current) === JSON.stringify(incoming)) return current
  throw new Error(`${path} is supplied by more than one fragment with conflicting values.`)
}

function mergeTemplate(current, incoming, path) {
  const merged = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (["sourceTemplateId", "name", "sourceName", "moduleCounts"].includes(key)) continue
    merged[key] = mergeValue(merged[key], value, `${path}.${key}`)
  }
  return merged
}

export async function readPilotContentFragments(directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
    .sort((left, right) => left.name.localeCompare(right.name))
  const documents = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    documents.push({
      source: path,
      document: JSON.parse(await readFile(path, "utf8")),
    })
  }
  return documents
}

export function assembleBuildertrendTemplateContentSubset({
  templateEntries,
  reviewedCapture,
  documents,
  excludedArchivedCount,
  allowIncomplete = false,
  capturedAt = new Date().toISOString(),
  incompleteLabel = "Template content",
  assemblyMetadata = {},
}) {
  if (!Array.isArray(templateEntries) || templateEntries.length === 0) {
    throw new Error("Template content subset must contain at least one template.")
  }
  if (!isRecord(reviewedCapture) || !Array.isArray(reviewedCapture.templates)) {
    throw new Error("Reviewed capture must contain templates.")
  }

  const reviewedById = new Map()
  for (const [index, template] of reviewedCapture.templates.entries()) {
    if (!isRecord(template)) throw new Error(`reviewedCapture.templates[${index}] must be an object.`)
    const id = requiredString(template.sourceTemplateId, `reviewedCapture.templates[${index}].sourceTemplateId`)
    if (reviewedById.has(id)) throw new Error(`Reviewed capture has duplicate sourceTemplateId ${id}.`)
    if (/^archive/i.test(requiredString(template.name, `reviewedCapture.templates[${index}].name`))) {
      throw new Error(`Archived reviewed template ${template.name} is not allowed.`)
    }
    reviewedById.set(id, template)
  }

  const contentById = new Map()
  for (const [index, entry] of templateEntries.entries()) {
    if (!isRecord(entry)) throw new Error(`templateEntries[${index}] must be an object.`)
    const id = requiredString(entry.sourceTemplateId, `templateEntries[${index}].sourceTemplateId`)
    const name = requiredString(entry.sourceName, `templateEntries[${index}].sourceName`)
    const reviewed = reviewedById.get(id)
    if (!reviewed || reviewed.name !== name) {
      throw new Error(`Template content identity mismatch for ${id} (${name}).`)
    }
    if (contentById.has(id)) throw new Error(`Template content duplicates sourceTemplateId ${id}.`)
    const moduleCounts = expectedModuleCounts(reviewed, `reviewed template ${id}`)
    const seed = { sourceTemplateId: id, name, sourceName: name, moduleCounts }
    // Browser fragments never recreate schedule data; the reviewed 40-template
    // capture remains the sole source for schedule rows and dependencies.
    const scheduleItems = reviewedScheduleItems(reviewed, `reviewed template ${id}`)
    if (moduleCounts.scheduleItems > 0 && scheduleItems) {
      seed.schedule = structuredClone(reviewed.schedule)
      seed.scheduleItems = scheduleItems
    }
    contentById.set(id, seed)
  }

  const exceptions = []
  const exceptionKeys = new Set()
  for (const { source, document } of documents) {
    const normalized = normalizeFragment(document, source)
    if (!Array.isArray(normalized.conversionExceptions)) {
      throw new Error(`${source}.conversionExceptions must be an array.`)
    }
    for (const [index, template] of normalized.templates.entries()) {
      if (!isRecord(template)) throw new Error(`${source}.templates[${index}] must be an object.`)
      const id = requiredString(template.sourceTemplateId, `${source}.templates[${index}].sourceTemplateId`)
      const current = contentById.get(id)
      if (!current) {
        throw new Error(
          `${source} contains non-pilot or archived template ${id} outside the approved content subset.`
        )
      }
      const suppliedName = template.name ?? template.sourceName
      if (suppliedName !== current.name) throw new Error(`${source} has an identity mismatch for ${id}.`)
      if (template.moduleCounts !== undefined) {
        const suppliedCounts = expectedModuleCounts(template, `${source}.templates[${index}]`)
        if (JSON.stringify(suppliedCounts) !== JSON.stringify(current.moduleCounts)) {
          throw new Error(`${source} has module-count metadata that conflicts with reviewed source ${id}.`)
        }
      }
      contentById.set(id, mergeTemplate(current, template, `${source}.templates[${index}]`))
    }
    for (const [index, exception] of normalized.conversionExceptions.entries()) {
      if (!isRecord(exception)) throw new Error(`${source}.conversionExceptions[${index}] must be an object.`)
      const templateId = requiredString(
        exception.templateSourceTemplateId,
        `${source}.conversionExceptions[${index}].templateSourceTemplateId`
      )
      if (!contentById.has(templateId)) {
        throw new Error(`${source} contains an exception outside the approved content subset: ${templateId}.`)
      }
      const key = JSON.stringify(exception)
      if (!exceptionKeys.has(key)) {
        exceptionKeys.add(key)
        exceptions.push(structuredClone(exception))
      }
    }
  }

  const missing = []
  const templates = []
  const assembledById = new Map()
  for (const entry of templateEntries) {
    const template = contentById.get(entry.sourceTemplateId)
    if (!template) throw new Error(`Template ${entry.sourceTemplateId} disappeared during assembly.`)
    for (const moduleName of PILOT_MODULES) {
      const items = moduleItems(template, moduleName)
      const expected = template.moduleCounts[moduleName]
      const actual = items?.length ?? 0
      if (actual !== expected) {
        missing.push({ sourceTemplateId: template.sourceTemplateId, name: template.name, module: moduleName, expected, actual })
      } else if (items) {
        assertUniqueSourceItemIds(items, `${template.name}.${moduleName}`)
      }
    }
    templates.push(template)
    assembledById.set(template.sourceTemplateId, template)
  }
  for (const [index, exception] of exceptions.entries()) {
    const path = `conversionExceptions[${index}]`
    const templateId = requiredString(exception.templateSourceTemplateId, `${path}.templateSourceTemplateId`)
    const moduleName = requiredString(exception.module, `${path}.module`)
    if (!PILOT_MODULES.includes(moduleName)) {
      throw new Error(`${path}.module must be one of ${PILOT_MODULES.join(", ")}.`)
    }
    requiredString(exception.field, `${path}.field`)
    requiredString(exception.loss, `${path}.loss`)
    requiredString(exception.recoveryPlan, `${path}.recoveryPlan`)
    if (!("sourceValue" in exception)) throw new Error(`${path}.sourceValue is required.`)
    if (!("sourceItemId" in exception)) throw new Error(`${path}.sourceItemId is required; use null for module-level exceptions.`)
    if (exception.sourceItemId !== null) {
      const sourceItemId = requiredString(exception.sourceItemId, `${path}.sourceItemId`)
      const template = assembledById.get(templateId)
      const items = template ? moduleItems(template, moduleName) : null
      if (!items?.some((item) => item.sourceItemId === sourceItemId)) {
        throw new Error(`${path}.sourceItemId does not identify captured ${moduleName} content.`)
      }
    }
  }
  if (!allowIncomplete && missing.length > 0) {
    const details = missing
      .map((item) => `${item.name} ${item.module}: expected ${item.expected}, found ${item.actual}`)
      .join("; ")
    throw new Error(`${incompleteLabel} is incomplete: ${details}.`)
  }

  return {
    fixtureVersion: 3,
    capturedAt,
    excludedArchivedCount,
    conversionExceptions: exceptions,
    templates,
    assembly: { complete: missing.length === 0, ...assemblyMetadata, missing },
  }
}

export function assembleBuildertrendTemplateContentPilot({
  manifest,
  reviewedCapture,
  documents,
  allowIncomplete = false,
  capturedAt = new Date().toISOString(),
}) {
  if (!isRecord(manifest) || !isRecord(manifest.scope) || !Array.isArray(manifest.templates)) {
    throw new Error("Pilot manifest must contain scope and templates.")
  }
  const scope = manifest.scope
  if (
    scope.activeTemplatesInSource !== 40 ||
    scope.pilotTemplatesIncluded !== 6 ||
    scope.remainingActiveTemplatesUnverified !== 34 ||
    scope.archivedTemplatesExcluded !== 27 ||
    scope.archivedTemplatesIncluded !== 0
  ) {
    throw new Error("Pilot manifest must preserve the reviewed 40/6/34/27 scope.")
  }
  if (
    !isRecord(reviewedCapture) ||
    reviewedCapture.expectedActiveCount !== scope.activeTemplatesInSource ||
    reviewedCapture.excludedArchivedCount !== scope.archivedTemplatesExcluded ||
    !Array.isArray(reviewedCapture.templates) ||
    reviewedCapture.templates.length !== scope.activeTemplatesInSource
  ) {
    throw new Error("Reviewed capture must retain all 40 active templates and exclude 27 archived templates.")
  }

  return assembleBuildertrendTemplateContentSubset({
    templateEntries: manifest.templates,
    reviewedCapture,
    documents,
    excludedArchivedCount: scope.archivedTemplatesExcluded,
    allowIncomplete,
    capturedAt,
    incompleteLabel: "Six-template pilot content",
    assemblyMetadata: {
      pilotTemplateCount: manifest.templates.length,
      remainingActiveTemplatesUnverified: scope.remainingActiveTemplatesUnverified,
    },
  })
}

export function buildBuildertrendTemplateContentInventory(capture, label = "Content") {
  if (!isRecord(capture) || !Array.isArray(capture.templates)) {
    throw new Error(`Assembled ${label.toLowerCase()} capture must contain templates.`)
  }
  if (!isRecord(capture.assembly) || capture.assembly.complete !== true) {
    throw new Error(`${label} inventory cannot be emitted from an incomplete content capture.`)
  }
  return {
    capturedAt: capture.capturedAt,
    expectedActiveCount: capture.templates.length,
    excludedArchivedCount: capture.excludedArchivedCount,
    templates: capture.templates.map((template, index) => ({
      sourceTemplateId: requiredString(
        template.sourceTemplateId,
        `capture.templates[${index}].sourceTemplateId`
      ),
      name: requiredString(template.name, `capture.templates[${index}].name`),
      moduleCounts: expectedModuleCounts(template, `capture.templates[${index}]`),
    })),
  }
}

export function buildBuildertrendTemplateContentPilotInventory(capture) {
  return buildBuildertrendTemplateContentInventory(capture, "Pilot")
}

export function pilotFragmentFileName(sourceTemplateId, sourceName) {
  const slug = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${sourceTemplateId}-${slug}.json`
}

export function describePilotFragmentSource(path) {
  return basename(path)
}
