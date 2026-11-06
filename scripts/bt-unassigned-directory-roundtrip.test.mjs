import test from "node:test"
import assert from "node:assert/strict"
import { buildDirectorySnapshot, directoryQueries } from "./export-bt-directory-snapshot.mjs"
import { parseDirectory, createParticipantResolver, contactFor, importedProjectContactRow } from "./import-buildertrend-participants.mjs"
import { parseCapture, parsePrecheck, planImport, threadStatements } from "./import-buildertrend-messages.mjs"

const PROJECT = "example-project"
const email = "person@example.invalid"
const baseContact = {
  id: "existing-person", project_id: PROJECT, contact_type: "subcontractor",
  display_name: "Example Person", email, source_entity_type: "buildertrend_new_person",
  source_entity_id: "source-person", internal_contact_id: null, vendor_id: null,
  vendor_contact_id: null, customer_id: null, customer_contact_id: null,
}
const rowsFor = (contact, extras = {}) => ({
  users: [], members: [], internalContacts: [], vendorContacts: [], customerContacts: [],
  projectContacts: [contact], btVendors: [], vendorNames: [], projects: [], btInternal: [], ...extras,
})
const resolveWith = (snapshot) => createParticipantResolver({
  directory: parseDirectory(snapshot), participantMap: new Map(), catalog: [], organizationId: "example-org",
})
const ref = { namespace: "email", email, displayName: "Example Person", kind: "sender" }

test("directory SELECT includes the direct company link used to distinguish assignment", () => {
  const query = directoryQueries("example-org").find((q) => q.name === "projectContacts")
  assert.ok(query)
  assert.match(query.sql(null), /pc\.vendor_id/)
  assert.ok(directoryQueries("example-org").every((q) => q.sql(null).startsWith("SELECT ")))
})

test("an exact existing unassigned contact stays unassigned after export and parse", () => {
  const snapshot = buildDirectorySnapshot(rowsFor(baseContact))
  assert.equal(snapshot.people[0].unassigned, true)
  const match = resolveWith(snapshot)(ref, PROJECT)
  assert.equal(match.rule, "by_email")
  assert.equal(match.entry.unassigned, true)
  assert.deepEqual(contactFor({ key: "source-key", ref, entry: match.entry }, PROJECT), { id: baseContact.id, create: false })
})

test("the round trip keeps a repeated-source conversation staff-only and flagged", () => {
  const capture = parseCapture(JSON.stringify({ schema: "bt-message-capture/v1", type: "message", btJobId: "1", btMessageId: "2", body: "Exact source message", subject: "Example", sentAtDisplay: "11/4/2026 10:00 AM", sender: { namespace: "email", email, displayName: "Example Person" }, recipients: [], attachments: [] }))
  const precheck = parsePrecheck({ schema: "bt-import-precheck/v1", staffOnlyProjectIds: [], privateArchiveJobIds: [] })
  const plan = planImport({ capture, projects: { "1": PROJECT }, resolveParticipant: resolveWith(buildDirectorySnapshot(rowsFor(baseContact))), precheck, timeZone: "America/Denver", organizationId: "example-org" })
  assert.equal(plan.threads.length, 1)
  assert.equal(plan.threads[0].audience, "staff")
  assert.equal(plan.threads[0].pendingIdentity, true)
  assert.equal(plan.reviews[0].unresolved[0].reason, "new_unassigned_person")
  assert.equal(plan.threads[0].messages[0].body, "Exact source message")
  const sql = threadStatements(plan.threads[0], { actorUserId: "archive-actor", now: "2026-11-04T17:00:00Z", driveFiles: new Map() })
  assert.ok(!sql.some((v) => v.startsWith("INSERT INTO project_contacts ")))
  assert.ok(!sql.some((v) => v.startsWith("INSERT INTO channel_members ")))
})

test("a direct vendor-company connection survives export and allows normal resolution", () => {
  const snapshot = buildDirectorySnapshot(rowsFor({ ...baseContact, vendor_id: "existing-vendor" }))
  const match = resolveWith(snapshot)(ref, PROJECT)
  assert.equal(snapshot.people[0].unassigned, false)
  assert.equal(match.entry.unassigned, undefined)
  assert.equal(match.entry.links.vendorId, "existing-vendor")
})

test("adding the same unassigned person to another project preserves the pending company assignment", () => {
  const snapshot = buildDirectorySnapshot(rowsFor(baseContact))
  const match = resolveWith(snapshot)(ref, "another-project")
  const person = { key: "source-key", ref, entry: match.entry }
  const contact = contactFor(person, "another-project")
  assert.equal(contact.create, true)
  const row = importedProjectContactRow(person, { contactId: contact.id, projectId: "another-project", now: "2026-11-04T17:00:00Z" })
  assert.equal(row.source_entity_type, "buildertrend_new_person")
  assert.equal(row.vendor_id, null)
  assert.equal(row.customer_id, null)
  assert.equal(row.owner_portal_visible, 0)
  assert.equal(row.sub_vendor_portal_visible, 0)
})

test("a direct customer-company connection survives export", () => {
  const snapshot = buildDirectorySnapshot(rowsFor({ ...baseContact, contact_type: "owner", customer_id: "existing-customer" }))
  const match = resolveWith(snapshot)(ref, PROJECT)
  assert.equal(snapshot.people[0].unassigned, false)
  assert.equal(match.entry.links.customerId, "existing-customer")
  assert.equal(match.entry.kind, "owner")
})

test("a linked directory vendor contact is not treated as a new unassigned person", () => {
  const snapshot = buildDirectorySnapshot(rowsFor({ ...baseContact, vendor_contact_id: "vendor-person" }, { vendorContacts: [{ id: "vendor-person", vendor_id: "existing-vendor", user_id: null, name: "Example Person", email }] }))
  assert.equal(snapshot.people.length, 1)
  const match = resolveWith(snapshot)(ref, PROJECT)
  assert.equal(match.entry.unassigned, undefined)
  assert.equal(match.entry.links.vendorContactId, "vendor-person")
})

test("ordinary legacy contacts retain their existing interpretation", () => {
  const snapshot = buildDirectorySnapshot(rowsFor({ ...baseContact, source_entity_type: "vendor" }))
  assert.equal(snapshot.people[0].unassigned, false)
  assert.equal(resolveWith(snapshot)(ref, PROJECT).entry.unassigned, undefined)
})

test("older snapshots without the optional flag remain readable", () => {
  const snapshot = buildDirectorySnapshot(rowsFor({ ...baseContact, source_entity_type: "vendor" }))
  delete snapshot.people[0].unassigned
  assert.equal(resolveWith(snapshot)(ref, PROJECT).entry.unassigned, undefined)
})

test("malformed unassigned status fails parsing rather than silently clearing a hold", () => {
  const snapshot = buildDirectorySnapshot(rowsFor(baseContact))
  snapshot.people[0].unassigned = "true"
  assert.throws(() => parseDirectory(snapshot), /unassigned must be a boolean/)
})
