import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"

const SCHEMA_VERSION = "buildertrend-correspondence-evidence/v1"
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/\-]*$/
const HEX_SHA256 = /^[a-f0-9]{64}$/i
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

function fail(message) {
  throw new Error(`Invalid Buildertrend correspondence source: ${message}`)
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  return value
}

function string(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`)
  return value.trim()
}

function id(value, label) {
  const result = string(value, label)
  if (!ID_PATTERN.test(result) || /[\u0000-\u001f\u007f\s]/.test(result)) fail(`${label} is not a valid stable source ID`)
  return result
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null
  return id(value, label)
}

function status(value, allowed, label) {
  const result = string(value, label)
  if (!allowed.includes(result)) fail(`${label} must be one of ${allowed.join(", ")}`)
  return result
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function iso(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null
  const result = string(value, label)
  const date = new Date(result)
  if (!ISO_TIMESTAMP.test(result) || Number.isNaN(date.getTime())) fail(`${label} must be an ISO-8601 timestamp with an explicit timezone`)
  return date.toISOString()
}

function unique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label} ${value}`)
    seen.add(value)
  }
}

function sourceIdentity(value, label) {
  const item = object(value, label)
  const sourceParticipantId = id(item.sourceParticipantId, `${label}.sourceParticipantId`)
  const evidence = item.evidence ?? item.identityEvidence
  const evidenceObject = object(evidence, `${label}.evidence`)
  const evidenceStatus = status(evidenceObject.status, ["proven", "uncertain", "missing"], `${label}.evidence.status`)
  return {
    sourceParticipantId,
    evidenceStatus,
    // Names and addresses are deliberately not returned. They cannot grant access
    // and retaining them in an inventory would make Bcc leakage easy.
  }
}

function bodyEvidence(message, label) {
  const explicit = message.bodyEvidence
  if (explicit !== undefined) {
    const body = object(explicit, `${label}.bodyEvidence`)
    const kind = status(body.kind, ["exact", "excerpt", "missing"], `${label}.bodyEvidence.kind`)
    if (kind === "missing") return { kind, body: null, sha256: null }
    const value = string(body.value, `${label}.bodyEvidence.value`)
    const digest = body.sha256 === undefined ? null : string(body.sha256, `${label}.bodyEvidence.sha256`)
    if (digest !== null && !HEX_SHA256.test(digest)) fail(`${label}.bodyEvidence.sha256 is not SHA-256`)
    if (digest !== null && digest.toLowerCase() !== sha256(value)) fail(`${label}.bodyEvidence.sha256 does not match body evidence`)
    return { kind, body: value, sha256: sha256(value) }
  }

  // Existing Buildertrend artifacts use exactSource.exactBody for the rare exact
  // capture and preview/fullText for generic register or page text. Keep that
  // distinction explicit when reading legacy evidence.
  const exactSource = message.exactSource
  if (exactSource !== undefined) {
    const source = object(exactSource, `${label}.exactSource`)
    if (source.exactBody !== undefined) {
      const value = string(source.exactBody, `${label}.exactSource.exactBody`)
      return { kind: "exact", body: value, sha256: sha256(value) }
    }
  }
  if (message.preview !== undefined || message.fullText !== undefined || message.pageText !== undefined) {
    const value = message.preview ?? message.fullText ?? message.pageText
    if (typeof value !== "string") fail(`${label}.preview/fullText/pageText must be a string`)
    return value.trim() === "" ? { kind: "missing", body: null, sha256: null } : { kind: "excerpt", body: value, sha256: sha256(value) }
  }
  return { kind: "missing", body: null, sha256: null }
}

function recipientEvidence(message, label) {
  const input = message.recipientEvidence ?? message.recipientsEvidence
  if (input === undefined) return { status: "missing", to: [], cc: [], bcc: [] }
  const item = object(input, `${label}.recipientEvidence`)
  const evidenceStatus = status(item.status, ["proven", "uncertain", "missing"], `${label}.recipientEvidence.status`)
  const parse = (role) => array(item[role] ?? [], `${label}.recipientEvidence.${role}`).map((entry, index) => sourceIdentity(entry, `${label}.recipientEvidence.${role}[${index}]`))
  const to = parse("to")
  const cc = parse("cc")
  const bcc = parse("bcc")
  if (evidenceStatus === "proven" && to.length + cc.length + bcc.length === 0) fail(`${label}.recipientEvidence.proven cannot have no recipients`)
  return { status: evidenceStatus, to, cc, bcc }
}

function threadEvidence(message, label) {
  const input = message.threadEvidence
  if (input === undefined) return { status: "missing", sourceThreadId: null, parentSourceMessageId: null }
  const item = object(input, `${label}.threadEvidence`)
  const evidenceStatus = status(item.status, ["proven", "uncertain", "missing"], `${label}.threadEvidence.status`)
  const sourceThreadId = optionalId(item.sourceThreadId, `${label}.threadEvidence.sourceThreadId`)
  const parentSourceMessageId = optionalId(item.parentSourceMessageId, `${label}.threadEvidence.parentSourceMessageId`)
  if (evidenceStatus === "proven" && sourceThreadId === null) fail(`${label}.threadEvidence.proven requires sourceThreadId`)
  return { status: evidenceStatus, sourceThreadId, parentSourceMessageId }
}

function attachmentEvidence(value, label) {
  const item = object(value, label)
  const sourceAttachmentId = id(item.sourceAttachmentId, `${label}.sourceAttachmentId`)
  const sourceMessageId = id(item.sourceMessageId, `${label}.sourceMessageId`)
  const transfer = item.transferEvidence ?? item.transfer
  const transferObject = object(transfer, `${label}.transferEvidence`)
  const transferStatus = status(transferObject.status, ["verified", "partial", "missing", "unavailable"], `${label}.transferEvidence.status`)
  const digest = transferObject.sha256 === undefined ? null : string(transferObject.sha256, `${label}.transferEvidence.sha256`)
  if (digest !== null && !HEX_SHA256.test(digest)) fail(`${label}.transferEvidence.sha256 is not SHA-256`)
  const sizeBytes = transferObject.sizeBytes === undefined ? null : transferObject.sizeBytes
  if (sizeBytes !== null && (!Number.isInteger(sizeBytes) || sizeBytes < 0)) fail(`${label}.transferEvidence.sizeBytes must be a non-negative integer`)
  if (transferStatus === "verified" && (digest === null || sizeBytes === null)) fail(`${label}.verified attachment requires sha256 and sizeBytes`)
  return {
    sourceAttachmentId,
    sourceMessageId,
    sourceProjectId: optionalId(item.sourceProjectId, `${label}.sourceProjectId`),
    transferStatus,
    sha256: digest?.toLowerCase() ?? null,
    sizeBytes,
  }
}

function normalizeSource(input) {
  const root = object(input, "source")
  const sourceAccountId = id(root.sourceAccountId, "source.sourceAccountId")
  const capturedAt = iso(root.capturedAt, "source.capturedAt", { optional: true })
  const projects = array(root.projects ?? [], "source.projects").map((value, index) => {
    const item = object(value, `source.projects[${index}]`)
    return {
      sourceProjectId: id(item.sourceProjectId, `source.projects[${index}].sourceProjectId`),
      canonicalProjectId: optionalId(item.canonicalProjectId, `source.projects[${index}].canonicalProjectId`),
      mappingStatus: status(item.mappingStatus ?? (item.canonicalProjectId ? "proven" : "missing"), ["proven", "uncertain", "missing"], `source.projects[${index}].mappingStatus`),
    }
  })
  unique(projects.map((item) => item.sourceProjectId), "sourceProjectId")
  const projectById = new Map(projects.map((item) => [item.sourceProjectId, item]))

  const conversations = array(root.conversations ?? [], "source.conversations").map((value, index) => {
    const item = object(value, `source.conversations[${index}]`)
    return {
      sourceConversationId: id(item.sourceConversationId, `source.conversations[${index}].sourceConversationId`),
      sourceProjectId: id(item.sourceProjectId, `source.conversations[${index}].sourceProjectId`),
      subject: string(item.subject, `source.conversations[${index}].subject`),
    }
  })
  unique(conversations.map((item) => item.sourceConversationId), "sourceConversationId")
  const conversationById = new Map(conversations.map((item) => [item.sourceConversationId, item]))

  const messages = array(root.messages ?? [], "source.messages").map((value, index) => {
    const item = object(value, `source.messages[${index}]`)
    const label = `source.messages[${index}]`
    const sourceMessageId = id(item.sourceMessageId, `${label}.sourceMessageId`)
    const sourceConversationId = id(item.sourceConversationId, `${label}.sourceConversationId`)
    const sourceProjectId = id(item.sourceProjectId, `${label}.sourceProjectId`)
    const sender = sourceIdentity(item.sender, `${label}.sender`)
    const body = bodyEvidence(item, label)
    const recipients = recipientEvidence(item, label)
    const thread = threadEvidence(item, label)
    return {
      sourceMessageId,
      sourceConversationId,
      sourceProjectId,
      createdAt: iso(item.createdAt, `${label}.createdAt`, { optional: true }),
      sender,
      body,
      recipients,
      thread,
      sourceAttachmentIds: array(item.sourceAttachmentIds ?? [], `${label}.sourceAttachmentIds`).map((attachmentId, attachmentIndex) => id(attachmentId, `${label}.sourceAttachmentIds[${attachmentIndex}]`)),
    }
  })
  unique(messages.map((item) => item.sourceMessageId), "sourceMessageId")

  const attachments = array(root.attachments ?? [], "source.attachments").map((value, index) => attachmentEvidence(value, `source.attachments[${index}]`))
  unique(attachments.map((item) => item.sourceAttachmentId), "sourceAttachmentId")
  const attachmentById = new Map(attachments.map((item) => [item.sourceAttachmentId, item]))

  const expectations = array(root.participantProjects ?? root.participantProjectExpectations ?? [], "source.participantProjects").map((value, index) => {
    const item = object(value, `source.participantProjects[${index}]`)
    const label = `source.participantProjects[${index}]`
    const participant = sourceIdentity(item.participant, `${label}.participant`)
    const sourceProjectId = id(item.sourceProjectId, `${label}.sourceProjectId`)
    const entitlement = object(item.projectEntitlementEvidence ?? item.entitlementEvidence, `${label}.projectEntitlementEvidence`)
    const entitlementStatus = status(entitlement.status, ["proven", "uncertain", "missing"], `${label}.projectEntitlementEvidence.status`)
    const expectedSourceMessageIds = array(item.expectedSourceMessageIds ?? [], `${label}.expectedSourceMessageIds`).map((value, messageIndex) => id(value, `${label}.expectedSourceMessageIds[${messageIndex}]`))
    const expectedSourceAttachmentIds = array(item.expectedSourceAttachmentIds ?? [], `${label}.expectedSourceAttachmentIds`).map((value, attachmentIndex) => id(value, `${label}.expectedSourceAttachmentIds[${attachmentIndex}]`))
    unique(expectedSourceMessageIds, `${label}.expectedSourceMessageIds`)
    unique(expectedSourceAttachmentIds, `${label}.expectedSourceAttachmentIds`)
    return { participant, sourceProjectId, entitlementStatus, expectedSourceMessageIds, expectedSourceAttachmentIds }
  })
  unique(expectations.map((item) => `${item.participant.sourceParticipantId}\u0000${item.sourceProjectId}`), "participant/project expectation")

  for (const conversation of conversations) {
    if (!projectById.has(conversation.sourceProjectId)) fail(`conversation ${conversation.sourceConversationId} references unknown sourceProjectId`)
  }
  for (const message of messages) {
    const conversation = conversationById.get(message.sourceConversationId)
    if (!conversation) fail(`message ${message.sourceMessageId} references unknown sourceConversationId`)
    if (conversation.sourceProjectId !== message.sourceProjectId) fail(`message ${message.sourceMessageId} project does not match its conversation`)
    if (message.thread.parentSourceMessageId !== null) {
      const parent = messages.find((candidate) => candidate.sourceMessageId === message.thread.parentSourceMessageId)
      if (!parent) fail(`message ${message.sourceMessageId} references unknown parentSourceMessageId`)
      if (parent.sourceConversationId !== message.sourceConversationId || parent.sourceProjectId !== message.sourceProjectId) fail(`message ${message.sourceMessageId} parent does not match its conversation and project`)
    }
    for (const attachmentId of message.sourceAttachmentIds) {
      const attachment = attachmentById.get(attachmentId)
      if (!attachment) fail(`message ${message.sourceMessageId} references unknown sourceAttachmentId ${attachmentId}`)
      if (attachment.sourceMessageId !== message.sourceMessageId) fail(`attachment ${attachmentId} does not point back to its message`)
      if (attachment.sourceProjectId !== null && attachment.sourceProjectId !== message.sourceProjectId) fail(`attachment ${attachmentId} project does not match its message`)
    }
  }
  for (const expectation of expectations) {
    if (!projectById.has(expectation.sourceProjectId)) fail(`participant/project expectation references unknown sourceProjectId ${expectation.sourceProjectId}`)
    for (const messageId of expectation.expectedSourceMessageIds) if (!messages.some((message) => message.sourceMessageId === messageId)) fail(`expectation references unknown sourceMessageId ${messageId}`)
    for (const attachmentId of expectation.expectedSourceAttachmentIds) if (!attachmentById.has(attachmentId)) fail(`expectation references unknown sourceAttachmentId ${attachmentId}`)
  }
  return { sourceAccountId, capturedAt, projects, conversations, messages, attachments, expectations }
}

function hasParticipant(message, sourceParticipantId) {
  return (message.sender.sourceParticipantId === sourceParticipantId && message.sender.evidenceStatus === "proven") ||
    message.recipients.to.some((item) => item.sourceParticipantId === sourceParticipantId && item.evidenceStatus === "proven") ||
    message.recipients.cc.some((item) => item.sourceParticipantId === sourceParticipantId && item.evidenceStatus === "proven") ||
    message.recipients.bcc.some((item) => item.sourceParticipantId === sourceParticipantId && item.evidenceStatus === "proven")
}

function reason(code, detail) {
  return { code, detail }
}

function reconcileSource(input) {
  const source = normalizeSource(input)
  const projectById = new Map(source.projects.map((item) => [item.sourceProjectId, item]))
  const attachmentById = new Map(source.attachments.map((item) => [item.sourceAttachmentId, item]))
  const messageById = new Map(source.messages.map((item) => [item.sourceMessageId, item]))

  const participantProjects = source.expectations.map((expectation) => {
    const reasons = []
    const project = projectById.get(expectation.sourceProjectId)
    if (project?.mappingStatus !== "proven" || project.canonicalProjectId === null) reasons.push(reason("project_mapping_unproven", "A source project alias does not have a proven canonical project mapping."))
    if (expectation.participant.evidenceStatus !== "proven") reasons.push(reason("participant_identity_unproven", "Participant identity is not proven by a stable source identity mapping."))
    if (expectation.entitlementStatus !== "proven") reasons.push(reason("project_entitlement_unproven", "Project entitlement is not proven for this exact participant identity."))

    let exactBodies = 0
    let visibleMessages = 0
    let threadProven = 0
    let missingMessages = 0
    let heldMessages = 0
    let expectedAttachmentCount = expectation.expectedSourceAttachmentIds.length
    let verifiedAttachments = 0
    const messageReasons = []
    for (const sourceMessageId of expectation.expectedSourceMessageIds) {
      const message = messageById.get(sourceMessageId)
      if (!message) {
        missingMessages += 1
        messageReasons.push(reason("expected_message_missing", `Expected source message ${sourceMessageId} is absent from the capture.`))
        continue
      }
      if (message.sourceProjectId !== expectation.sourceProjectId) {
        heldMessages += 1
        messageReasons.push(reason("message_project_mismatch", `Message ${sourceMessageId} is mapped to a different source project.`))
      }
      if (hasParticipant(message, expectation.participant.sourceParticipantId) && message.recipients.status === "proven") visibleMessages += 1
      else {
        heldMessages += 1
        messageReasons.push(reason("participant_visibility_unproven", `Source visibility for ${sourceMessageId} does not prove this participant can see it.`))
      }
      if (message.sender.evidenceStatus !== "proven") messageReasons.push(reason("sender_identity_unproven", `Original sender evidence for ${sourceMessageId} is not proven.`))
      if (message.body.kind === "exact") exactBodies += 1
      else messageReasons.push(reason(message.body.kind === "excerpt" ? "body_excerpt_only" : "body_missing", `Message ${sourceMessageId} has no exact source body.`))
      if (message.thread.status === "proven") threadProven += 1
      else messageReasons.push(reason("threading_unproven", `Message ${sourceMessageId} has no proven source thread relationship.`))
    }
    for (const sourceAttachmentId of expectation.expectedSourceAttachmentIds) {
      const attachment = attachmentById.get(sourceAttachmentId)
      if (attachment?.transferStatus === "verified") verifiedAttachments += 1
      else reasons.push(reason("attachment_incomplete", `Expected source attachment ${sourceAttachmentId} has not been byte-verified.`))
    }
    reasons.push(...messageReasons)
    const bodyComplete = exactBodies === expectation.expectedSourceMessageIds.length
    const messagesComplete = missingMessages === 0 && heldMessages === 0 && visibleMessages === expectation.expectedSourceMessageIds.length
    const attachmentsComplete = verifiedAttachments === expectedAttachmentCount
    let disposition = "ready"
    if (reasons.some((item) => ["participant_identity_unproven", "project_entitlement_unproven", "project_mapping_unproven"].includes(item.code))) disposition = "held"
    else if (!bodyComplete || !messagesComplete || !attachmentsComplete || threadProven !== expectation.expectedSourceMessageIds.length) disposition = "partial"
    return {
      participantId: expectation.participant.sourceParticipantId,
      sourceProjectId: expectation.sourceProjectId,
      canonicalProjectId: project?.canonicalProjectId ?? null,
      status: disposition,
      expectedMessages: expectation.expectedSourceMessageIds.length,
      visibleMessages,
      exactBodies,
      expectedAttachments: expectedAttachmentCount,
      verifiedAttachments,
      provenThreads: threadProven,
      reasons,
    }
  })

  const exactBodies = source.messages.filter((item) => item.body.kind === "exact").length
  const excerptBodies = source.messages.filter((item) => item.body.kind === "excerpt").length
  const missingBodies = source.messages.filter((item) => item.body.kind === "missing").length
  const provenRecipients = source.messages.filter((item) => item.recipients.status === "proven").length
  const bccEvidenceMessages = source.messages.filter((item) => item.recipients.bcc.length > 0).length
  const provenThreads = source.messages.filter((item) => item.thread.status === "proven").length
  const verifiedAttachments = source.attachments.filter((item) => item.transferStatus === "verified").length
  const held = participantProjects.filter((item) => item.status === "held").length
  const partial = participantProjects.filter((item) => item.status === "partial").length
  const ready = participantProjects.filter((item) => item.status === "ready").length
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceAccountId: source.sourceAccountId,
    capturedAt: source.capturedAt,
    sourceSummary: {
      projects: source.projects.length,
      provenProjectMappings: source.projects.filter((item) => item.mappingStatus === "proven").length,
      conversations: source.conversations.length,
      messages: source.messages.length,
      exactBodies,
      excerptBodies,
      missingBodies,
      provenRecipientMessages: provenRecipients,
      uncertainOrMissingRecipientMessages: source.messages.length - provenRecipients,
      bccEvidenceMessages,
      bccIdentitiesExposed: false,
      provenThreadMessages: provenThreads,
      attachments: source.attachments.length,
      verifiedAttachments,
      participantProjects: participantProjects.length,
      ready,
      partial,
      held,
      completenessClaim: "not_certified",
    },
    participantProjects,
    evidenceGaps: [
      ...(source.expectations.length === 0 ? [reason("expected_inventory_missing", "No participant/project expected inventory was supplied; completeness cannot be certified.")] : []),
      ...(source.messages.some((item) => item.recipients.status !== "proven") ? [reason("original_recipients_incomplete", "Original To/Cc/Bcc evidence is incomplete for one or more captured messages.")] : []),
      ...(source.messages.some((item) => item.thread.status !== "proven") ? [reason("threading_incomplete", "Source conversation or reply relationships are incomplete for one or more captured messages.")] : []),
      ...(source.messages.some((item) => item.body.kind !== "exact") ? [reason("body_recovery_incomplete", "Excerpt/page text is retained as evidence but is not an exact message body.")] : []),
      ...(source.attachments.some((item) => item.transferStatus !== "verified") ? [reason("attachment_recovery_incomplete", "One or more source attachments lack verified preserved bytes.")] : []),
    ],
    safety: {
      mode: "offline_inventory_only",
      productionReads: false,
      productionWrites: false,
      identityGrants: false,
      notificationsSent: false,
      bccIdentitiesIncluded: false,
      bodyTextIncluded: false,
      fuzzyMatchingUsed: false,
    },
  }
}

export { normalizeSource, reconcileSource }

async function main() {
  const [inputPath, outputPath, ...unexpected] = process.argv.slice(2)
  if (!inputPath || !outputPath || unexpected.length > 0) throw new Error("Usage: node scripts/build-buildertrend-correspondence-evidence.mjs <source.json> <evidence-report.json>")
  const input = JSON.parse(await readFile(inputPath, "utf8"))
  const report = reconcileSource(input)
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(JSON.stringify({ input: basename(inputPath), outputPath, ...report.sourceSummary }))
}

if (typeof process.argv[1] === "string" && process.argv[1].endsWith("build-buildertrend-correspondence-evidence.mjs")) await main()
