import assert from "node:assert/strict"
import test from "node:test"

import {
  assembleBuildertrendTemplateContentPilot,
  buildBuildertrendTemplateContentPilotInventory,
} from "./lib/buildertrend-template-content-pilot.mjs"

const pilotTemplates = [
  ["1", "Drywall", { tasks: 1, scheduleItems: 1 }],
  ["2", "Roofing", { tasks: 1, selections: 1 }],
  ["3", "Design", { tasks: 1 }],
  ["4", "LiteDeck", { tasks: 1 }],
  ["5", "ICF", { tasks: 1 }],
  ["6", "Cabinetry", { tasks: 1, bidPackages: 1 }],
]

const manifest = {
  scope: {
    activeTemplatesInSource: 40,
    pilotTemplatesIncluded: 6,
    remainingActiveTemplatesUnverified: 34,
    archivedTemplatesExcluded: 27,
    archivedTemplatesIncluded: 0,
  },
  templates: pilotTemplates.map(([sourceTemplateId, sourceName]) => ({ sourceTemplateId, sourceName })),
}

const reviewedCapture = {
  expectedActiveCount: 40,
  excludedArchivedCount: 27,
  templates: [
    ...pilotTemplates.map(([sourceTemplateId, name, moduleCounts]) => ({
      sourceTemplateId,
      name,
      moduleCounts,
      ...(moduleCounts.scheduleItems
        ? {
            schedule: {
              items: [{ sourceItemId: `${sourceTemplateId}-schedule`, title: "Schedule" }],
              dependencies: [],
            },
          }
        : {}),
    })),
    ...Array.from({ length: 34 }, (_, index) => ({
      sourceTemplateId: `other-${index}`,
      name: `Other ${index}`,
      moduleCounts: {},
    })),
  ],
}

function fragment(sourceTemplateId, name, values) {
  return { source: `${sourceTemplateId}.json`, document: { sourceTemplateId, name, ...values } }
}

function completeDocuments() {
  return pilotTemplates.map(([id, name, counts]) => fragment(id, name, {
    tasks: Array.from({ length: counts.tasks ?? 0 }, (_, index) => ({ sourceItemId: `${id}-task-${index}`, title: "Task" })),
    selections: Array.from({ length: counts.selections ?? 0 }, (_, index) => ({ sourceItemId: `${id}-selection-${index}`, title: "Selection" })),
    bidPackages: Array.from({ length: counts.bidPackages ?? 0 }, (_, index) => ({ sourceItemId: `${id}-bid-${index}`, title: "Bid" })),
  }))
}

test("assembles six reviewed pilot templates and reuses reviewed schedule evidence", () => {
  const result = assembleBuildertrendTemplateContentPilot({
    manifest,
    reviewedCapture,
    documents: completeDocuments(),
    capturedAt: "2026-08-03T00:00:00.000Z",
  })

  assert.equal(result.fixtureVersion, 3)
  assert.equal(result.templates.length, 6)
  assert.equal(result.excludedArchivedCount, 27)
  assert.equal(result.assembly.remainingActiveTemplatesUnverified, 34)
  assert.equal(result.assembly.complete, true)
  assert.equal(result.templates[0].schedule.items.length, 1)
  assert.deepEqual(result.templates[0].scheduleItems[0].predecessors, [])
  assert.deepEqual(buildBuildertrendTemplateContentPilotInventory(result).templates[0], {
    sourceTemplateId: "1",
    name: "Drywall",
    moduleCounts: { tasks: 1, scheduleItems: 1, selections: 0, bidPackages: 0 },
  })
})

test("reports every missing module without manufacturing placeholder content", () => {
  const result = assembleBuildertrendTemplateContentPilot({
    manifest,
    reviewedCapture,
    documents: [completeDocuments()[0]],
    allowIncomplete: true,
  })

  assert.equal(result.assembly.complete, false)
  assert.match(
    result.assembly.missing.map((item) => `${item.name}:${item.module}`).join(","),
    /Roofing:tasks/
  )
  assert.equal(result.templates[1].tasks, undefined)
})

test("rejects incomplete pilots in release-check mode", () => {
  assert.throws(
    () => assembleBuildertrendTemplateContentPilot({
      manifest,
      reviewedCapture,
      documents: [completeDocuments()[0]],
    }),
    /Six-template pilot content is incomplete/
  )
})

test("does not emit a paired import inventory from an incomplete capture", () => {
  const result = assembleBuildertrendTemplateContentPilot({
    manifest,
    reviewedCapture,
    documents: [completeDocuments()[0]],
    allowIncomplete: true,
  })
  assert.throws(
    () => buildBuildertrendTemplateContentPilotInventory(result),
    /cannot be emitted from an incomplete content capture/
  )
})

test("rejects non-pilot or archived fragments", () => {
  assert.throws(
    () => assembleBuildertrendTemplateContentPilot({
      manifest,
      reviewedCapture,
      documents: [fragment("archived-1", "Archive - Old", { tasks: [] })],
      allowIncomplete: true,
    }),
    /non-pilot or archived template/
  )
})

test("rejects fragment counts that conflict with reviewed Buildertrend evidence", () => {
  const bad = fragment("2", "Roofing", {
    moduleCounts: { tasks: 2, selections: 1 },
    tasks: [{ sourceItemId: "2-task", title: "Task" }],
  })
  assert.throws(
    () => assembleBuildertrendTemplateContentPilot({
      manifest,
      reviewedCapture,
      documents: [bad],
      allowIncomplete: true,
    }),
    /module-count metadata that conflicts/
  )
})

test("rejects conflicting duplicate module fragments", () => {
  const first = fragment("2", "Roofing", { tasks: [{ sourceItemId: "task-a", title: "A" }] })
  const second = fragment("2", "Roofing", { tasks: [{ sourceItemId: "task-b", title: "B" }] })
  assert.throws(
    () => assembleBuildertrendTemplateContentPilot({
      manifest,
      reviewedCapture,
      documents: [first, second],
      allowIncomplete: true,
    }),
    /conflicting values/
  )
})

test("rejects conversion exceptions that point outside captured module content", () => {
  const documents = completeDocuments()
  documents[0] = {
    source: "drywall.json",
    document: {
      template: documents[0].document,
      conversionExceptions: [{
        templateSourceTemplateId: "1",
        module: "tasks",
        sourceItemId: "missing-task",
        field: "costType",
        sourceValue: "Labor",
        loss: "Not represented.",
        recoveryPlan: "Map later.",
      }],
    },
  }
  assert.throws(
    () => assembleBuildertrendTemplateContentPilot({ manifest, reviewedCapture, documents }),
    /sourceItemId does not identify captured tasks content/
  )
})
