import assert from "node:assert/strict"
import test from "node:test"

import { normalizeSource, reconcileSource } from "./build-buildertrend-correspondence-evidence.mjs"

const body = (value) => ({ kind: "exact", value })
const person = (sourceParticipantId, status = "proven") => ({ sourceParticipantId, evidence: { status } })
const recipientEvidence = (sourceParticipantId) => ({ status: "proven", to: [person(sourceParticipantId)], cc: [], bcc: [] })
const attachment = (sourceAttachmentId, sourceMessageId, status = "verified") => ({
  sourceAttachmentId,
  sourceMessageId,
  transferEvidence: status === "verified"
    ? { status, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sizeBytes: 12 }
    : { status },
})

function source(overrides = {}) {
  return {
    schemaVersion: "buildertrend-correspondence-source/v1",
    sourceAccountId: "account-1",
    capturedAt: "2026-09-05T12:00:00Z",
    projects: [{ sourceProjectId: "job-1", canonicalProjectId: "project-1", mappingStatus: "proven" }],
    conversations: [{ sourceConversationId: "thread-1", sourceProjectId: "job-1", subject: "Schedule" }],
    messages: [{
      sourceMessageId: "message-1",
      sourceConversationId: "thread-1",
      sourceProjectId: "job-1",
      sender: person("staff-1"),
      bodyEvidence: body("Exact Buildertrend body"),
      recipientEvidence: recipientEvidence("owner-1"),
      threadEvidence: { status: "proven", sourceThreadId: "thread-1" },
      sourceAttachmentIds: ["file-1"],
    }],
    attachments: [attachment("file-1", "message-1")],
    participantProjects: [{
      participant: person("owner-1"),
      sourceProjectId: "job-1",
      projectEntitlementEvidence: { status: "proven" },
      expectedSourceMessageIds: ["message-1"],
      expectedSourceAttachmentIds: ["file-1"],
    }],
    ...overrides,
  }
}

test("marks a fully evidenced participant/project ready without emitting bodies or Bcc identities", () => {
  const report = reconcileSource(source({
    messages: [{
      ...source().messages[0],
      recipientEvidence: {
        status: "proven",
        to: [person("owner-1")],
        cc: [],
        bcc: [person("blind-1")],
      },
    }],
  }))

  assert.equal(report.participantProjects[0].status, "ready")
  assert.equal(report.sourceSummary.exactBodies, 1)
  assert.equal(report.sourceSummary.bccEvidenceMessages, 1)
  assert.equal(report.sourceSummary.bccIdentitiesExposed, false)
  assert.equal(report.safety.bodyTextIncluded, false)
  assert.equal(JSON.stringify(report).includes("Exact Buildertrend body"), false)
  assert.equal(JSON.stringify(report).includes("blind-1"), false)
})

test("keeps excerpt/page text partial and never upgrades it to an exact body", () => {
  const value = source()
  value.messages = [{
    ...value.messages[0],
    bodyEvidence: { kind: "excerpt", value: "Generic captured page text" },
  }]
  const report = reconcileSource(value)
  assert.equal(report.sourceSummary.exactBodies, 0)
  assert.equal(report.sourceSummary.excerptBodies, 1)
  assert.equal(report.participantProjects[0].status, "partial")
  assert.equal(report.participantProjects[0].reasons.some((item) => item.code === "body_excerpt_only"), true)
  assert.equal(JSON.stringify(report).includes("Generic captured page text"), false)
})

test("holds unproven identity, entitlement, or project mapping instead of granting access", () => {
  const value = source()
  value.projects = [{ sourceProjectId: "job-1", canonicalProjectId: "project-1", mappingStatus: "uncertain" }]
  value.participantProjects[0].participant = person("owner-1", "uncertain")
  value.participantProjects[0].projectEntitlementEvidence = { status: "uncertain" }
  const report = reconcileSource(value)
  assert.equal(report.participantProjects[0].status, "held")
  assert.deepEqual(report.participantProjects[0].reasons.map((item) => item.code).slice(0, 3), [
    "project_mapping_unproven",
    "participant_identity_unproven",
    "project_entitlement_unproven",
  ])
})

test("holds incomplete recipients and attachments while retaining evidence counts", () => {
  const value = source()
  value.messages = [{
    ...value.messages[0],
    recipientEvidence: { status: "missing", to: [], cc: [], bcc: [] },
  }]
  value.attachments = [attachment("file-1", "message-1", "partial")]
  const report = reconcileSource(value)
  assert.equal(report.participantProjects[0].status, "partial")
  assert.equal(report.sourceSummary.uncertainOrMissingRecipientMessages, 1)
  assert.equal(report.sourceSummary.verifiedAttachments, 0)
  assert.equal(report.evidenceGaps.some((item) => item.code === "original_recipients_incomplete"), true)
  assert.equal(report.evidenceGaps.some((item) => item.code === "attachment_recovery_incomplete"), true)
})

test("rejects duplicate or malformed source IDs and cross-record references", () => {
  assert.throws(() => normalizeSource(source({
    messages: [source().messages[0], { ...source().messages[0], sourceMessageId: "message-1" }],
  })), /duplicate sourceMessageId/)
  assert.throws(() => normalizeSource(source({
    messages: [{ ...source().messages[0], sourceMessageId: "message 1" }],
  })), /not a valid stable source ID/)
  assert.throws(() => normalizeSource(source({
    messages: [{ ...source().messages[0], sourceProjectId: "job-2" }],
  })), /project does not match its conversation/)
  assert.throws(() => normalizeSource(source({
    messages: [{ ...source().messages[0], sourceAttachmentIds: ["unknown-file"] }],
  })), /references unknown sourceAttachmentId/)
})

test("reads legacy exactSource and preview fields with their safe body classifications", () => {
  const value = source({
    messages: [
      {
        ...source().messages[0],
        bodyEvidence: undefined,
        exactSource: { exactBody: "Legacy exact body" },
      },
    ],
  })
  assert.equal(normalizeSource(value).messages[0].body.kind, "exact")
  value.messages[0].exactSource = undefined
  value.messages[0].preview = "Register preview"
  assert.equal(normalizeSource(value).messages[0].body.kind, "excerpt")
})
