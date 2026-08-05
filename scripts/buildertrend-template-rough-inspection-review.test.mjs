import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const roughInspectionTemplateId = "12978590"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/30-12978590.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves the three native Rough Inspection task identities in displayed order", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.sourceTemplateId, roughInspectionTemplateId)
  assert.equal(fragment.tasks.length, 3)
  assert.equal(new Set(fragment.tasks.map((task) => task.sourceItemId)).size, 3)
  assert.deepEqual(
    fragment.tasks.map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      {
        sourceItemId: "75717818",
        parentSourceItemId: null,
        title: "Draft & Fire Stop Complete",
        sortOrder: 1,
      },
      {
        sourceItemId: "75717822",
        parentSourceItemId: null,
        title: "Call In Building Dept. Rough Frame Inspection",
        sortOrder: 2,
      },
      {
        sourceItemId: "75717824",
        parentSourceItemId: null,
        title: "Passed Building Dept. Rough Frame Inspection",
        sortOrder: 3,
      },
    ]
  )
})

test("assembles Rough Inspection tasks with the canonical two-item schedule", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === roughInspectionTemplateId),
    true
  )
  const result = assembleBuildertrendTemplateNextBatchContent({
    release,
    nextBatchManifest,
    reviewedCapture,
    documents,
  })
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)

  const roughInspection = result.capture.templates.find(
    (template) => template.sourceTemplateId === roughInspectionTemplateId
  )
  assert.ok(roughInspection)
  assert.equal(roughInspection.tasks.length, 3)
  assert.deepEqual(
    roughInspection.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "145103222",
        title: "Draft & Fire Stop",
        startDate: "2022-05-23",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#6C824D",
      },
      {
        sourceItemId: "145103435",
        title: "Building Dept. Rough Frame Inspection",
        startDate: "2022-05-24",
        workdays: 1,
        phase: "Rough: MEP",
        displayColor: "#ED2591",
      },
    ]
  )
  assert.deepEqual(
    roughInspection.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      {
        predecessorSourceItemId: "145103222",
        successorSourceItemId: "145103435",
        type: "FS",
        lagDays: 0,
      },
    ]
  )
})
