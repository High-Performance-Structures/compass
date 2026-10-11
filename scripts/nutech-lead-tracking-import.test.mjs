import assert from "node:assert/strict"
import test from "node:test"

import {
  importedProjectId,
  planNutechImport,
  projectNumberIn,
  sheetDate,
  trackerAddress,
  trackerStatus,
} from "./lib/nutech-lead-tracking-import.mjs"

// Master List columns: 0 number, 10 intake date, 11 assigned, 13 status,
// 14 last update, 17 company, 18 last, 19 first, 22 street #, 23 street, 24 town.
function masterRow(values) {
  const row = Array(28).fill("")
  for (const [index, value] of Object.entries(values)) row[Number(index)] = value
  return row
}

const base = {
  existing: [],
  staffNames: { Rebekah: "Rebekah Jones" },
  asOf: "2026-10-09",
}

test("reads tracker values", () => {
  assert.equal(projectNumberIn("N-998-1398-Kelsey Ct.-Tanner Bellino"), "N-998-1398")
  assert.equal(projectNumberIn("H-440-3719-Floating Cloud Court"), null)
  assert.equal(sheetDate("9/23/26"), "2026-09-23")
  assert.equal(sheetDate("12/3/2019"), "2019-12-03")
  assert.equal(sheetDate("ASAP"), null)
  assert.equal(trackerStatus("ES - Estimate Sent"), "estimate_sent")
  assert.equal(trackerStatus("W - Awaiting Response"), "awaiting_response")
  assert.equal(trackerStatus(""), null)
  assert.equal(
    trackerAddress(masterRow({ 22: "201", 23: "Chickasaw Rd.", 24: "Guffey, CO 80820" })),
    "201 Chickasaw Rd., Guffey, CO 80820",
  )
  assert.equal(trackerAddress(masterRow({ 22: "00", 23: "", 24: "Florissant" })), "Florissant")
})

test("keeps recently active leads in the pipeline and marks old open leads inactive", () => {
  const plan = planNutechImport({
    ...base,
    masterRows: [
      masterRow({ 0: "N-1010-12", 10: "9/30/2026", 11: "Rebekah", 13: "E - Estimate in Progress", 18: "Smith", 19: "Ann" }),
      masterRow({ 0: "N-500-00", 10: "1/5/2022", 13: "ES - Estimate Sent", 18: "Old" }),
      masterRow({ 0: "N-400-00", 10: "1/5/2021", 13: "C - Completed", 18: "Done" }),
      masterRow({ 0: "N-600-00", 10: "1/5/2023", 13: "P - Awaiting Payment", 18: "Quoted" }),
    ],
    // An estimate request this year keeps N-600 active despite its old intake date.
    activity: [{ text: "N-600-00--Quoted", date: "9/1/2026" }],
  })
  const byNumber = new Map(plan.inserts.map((project) => [project.projectNumber, project]))
  assert.deepEqual(plan.report, { active: 2, stale: 1, closed: 1, unchanged: 0, keptCompassStatus: [], unknownStatus: [] })
  assert.equal(byNumber.get("N-1010-12")?.jobStatusId, "estimating")
  assert.equal(byNumber.get("N-1010-12")?.projectManager, "Rebekah Jones")
  assert.equal(byNumber.get("N-1010-12")?.clientName, "Ann Smith")
  assert.equal(byNumber.get("N-500-00")?.jobStatusId, "inactive")
  assert.equal(byNumber.get("N-500-00")?.note.importedAsStale, true)
  assert.equal(byNumber.get("N-400-00")?.status, "COMPLETE")
  assert.equal(byNumber.get("N-600-00")?.clientStatus, "customer")
  assert.equal(byNumber.get("N-1010-12")?.id, importedProjectId("N-1010-12"))
})

test("updates existing projects without overwriting a status someone changed in Compass", () => {
  const plan = planNutechImport({
    ...base,
    masterRows: [
      masterRow({ 0: "N-990-11730", 10: "8/1/2026", 13: "E - Estimate in Progress" }),
      masterRow({ 0: "N-1001-515", 10: "9/1/2026", 13: "E - Estimate in Progress", 22: "515", 23: "Eagle Mountain Rd." }),
      masterRow({ 0: "N-999-18090", 13: "BE - Budget Estimate In Progress" }),
    ],
    activity: [],
    existing: [
      { id: "a", projectNumber: "N-990-11730", jobStatusId: "inactive", address: "x", clientName: "c", projectManager: "p", statusChangedInCompass: false, intakeDate: null },
      { id: "b", projectNumber: "N-1001-515", jobStatusId: "estimate_sent", address: null, clientName: "c", projectManager: "p", statusChangedInCompass: true, intakeDate: "2026-09-03" },
      // Created through the Compass form recently; the sheet row has no dates.
      { id: "c", projectNumber: "N-999-18090", jobStatusId: "current", address: "x", clientName: "c", projectManager: "p", statusChangedInCompass: false, intakeDate: "2026-09-02" },
    ],
  })
  const byId = new Map(plan.updates.map((update) => [update.id, update.set]))
  assert.deepEqual(byId.get("a"), { jobStatusId: "estimating", status: "OPEN" })
  assert.deepEqual(byId.get("b"), { address: "515 Eagle Mountain Rd." })
  assert.deepEqual(byId.get("c"), { jobStatusId: "budget_estimating", status: "OPEN" })
  assert.equal(plan.inserts.length, 0)
  assert.equal(plan.report.keptCompassStatus.length, 1)
})
