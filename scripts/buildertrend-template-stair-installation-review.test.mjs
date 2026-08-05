import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"
import {
  assembleBuildertrendTemplateNextBatchContent,
} from "./lib/buildertrend-template-next-batch-content.mjs"

const stairInstallationTemplateId = "12650713"
const paths = {
  fragment: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/26-12650713.capture.json",
  fragments: "scripts/fixtures/buildertrend-template-content-next-batch/fragments",
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

test("preserves all ten native Stair Installation task identities and checklist hierarchy", async () => {
  const fragment = await readJson(paths.fragment)

  assert.equal(fragment.sourceTemplateId, stairInstallationTemplateId)
  assert.equal(fragment.tasks.length, 10)
  assert.equal(new Set(fragment.tasks.map((task) => task.sourceItemId)).size, 10)
  assert.deepEqual(
    fragment.tasks.map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75710961", parentSourceItemId: null, title: "Frame Landing", sortOrder: 1 },
      { sourceItemId: "75710962", parentSourceItemId: null, title: "Sheet Landing", sortOrder: 2 },
      { sourceItemId: "75710963", parentSourceItemId: null, title: "Set (X) Level Upper Stair System", sortOrder: 3 },
      { sourceItemId: "75710964", parentSourceItemId: null, title: "Set (X) Level Lower Stair System", sortOrder: 4 },
      { sourceItemId: "75710965", parentSourceItemId: null, title: "HPS (X) Level Stair Installation QC Inspection", sortOrder: 5 },
      { sourceItemId: "75711038", parentSourceItemId: "75710965", title: "Upper Stairs Hung Correctly", sortOrder: 1 },
      { sourceItemId: "75711039", parentSourceItemId: "75710965", title: "Upper Stairs Straps/Hangers Nailed Off", sortOrder: 2 },
      { sourceItemId: "75711040", parentSourceItemId: "75710965", title: "Lower Stairs Hunger Correctly", sortOrder: 3 },
      { sourceItemId: "75711041", parentSourceItemId: "75710965", title: "Lower Stairs Straps/Hangers Nailed Off", sortOrder: 4 },
      { sourceItemId: "75711042", parentSourceItemId: "75710965", title: "Min. 6'8\" Head Clearance Per Code (Measure from front edge of tread to a line parallel to stair rim)", sortOrder: 5 },
    ]
  )
})

test("assembles reviewed Stair tasks with the canonical three-item schedule", async () => {
  const [release, nextBatchManifest, reviewedCapture, documents] = await Promise.all([
    readJson(paths.release),
    readJson(paths.manifest),
    readJson(paths.reviewed),
    readPilotContentFragments(paths.fragments),
  ])

  assert.equal(
    release.templates.some((template) => template.sourceTemplateId === stairInstallationTemplateId),
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

  const stairInstallation = result.capture.templates.find(
    (template) => template.sourceTemplateId === stairInstallationTemplateId
  )
  assert.ok(stairInstallation)
  assert.equal(stairInstallation.tasks.length, 10)
  assert.deepEqual(
    stairInstallation.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      {
        sourceItemId: "141694608",
        title: "Frame & Sheet (X) Level Landing",
        startDate: "2022-04-13",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141695005",
        title: "Install (X) Level Stairs",
        startDate: "2022-04-14",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#ABBE91",
      },
      {
        sourceItemId: "141695420",
        title: "HPS (X) Level Stair Installation QC Inspection",
        startDate: "2022-04-15",
        workdays: 1,
        phase: "Rough: Frame",
        displayColor: "#2222DD",
      },
    ]
  )
  assert.deepEqual(
    stairInstallation.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "141694608", successorSourceItemId: "141695005", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141695005", successorSourceItemId: "141695420", type: "FS", lagDays: 0 },
    ]
  )
})
