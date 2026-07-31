import assert from "node:assert/strict"
import test from "node:test"

import { generateBuildertrendChangeOrderImportSql } from "./buildertrend-change-order-import.mjs"

const fixture = {
  capturedAt: "2026-07-31T20:25:00.000Z",
  projects: [
    {
      projectId: "proj-o-170-loomis",
      buildertrendProjectId: "35400494",
      requesterName: "Tanis Loomis",
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
      requesterName: "Alan and Deborah Loeffler",
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

test("generates idempotent operational imports with faithful statuses", () => {
  const output = generateBuildertrendChangeOrderImportSql(fixture)
  assert.match(output, /'executed', 'owner'/)
  assert.match(output, /'draft', 'internal'/)
  assert.match(output, /ON CONFLICT\(project_id, change_order_number\) DO NOTHING/)
  assert.match(output, /INSERT OR IGNORE INTO project_change_order_lines/)
  assert.match(output, /INSERT OR IGNORE INTO project_change_order_history/)
  assert.match(output, /Owner''s change/)
})

test("rejects duplicate change-order numbers", () => {
  const duplicate = structuredClone(fixture)
  duplicate.projects[0].orders.push({ ...duplicate.projects[0].orders[0], recordId: "3" })
  assert.throws(
    () => generateBuildertrendChangeOrderImportSql(duplicate),
    /Duplicate Buildertrend change order/
  )
})
