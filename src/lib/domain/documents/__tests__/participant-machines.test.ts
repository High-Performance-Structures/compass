import { readFileSync } from "node:fs"

import { eq } from "drizzle-orm"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import { participantIdentityMachine, participantReviewMachine } from "@/lib/domain/documents/participant-machines"
import {
  PARTICIPANT_IDENTITY_STATUSES,
  PARTICIPANT_MEMBERSHIP_STATUSES,
  PARTICIPANT_REVIEW_STATUSES,
} from "@/lib/domain/documents/statuses"
import { reviewSourceRecordParticipantsStatement } from "@/lib/domain/documents/store"
import { availableEvents, machineProblems, nextState } from "@/lib/shared/state-machine"

describe("participant machines", () => {
  it("are well formed", () => {
    expect(machineProblems(participantReviewMachine)).toEqual([])
    expect(machineProblems(participantIdentityMachine)).toEqual([])
  })

  it("review decides a row once", () => {
    expect(nextState(participantReviewMachine, "unreviewed", "review").ok).toBe(true)
    expect(availableEvents(participantReviewMachine, "reviewed")).toEqual([])
  })

  it("a split row is final; review of any other identity keeps working", () => {
    expect(nextState(participantIdentityMachine, "boundary_unproven:several", "split").ok).toBe(true)
    expect(nextState(participantIdentityMachine, "boundary_split", "match").ok).toBe(false)
    for (const imported of ["source_display_unverified", "matched_source_held", "matched_active_user", "matched_project_contact"] as const) {
      expect(nextState(participantIdentityMachine, imported, "match").ok).toBe(true)
    }
  })

  it("leaves the older cutover review values alone", () => {
    for (const imported of ["held", "needs_review", "verified"] as const) {
      expect(availableEvents(participantReviewMachine, imported)).toEqual([])
    }
  })

  // Values found in production on 2026-11-12 (read only). A stored value
  // missing from its list would make the typed column lie.
  it("lists every status stored in production", () => {
    const production = {
      identity: ["matched", "boundary_split", "boundary_unproven:none", "unmatched", "matched_active_user",
        "matched_project_contact", "matched_source_held", "source_display_unverified"],
      membership: ["active", "pending"],
      review: ["reviewed", "unreviewed", "held", "needs_review", "verified"],
    }
    expect(production.identity.filter((value) => !includes(PARTICIPANT_IDENTITY_STATUSES, value))).toEqual([])
    expect(production.membership.filter((value) => !includes(PARTICIPANT_MEMBERSHIP_STATUSES, value))).toEqual([])
    expect(production.review.filter((value) => !includes(PARTICIPANT_REVIEW_STATUSES, value))).toEqual([])
  })
})

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value)
}

const SCHEMA = readFileSync("drizzle/0140_project_source_record_participants.sql", "utf8").replaceAll("--> statement-breakpoint", "")

let current: ReturnType<typeof sqliteDb> | null = null
afterEach(() => {
  current?.sqlite.close()
  current = null
})

function seed(): ReturnType<typeof sqliteDb> {
  current = sqliteDb(`PRAGMA foreign_keys = OFF; ${SCHEMA}`)
  current.sqlite.exec(`INSERT INTO project_source_record_participants (id, organization_id, project_id, source_record_type,
    source_record_id, source_participant_id, participant_role, identity_status, review_status, active, created_at, updated_at)
    VALUES ('p1', 'org', 'job', 'bt_message', 'm1', 'to:jane', 'to', 'unmatched', 'unreviewed', 0, 't0', 't0'),
           ('p2', 'org', 'job', 'bt_message', 'm2', 'to:literal', 'to_literal', 'boundary_unproven:none', 'unreviewed', 0, 't0', 't0')`)
  return current
}

function row(sqlite: ReturnType<typeof sqliteDb>["sqlite"], id: string): unknown {
  return sqlite.prepare("SELECT identity_status, review_status, user_id FROM project_source_record_participants WHERE id = ?").get(id)
}

describe("reviewSourceRecordParticipantsStatement", () => {
  it("matches an unreviewed row, and a second decision on it changes nothing", async () => {
    const { sqlite, db } = seed()
    const byId = eq(projectSourceRecordParticipants.id, "p1")
    await db.batch([reviewSourceRecordParticipantsStatement(db, byId, { identity: "match", set: { userId: "u1", updatedAt: "t1" } })])
    expect(row(sqlite, "p1")).toEqual({ identity_status: "matched", review_status: "reviewed", user_id: "u1" })

    // A reviewer (or the automatic resolver) working from a stale read.
    await db.batch([reviewSourceRecordParticipantsStatement(db, byId, { identity: "match", set: { userId: "u2", updatedAt: "t2" } })])
    expect(row(sqlite, "p1")).toEqual({ identity_status: "matched", review_status: "reviewed", user_id: "u1" })
  })

  it("splits a run-together literal; an older cutover review value is left alone", async () => {
    const { sqlite, db } = seed()
    sqlite.exec("UPDATE project_source_record_participants SET identity_status = 'matched_source_held', review_status = 'needs_review' WHERE id = 'p1'")
    await db.batch([reviewSourceRecordParticipantsStatement(db, eq(projectSourceRecordParticipants.id, "p1"), { identity: "match", set: { userId: "u1", updatedAt: "t1" } })])
    expect(row(sqlite, "p1")).toEqual({ identity_status: "matched_source_held", review_status: "needs_review", user_id: null })
    await db.batch([reviewSourceRecordParticipantsStatement(db, eq(projectSourceRecordParticipants.id, "p2"), { identity: "split", set: { updatedAt: "t1" } })])
    expect(row(sqlite, "p2")).toEqual({ identity_status: "boundary_split", review_status: "reviewed", user_id: null })
  })

  it("matches an unreviewed row whatever identity the importer stored", async () => {
    const { sqlite, db } = seed()
    sqlite.exec("UPDATE project_source_record_participants SET identity_status = 'source_display_unverified' WHERE id = 'p1'")
    await db.batch([reviewSourceRecordParticipantsStatement(db, eq(projectSourceRecordParticipants.id, "p1"), { identity: "match", set: { userId: "u1", updatedAt: "t1" } })])
    expect(row(sqlite, "p1")).toEqual({ identity_status: "matched", review_status: "reviewed", user_id: "u1" })
  })

  it("leaves a row as is: reviewed, identity unchanged", async () => {
    const { sqlite, db } = seed()
    await db.batch([reviewSourceRecordParticipantsStatement(db, eq(projectSourceRecordParticipants.id, "p1"), { set: { updatedAt: "t1" } })])
    expect(row(sqlite, "p1")).toEqual({ identity_status: "unmatched", review_status: "reviewed", user_id: null })
  })
})

const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /^(?!.*\.test\.tsx?$).*\.(ts|tsx)$/ }

function sourceFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

describe("participant status writes", () => {
  const files = sourceFiles("src").map((path) => ({ path, text: readSource(path) }))

  it("only documents/store.ts updates the table, and only through the machines", () => {
    const updaters = files.filter(({ text }) => /\.update\(projectSourceRecordParticipants\)|UPDATE\s+project_source_record_participants/i.test(text))
    expect(updaters.map(({ path }) => path)).toEqual(["src/lib/domain/documents/store.ts"])
    const store = readSource("src/lib/domain/documents/store.ts")
    const updates = store.split(".update(projectSourceRecordParticipants)").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("\n}\n")))
    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update).toMatch(/reviewStatus: review\.to/)
      expect(update).toMatch(/inArray\(projectSourceRecordParticipants\.reviewStatus, \[\.\.\.review\.from\]\)/)
    }
  })

  it("never come from a literal status in a patch or row", () => {
    // Files that write participants (other tables have their own reviewStatus).
    // participant-machines.ts is where the managed values are declared.
    const writers = files.filter(({ path, text }) =>
      /SourceRecordParticipant/.test(text) && !path.endsWith("documents/participant-machines.ts"))
    expect(writers.length).toBeGreaterThan(3)
    const literal = /\b(identityStatus|membershipStatus|reviewStatus):\s*["'`]/
    expect(writers.filter(({ text }) => literal.test(text)).map(({ path }) => path)).toEqual([])
    const store = readSource("src/lib/domain/documents/store.ts")
    const threadInsert = store.slice(store.indexOf("export function insertThreadParticipantsForMessagesStatement"))
    expect(threadInsert.slice(0, threadInsert.indexOf("\n}\n"))).not.toMatch(/'(matched|reviewed|active|pending)'/)
  })
})
