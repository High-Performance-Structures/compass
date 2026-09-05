import assert from "node:assert/strict"
import test from "node:test"

import { generateBuildertrendChangeOrderImportSql } from "./buildertrend-change-order-import.mjs"

const fixture = {
  capturedAt: "2026-07-31T20:25:00.000Z",
  projects: [
    {
      projectId: "proj-o-170-loomis",
      buildertrendProjectId: "35400494",
      requesterName: "Project A customer",
      orders: [
        {
          recordId: "1",
          number: "O-170-0001",
          title: "Owner's change",
          createdAt: "2026-07-01T12:00:00.000Z",
          status: "Approved",
          statusDate: "2026-07-02",
          amountCents: 125,
          documentCount: 1,
        },
      ],
    },
    {
      projectId: "proj-o-202-loeffler",
      buildertrendProjectId: "41684371",
      requesterName: "Project B customer",
      orders: [
        {
          recordId: "2",
          number: "O-202-0001",
          title: "Draft change",
          createdAt: "2026-07-03T12:00:00.000Z",
          status: "Draft",
          statusDate: "2026-07-03",
          amountCents: -50,
          documentCount: 0,
        },
      ],
    },
  ],
}

test("keeps imported financial and source status facts without inventing an initiator", () => {
  const output = generateBuildertrendChangeOrderImportSql(fixture)
  assert.match(output, /'executed', 'owner'/)
  assert.match(output, /'draft', 'internal'/)
  assert.match(
    output,
    /'executed', 'owner', 'unknown', NULL, 'Initiator not verified from Buildertrend'/
  )
  assert.match(
    output,
    /'draft', 'internal', 'unknown', NULL, 'Initiator not verified from Buildertrend'/
  )
  assert.match(
    output,
    /'Owner''s change', 'Owner''s change', NULL, 125, NULL, 'executed'/
  )
  assert.match(output, /'Draft change', 'Draft change', NULL, -50, NULL, 'draft'/)
  assert.match(output, /ON CONFLICT\(project_id, change_order_number\) DO NOTHING/)
  assert.match(output, /INSERT OR IGNORE INTO project_change_order_lines/)
  assert.match(output, /INSERT OR IGNORE INTO project_change_order_history/)
  assert.match(output, /Owner''s change/)
  assert.doesNotMatch(output, /\b(?:BEGIN|COMMIT)\b/)
})

test("retains the original name only as unverified project-level association provenance", () => {
  const output = generateBuildertrendChangeOrderImportSql(fixture)

  assert.match(output, /"initiatorProvenance":\{"status":"unknown"/)
  assert.match(
    output,
    /"projectAssociation":\{"name":"Project A customer","scope":"project_level_import_association","sourceVerifiedForChangeOrder":false\}/
  )
  assert.match(
    output,
    /"projectAssociation":\{"name":"Project B customer","scope":"project_level_import_association","sourceVerifiedForChangeOrder":false\}/
  )
  assert.doesNotMatch(output, /'owner', NULL, 'Project A customer'/)
  assert.doesNotMatch(output, /'owner', NULL, 'Project B customer'/)
})

test("rejects duplicate change-order numbers", () => {
  const duplicate = structuredClone(fixture)
  duplicate.projects[0].orders.push({ ...duplicate.projects[0].orders[0], recordId: "3" })
  assert.throws(
    () => generateBuildertrendChangeOrderImportSql(duplicate),
    /Duplicate Buildertrend change order/
  )
})
