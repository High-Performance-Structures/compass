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
