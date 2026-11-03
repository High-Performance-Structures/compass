import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_COLUMNS, insertStatements, planSavedViewsBackfill, sqlLiteral, VIEW_COLUMNS } from "./saved-views-backfill.mjs"

const view = (id, scope, extra = {}) => ({
  id, scope, organization_id: "org", owner_user_id: "alice", name: id, visibility: "personal",
  definition: "{}", created_at: "t0", updated_at: "t0", ...extra,
})
const base = { legacyViews: [], existingViews: [], legacyDefaults: [], existingDefaults: [], organizationIds: ["org"] }

test("copies legacy views of both scopes with their ids", () => {
  const plan = planSavedViewsBackfill({ ...base, legacyViews: [view("p1", "projects"), view("s1", "schedule", { name: "p1" })] })
  assert.deepEqual(plan.viewInserts.map((row) => [row.id, row.scope]), [["p1", "projects"], ["s1", "schedule"]])
  assert.deepEqual(Object.keys(plan.viewInserts[0]), [...VIEW_COLUMNS])
  assert.deepEqual(plan.review, [])
})

test("skips rows already copied and is a no-op on a re-run", () => {
  const legacyViews = [view("p1", "projects")]
  const plan = planSavedViewsBackfill({ ...base, legacyViews, existingViews: [view("p1", "projects", { updated_at: "later" })] })
  assert.deepEqual(plan.viewInserts, [])
  assert.deepEqual(plan.viewsAlreadyCopied, ["p1"])
})

test("sends ambiguous rows to review instead of guessing", () => {
  const plan = planSavedViewsBackfill({
    ...base,
    legacyViews: [
      view("odd", "schedule", { visibility: "team" }),
      view("dup", "projects"), view("dup", "schedule"),
      view("clash", "projects", { name: "Taken" }),
      view("changed", "projects", { name: "Old" }),
    ],
    existingViews: [view("other", "projects", { name: "Taken" }), view("changed", "projects", { name: "New" })],
  })
  assert.deepEqual(plan.viewInserts, [])
  assert.deepEqual(plan.review.map((entry) => entry.legacy.id), ["odd", "dup", "dup", "clash", "changed"])
})

test("converts project default preferences, keeping newer saved_view_defaults rows", () => {
  const plan = planSavedViewsBackfill({
    ...base,
    organizationIds: ["org", "org2"],
    legacyDefaults: [
      { user_id: "alice", view_key: "project-hub-default:org", value: "{\"a\":1}", updated_at: "t1" },
      { user_id: "bob", view_key: "project-hub-default:org2", value: "malformed", updated_at: "t1" },
      { user_id: "bob", view_key: "project-hub-default:org", value: "{}", updated_at: "t1" },
      { user_id: "carol", view_key: "project-hub-default:gone", value: "{}", updated_at: "t1" },
      { user_id: "alice", view_key: "role-dashboard:pm", value: "[]", updated_at: "t1" },
    ],
    existingDefaults: [{ user_id: "bob", organization_id: "org", scope: "projects" }],
  })
  assert.deepEqual(plan.defaultInserts, [
    { user_id: "alice", organization_id: "org", scope: "projects", view_id: null, inline_definition: "{\"a\":1}", updated_at: "t1" },
    { user_id: "bob", organization_id: "org2", scope: "projects", view_id: null, inline_definition: "malformed", updated_at: "t1" },
  ])
  assert.deepEqual(plan.defaultsAlreadyPresent, [{ user_id: "bob", organization_id: "org", scope: "projects" }])
  assert.deepEqual(plan.review.map((entry) => entry.legacy.user_id), ["carol"])
})

test("keeps every insert within D1's 100-value budget and escapes text", () => {
  const rows = Array.from({ length: 25 }, (_, index) => view(`v${index}`, "projects", { name: "O'Brien" }))
  const statements = insertStatements("saved_views", VIEW_COLUMNS, rows)
  assert.equal(statements.length, 3) // 11 rows x 9 columns = 99 values per statement
  assert.ok(statements.every((sql) => sql.endsWith("ON CONFLICT DO NOTHING;")))
  assert.ok(statements[0].includes("'O''Brien'"))
  assert.equal(insertStatements("saved_view_defaults", DEFAULT_COLUMNS, []).length, 0)
  assert.equal(sqlLiteral(null), "NULL")
})
