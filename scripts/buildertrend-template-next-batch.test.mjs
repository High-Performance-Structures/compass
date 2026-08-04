import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildBuildertrendTemplateNextBatchManifest,
  validateBuildertrendNextBatchFragments,
} from "./lib/buildertrend-template-next-batch.mjs"

const workplan = JSON.parse(await readFile(
  "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
  "utf8"
))
const pilotManifest = JSON.parse(await readFile(
  "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json",
  "utf8"
))

function nextBatchManifest() {
  return buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })
}

function stuccoDocument(values = {}) {
  const manifest = nextBatchManifest()
  const stucco = manifest.templates[0]
  return {
    manifest,
    document: {
      sourceTemplateId: stucco.sourceTemplateId,
      name: stucco.sourceName,
      ...values,
    },
  }
}

function tasks(count = 48) {
  return Array.from({ length: count }, (_, index) => ({
    sourceItemId: `task-${index + 1}`,
    parentSourceItemId: index === 0 ? null : "task-1",
    title: `Task ${index + 1}`,
  }))
}

function selections() {
  return Array.from({ length: 4 }, (_, index) => ({
    sourceItemId: `selection-${index + 1}`,
    title: `Selection ${index + 1}`,
    choices: [{ sourceChoiceId: `choice-${index + 1}`, title: `Choice ${index + 1}` }],
  }))
}

test("derives exactly 34 non-pilot templates with sequences 6–12 first", () => {
  const manifest = buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })

  assert.equal(manifest.templates.length, 34)
  assert.equal(manifest.waves[0].templateCount, 6)
  assert.deepEqual(manifest.waves[0].workplanSequences, [6, 7, 8, 9, 11, 12])
  assert.equal(manifest.waves[0].browserCaptureGateCount, 13)
  assert.equal(manifest.browserCaptureGateCount, 59)
  assert.deepEqual(manifest.aggregateTotals, {
    tasks: 490,
    scheduleItems: 93,
    selections: 45,
    bidPackages: 26,
    browserCaptureRows: 561,
    totalWorkItems: 654,
  })
  assert.equal(manifest.templates.some((item) => item.sourceTemplateId === "30294726"), false)
  assert.equal(manifest.scope.archivedTemplatesExcluded, 27)
  assert.equal(manifest.capturePolicy.classification.includes("does not assign a department"), true)
})

test("reports exact source capture gates without placeholder fragments", () => {
  const manifest = buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })
  const status = validateBuildertrendNextBatchFragments({ manifest, documents: [] })

  assert.equal(status.complete, false)
  assert.equal(status.capturedGateCount, 0)
  assert.equal(status.remainingGateCount, 59)
  assert.equal(status.priorityRemainingGateCount, 13)
  assert.deepEqual(
    status.missing.filter((item) => item.sourceTemplateId === "12859981").map((item) => item.module),
    ["tasks", "selections", "bidPackages"]
  )
})

test("accepts only exact reviewed module counts", () => {
  const manifest = buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })
  const stucco = manifest.templates[0]
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest,
      documents: [{
        source: "stucco.capture.json",
        document: {
          sourceTemplateId: stucco.sourceTemplateId,
          name: stucco.sourceName,
          tasks: [{ sourceItemId: "invented", title: "Not enough rows" }],
        },
      }],
    }),
    /tasks expected 48, found 1/
  )
})

test("rejects completed-pilot, archived, and unknown template fragments", () => {
  const manifest = buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest,
      documents: [{
        source: "drywall.capture.json",
        document: { sourceTemplateId: "30294726", name: "Drywall Installation" },
      }],
    }),
    /pilot, archived, or unknown template/
  )
})

test("does not accept duplicate or browser-recaptured schedule modules", () => {
  const manifest = buildBuildertrendTemplateNextBatchManifest({
    workplan,
    pilotManifest,
    generatedAt: "2026-08-04",
  })
  const stucco = manifest.templates[0]
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest,
      documents: [{
        source: "stucco.capture.json",
        document: {
          sourceTemplateId: stucco.sourceTemplateId,
          name: stucco.sourceName,
          scheduleItems: [],
        },
      }],
    }),
    /must not duplicate schedule data/
  )
})

test("accepts a task hierarchy whose parents are in the same fragment", () => {
  const { manifest, document } = stuccoDocument({ tasks: tasks() })
  const status = validateBuildertrendNextBatchFragments({
    manifest,
    documents: [{ source: "stucco.capture.json", document }],
  })

  assert.equal(status.capturedGateCount, 1)
  assert.equal(status.remainingGateCount, 58)
})

test("rejects dangling, self-referencing, and cyclic task parents", () => {
  const dangling = tasks()
  dangling[1].parentSourceItemId = "missing-task"
  let input = stuccoDocument({ tasks: dangling })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /parentSourceItemId missing-task is not in the same task fragment/
  )

  const self = tasks()
  self[1].parentSourceItemId = self[1].sourceItemId
  input = stuccoDocument({ tasks: self })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /cannot reference itself as parentSourceItemId/
  )

  const cycle = tasks()
  cycle[0].parentSourceItemId = "task-2"
  cycle[1].parentSourceItemId = "task-1"
  input = stuccoDocument({ tasks: cycle })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /contains a parentSourceItemId cycle/
  )
})

test("validates selection choice IDs and titles", () => {
  const validSelections = selections()
  let input = stuccoDocument({ selections: validSelections })
  const status = validateBuildertrendNextBatchFragments({
    manifest: input.manifest,
    documents: [{ source: "stucco.capture.json", document: input.document }],
  })
  assert.equal(status.capturedGateCount, 1)

  const duplicateChoiceIds = selections()
  duplicateChoiceIds[0].choices.push({ sourceChoiceId: "choice-1", title: "Duplicate" })
  input = stuccoDocument({ selections: duplicateChoiceIds })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /choices duplicates sourceChoiceId choice-1/
  )

  const emptyChoiceId = selections()
  emptyChoiceId[0].choices[0].sourceChoiceId = ""
  input = stuccoDocument({ selections: emptyChoiceId })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /choices\[0\]\.sourceChoiceId must be a non-empty string/
  )

  const emptyChoiceTitle = selections()
  emptyChoiceTitle[0].choices[0].title = ""
  input = stuccoDocument({ selections: emptyChoiceTitle })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /choices\[0\]\.title must be a non-empty string/
  )
})

test("validates bid-package line item titles and cost codes", () => {
  const validBid = [{
    sourceItemId: "bid-1",
    title: "Stucco bid",
    lineItems: [{ title: "Stucco labor and material", costCode: "09 24 00 - Portland Cement Plastering" }],
  }]
  let input = stuccoDocument({ bidPackages: validBid })
  const status = validateBuildertrendNextBatchFragments({
    manifest: input.manifest,
    documents: [{ source: "stucco.capture.json", document: input.document }],
  })
  assert.equal(status.capturedGateCount, 1)

  const emptyTitle = structuredClone(validBid)
  emptyTitle[0].lineItems[0].title = ""
  input = stuccoDocument({ bidPackages: emptyTitle })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /lineItems\[0\]\.title must be a non-empty string/
  )

  const emptyCostCode = structuredClone(validBid)
  emptyCostCode[0].lineItems[0].costCode = ""
  input = stuccoDocument({ bidPackages: emptyCostCode })
  assert.throws(
    () => validateBuildertrendNextBatchFragments({
      manifest: input.manifest,
      documents: [{ source: "stucco.capture.json", document: input.document }],
    }),
    /lineItems\[0\]\.costCode must be a non-empty string/
  )
})
