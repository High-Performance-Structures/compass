import { and, eq, lt, or, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import {
  sageBridgeRequestNonces,
  sageClientDirectoryRefreshes,
  sageClientProjectWriteOperations,
  sagePayApplicationSyncRuns,
} from "@/db/schema-sage"
import { sageLaborRequests } from "@/db/schema-shop-tickets"
import {
  expectedShape,
  recordingD1,
  rowsOf,
  runRecorded,
  sqliteWith,
  statementShape,
} from "@/lib/domain/__tests__/recording-d1"
import { SAGE_BRIDGE_HEARTBEAT_IDS } from "@/lib/domain/sage-bridge/rules"
import {
  acquireSagePayApplicationRunStatement,
  deleteSageBridgeRequestNonces,
  insertSageBridgeRequestNonce,
  insertSageClientDirectoryRefresh,
  insertSageClientProjectWriteOperation,
  insertSageLaborRequest,
  insertSagePayApplicationSyncRun,
  sageBridgeHeartbeatStatement,
  sageClientDirectoryReplaceStatements,
  sageClientProjectWriteSucceededStatement,
  sagePayApplicationTerminalRunStatement,
  updateSageClientDirectoryRefreshes,
  updateSageClientProjectWriteOperations,
  updateSageLaborRequests,
  updateSagePayApplicationSyncRuns,
} from "@/lib/domain/sage-bridge/store"

/*
 * Each moved write builds the same SQL, with the same binds, as the route or
 * integration wrote before the move. The old statements are written out here.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"
const stale = "2026-10-31T07:50:00.000Z"

describe("Sage bridge store: Drizzle builders keep the caller's fences", () => {
  it("consumes and expires request nonces with the same SQL", () => {
    const values = { requestId: "r1", route: "/api/integrations/sage/x", createdAt: now }
    expect(insertSageBridgeRequestNonce(db, values).toSQL()).toEqual(db.insert(sageBridgeRequestNonces).values(values).toSQL())
    const cutoff = lt(sageBridgeRequestNonces.createdAt, stale)
    expect(deleteSageBridgeRequestNonces(db, cutoff).toSQL()).toEqual(db.delete(sageBridgeRequestNonces).where(cutoff).toSQL())
  })

  it("claims client/project writes with the stale-claim fence intact", () => {
    const changes = {
      status: "running", claimToken: "t1", claimedAt: now,
      attemptCount: sql`${sageClientProjectWriteOperations.attemptCount} + 1`, updatedAt: now,
    }
    const fence = and(eq(sageClientProjectWriteOperations.id, "op1"), or(
      eq(sageClientProjectWriteOperations.status, "queued"),
      and(eq(sageClientProjectWriteOperations.status, "running"), lt(sageClientProjectWriteOperations.claimedAt, stale)),
    ))
    expect(updateSageClientProjectWriteOperations(db, changes, fence).toSQL()).toEqual(
      db.update(sageClientProjectWriteOperations).set(changes).where(fence).toSQL(),
    )
  })

  it("queues client/project writes and labor requests with the same SQL", () => {
    const operation = {
      id: "op1", organizationId: "org-1", customerId: "c1", projectId: null, requestedByUserId: "u1",
      operationType: "ensure_client", idempotencyKey: "customer:c1", payloadJson: "{}", status: "queued",
      requestedAt: now, updatedAt: now,
    }
    expect(insertSageClientProjectWriteOperation(db, operation).toSQL()).toEqual(
      db.insert(sageClientProjectWriteOperations).values(operation).toSQL(),
    )
    const labor = {
      id: "l1", organizationId: "org-1", projectId: "p1", projectNumber: "O-1", sageJobNumber: "O-1",
      dateFrom: "2026-10-01", dateTo: "2026-10-31", requestedBy: "u1", requestedAt: now, updatedAt: now,
    }
    expect(insertSageLaborRequest(db, labor).toSQL()).toEqual(db.insert(sageLaborRequests).values(labor).toSQL())
  })

  it("claims and completes directory refreshes with .returning() unchanged", () => {
    const fence = and(eq(sageClientDirectoryRefreshes.id, "d1"), eq(sageClientDirectoryRefreshes.claimToken, "t1"))
    const changes = { status: "failed", errorMessage: "x", completedAt: now }
    expect(updateSageClientDirectoryRefreshes(db, changes, fence).returning({ id: sageClientDirectoryRefreshes.id }).toSQL()).toEqual(
      db.update(sageClientDirectoryRefreshes).set(changes).where(fence).returning({ id: sageClientDirectoryRefreshes.id }).toSQL(),
    )
    const values = { id: "d1", organizationId: "org-1", status: "queued", requestedByUserId: "u1", requestedAt: now }
    expect(insertSageClientDirectoryRefresh(db, values).toSQL()).toEqual(db.insert(sageClientDirectoryRefreshes).values(values).toSQL())
  })

  it("queues and claims pay-application runs and labor requests with the same SQL", () => {
    const run = {
      id: "run1", projectId: "p1", requestedByUserId: "u1", idempotencyKey: "k",
      sageJobId: null, sageJobNumber: "J-1", status: "queued", requestedAt: now, updatedAt: now,
    }
    expect(insertSagePayApplicationSyncRun(db, run).toSQL()).toEqual(db.insert(sagePayApplicationSyncRuns).values(run).toSQL())
    const runFence = and(eq(sagePayApplicationSyncRuns.id, "run1"), eq(sagePayApplicationSyncRuns.status, "processing"))
    expect(updateSagePayApplicationSyncRuns(db, { status: "failed", completedAt: now }, runFence).toSQL()).toEqual(
      db.update(sagePayApplicationSyncRuns).set({ status: "failed", completedAt: now }).where(runFence).toSQL(),
    )
    const laborFence = and(eq(sageLaborRequests.status, "running"), sql`${sageLaborRequests.attemptCount} >= ${3}`)
    const laborChanges = { status: "failed" as const, error: "The Sage bridge did not answer.", updatedAt: now }
    expect(updateSageLaborRequests(db, laborChanges, laborFence).toSQL()).toEqual(
      db.update(sageLaborRequests).set(laborChanges).where(laborFence).toSQL(),
    )
  })
})

describe("Sage bridge store: raw statements", () => {
  it("records each bridge heartbeat exactly as the per-route literal statements did", () => {
    // The id used to be a SQL literal per route; it is now a bind value.
    const schema = "CREATE TABLE sage_bridge_status (id TEXT PRIMARY KEY, last_seen_at TEXT, updated_at TEXT)"
    for (const bridgeId of SAGE_BRIDGE_HEARTBEAT_IDS) {
      const before = sqliteWith(schema)
      const after = sqliteWith(schema)
      for (const at of [now, "2026-10-31T08:01:00.000Z"]) {
        before.prepare(`INSERT INTO sage_bridge_status (id, last_seen_at, updated_at)
          VALUES ('${bridgeId}', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at`).run(at, at)
        runRecorded(after, [sageBridgeHeartbeatStatement(d1, bridgeId, at)])
      }
      expect(rowsOf(after, "sage_bridge_status")).toEqual(rowsOf(before, "sage_bridge_status"))
      expect(rowsOf(after, "sage_bridge_status")).toHaveLength(1)
    }
  })

  it("marks a client/project write succeeded with the same SQL and binds", () => {
    const statement = sageClientProjectWriteSucceededStatement(d1, {
      operationId: "op1", clientId: "c-id", clientNumber: "101", clientStatusNumber: 1,
      jobId: null, jobNumber: null, jobStatusNumber: null, jobTypeNumber: null, now,
    })
    expect(statementShape(statement)).toEqual(expectedShape(
      `UPDATE sage_client_project_write_operations
       SET status = 'succeeded', sage_client_id = ?, sage_client_number = ?,
           sage_job_id = ?, sage_job_number = ?,
           resolved_client_status_number = ?, resolved_job_status_number = ?,
           resolved_job_type_number = ?, error_message = NULL,
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      ["c-id", "101", null, null, 1, null, null, now, now, "op1"],
    ))
  })

  it("replaces the directory snapshot in the same batch order, fenced by the running claim", () => {
    const claim = { refreshId: "d1", organizationId: "org-1", claimToken: "t1", now }
    const statements = sageClientDirectoryReplaceStatements(d1, claim, ["[1]", "[2]"]).map(statementShape)
    const fence = [claim.refreshId, claim.organizationId, claim.claimToken]
    const insert = `INSERT INTO sage_client_directory_entries
      (organization_id, sage_record_id, sage_client_number, name, email, captured_at)
      SELECT ?, json_extract(value, '$.sageRecordId'), json_extract(value, '$.sageClientNumber'),
        json_extract(value, '$.name'), json_extract(value, '$.email'), ? FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM sage_client_directory_refreshes WHERE id = ? AND organization_id = ?
        AND status = 'running' AND claim_token = ?)`
    expect(statements).toEqual([
      expectedShape(`DELETE FROM sage_client_directory_entries WHERE organization_id = ?
      AND EXISTS (SELECT 1 FROM sage_client_directory_refreshes WHERE id = ? AND organization_id = ?
        AND status = 'running' AND claim_token = ?)`, ["org-1", ...fence]),
      expectedShape(insert, ["org-1", now, "[1]", ...fence]),
      expectedShape(insert, ["org-1", now, "[2]", ...fence]),
      expectedShape(`UPDATE sage_client_directory_refreshes SET status = 'succeeded', completed_at = ?, error_message = NULL
      WHERE id = ? AND organization_id = ? AND status = 'running' AND claim_token = ?`, [now, ...fence]),
    ])
  })

  it("acquires and finishes pay-application runs with the same SQL and binds", () => {
    expect(statementShape(acquireSagePayApplicationRunStatement(d1, { runId: "run1", claimToken: "t1", claimedAt: stale, now })))
      .toEqual(expectedShape(
        `UPDATE sage_pay_application_sync_runs
     SET status = 'processing', claimed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running'
       AND claim_token = ? AND claimed_at = ?`,
        [now, now, "run1", "t1", stale],
      ))
    const outcome = {
      runId: "run1", projectId: "p1", claimToken: "t1", status: "completed" as const, snapshotId: "s1",
      sourceApplicationId: "a1", sourceRevision: "r1", sourceHash: "h1", reconciliationJson: "{}",
      errorMessage: null, capturedAt: stale, now,
    }
    expect(statementShape(sagePayApplicationTerminalRunStatement(d1, outcome))).toEqual(expectedShape(
      `UPDATE sage_pay_application_sync_runs
     SET status = ?, snapshot_id = ?, source_application_id = ?,
         source_revision = ?, source_hash = ?, reconciliation_json = ?,
         error_message = ?, captured_at = ?, completed_at = ?,
         updated_at = ?
     WHERE id = ? AND project_id = ?
       AND status = 'processing' AND claim_token = ?`,
      ["completed", "s1", "a1", "r1", "h1", "{}", null, stale, now, now, "run1", "p1", "t1"],
    ))
  })
})
