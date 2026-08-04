import {
  assembleBuildertrendTemplateContentSubset,
  buildBuildertrendTemplateContentInventory,
} from "./buildertrend-template-content-pilot.mjs"
import {
  validateBuildertrendNextDraftManifest,
} from "./buildertrend-template-next-batch.mjs"

export const INCOMPLETE_CONCRETE_FOOTER_ID = "12581937"

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

  const validation = validateBuildertrendNextDraftManifest({
    manifest: nextBatchManifest,
    draftManifest: release,
    documents,
  })
  const requestedIds = validation.entries.map((entry) => entry.sourceTemplateId)
  const concreteExclusion = release.excludedTemplates?.find(
    (template) => template?.sourceTemplateId === INCOMPLETE_CONCRETE_FOOTER_ID
  )
  if (!validation.summary.concreteFooterIncluded && !concreteExclusion) {
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
      browserCaptureGateCount: validation.status.capturedGateCount,
      excludedIncompleteTemplateCount: validation.summary.excludedIncompleteTemplateCount,
      excludedArchivedTemplateCount: validation.summary.excludedArchivedTemplateCount,
      eligibleAfterThisBatch: validation.status.structurallyCompleteTemplateIds.filter(
        (sourceTemplateId) => !requestedIds.includes(sourceTemplateId)
      ).length,
    },
  })
  return {
    capture,
    inventory: buildBuildertrendTemplateContentInventory(capture, "Next-batch"),
  }
}
