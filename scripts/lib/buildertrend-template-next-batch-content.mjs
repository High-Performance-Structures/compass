import {
  assembleBuildertrendTemplateContentSubset,
  buildBuildertrendTemplateContentInventory,
} from "./buildertrend-template-content-pilot.mjs"
import {
  BROWSER_CAPTURE_MODULES,
  validateBuildertrendNextBatchFragments,
} from "./buildertrend-template-next-batch.mjs"

export const NEXT_BATCH_CONTENT_IDS = ["12859981", "12978371"]
export const INCOMPLETE_CONCRETE_FOOTER_ID = "12581937"

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim()
}

function browserCaptureGateCount(templates) {
  return templates.reduce(
    (total, template) => total + BROWSER_CAPTURE_MODULES.filter(
      (moduleName) => (template.moduleCounts[moduleName] ?? 0) > 0
    ).length,
    0
  )
}

export function assembleBuildertrendTemplateNextBatchContent({
  release,
  nextBatchManifest,
  reviewedCapture,
  documents,
  publishRequested = false,
  capturedAt,
}) {
  if (publishRequested || release?.publish !== false || release?.draftOnly !== true) {
    throw new Error("Next-batch template content is draft-only; publication requests are prohibited.")
  }
  if (!isRecord(release) || release.releaseVersion !== 1 || !Array.isArray(release.templates)) {
    throw new Error("Next-batch content release must contain a versioned template allowlist.")
  }
  if (
    !isRecord(nextBatchManifest) ||
    nextBatchManifest.scope?.remainingActiveTemplatesIncluded !== 34 ||
    !Array.isArray(nextBatchManifest.templates)
  ) {
    throw new Error("Next-batch manifest must retain all 34 reviewed non-pilot templates.")
  }
  if (
    !isRecord(reviewedCapture) ||
    reviewedCapture.expectedActiveCount !== 40 ||
    reviewedCapture.excludedArchivedCount !== 27 ||
    !Array.isArray(reviewedCapture.templates) ||
    reviewedCapture.templates.length !== 40
  ) {
    throw new Error("Reviewed capture must retain all 40 active templates and exclude 27 archived templates.")
  }

  const requestedIds = release.templates.map((template, index) =>
    requiredString(template?.sourceTemplateId, `release.templates[${index}].sourceTemplateId`)
  )
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new Error("Next-batch content release contains duplicate template IDs.")
  }
  if (JSON.stringify(requestedIds) !== JSON.stringify(NEXT_BATCH_CONTENT_IDS)) {
    if (requestedIds.includes(INCOMPLETE_CONCRETE_FOOTER_ID)) {
      throw new Error("Concrete - Footer Assembly is partially captured and cannot be released.")
    }
    throw new Error(
      `Next-batch content release must contain only ${NEXT_BATCH_CONTENT_IDS.join(" and ")}.`
    )
  }
  const concreteExclusion = release.excludedTemplates?.find(
    (template) => template?.sourceTemplateId === INCOMPLETE_CONCRETE_FOOTER_ID
  )
  if (!concreteExclusion) {
    throw new Error("Next-batch content release must explicitly exclude incomplete Concrete - Footer Assembly.")
  }

  const manifestById = new Map(
    nextBatchManifest.templates.map((template) => [template.sourceTemplateId, template])
  )
  const selected = release.templates.map((entry) => {
    if (entry.browserCaptureGates !== "complete") {
      throw new Error(`${entry.sourceName ?? entry.sourceTemplateId} is partially captured and cannot be released.`)
    }
    const reviewed = manifestById.get(entry.sourceTemplateId)
    if (!reviewed || reviewed.sourceName !== entry.sourceName) {
      throw new Error(`Next-batch identity mismatch for ${entry.sourceTemplateId}.`)
    }
    if (reviewed.fragmentPath !== entry.fragmentPath) {
      throw new Error(`Next-batch fragment path mismatch for ${entry.sourceTemplateId}.`)
    }
    return reviewed
  })
  const scopedManifest = {
    browserCaptureGateCount: browserCaptureGateCount(selected),
    templates: selected,
  }
  const status = validateBuildertrendNextBatchFragments({
    manifest: scopedManifest,
    documents,
  })
  if (!status.complete) {
    const missing = status.missing
      .map((item) => `${item.sourceName} ${item.module}`)
      .join(", ")
    throw new Error(`Next-batch template content is partially captured: ${missing}.`)
  }

  const capture = assembleBuildertrendTemplateContentSubset({
    templateEntries: selected,
    reviewedCapture,
    documents,
    excludedArchivedCount: 27,
    capturedAt: capturedAt ?? release.generatedAt,
    incompleteLabel: "Next-batch template content",
    assemblyMetadata: {
      releaseVersion: release.releaseVersion,
      draftOnly: true,
      publish: false,
      templateCount: selected.length,
      sourceTemplateIds: requestedIds,
      browserCaptureGateCount: status.capturedGateCount,
    },
  })
  return {
    capture,
    inventory: buildBuildertrendTemplateContentInventory(capture, "Next-batch"),
  }
}
