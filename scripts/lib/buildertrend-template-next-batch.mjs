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

function validateTaskHierarchy(items, path) {
  const tasksById = new Map(items.map((item) => [item.sourceItemId, item]))
  for (const [index, task] of items.entries()) {
    const parentId = task.parentSourceItemId
    if (parentId === undefined || parentId === null) continue
    const normalizedParentId = requiredString(parentId, `${path}[${index}].parentSourceItemId`)
    if (normalizedParentId === task.sourceItemId) {
      throw new Error(`${path}[${index}] cannot reference itself as parentSourceItemId.`)
    }
    if (!tasksById.has(normalizedParentId)) {
      throw new Error(`${path}[${index}].parentSourceItemId ${normalizedParentId} is not in the same task fragment.`)
    }
  }

  const complete = new Set()
  for (const task of items) {
    if (complete.has(task.sourceItemId)) continue
    const currentPath = new Set()
    let current = task
    while (current) {
      if (complete.has(current.sourceItemId)) break
      if (currentPath.has(current.sourceItemId)) {
        throw new Error(`${path} contains a parentSourceItemId cycle at ${current.sourceItemId}.`)
      }
      currentPath.add(current.sourceItemId)
      const parentId = current.parentSourceItemId
      current = typeof parentId === "string" ? tasksById.get(parentId) : undefined
    }
    for (const id of currentPath) complete.add(id)
  }
}

function validateSelectionChoices(selection, path) {
  if (selection.choices === undefined) return
  if (!Array.isArray(selection.choices)) throw new Error(`${path}.choices must be an array.`)
  const choiceIds = new Set()
  for (const [index, choice] of selection.choices.entries()) {
    if (!isRecord(choice)) throw new Error(`${path}.choices[${index}] must be an object.`)
    const choiceId = requiredString(choice.sourceChoiceId, `${path}.choices[${index}].sourceChoiceId`)
    requiredString(choice.title, `${path}.choices[${index}].title`)
    if (choiceIds.has(choiceId)) throw new Error(`${path}.choices duplicates sourceChoiceId ${choiceId}.`)
    choiceIds.add(choiceId)
  }
}

function validateBidPackageLineItems(bidPackage, path) {
  if (bidPackage.lineItems === undefined) return
  if (!Array.isArray(bidPackage.lineItems)) throw new Error(`${path}.lineItems must be an array.`)
  for (const [index, lineItem] of bidPackage.lineItems.entries()) {
    if (!isRecord(lineItem)) throw new Error(`${path}.lineItems[${index}] must be an object.`)
    requiredString(lineItem.title, `${path}.lineItems[${index}].title`)
    requiredString(lineItem.costCode, `${path}.lineItems[${index}].costCode`)
  }
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
        if (moduleName === "selections") {
          validateSelectionChoices(item, `${source}.${moduleName}[${index}]`)
        }
        if (moduleName === "bidPackages") {
          validateBidPackageLineItems(item, `${source}.${moduleName}[${index}]`)
        }
      }
      if (moduleName === "tasks") validateTaskHierarchy(template[moduleName], `${source}.tasks`)
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
  const incompleteTemplateIds = new Set(missing.map((item) => item.sourceTemplateId))
  const structurallyCompleteTemplateIds = manifest.templates
    .filter((template) => !incompleteTemplateIds.has(template.sourceTemplateId))
    .map((template) => template.sourceTemplateId)
  return {
    complete: missing.length === 0,
    capturedGateCount: manifest.browserCaptureGateCount - missing.length,
    remainingGateCount: missing.length,
    priorityRemainingGateCount: missing.filter((item) => item.wave === "priority-sequences-06-12").length,
    structurallyCompleteTemplateIds,
    incompleteTemplateCount: incompleteTemplateIds.size,
    missing,
  }
}

export function validateBuildertrendNextDraftManifest({
  manifest,
  draftManifest,
  documents,
}) {
  if (!isRecord(draftManifest) || !isRecord(draftManifest.scope) || !Array.isArray(draftManifest.templates)) {
    throw new Error("Next draft manifest must contain scope and templates.")
  }
  const scope = draftManifest.scope
  if (
    scope.activeTemplatesInSource !== 40 ||
    scope.completedPilotTemplatesExcluded !== 6 ||
    scope.nonPilotCandidatesAudited !== 34 ||
    !Number.isInteger(scope.structurallyCompleteTemplatesIncluded) ||
    !Number.isInteger(scope.incompleteTemplatesExcluded) ||
    scope.structurallyCompleteTemplatesIncluded + scope.incompleteTemplatesExcluded !== 34 ||
    scope.archivedTemplatesExcluded !== 27 ||
    scope.archivedTemplatesIncluded !== 0
  ) {
    throw new Error("Next draft manifest must preserve the reviewed 40/6/34/27 scope.")
  }
  if (
    !isRecord(draftManifest.releasePolicy) ||
    draftManifest.releasePolicy.lifecycleStatus !== "draft" ||
    draftManifest.releasePolicy.versionStatus !== "draft" ||
    draftManifest.releasePolicy.publishAllowed !== false
  ) {
    throw new Error("Next draft manifest must remain draft-only and unpublished.")
  }

  const status = validateBuildertrendNextBatchFragments({ manifest, documents })
  if (
    scope.structurallyCompleteTemplatesIncluded !== status.structurallyCompleteTemplateIds.length ||
    scope.incompleteTemplatesExcluded !== status.incompleteTemplateCount
  ) {
    throw new Error("Next draft manifest scope is stale for the currently reviewed fragments.")
  }
  const expectedIds = status.structurallyCompleteTemplateIds
  const declaredIds = draftManifest.templates.map((template, index) =>
    requiredString(template?.sourceTemplateId, `draftManifest.templates[${index}].sourceTemplateId`)
  )
  if (new Set(declaredIds).size !== declaredIds.length) {
    throw new Error("Next draft manifest duplicates a sourceTemplateId.")
  }
  if (JSON.stringify(declaredIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      "Next draft manifest is stale; its included templates do not match the structurally complete fragments."
    )
  }

  const manifestById = new Map(manifest.templates.map((template) => [template.sourceTemplateId, template]))
  const entries = draftManifest.templates.map((template, index) => {
    const sourceTemplateId = declaredIds[index]
    const sourceName = requiredString(template.sourceName, `draftManifest.templates[${index}].sourceName`)
    const reviewed = manifestById.get(sourceTemplateId)
    if (!reviewed || reviewed.sourceName !== sourceName) {
      throw new Error(`Next draft manifest identity mismatch for ${sourceTemplateId}.`)
    }
    if (reviewed.workplanSequence !== template.workplanSequence) {
      throw new Error(`Next draft manifest sequence mismatch for ${sourceTemplateId}.`)
    }
    if (JSON.stringify(reviewed.moduleCounts) !== JSON.stringify(template.moduleCounts)) {
      throw new Error(`Next draft manifest module-count mismatch for ${sourceTemplateId}.`)
    }
    return { sourceTemplateId, sourceName }
  })

  return {
    entries,
    status,
    summary: {
      includedTemplateCount: entries.length,
      excludedIncompleteTemplateCount: status.incompleteTemplateCount,
      excludedArchivedTemplateCount: draftManifest.scope.archivedTemplatesExcluded,
      concreteFooterIncluded: declaredIds.includes("12581937"),
    },
  }
}
