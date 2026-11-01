import { describe, expect, it } from "vitest"

import {
  CAPTURE_SCHEMA,
  PARTICIPANT_MAP_SCHEMA,
  PRECHECK_SCHEMA,
  parseCapture,
  parseParticipantMap,
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
 * Matching Buildertrend message participants to Compass people (owner
 * decision 2026-11-01): reviewed map by exact BT id, then exact email, then
 * exact full name in the project, then exact full name in the BT people
 * catalog resolved to one Compass person; anything else goes to review.
 */

const PROJECT = "proj-1"

const directory = parseDirectory({
  schema: DIRECTORY_SCHEMA,
  people: [
    { personKey: "staff-pat", kind: "staff", userId: "user-staff", displayName: "Pat PM", emails: ["pm@example.com"], projectIds: [PROJECT] },
    { personKey: "owner-olive", kind: "owner", userId: "user-owner", displayName: "Olive Owner", emails: ["owner@example.com"], projectIds: [PROJECT] },
    { personKey: "vendor-val", kind: "vendor", displayName: "Val Vendor", emails: ["val@vendor.example"], btIds: ["vendor_contact:77"] },
    { personKey: "sam-1", kind: "vendor", displayName: "Sam Smith", emails: [], projectContactIds: { [PROJECT]: "pc-sam-1" } },
    { personKey: "sam-2", kind: "owner", displayName: "Sam Smith", emails: [], projectIds: [PROJECT], userId: "user-sam" },
    { personKey: "shared-1", kind: "vendor", displayName: "Shared One", emails: ["office@shared.example"] },
    { personKey: "shared-2", kind: "vendor", displayName: "Shared Two", emails: ["office@shared.example"] },
    { personKey: "elsewhere", kind: "vendor", displayName: "Ellis Elsewhere", emails: ["ellis@elsewhere.example"] },
  ],
})

const catalog = parsePeopleCatalog([
  { btId: 77, type: "vendor_contact", parentBtId: 7, displayName: "Val Vendor" },
  { btId: 91, type: "vendor_contact", parentBtId: 9, displayName: "Chris Lee" },
  { btId: 92, type: "customer", displayName: "Chris Lee" },
  { btId: 88, type: "customer", displayName: "Dana Doe" },
  { btId: 95, type: "vendor_contact", displayName: "Ellis Elsewhere", email: "ELLIS@elsewhere.example" },
].map((row) => JSON.stringify(row)).join("\n"))

const participantMap = parseParticipantMap({
  schema: PARTICIPANT_MAP_SCHEMA,
  participants: { "owner:500": { decision: "user", kind: "owner", userId: "user-mapped" } },
})

const resolve = createParticipantResolver({ participantMap, directory, catalog })

function ref(overrides: Record<string, unknown>) {
  return { participantId: null, namespace: "unknown", email: null, displayName: null, role: null, kind: "to", ...overrides }
}

describe("Buildertrend participant matching", () => {
  it("a. matches the exact email shown, ignoring case and spaces", () => {
    expect(resolve(ref({ email: "  OWNER@Example.com ", displayName: "Someone Else" }), PROJECT))
      .toEqual({ entry: expect.objectContaining({ decision: "user", userId: "user-owner", kind: "owner" }), rule: "by_email" })
  })

  it("a. sends an email shared by more than one person to review", () => {
    expect(resolve(ref({ email: "office@shared.example" }), PROJECT)).toEqual({ reason: "participant_ambiguous" })
  })

  it("b. matches an exact full name among the project's people first", () => {
    expect(resolve(ref({ displayName: "  olive   OWNER " }), PROJECT))
      .toEqual({ entry: expect.objectContaining({ userId: "user-owner" }), rule: "by_name_project" })
  })

  it("b. sends a name shared by two of the project's people to review", () => {
    expect(resolve(ref({ displayName: "Sam Smith" }), PROJECT)).toEqual({ reason: "participant_ambiguous" })
  })

  it("b. never matches initials or partial names", () => {
    expect(resolve(ref({ displayName: "O. Owner" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
    expect(resolve(ref({ displayName: "Olive" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
  })

  it("b. falls back to the BT catalog, resolved to one person by exact BT id", () => {
    expect(resolve(ref({ displayName: "Val Vendor" }), PROJECT))
      .toEqual({ entry: expect.objectContaining({ decision: "new_contact", kind: "vendor", identity: "person:vendor-val" }), rule: "by_name_catalog" })
  })

  it("b. resolves a catalog hit by its email when no BT id is registered", () => {
    expect(resolve(ref({ displayName: "Ellis Elsewhere" }), PROJECT))
      .toEqual({ entry: expect.objectContaining({ identity: "person:elsewhere" }), rule: "by_name_catalog" })
  })

  it("c. sends an ambiguous or unresolvable catalog name to review", () => {
    expect(resolve(ref({ displayName: "Chris Lee" }), PROJECT)).toEqual({ reason: "participant_ambiguous" })
    expect(resolve(ref({ displayName: "Dana Doe" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
    expect(resolve(ref({ displayName: "Nobody Known" }), PROJECT)).toEqual({ reason: "participant_unmatched" })
  })

  it("0. a reviewed map entry for the exact BT id wins over email and name", () => {
    expect(resolve(ref({ participantId: "500", namespace: "owner", email: "owner@example.com", displayName: "Olive Owner" }), PROJECT))
      .toEqual({ entry: expect.objectContaining({ userId: "user-mapped" }), rule: "by_map" })
  })

  it("counts how each participant was matched and holds a thread with an ambiguous one", () => {
    const message = (id: string, thread: string, sender: Record<string, unknown>, recipient: Record<string, unknown>) => JSON.stringify({
      schema: CAPTURE_SCHEMA, type: "message", btJobId: "101", btThreadId: thread, btMessageId: id, subject: "Tile", body: "Hi",
      sentAtDisplay: "Oct 3, 2025 4:12 PM", sender: { namespace: "builder", participantId: null, ...sender },
      recipients: [{ namespace: "owner", participantId: null, kind: "to", ...recipient }], attachments: [],
    })
    const thread = (id: string) => JSON.stringify({ schema: CAPTURE_SCHEMA, type: "thread", btJobId: "101", btThreadId: id, messageCount: 1 })
    const plan = planImport({
      capture: parseCapture([
        message("1", "9001", { displayName: "Pat PM", email: "PM@example.com" }, { displayName: "Olive Owner" }), thread("9001"),
        message("2", "9002", { displayName: "Pat PM", email: "pm@example.com" }, { displayName: "Val Vendor" }), thread("9002"),
        message("3", "9003", { displayName: "Pat PM", email: "pm@example.com" }, { displayName: "Sam Smith" }), thread("9003"),
      ].join("\n")),
      resolveParticipant: resolve,
      precheck: parsePrecheck({ schema: PRECHECK_SCHEMA, staffOnlyProjectIds: [], privateArchiveJobIds: [] }),
      projects: { "101": PROJECT },
      timeZone: "America/Denver",
      organizationId: "org-1",
    })
    expect(plan.threads.map((item: { btThreadId: string }) => item.btThreadId)).toEqual(["9001", "9002"])
    expect(plan.reviews).toEqual([expect.objectContaining({ reason: "participant_ambiguous", btThreadId: "9003" })])
    expect(plan.matches).toEqual({ by_map: 0, by_email: 3, by_name_project: 1, by_name_catalog: 1, review: 1 })
  })
})
