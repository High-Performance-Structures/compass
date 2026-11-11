import { drizzle } from "drizzle-orm/d1"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"
import { migratedDatabase } from "@/lib/domain/contacts/__tests__/directory-seed"
import { isRecord } from "@/lib/shared/guards"

/*
 * Approving a Sage contact change never dead-ends on how old Compass's last
 * Sage read is (regression, 2026-11-10: approvals more than 15 minutes after
 * the edit failed with "the read is stale", and a late approval went straight
 * to a permanent conflict at the writer's claim). An old read queues a fresh
 * one; when it lands with Sage's values unchanged the change is rebased and
 * handed to the writer; when Sage changed a requested field it becomes a
 * conflict naming both values. Runs against a database built from every
 * migration. All names and ids are made up.
 */

const state = vi.hoisted(() => ({ d1: null as unknown, userId: "staff-1" }))
const ORG = "org-1"

function user(): Record<string, unknown> {
  return {
    id: state.userId, email: `${state.userId}@example.com`, firstName: "Avery", lastName: "Office", displayName: null,
    avatarUrl: null, role: "admin", googleEmail: null, isActive: true, lastLoginAt: null, organizationId: ORG,
    organizationName: "A", organizationType: "company", createdAt: "", updatedAt: "",
  }
}
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user(), requireAuth: async () => user() }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: async () => ({
    env: {
      DB: state.d1, SAGE_CONTACT_ORGANIZATION_ID: ORG, SAGE_CONTACT_WRITES_ENABLED: "true",
      SAGE_CONTACT_BRIDGE_SECRET: "test-secret",
    },
  }),
}))
vi.mock("@/lib/permission-enforcement", () => ({
  canFeature: async () => true,
  requireFeaturePermission: async () => undefined,
}))
vi.mock("@/db", () => ({ getDb: (d1: never) => drizzle(d1) }))
vi.mock("@/lib/sage/bridge-auth", async (original) => ({
  ...await original<typeof import("@/lib/sage/bridge-auth")>(),
  getSageContactBridgeSecret: () => "test-secret",
  verifySageBridgeRequest: async () => ({ success: true }),
}))

import { GET } from "@/app/api/integrations/sage/contact-changes/requests/route"
import { POST } from "@/app/api/integrations/sage/contact-changes/results/route"
import {
  listSageContactChangeProposals,
  reapplySageContactChange,
  reviewSageContactChange,
} from "@/app/actions/sage-contact-changes"
import { describeSageDifferences, rebaseSageChanges } from "@/lib/sage/contact-change-readiness"

const NOW = "2026-11-01T00:00:00.000Z"
const OLD_READ = "2026-11-05T15:00:00.000Z"
const CLIENT_SAGE_ID = "7b1d2e3f-0000-4000-8000-000000000052"
const PROPOSAL = "proposal-1"

let sqlite: ReturnType<typeof migratedDatabase>

function insert(table: string, row: Record<string, string | number | null>): void {
  const keys = Object.keys(row)
  sqlite.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(...Object.values(row))
}

function rows(query: string): Record<string, unknown>[] {
  return sqlite.prepare(query).all().filter(isRecord)
}

/** The record's newest change request (a rebase or reapply supersedes it with a copy). */
function proposal(): Record<string, unknown> | undefined {
  return rows(`SELECT id, status, base_revision, changes_json, error_message FROM sage_contact_change_proposals
    WHERE entity_id = 'customer-1' ORDER BY rowid DESC LIMIT 1`)[0]
}

function originalStatus(): unknown {
  return rows(`SELECT status FROM sage_contact_change_proposals WHERE id = '${PROPOSAL}'`)[0]?.status
}

/** What Sage holds for the client. */
const sageClient = {
  addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
  billingAddressLine1: null, billingAddressLine2: null, billingCity: null, billingState: null, billingPostalCode: null,
  name: "Kelly Painting", email: "kelly@paint.example", phone: "555-0200",
}

function snapshot(capturedAt: string, revision = "rev-1", fields: Record<string, string | null> = sageClient): void {
  insert("sage_contact_snapshots", {
    id: "snap-1", organization_id: ORG, kind: "client_company", entity_id: "customer-1", sage_record_id: CLIENT_SAGE_ID,
    parent_sage_record_id: null, revision, fields_json: JSON.stringify(fields), captured_at: capturedAt,
  })
}

function changeRequest(status: string, extra: Record<string, string | null> = {}): void {
  insert("sage_contact_change_proposals", {
    id: PROPOSAL, organization_id: ORG, kind: "client_company", entity_id: "customer-1", sage_record_id: CLIENT_SAGE_ID,
    parent_sage_record_id: null, base_revision: "rev-1",
    changes_json: JSON.stringify([{ field: "email", before: "kelly@paint.example", after: "office@paint.example" }]),
    status, requested_by_user_id: "staff-1", requested_at: "2026-11-05T15:01:00.000Z", updated_at: NOW, ...extra,
  })
}

let requestCounter = 0
function headers(): Record<string, string> {
  requestCounter += 1
  return { "content-type": "application/json", "x-compass-request-id": `req-${requestCounter}-${Date.now()}` }
}

type Claimed = { readonly reads: { id: string; claimToken: string }[]; readonly writes: { id: string; baseRevision: string }[] }

async function poll(): Promise<Claimed> {
  const response = await GET(new Request("https://compass.test/api/integrations/sage/contact-changes/requests", { headers: headers() }))
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.reads) || !Array.isArray(body.writes)) throw new Error("Unexpected claim body")
  return {
    reads: body.reads.filter(isRecord).map((read) => ({ id: String(read.id), claimToken: String(read.claimToken) })),
    writes: body.writes.filter(isRecord).map((write) => ({ id: String(write.id), baseRevision: String(write.baseRevision) })),
  }
}

/** The Sage writer answers a claimed read with what Sage holds now. */
async function answerRead(read: { id: string; claimToken: string }, revision: string, fields: Record<string, string | null>): Promise<void> {
  const response = await POST(new Request("https://compass.test/api/integrations/sage/contact-changes/results", {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      type: "read",
      result: {
        outcome: "succeeded", id: read.id, claimToken: read.claimToken,
        snapshot: {
          kind: "client_company", entityId: "customer-1", sageRecordId: CLIENT_SAGE_ID, sageRecordNumber: "52",
          parentSageRecordId: null, identityName: "Kelly Painting", revision, fields,
        },
      },
    }),
  }))
  expect(response.status).toBe(202)
}

beforeEach(() => {
  sqlite = migratedDatabase()
  sqlite.pragma("foreign_keys = OFF")
  state.d1 = d1Over(sqlite)
  state.userId = "reviewer-1"
  insert("users", { id: "staff-1", email: "staff-1@example.com", first_name: "Sam", last_name: "Staff", created_at: NOW, updated_at: NOW })
  insert("customers", {
    id: "customer-1", organization_id: ORG, name: "Kelly Painting", email: "office@paint.example", phone: "555-0200",
    sage_client_id: CLIENT_SAGE_ID, sage_client_number: "52", created_at: NOW, updated_at: NOW,
  })
})

afterEach(() => sqlite.close())

describe("approving against an old Sage read", () => {
  it("records the approval, reads Sage again, rebases onto the unchanged values and hands it to the writer", async () => {
    snapshot(OLD_READ)
    changeRequest("pending")
    await expect(reviewSageContactChange(PROPOSAL, "approve")).resolves
      .toEqual({ success: true, id: PROPOSAL, status: "checking_sage" })
    expect(proposal()?.status).toBe("approved")

    // The writer gets the read, not the write.
    const first = await poll()
    expect(first.writes).toEqual([])
    const [read] = first.reads
    if (!read) throw new Error("No Sage read was queued")

    // Another field changed in Sage (new revision); the email Sage holds is still the request's before-value.
    await answerRead(read, "rev-2", { ...sageClient, phone: "555-0299" })
    // The plan is immutable: an approved copy planned against the new read replaces it.
    expect(originalStatus()).toBe("superseded")
    const rebased = proposal()
    expect(rebased).toMatchObject({ status: "approved", base_revision: "rev-2", error_message: null })
    expect(JSON.parse(String(rebased?.changes_json)))
      .toEqual([{ field: "email", before: "kelly@paint.example", after: "office@paint.example" }])

    const second = await poll()
    expect(second.writes).toEqual([{ id: String(rebased?.id), baseRevision: "rev-2" }])
    expect(proposal()?.status).toBe("running")
  })

  it("becomes a conflict naming Sage's value and the requested one when Sage changed that field", async () => {
    snapshot(OLD_READ)
    changeRequest("pending")
    await reviewSageContactChange(PROPOSAL, "approve")
    const [read] = (await poll()).reads
    if (!read) throw new Error("No Sage read was queued")
    await answerRead(read, "rev-2", { ...sageClient, email: "someone@paint.example" })
    expect(proposal()?.status).toBe("conflict")
    expect(String(proposal()?.error_message)).toContain('Email: Sage now has "someone@paint.example", requested "office@paint.example"')
    expect((await poll()).writes).toEqual([])
  })

  it("approves straight to the writer when the read is recent", async () => {
    snapshot(new Date().toISOString())
    changeRequest("pending")
    await expect(reviewSageContactChange(PROPOSAL, "approve")).resolves.toMatchObject({ status: "approved" })
    expect((await poll()).writes).toEqual([{ id: PROPOSAL, baseRevision: "rev-1" }])
  })
})

describe("the writer's claim", () => {
  it("re-reads Sage for an approved change whose read expired instead of failing it", async () => {
    snapshot(OLD_READ)
    changeRequest("approved", { reviewed_by_user_id: "reviewer-1", reviewed_at: OLD_READ })
    const claimed = await poll()
    expect(claimed.writes).toEqual([])
    // The read goes out in the same poll.
    expect(claimed.reads).toHaveLength(1)
    expect(proposal()?.status).toBe("approved")
  })

  it("lets staff reapply a conflict left by an expired read; unchanged Sage values go to the writer", async () => {
    snapshot(OLD_READ)
    changeRequest("conflict", { error_message: "Sage snapshot changed or expired before bridge claim" })
    const [listed] = await listSageContactChangeProposals()
    expect(listed?.problem).toContain("Reapply")
    await expect(reapplySageContactChange(PROPOSAL)).resolves.toMatchObject({ success: true, status: "checking_sage" })
    expect(originalStatus()).toBe("superseded")
    expect(await listSageContactChangeProposals()).toMatchObject([{ state: { label: "Sending to Sage…" } }])
    const [read] = (await poll()).reads
    if (!read) throw new Error("No Sage read was queued")
    await answerRead(read, "rev-1", sageClient)
    expect((await poll()).writes).toEqual([{ id: String(proposal()?.id), baseRevision: "rev-1" }])
  })
})

describe("the review list", () => {
  it("shows requests needing a decision and those on their way; finished ones leave it", async () => {
    const changes = JSON.stringify([{ field: "phone", before: "555-0200", after: "555-0201" }])
    const statuses = ["pending", "approved", "running", "conflict", "failed", "succeeded", "rejected", "superseded", "withdrawn", "queued"]
    statuses.forEach((status, index) => insert("sage_contact_change_proposals", {
      // One unfinished change per record, so each status gets its own record.
      id: `p-${status}`, organization_id: ORG, kind: "client_company",
      entity_id: status === "pending" ? "customer-1" : `customer-${status}`, sage_record_id: CLIENT_SAGE_ID,
      parent_sage_record_id: null, base_revision: "rev-1", changes_json: changes, status,
      requested_by_user_id: "staff-1", requested_at: `2026-11-0${(index % 9) + 1}T00:00:00.000Z`, updated_at: NOW,
    }))
    const listed = await listSageContactChangeProposals()
    expect(listed.map((item) => [item.status, item.state.label])).toEqual([
      ["pending", "Waiting for approval"],
      ["failed", "Needs attention"],
      ["conflict", "Needs attention"],
      ["running", "Sending to Sage…"],
      ["approved", "Sending to Sage…"],
    ])
    expect(listed[0]).toMatchObject({ kindLabel: "Client", entityName: "Kelly Painting", requestedByName: "Sam Staff" })
  })
})

describe("rebasing onto a newer Sage read", () => {
  const email = { field: "email", before: "a@example.com", after: "b@example.com" } as const
  const phone = { field: "phone", before: null, after: "555-0100" } as const

  it("keeps before-values Sage still holds and takes values Sage already has", () => {
    expect(rebaseSageChanges([email, phone], { email: "a@example.com", phone: "555-0100", city: "Golden" })).toEqual({
      ok: true,
      changes: [email, { field: "phone", before: "555-0100", after: "555-0100" }],
    })
    // Blank and missing values match the way the Sage writer compares them.
    expect(rebaseSageChanges([email, phone], { email: "a@example.com", phone: "" })).toMatchObject({ ok: true })
  })

  it("reports each field Sage changed underneath, with both values", () => {
    const result = rebaseSageChanges([email, phone], { email: "c@example.com", phone: null })
    expect(result).toEqual({ ok: false, differences: [{ field: "email", sageValue: "c@example.com", requested: "b@example.com" }] })
    expect(result.ok ? null : describeSageDifferences(result.differences))
      .toBe('Sage changed since this was requested. Email: Sage now has "c@example.com", requested "b@example.com".')
  })
})
