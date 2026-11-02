import { describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PRECHECK_SCHEMA,
  buildBatches,
  parseCapture,
  parsePrecheck,
  planImport,
} from "../../../scripts/import-buildertrend-messages.mjs"
import {
  DIRECTORY_SCHEMA,
  createParticipantResolver,
  parseDirectory,
  parsePeopleCatalog,
} from "../../../scripts/import-buildertrend-participants.mjs"

/*
 * Buildertrend renders a whole envelope field (all the recipients) as one
 * string, so the capture marks those participants `requiresReview` /
 * `participantBoundaryProven: false`. They fail closed unless exact
 * dictionary segmentation splits the literal into known people in exactly
 * one way.
 */

const PROJECT = "proj-1"

const directory = parseDirectory({
  schema: DIRECTORY_SCHEMA,
  people: [
    { personKey: "user:u-pm", kind: "staff", userId: "u-pm", displayName: "Pat PM", emails: ["pm@example.com"], projectIds: [PROJECT] },
    { personKey: "user:u-owner", kind: "owner", userId: "u-owner", displayName: "Olive Owner", emails: ["owner@example.com"], projectIds: [PROJECT] },
    { personKey: "user:u-john", kind: "owner", userId: "u-john", displayName: "Smith, John", emails: [], projectIds: [PROJECT] },
    // "Smith" and "John" are also people, so "Smith, John" splits two ways.
    { personKey: "user:u-smith", kind: "owner", userId: "u-smith", displayName: "Smith", emails: [], projectIds: [PROJECT] },
    { personKey: "user:u-john2", kind: "owner", userId: "u-john2", displayName: "John", emails: [], projectIds: [PROJECT] },
  ],
})
const catalog = parsePeopleCatalog("")
const resolve = createParticipantResolver({ participantMap: new Map(), directory, catalog, organizationId: "org-1" })

function line(id: string, recipients: readonly Record<string, unknown>[], sender: Record<string, unknown> = { namespace: "builder", email: "pm@example.com", displayName: "Pat PM" }): string {
  return JSON.stringify({
    schema: CAPTURE_SCHEMA, type: "message", btJobId: "101", btThreadId: `t${id}`, btMessageId: id, subject: "Tile", body: "Hi",
    sentAtDisplay: "Oct 3, 2025 4:12 PM", sender, recipients, attachments: [],
  })
}

function thread(id: string): string {
  return JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: "101", btThreadId: `t${id}`, messageCount: 1 })
}

const undivided = (literal: string) => ({ namespace: "owner", displayName: literal, kind: "to", requiresReview: true, participantBoundaryProven: false })

function plan(lines: readonly string[]) {
  return planImport({
    capture: parseCapture(lines.join("\n")),
    resolveParticipant: resolve,
    precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [] }),
    projects: { "101": PROJECT },
    timeZone: "America/Denver",
    organizationId: "org-1",
  })
}

describe("undivided Buildertrend recipient literals", () => {
  it("keeps requiresReview and participantBoundaryProven through parsing", () => {
    const parsed = parseCapture(line("1", [undivided("Olive Owner")]))
    expect(parsed.messages[0].recipients[0]).toMatchObject({ requiresReview: true, participantBoundaryProven: false })
  })

  it("splits a literal of two known names into two participants", () => {
    const result = plan([line("1", [undivided("Olive Owner, pm@example.com")]), thread("1")])
    expect(result.reviews).toEqual([])
    expect(result.matches.segmented_by_dictionary).toBe(1)
    const people = [...new Set(result.threads[0].people.map((person: { entry: { userId: string } }) => person.entry.userId))].sort()
    expect(people).toEqual(["u-owner", "u-pm"])
  })

  it("lets a known \"Last, First\" name keep its comma", () => {
    expect(resolve.segment("Olive Owner; Smith, John", "other-project")).toEqual({ reason: "participant_ambiguous" })
    const narrow = createParticipantResolver({
      participantMap: new Map(),
      directory: parseDirectory({ schema: DIRECTORY_SCHEMA, people: [
        { personKey: "user:u-owner", kind: "owner", userId: "u-owner", displayName: "Olive Owner", emails: [], projectIds: [PROJECT] },
        { personKey: "user:u-john", kind: "owner", userId: "u-john", displayName: "Smith, John", emails: [], projectIds: [PROJECT] },
      ] }),
      catalog,
      organizationId: "org-1",
    })
    expect(narrow.segment("Olive Owner; Smith,   John", PROJECT)).toEqual({ tokens: [{ displayName: "Olive Owner" }, { displayName: "Smith, John" }] })
  })

  it("sends a literal that splits more than one way to review", () => {
    const result = plan([line("1", [undivided("Smith, John")]), thread("1")])
    expect(result.threads).toEqual([])
    expect(result.reviews).toEqual([expect.objectContaining({ reason: "participant_ambiguous", literal: "Smith, John" })])
  })

  it("sends a literal with an unknown piece to review", () => {
    const result = plan([line("1", [undivided("Olive Owner, Someone Unknown")]), thread("1")])
    expect(result.threads).toEqual([])
    expect(result.reviews).toEqual([expect.objectContaining({ reason: "participant_boundary_unproven" })])
  })

  it("fails closed when requiresReview is set and nothing resolves it, even with a matching email", () => {
    const flagged = { namespace: "owner", displayName: "Somebody", email: "owner@example.com", kind: "to", requiresReview: true }
    const result = plan([line("1", [flagged]), thread("1")])
    expect(result.threads).toEqual([])
    expect(result.reviews).toEqual([expect.objectContaining({ reason: "participant_boundary_unproven" })])
  })

  it("requires an undivided sender to be exactly one known person", () => {
    const sender = { namespace: "builder", displayName: "Pat PM, Olive Owner", requiresReview: true, participantBoundaryProven: false }
    const result = plan([line("1", [{ namespace: "owner", displayName: "Olive Owner", kind: "to" }], sender), thread("1")])
    expect(result.threads).toEqual([])
    expect(result.reviews).toEqual([expect.objectContaining({ reason: "participant_boundary_unproven", participantKind: "sender" })])
  })

  it("keeps the original literal whole in the stored participant snapshot", () => {
    const result = plan([line("1", [undivided("Olive Owner, pm@example.com")]), thread("1")])
    const built = buildBatches(result, { actorUserId: "u-pm", now: "2026-11-01T00:00:00.000Z", driveFiles: new Map(), batchSize: 40 })
    const sql = built.batches.flatMap((batch: { statements: string[] }) => batch.statements).join("\n")
    expect(sql).toContain("'Olive Owner, pm@example.com'")
    expect(sql).toContain("'to_literal'")
  })
})
