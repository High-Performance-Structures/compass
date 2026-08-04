export const TEMPLATE_CONTENT_MODULES = ["tasks", "scheduleItems", "selections", "bidPackages"]
export const BROWSER_CAPTURE_MODULES = ["tasks", "selections", "bidPackages"]

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string.`)
  return value.trim()
}

function requireCount(value, path) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${path} must be a non-negative integer.`)
  return value
}

function normalizedCounts(value, path) {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`)
  for (const key of Object.keys(value)) {
    if (!TEMPLATE_CONTENT_MODULES.includes(key)) throw new Error(`${path} has unsupported module ${key}.`)
  }
  return Object.fromEntries(
    TEMPLATE_CONTENT_MODULES.map((moduleName) => [
      moduleName,
      requireCount(value[moduleName] ?? 0, `${path}.${moduleName}`),
    ])
  )
}

function addCounts(left, right) {
  return Object.fromEntries(
    TEMPLATE_CONTENT_MODULES.map((moduleName) => [moduleName, left[moduleName] + right[moduleName]])
  )
}

function emptyCounts() {
  return Object.fromEntries(TEMPLATE_CONTENT_MODULES.map((moduleName) => [moduleName, 0]))
}

function sumRows(templates) {
  const moduleCounts = templates.reduce(
    (total, template) => addCounts(total, template.moduleCounts),
    emptyCounts()
  )
  return {
    ...moduleCounts,
    browserCaptureRows: BROWSER_CAPTURE_MODULES.reduce(
      (total, moduleName) => total + moduleCounts[moduleName],
      0
    ),
    totalWorkItems: TEMPLATE_CONTENT_MODULES.reduce(
      (total, moduleName) => total + moduleCounts[moduleName],
      0
    ),
  }
}

function browserGateCount(templates) {
  return templates.reduce(
    (total, template) => total + BROWSER_CAPTURE_MODULES.filter(
      (moduleName) => template.moduleCounts[moduleName] > 0
    ).length,
    0
  )
}

function fragmentPath(template) {
  return `scripts/fixtures/buildertrend-template-content-next-batch/fragments/${String(template.sequence).padStart(2, "0")}-${template.sourceTemplateId}.capture.json`
}

export function buildBuildertrendTemplateNextBatchManifest({ workplan, pilotManifest, generatedAt }) {
  if (!isRecord(workplan) || !isRecord(workplan.scope) || !Array.isArray(workplan.templates)) {
    throw new Error("Workplan must contain scope and templates.")
  }
  if (!isRecord(pilotManifest) || !Array.isArray(pilotManifest.templates)) {
    throw new Error("Pilot manifest must contain templates.")
  }
  if (
    workplan.scope.activeTemplatesIncluded !== 40 ||
    workplan.scope.archivedTemplatesExcluded !== 27 ||
    workplan.scope.archivedTemplatesIncluded !== 0 ||
    workplan.templates.length !== 40
  ) {
    throw new Error("Workplan must preserve the reviewed 40 active / 27 archived-excluded scope.")
  }
  if (pilotManifest.templates.length !== 6) throw new Error("Completed pilot manifest must contain six templates.")

  const pilotIds = new Set()
  for (const [index, template] of pilotManifest.templates.entries()) {
    if (!isRecord(template)) throw new Error(`pilotManifest.templates[${index}] must be an object.`)
    const id = requiredString(template.sourceTemplateId, `pilotManifest.templates[${index}].sourceTemplateId`)
    if (pilotIds.has(id)) throw new Error(`Pilot manifest duplicates sourceTemplateId ${id}.`)
    pilotIds.add(id)
  }

  const sourceIds = new Set()
  const remaining = workplan.templates.map((template, index) => {
    if (!isRecord(template)) throw new Error(`workplan.templates[${index}] must be an object.`)
    const sourceTemplateId = requiredString(template.sourceTemplateId, `workplan.templates[${index}].sourceTemplateId`)
    if (sourceIds.has(sourceTemplateId)) throw new Error(`Workplan duplicates sourceTemplateId ${sourceTemplateId}.`)
    sourceIds.add(sourceTemplateId)
    const sequence = requireCount(template.sequence, `workplan.templates[${index}].sequence`)
    const sourceName = requiredString(template.sourceName, `workplan.templates[${index}].sourceName`)
    if (/^archive/i.test(sourceName)) throw new Error(`Archived template ${sourceName} is not allowed.`)
    const moduleCounts = normalizedCounts(template.moduleCounts, `workplan.templates[${index}].moduleCounts`)
    const totalWorkItems = TEMPLATE_CONTENT_MODULES.reduce(
      (total, moduleName) => total + moduleCounts[moduleName],
      0
    )
    if (totalWorkItems !== template.totalWorkItems) {
      throw new Error(`Workplan totalWorkItems mismatch for ${sourceTemplateId}.`)
    }
    return {
      sequence,
      sourceTemplateId,
      sourceName,
      temporaryBuildertrendTargetName: requiredString(
        template.temporaryBuildertrendTargetName,
        `workplan.templates[${index}].temporaryBuildertrendTargetName`
      ),
      moduleCounts,
      totalWorkItems,
      workplanStatus: requiredString(template.status, `workplan.templates[${index}].status`),
    }
  }).filter((template) => !pilotIds.has(template.sourceTemplateId))
    .sort((left, right) => left.sequence - right.sequence)

  if (sourceIds.size !== 40 || remaining.length !== 34) {
    throw new Error("Next-batch manifest must retain exactly 34 non-pilot active templates.")
  }
  for (const pilotId of pilotIds) {
    if (!sourceIds.has(pilotId)) throw new Error(`Pilot template ${pilotId} is not in the active workplan.`)
  }

  const priority = remaining.filter((template) => template.sequence >= 6 && template.sequence <= 12)
  const later = remaining.filter((template) => template.sequence > 12)
  if (
    priority.length !== 6 ||
    priority.map((template) => template.sequence).join(",") !== "6,7,8,9,11,12"
  ) {
    throw new Error("Priority wave must be workplan sequences 6–12 with completed pilot sequence 10 excluded.")
  }
  if (later.length !== 28) throw new Error("Remaining wave must contain workplan sequences 13–40.")

  const rows = remaining.map((template, index) => {
    const priorityWave = template.sequence <= 12 ? "priority-sequences-06-12" : "remaining-sequences-13-40"
    const gates = Object.fromEntries(
      TEMPLATE_CONTENT_MODULES
        .filter((moduleName) => template.moduleCounts[moduleName] > 0)
        .map((moduleName) => [
          moduleName,
          {
            expectedCount: template.moduleCounts[moduleName],
            evidence: moduleName === "scheduleItems" ? "reviewed_source_capture" : "browser_fragment_required",
          },
        ])
    )
    return {
      captureOrder: index + 1,
      workplanSequence: template.sequence,
      sourceTemplateId: template.sourceTemplateId,
      sourceName: template.sourceName,
      temporaryBuildertrendTargetName: template.temporaryBuildertrendTargetName,
      wave: priorityWave,
      moduleCounts: template.moduleCounts,
      totalWorkItems: template.totalWorkItems,
      workplanStatus: template.workplanStatus,
      fragmentPath: fragmentPath(template),
      captureGates: gates,
    }
  })

  const wave = (id, name, templates) => ({
    id,
    name,
    workplanSequences: templates.map((template) => template.sequence),
    templateCount: templates.length,
    browserCaptureGateCount: browserGateCount(templates),
    totals: sumRows(templates),
    sourceTemplateIds: templates.map((template) => template.sourceTemplateId),
  })

  return {
    manifestVersion: 1,
    generatedAt: requiredString(generatedAt, "generatedAt"),
    sourceWorkplan: "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
    completedPilotManifest: "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json",
    scope: {
      activeTemplatesInSource: 40,
      completedPilotTemplatesExcluded: 6,
      remainingActiveTemplatesIncluded: 34,
      archivedTemplatesExcluded: 27,
      archivedTemplatesIncluded: 0,
    },
    capturePolicy: {
      classification: "Capture does not assign a department; the destination job supplies department context.",
      sourceMutation: "prohibited",
      contentFabrication: "prohibited",
      scheduleEvidence: "Reuse reviewed schedule rows and dependencies from the 40-template source capture.",
    },
    aggregateTotals: sumRows(remaining),
    browserCaptureGateCount: browserGateCount(remaining),
    waves: [
      wave("priority-sequences-06-12", "Next six non-pilot templates", priority),
      wave("remaining-sequences-13-40", "Remaining non-pilot templates", later),
    ],
    templates: rows,
  }
}

function templateFromDocument(document, path) {
  if (!isRecord(document)) throw new Error(`${path} must be a JSON object.`)
  if (isRecord(document.template)) return document.template
  if (typeof document.sourceTemplateId === "string") return document
  if (Array.isArray(document.templates) && document.templates.length === 1 && isRecord(document.templates[0])) {
    return document.templates[0]
  }
  throw new Error(`${path} must identify exactly one template.`)
}

export function validateBuildertrendNextBatchFragments({ manifest, documents }) {
  if (!isRecord(manifest) || !Array.isArray(manifest.templates)) {
    throw new Error("Next-batch manifest must contain templates.")
  }
  const manifestById = new Map(manifest.templates.map((template) => [template.sourceTemplateId, template]))
  const captured = new Map()
  for (const { source, document } of documents) {
    const template = templateFromDocument(document, source)
    const id = requiredString(template.sourceTemplateId, `${source}.sourceTemplateId`)
    const expected = manifestById.get(id)
    if (!expected) throw new Error(`${source} identifies a pilot, archived, or unknown template ${id}.`)
    const name = template.name ?? template.sourceName
    if (name !== expected.sourceName) throw new Error(`${source} has an identity mismatch for ${id}.`)
    if (template.moduleCounts !== undefined) {
      const counts = normalizedCounts(template.moduleCounts, `${source}.moduleCounts`)
      if (JSON.stringify(counts) !== JSON.stringify(expected.moduleCounts)) {
        throw new Error(`${source} module counts conflict with the reviewed workplan.`)
      }
    }
    const current = captured.get(id) ?? new Set()
    for (const moduleName of BROWSER_CAPTURE_MODULES) {
      if (template[moduleName] === undefined) continue
      if (!Array.isArray(template[moduleName])) throw new Error(`${source}.${moduleName} must be an array.`)
      if (current.has(moduleName)) throw new Error(`${source} duplicates captured module ${moduleName} for ${id}.`)
      const expectedCount = expected.moduleCounts[moduleName]
      if (template[moduleName].length !== expectedCount) {
        throw new Error(`${source}.${moduleName} expected ${expectedCount}, found ${template[moduleName].length}.`)
      }
      const itemIds = new Set()
      for (const [index, item] of template[moduleName].entries()) {
        if (!isRecord(item)) throw new Error(`${source}.${moduleName}[${index}] must be an object.`)
        const itemId = requiredString(item.sourceItemId, `${source}.${moduleName}[${index}].sourceItemId`)
        requiredString(item.title, `${source}.${moduleName}[${index}].title`)
        if (itemIds.has(itemId)) throw new Error(`${source}.${moduleName} duplicates sourceItemId ${itemId}.`)
        itemIds.add(itemId)
      }
      current.add(moduleName)
    }
    if (template.scheduleItems !== undefined || template.schedule !== undefined) {
      throw new Error(`${source} must not duplicate schedule data already preserved in the reviewed source capture.`)
    }
    captured.set(id, current)
  }

  const missing = []
  for (const template of manifest.templates) {
    const modules = captured.get(template.sourceTemplateId) ?? new Set()
    for (const moduleName of BROWSER_CAPTURE_MODULES) {
      const expectedCount = template.moduleCounts[moduleName]
      if (expectedCount > 0 && !modules.has(moduleName)) {
        missing.push({
          workplanSequence: template.workplanSequence,
          sourceTemplateId: template.sourceTemplateId,
          sourceName: template.sourceName,
          module: moduleName,
          expectedCount,
          wave: template.wave,
        })
      }
    }
  }
  return {
    complete: missing.length === 0,
    capturedGateCount: manifest.browserCaptureGateCount - missing.length,
    remainingGateCount: missing.length,
    priorityRemainingGateCount: missing.filter((item) => item.wave === "priority-sequences-06-12").length,
    missing,
  }
}
