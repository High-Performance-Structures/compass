import { and, eq, lt, or } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { getDb } from "@/db"
import {
  sageContactChangeEvents,
  sageContactChangeProposals,
  sageContactCreateProposals,
  sageContactReadRequests,
  sageContactSnapshots,
} from "@/db/schema-sage"
import { expectedShape, recorded, recordingD1, statementShape } from "@/lib/domain/__tests__/recording-d1"
import {
  awaitSageLinkReviewStatements,
  claimSageContactCreateStatement,
  confirmSageLinkStatement,
  insertSageContactChangeEvent,
  insertSageContactSnapshot,
  refreshSageLinkLookupStatements,
  rejectSageLinkCandidateStatements,
  rejectSageLinkReviewStatements,
  reviewSageContactChangeStatements,
  reviewSageContactCreateStatements,
  sageContactCreateFailedStatement,
  sageContactCreateOutcomeEventStatement,
  sageContactCreateSucceededStatement,
  sageContactCreateUncertainStatement,
  sageCreatedPersonSnapshotStatement,
  sageLinkedEventStatement,
  startSageLinkStatement,
  updateSageContactChangeProposals,
  updateSageContactCreateProposals,
  updateSageContactReadRequests,
} from "@/lib/domain/sage-bridge/contact-store"

/*
 * Each moved write builds the same SQL with the same binds as before. Audit
 * event ids are random, so bind position 0 of those statements is checked
 * as "a UUID" and the rest compared exactly.
 */
// @ts-expect-error Statements are only built here, never run.
const db = getDb({})
const d1 = recordingD1()
const now = "2026-10-31T08:00:00.000Z"
const uuid = /^[0-9a-f-]{36}$/

function withGeneratedId(statement: unknown): { readonly sql: string; readonly binds: readonly unknown[] } {
  const shape = statementShape(statement)
  expect(String(shape.binds[0])).toMatch(uuid)
  return { sql: shape.sql, binds: shape.binds.slice(1) }
}

describe("Sage contact store: Drizzle builders", () => {
  it("keeps read-request claim fences and .returning()", () => {
    const fence = and(eq(sageContactReadRequests.id, "r1"), or(
      eq(sageContactReadRequests.status, "queued"),
      and(eq(sageContactReadRequests.status, "running"), lt(sageContactReadRequests.claimedAt, now)),
    ))
    const changes = { status: "running", claimToken: "t1", claimedAt: now }
    expect(updateSageContactReadRequests(db, changes, fence).returning({ id: sageContactReadRequests.id }).toSQL()).toEqual(
      db.update(sageContactReadRequests).set(changes).where(fence).returning({ id: sageContactReadRequests.id }).toSQL(),
    )
  })

  it("keeps the snapshot upsert target and set", () => {
    const values = {
      id: "s1", organizationId: "org-1", kind: "client_company", entityId: "c1", sageRecordId: "sr1",
      parentSageRecordId: null, revision: "rev", fieldsJson: "{}", capturedAt: now,
    }
    const conflict = {
      target: [sageContactSnapshots.organizationId, sageContactSnapshots.kind, sageContactSnapshots.entityId],
      set: { revision: "rev", fieldsJson: "{}", capturedAt: now },
    }
    expect(insertSageContactSnapshot(db, values).onConflictDoUpdate(conflict).toSQL()).toEqual(
      db.insert(sageContactSnapshots).values(values).onConflictDoUpdate(conflict).toSQL(),
    )
  })

  it("keeps change and create proposal updates and event inserts", () => {
    const fence = and(eq(sageContactChangeProposals.id, "p1"), eq(sageContactChangeProposals.claimToken, "t1"))
    expect(updateSageContactChangeProposals(db, { status: "failed" }, fence).toSQL()).toEqual(
      db.update(sageContactChangeProposals).set({ status: "failed" }).where(fence).toSQL(),
    )
    const event = {
      id: "e1", proposalId: "p1", organizationId: "org-1", actorUserId: null,
      eventType: "failed", detailJson: "{}", createdAt: now,
    }
    expect(insertSageContactChangeEvent(db, event).toSQL()).toEqual(db.insert(sageContactChangeEvents).values(event).toSQL())
    const createFence = and(eq(sageContactCreateProposals.id, "p1"), eq(sageContactCreateProposals.status, "approved"))
    expect(updateSageContactCreateProposals(db, { status: "failed" }, createFence).returning({ id: sageContactCreateProposals.id }).toSQL())
      .toEqual(db.update(sageContactCreateProposals).set({ status: "failed" }).where(createFence)
        .returning({ id: sageContactCreateProposals.id }).toSQL())
  })
})

describe("Sage contact store: link review statements", () => {
  it("rejects a link candidate exactly as the results route did", () => {
    const [update, event] = rejectSageLinkCandidateStatements(d1, { id: "r1", organizationId: "org-1", claimToken: "t1" }, "why", now)
    expect(statementShape(update)).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests SET status = 'conflict', error_message = ?, completed_at = ?
       WHERE id = ? AND organization_id = ? AND claim_token = ?
         AND status = 'running' AND purpose = 'link_candidate'`,
      ["why", now, "r1", "org-1", "t1"],
    ))
    expect(withGeneratedId(event)).toEqual(expectedShape(
      `INSERT INTO sage_contact_link_events
       (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, 'conflict', ?, ?
       FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
         AND claim_token = ? AND status = 'conflict' AND completed_at = ?`,
      [JSON.stringify({ reason: "why" }), now, "r1", "org-1", "t1", now],
    ))
  })

  it("stores a candidate for review exactly as the results route did", () => {
    const [update, event] = awaitSageLinkReviewStatements(d1, { readId: "r1", claimToken: "t1", snapshotJson: "{\"a\":1}", now })
    expect(statementShape(update)).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests
           SET status = 'awaiting_review', candidate_snapshot_json = ?, completed_at = ?
           WHERE id = ? AND claim_token = ? AND status = 'running' AND purpose = 'link_candidate'`,
      ["{\"a\":1}", now, "r1", "t1"],
    ))
    expect(withGeneratedId(event)).toEqual(expectedShape(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, NULL, 'candidate_read', '{}', ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'awaiting_review'
             AND claim_token = ?`,
      [now, "r1", "t1"],
    ))
  })

  it("refreshes a lookup exactly as the link action did", () => {
    const [update, event] = refreshSageLinkLookupStatements(d1, {
      requestId: "r1", organizationId: "org-1", actorUserId: "u1", number: "42", reason: "stale", refreshedAt: now,
    })
    expect(statementShape(update)).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests SET status = 'queued', claim_token = NULL,
           claimed_at = NULL, candidate_snapshot_json = NULL, completed_at = NULL,
           error_message = NULL, requested_at = ?
           WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
             AND status = 'awaiting_review' AND sage_record_number = ?`,
      [now, "r1", "org-1", "42"],
    ))
    expect(withGeneratedId(event)).toEqual(expectedShape(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'refreshed', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND organization_id = ?
             AND status = 'queued' AND requested_at = ?
             AND NOT EXISTS (SELECT 1 FROM sage_contact_link_events
               WHERE request_id = ? AND event_type = 'refreshed' AND created_at = ?)`,
      ["u1", JSON.stringify({ number: "42", reason: "stale" }), now, "r1", "org-1", now, "r1", now],
    ))
  })

  it("rejects, starts, confirms and audits a reviewed link exactly as before", () => {
    const review = { requestId: "r1", organizationId: "org-1", reviewerUserId: "u1", reviewNote: null, now }
    const [reject, rejected] = rejectSageLinkReviewStatements(d1, review, JSON.stringify({ note: "" }))
    expect(statementShape(reject)).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests SET status = 'rejected', reviewed_by_user_id = ?,
           reviewed_at = ?, review_note = ? WHERE id = ? AND organization_id = ?
           AND purpose = 'link_candidate' AND status = 'awaiting_review'`,
      ["u1", now, null, "r1", "org-1"],
    ))
    expect(withGeneratedId(rejected)).toEqual(expectedShape(
      `INSERT INTO sage_contact_link_events
           (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
           SELECT ?, id, organization_id, ?, 'rejected', ?, ?
           FROM sage_contact_read_requests WHERE id = ? AND status = 'rejected'
             AND reviewed_by_user_id = ? AND reviewed_at = ?`,
      ["u1", JSON.stringify({ note: "" }), now, "r1", "u1", now],
    ))
    expect(statementShape(startSageLinkStatement(d1, review, { reviewToken: "rt", candidateSnapshotJson: "{}" }))).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests SET status = 'linking', claim_token = ?,
         reviewed_by_user_id = ?, reviewed_at = ?, review_note = ?
         WHERE id = ? AND organization_id = ? AND purpose = 'link_candidate'
           AND status = 'awaiting_review' AND candidate_snapshot_json = ?`,
      ["rt", "u1", now, null, "r1", "org-1", "{}"],
    ))
    const confirmation = ` AND customer_id IN (SELECT id FROM customers WHERE organization_id = ? AND sage_client_id = ?)`
    const binds = ["r1", "org-1", "rt", "e1", "sid", "org-1", "parent"]
    expect(statementShape(confirmSageLinkStatement(d1, {
      confirmedTable: "customer_contacts", confirmedColumn: "sage_contact_id", confirmation, binds,
    }))).toEqual(expectedShape(
      `UPDATE sage_contact_read_requests SET status = 'linked' WHERE id = ?
       AND organization_id = ? AND status = 'linking' AND claim_token = ?
       AND EXISTS (SELECT 1 FROM customer_contacts WHERE id = ? AND sage_contact_id = ?${confirmation})`,
      binds,
    ))
    expect(withGeneratedId(sageLinkedEventStatement(d1, review, { reviewToken: "rt", detailJson: "{}" }))).toEqual(expectedShape(
      `INSERT INTO sage_contact_link_events
         (id, request_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, 'linked', ?, ? FROM sage_contact_read_requests
         WHERE id = ? AND organization_id = ? AND status = 'linked'
           AND reviewed_by_user_id = ? AND reviewed_at = ? AND claim_token = ?`,
      ["u1", "{}", now, "r1", "org-1", "u1", now, "rt"],
    ))
  })
})

describe("Sage contact store: proposal reviews", () => {
  const review = {
    proposalId: "p1", organizationId: "org-1", reviewerUserId: "u1", status: "rejected" as const,
    reviewNote: "no", noteJson: JSON.stringify({ note: "no" }), completedAt: now, now,
  }

  it("decides a change proposal exactly as before", () => {
    const [update, event] = reviewSageContactChangeStatements(d1, review)
    expect(statementShape(update)).toEqual(expectedShape(
      `UPDATE sage_contact_change_proposals
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?,
             review_note = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`,
      ["rejected", "u1", now, "no", now, now, "p1", "org-1"],
    ))
    expect(withGeneratedId(event)).toEqual(expectedShape(
      `INSERT INTO sage_contact_change_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ?
         FROM sage_contact_change_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`,
      ["u1", "rejected", review.noteJson, now, "p1", "org-1", "rejected", "u1", now],
    ))
  })

  it("decides a create proposal exactly as before", () => {
    const [update, event] = reviewSageContactCreateStatements(d1, { ...review, status: "approved", completedAt: null })
    expect(statementShape(update)).toEqual(expectedShape(
      `UPDATE sage_contact_create_proposals SET status = ?, reviewed_by_user_id = ?,
         reviewed_at = ?, review_note = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'pending'`,
      ["approved", "u1", now, "no", null, now, "p1", "org-1"],
    ))
    expect(withGeneratedId(event)).toEqual(expectedShape(
      `INSERT INTO sage_contact_create_events
         (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
         SELECT ?, id, organization_id, ?, ?, ?, ? FROM sage_contact_create_proposals
         WHERE id = ? AND organization_id = ? AND status = ?
           AND reviewed_by_user_id = ? AND reviewed_at = ?`,
      ["u1", "approved", review.noteJson, now, "p1", "org-1", "approved", "u1", now],
    ))
  })
})

describe("Sage contact store: Add claim and result", () => {
  it("claims an Add with the same parent fence per kind", () => {
    for (const kind of ["client_person", "vendor_person"] as const) {
      const parentTable = kind === "client_person" ? "customers" : "vendors"
      const parentIdColumn = kind === "client_person" ? "customer_id" : "vendor_id"
      const parentSageColumn = kind === "client_person" ? "sage_client_id" : "sage_vendor_id"
      const activeFilter = kind === "client_person" ? "" : "AND parent.directory_status = 'active'"
      const statement = claimSageContactCreateStatement(d1, {
        kind, proposalId: "p1", organizationId: "org-1", parentSageRecordId: "psr", claimToken: "t1", now,
      })
      expect(statementShape(statement)).toEqual(expectedShape(
        `UPDATE sage_contact_create_proposals
         SET status = 'running', claim_token = ?, claimed_at = ?, attempt_count = attempt_count + 1,
             updated_at = ?
         WHERE id = ? AND organization_id = ? AND status = 'approved' AND attempt_count = 0
           AND EXISTS (SELECT 1 FROM ${parentTable} parent
             WHERE parent.id = sage_contact_create_proposals.${parentIdColumn}
               AND parent.organization_id = sage_contact_create_proposals.organization_id
               AND parent.${parentSageColumn} = sage_contact_create_proposals.parent_sage_record_id
               ${activeFilter})
           AND NOT EXISTS (
             SELECT 1 FROM sage_contact_create_proposals other
             WHERE other.organization_id = ? AND other.parent_sage_record_id = ?
               AND other.status IN ('running', 'needs_reconciliation') AND other.id <> ?
           )`,
        ["t1", now, now, "p1", "org-1", "org-1", "psr", "p1"],
      ))
    }
  })

  const claim = { proposalId: "p1", organizationId: "org-1", claimToken: "t1", now }

  it("parks, fails and completes an Add exactly as the result handler did", () => {
    expect(statementShape(sageContactCreateUncertainStatement(d1, claim, { reason: "r", sageContactId: null, sageLineNumber: null })))
      .toEqual(expectedShape(
        `UPDATE sage_contact_create_proposals SET status = 'needs_reconciliation',
       error_message = ?, sage_contact_id = ?, sage_line_number = ?,
       completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
         AND status = 'running' AND claim_token = ?`,
        ["r", null, null, now, now, "p1", "org-1", "t1"],
      ))
    expect(statementShape(sageContactCreateFailedStatement(d1, claim, "boom"))).toEqual(expectedShape(
      `UPDATE sage_contact_create_proposals SET status = 'failed', error_message = ?,
         completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?
           AND status = 'running' AND claim_token = ?`,
      ["boom", now, now, "p1", "org-1", "t1"],
    ))
    expect(statementShape(sageContactCreateSucceededStatement(d1, claim, {
      canonicalTable: "vendor_contacts", sageContactId: "sc1", sageLineNumber: 3,
    }))).toEqual(expectedShape(
      `UPDATE sage_contact_create_proposals SET status = 'succeeded',
       sage_contact_id = ?, sage_line_number = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND status = 'running' AND claim_token = ?
         AND EXISTS (SELECT 1 FROM vendor_contacts WHERE id = ? AND sage_contact_id = ?)`,
      ["sc1", 3, now, now, "p1", "org-1", "t1", "p1", "sc1"],
    ))
  })

  it("writes each outcome event with the status the proposal must have reached", () => {
    for (const status of ["needs_reconciliation", "failed", "succeeded"] as const) {
      expect(withGeneratedId(sageContactCreateOutcomeEventStatement(d1, claim, status, "{}"))).toEqual(expectedShape(
        `INSERT INTO sage_contact_create_events
       (id, proposal_id, organization_id, actor_user_id, event_type, detail_json, created_at)
       SELECT ?, id, organization_id, NULL, '${status}', ?, ?
       FROM sage_contact_create_proposals WHERE id = ? AND organization_id = ?
         AND status = '${status}' AND claim_token = ? AND completed_at = ?`,
        ["{}", now, "p1", "org-1", "t1", now],
      ))
    }
  })

  it("snapshots the added person only once the directory row carries the Sage ID", () => {
    const statement = sageCreatedPersonSnapshotStatement(d1, {
      canonicalTable: "customer_contacts", organizationId: "org-1", kind: "client_person", personId: "p1",
      sageRecordId: "sc1", parentSageRecordId: "psr", revision: "rev", fieldsJson: "{}", now,
    })
    expect(withGeneratedId(statement)).toEqual(expectedShape(
      `INSERT INTO sage_contact_snapshots
       (id, organization_id, kind, entity_id, sage_record_id, parent_sage_record_id,
        revision, fields_json, captured_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM customer_contacts
       WHERE id = ? AND sage_contact_id = ?`,
      ["org-1", "client_person", "p1", "sc1", "psr", "rev", "{}", now, "p1", "sc1"],
    ))
    expect(recorded(statement).sql).toContain("FROM customer_contacts")
  })
})
