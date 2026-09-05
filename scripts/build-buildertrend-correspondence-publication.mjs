import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const SCHEMA_VERSION = "buildertrend-correspondence-publication-manifest/v1"
const PACKAGE_VERSION = "buildertrend-correspondence-publication-rehearsal/v1"
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/\-]*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const ROLES = ["staff", "owner", "sub_vendor"]

function invalid(message) {
  throw new Error(`Invalid Buildertrend correspondence publication manifest: ${message}`)
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`)
  return value
}

function list(value, label) {
  if (!Array.isArray(value)) invalid(`${label} must be an array`)
  return value
}

function text(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) invalid(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}`)
  return allowEmpty ? value : value.trim()
}

function id(value, label) {
  const result = text(value, label)
  if (!ID_PATTERN.test(result) || /[\u0000-\u001f\u007f\s]/.test(result)) invalid(`${label} must be a stable source ID`)
  return result
}

function optionalId(value, label) {
  if (value === null || value === undefined || value === "") return null
  return id(value, label)
}

function iso(value, label) {
  const result = text(value, label)
  if (!ISO_TIMESTAMP_PATTERN.test(result) || Number.isNaN(new Date(result).getTime())) invalid(`${label} must be an ISO-8601 timestamp with an explicit timezone`)
  return new Date(result).toISOString()
}

function oneOf(value, values, label) {
  const result = text(value, label)
  if (!values.includes(result)) invalid(`${label} must be one of ${values.join(", ")}`)
  return result
}

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function sql(value) {
  if (value === null) return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

function stableJson(value) {
  return JSON.stringify(value)
}

function unique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) invalid(`duplicate ${label} ${value}`)
    seen.add(value)
  }
}

function participant(value, label) {
  const item = object(value, label)
  const role = oneOf(item.role, ROLES, `${label}.role`)
  return {
    userId: id(item.userId, `${label}.userId`),
    name: text(item.name, `${label}.name`),
    email: text(item.email, `${label}.email`),
    role,
    identityEvidence: oneOf(item.identityEvidence?.status ?? item.identityStatus, ["proven"], `${label}.identityEvidence.status`),
    entitlementEvidence: oneOf(item.entitlementEvidence?.status ?? item.projectEntitlementStatus, ["proven"], `${label}.entitlementEvidence.status`),
  }
}

function attachment(value, label, messageId, projectId) {
  const item = object(value, label)
  const driveFileId = text(item.driveFileId, `${label}.driveFileId`)
  if (!/^[A-Za-z0-9_-]+$/.test(driveFileId) || driveFileId.includes("http")) invalid(`${label}.driveFileId must be a restricted Drive file ID, not a URL`)
  const sizeBytes = item.sizeBytes ?? item.size
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) invalid(`${label}.sizeBytes must be a non-negative integer`)
  const verification = item.byteVerification ?? item.transferEvidence?.status
  if (verification !== "verified") invalid(`${label} requires byteVerification=verified`)
  const sourceSha256 = item.sourceSha256 ?? item.sha256
  if (sourceSha256 !== undefined && (!text(sourceSha256, `${label}.sourceSha256`) || !SHA256_PATTERN.test(sourceSha256))) invalid(`${label}.sourceSha256 must be SHA-256`)
  return {
    sourceAttachmentId: id(item.sourceAttachmentId, `${label}.sourceAttachmentId`),
    sourceMessageId: messageId,
    sourceProjectId: projectId,
    ownerUserId: id(item.ownerUserId, `${label}.ownerUserId`),
    name: text(item.name, `${label}.name`),
    contentType: text(item.contentType ?? item.mimeType, `${label}.contentType`),
    size: sizeBytes,
    driveFileId,
    sourceSha256: sourceSha256?.toLowerCase() ?? null,
  }
}

function grant(value, label, participantIds) {
  const item = object(value, label)
  const kind = oneOf(item.kind, ["author", "to", "cc", "bcc"], `${label}.kind`)
  if (kind === "bcc") invalid(`${label}.kind=bcc is held; first phase does not publish Bcc messages`)
  const userId = id(item.userId, `${label}.userId`)
  if (!participantIds.has(userId)) invalid(`${label}.userId ${userId} is not a current conversation participant`)
  if ((item.evidence?.status ?? item.evidenceStatus) !== "proven") invalid(`${label} requires proven account grant evidence`)
  return { userId, name: text(item.name, `${label}.name`), kind }
}

function normalizeManifest(input) {
  const root = object(input, "manifest")
  if (root.schemaVersion !== SCHEMA_VERSION) invalid(`schemaVersion must be ${SCHEMA_VERSION}`)
  const reviewed = object(root.reviewed, "manifest.reviewed")
  const referenceHash = text(reviewed.referenceHash, "manifest.reviewed.referenceHash")
  if (!SHA256_PATTERN.test(referenceHash)) invalid("manifest.reviewed.referenceHash must be SHA-256")
  if (reviewed.identityEntitlementsProven !== true) invalid("identityEntitlementsProven must be true")
  if (reviewed.quoteReview !== "complete") invalid("quoteReview must be complete")
  const sourceAccountId = id(root.sourceAccountId, "manifest.sourceAccountId")
  const organizationId = id(root.organizationId, "manifest.organizationId")
  const publicationId = id(root.publicationId, "manifest.publicationId")
  const projectInput = object(root.project, "manifest.project")
  if ((projectInput.mappingEvidence?.status ?? projectInput.mappingStatus) !== "proven") invalid("project mapping must be proven")
  const project = {
    projectId: id(projectInput.projectId, "manifest.project.projectId"),
    sourceProjectId: id(projectInput.sourceProjectId, "manifest.project.sourceProjectId"),
  }
  const conversations = list(root.conversations, "manifest.conversations").map((conversationValue, conversationIndex) => {
    const conversationInput = object(conversationValue, `manifest.conversations[${conversationIndex}]`)
    const conversationLabel = `manifest.conversations[${conversationIndex}]`
    const sourceThreadId = id(conversationInput.sourceThreadId, `${conversationLabel}.sourceThreadId`)
    const participants = list(conversationInput.participants, `${conversationLabel}.participants`).map((value, index) => participant(value, `${conversationLabel}.participants[${index}]`))
    unique(participants.map((item) => item.userId), `${conversationLabel}.participant userId`)
    const participantIds = new Set(participants.map((item) => item.userId))
    const messages = list(conversationInput.messages, `${conversationLabel}.messages`).map((messageValue, messageIndex) => {
      const messageInput = object(messageValue, `${conversationLabel}.messages[${messageIndex}]`)
      const messageLabel = `${conversationLabel}.messages[${messageIndex}]`
      if (messageInput.exactBody === undefined || typeof messageInput.exactBody !== "string") invalid(`${messageLabel}.exactBody is required and must be the full exact body`)
      if (messageInput.excerpt !== undefined || messageInput.pageText !== undefined || messageInput.preview !== undefined) invalid(`${messageLabel} contains excerpt/page text; hold the message until exactBody is recovered`)
      if ((messageInput.senderEvidence?.status ?? messageInput.senderStatus) !== "proven") invalid(`${messageLabel} sender evidence must be proven`)
      const messageSourceThreadId = id(messageInput.sourceThreadId ?? sourceThreadId, `${messageLabel}.sourceThreadId`)
      if (messageSourceThreadId !== sourceThreadId) invalid(`${messageLabel}.sourceThreadId does not match its conversation`)
      const grants = list(messageInput.grants, `${messageLabel}.grants`).map((value, index) => grant(value, `${messageLabel}.grants[${index}]`, participantIds))
      unique(grants.map((item) => item.userId), `${messageLabel}.grant userId`)
      if (grants.length === 0) invalid(`${messageLabel}.grants must contain at least one proven account grant`)
      if (Object.hasOwn(messageInput, "bcc") || grants.some((item) => item.kind === "bcc")) invalid(`${messageLabel} contains Bcc evidence; hold the whole message`)
      const sourceMessageId = id(messageInput.sourceMessageId, `${messageLabel}.sourceMessageId`)
      const attachments = list(messageInput.attachments ?? [], `${messageLabel}.attachments`).map((value, index) => attachment(value, `${messageLabel}.attachments[${index}]`, sourceMessageId, project.projectId))
      unique(attachments.map((item) => item.sourceAttachmentId), `${messageLabel}.attachment source ID`)
      for (const item of attachments) if (!participantIds.has(item.ownerUserId)) invalid(`${messageLabel} attachment owner must be a current participant`)
      const messageSourceAccountId = id(messageInput.sourceAccountId ?? sourceAccountId, `${messageLabel}.sourceAccountId`)
      if (messageSourceAccountId !== sourceAccountId) invalid(`${messageLabel}.sourceAccountId does not match the reviewed source account`)
      return {
        sourceMessageId,
        sourceThreadId,
        sourceAccountId: messageSourceAccountId,
        body: messageInput.exactBody,
        authorName: text(messageInput.authorName, `${messageLabel}.authorName`),
        authorUserId: optionalId(messageInput.authorUserId, `${messageLabel}.authorUserId`),
        sentAt: iso(messageInput.sentAt, `${messageLabel}.sentAt`),
        grants,
        attachments,
      }
    })
    unique(messages.map((item) => item.sourceMessageId), `${conversationLabel}.sourceMessageId`)
    for (const message of messages) if (message.authorUserId !== null && !participantIds.has(message.authorUserId)) invalid(`${conversationLabel} authorUserId ${message.authorUserId} is not a current participant`)
    return {
      sourceThreadId,
      subject: text(conversationInput.subject, `${conversationLabel}.subject`),
      createdAt: iso(conversationInput.createdAt, `${conversationLabel}.createdAt`),
      participants,
      messages,
    }
  })
  unique(conversations.map((item) => item.sourceThreadId), "sourceThreadId")
  const messageKeys = conversations.flatMap((conversation) => conversation.messages.map((message) => `${message.sourceAccountId}\u0000${message.sourceMessageId}`))
  unique(messageKeys, "source account/message")
  return { publicationId, organizationId, sourceAccountId, project, reviewed: { reviewerId: id(reviewed.reviewerId, "manifest.reviewed.reviewerId"), reviewedAt: iso(reviewed.reviewedAt, "manifest.reviewed.reviewedAt"), referenceHash: referenceHash.toLowerCase() }, conversations }
}

function conversationId(sourceAccountId, sourceThreadId) {
  return `bt-correspondence-${hash(`${sourceAccountId}\u0000${sourceThreadId}`).slice(0, 32)}`
}

function messageId(sourceAccountId, sourceMessageId) {
  return `bt-correspondence-message-${hash(`${sourceAccountId}\u0000${sourceMessageId}`).slice(0, 32)}`
}

function attachmentId(sourceAccountId, sourceAttachmentId) {
  return `bt-correspondence-attachment-${hash(`${sourceAccountId}\u0000${sourceAttachmentId}`).slice(0, 32)}`
}

function sourceKey(sourceAccountId, sourceMessageId) {
  return `buildertrend:${hash(stableJson([sourceAccountId, sourceMessageId]))}`
}

function participantRows(manifest, conversation) {
  return conversation.participants.map((item) => [conversationId(manifest.sourceAccountId, conversation.sourceThreadId), item])
}

function expectedParticipantChecks(manifest, conversation) {
  return conversation.participants.map((item) => {
    const roleCheck = item.role === "owner" ? "pm.role IN ('owner','client')" : item.role === "sub_vendor" ? "pm.role IN ('supplier','subcontractor')" : "om.role NOT IN ('owner','client','supplier','subcontractor','guest')"
    return `EXISTS (SELECT 1 FROM users u JOIN organization_members om ON om.user_id=u.id JOIN project_members pm ON pm.user_id=u.id WHERE u.id=${sql(item.userId)} AND u.is_active=1 AND u.email=${sql(item.email)} AND COALESCE(u.display_name,'')=${sql(item.name)} AND om.organization_id=${sql(manifest.organizationId)} AND pm.project_id=${sql(manifest.project.projectId)} AND ${roleCheck})`
  })
}

function messageRows(manifest) {
  return manifest.conversations.flatMap((conversation) => conversation.messages.map((message) => ({ conversation, message, conversationId: conversationId(manifest.sourceAccountId, conversation.sourceThreadId), messageId: messageId(message.sourceAccountId, message.sourceMessageId), sourceKey: sourceKey(message.sourceAccountId, message.sourceMessageId), requestHash: hash(stableJson({ sourceAccountId: message.sourceAccountId, sourceMessageId: message.sourceMessageId, sourceThreadId: message.sourceThreadId, body: message.body, authorName: message.authorName, authorUserId: message.authorUserId, sentAt: message.sentAt, grants: message.grants, attachments: message.attachments.map((item) => ({ sourceAttachmentId: item.sourceAttachmentId, driveFileId: item.driveFileId, size: item.size })) })), })))
}

function expectedMessageRowsCte(rows) {
  return rows.map((row) => `(${[row.messageId, row.conversationId, row.sourceKey, row.message.body, row.message.authorName, row.message.authorUserId, row.message.sentAt, row.requestHash].map(sql).join(",")})`).join(",\n")
}

function buildGuard(manifest, rows) {
  const projectCheck = `EXISTS (SELECT 1 FROM projects p WHERE p.id=${sql(manifest.project.projectId)} AND p.organization_id=${sql(manifest.organizationId)})`
  const participantChecks = manifest.conversations.flatMap((conversation) => expectedParticipantChecks(manifest, conversation)).join(" AND ") || "1=1"
  const conversationChecks = manifest.conversations.map((conversation) => {
    const idValue = conversationId(manifest.sourceAccountId, conversation.sourceThreadId)
    return `NOT EXISTS (SELECT 1 FROM project_correspondence c WHERE c.id=${sql(idValue)} AND NOT (c.organization_id=${sql(manifest.organizationId)} AND c.project_id=${sql(manifest.project.projectId)} AND c.subject=${sql(conversation.subject)} AND c.participant_version=1))`
  }).join(" AND ") || "1=1"
  const existingParticipantChecks = manifest.conversations.flatMap((conversation) => conversation.participants.map((item) => {
    const idValue = conversationId(manifest.sourceAccountId, conversation.sourceThreadId)
    return `NOT EXISTS (SELECT 1 FROM correspondence_participants p WHERE p.conversation_id=${sql(idValue)} AND p.user_id=${sql(item.userId)} AND NOT (p.name=${sql(item.name)} AND p.email=${sql(item.email)} AND p.role=${sql(item.role)} AND p.revoked_at IS NULL))`
  })).join(" AND ") || "1=1"
  const messageIdentity = rows.map((row) => `NOT EXISTS (SELECT 1 FROM correspondence_messages m WHERE m.source_key=${sql(row.sourceKey)} AND NOT (m.id=${sql(row.messageId)} AND m.conversation_id=${sql(row.conversationId)} AND m.source='buildertrend' AND m.body=${sql(row.message.body)} AND m.author_name=${sql(row.message.authorName)} AND ${row.message.authorUserId === null ? "m.author_user_id IS NULL" : `m.author_user_id=${sql(row.message.authorUserId)}`} AND m.sent_at=${sql(row.message.sentAt)} AND m.request_hash=${sql(row.requestHash)}))`).join(" AND ") || "1=1"
  const grantChecks = rows.map((row) => {
    const allowed = row.message.grants.map((grantValue) => `(r.user_id=${sql(grantValue.userId)} AND r.name=${sql(grantValue.name)} AND r.kind=${sql(grantValue.kind)} AND r.baseline=1 AND r.opened_at IS NULL)`).join(" OR ") || "0=1"
    return `NOT EXISTS (SELECT 1 FROM correspondence_recipients r JOIN correspondence_messages m ON m.id=r.message_id WHERE m.source_key=${sql(row.sourceKey)} AND NOT (${allowed}))`
  }).join(" AND ") || "1=1"
  const grantCounts = rows.map((row) => `(NOT EXISTS (SELECT 1 FROM correspondence_messages m WHERE m.source_key=${sql(row.sourceKey)}) OR (SELECT COUNT(*) FROM correspondence_recipients r JOIN correspondence_messages m ON m.id=r.message_id WHERE m.source_key=${sql(row.sourceKey)})=${row.message.grants.length})`).join(" AND ") || "1=1"
  const attachmentChecks = rows.flatMap((row) => row.message.attachments.map((item) => `NOT EXISTS (SELECT 1 FROM correspondence_attachments a WHERE a.id=${sql(attachmentId(row.message.sourceAccountId, item.sourceAttachmentId))} AND NOT (a.organization_id=${sql(manifest.organizationId)} AND a.project_id=${sql(manifest.project.projectId)} AND a.owner_user_id=${sql(item.ownerUserId)} AND a.message_id=${sql(row.messageId)} AND a.name=${sql(item.name)} AND a.content_type=${sql(item.contentType)} AND a.size=${item.size} AND a.drive_file_id=${sql(item.driveFileId)}))`)).join(" AND ") || "1=1"
  return `INSERT INTO correspondence_write_guards (id,allowed) VALUES (${sql(`publication:${manifest.publicationId}`)}, CASE WHEN ${projectCheck} AND ${conversationChecks} AND ${participantChecks} AND ${existingParticipantChecks} AND ${messageIdentity} AND ${grantChecks} AND ${grantCounts} AND ${attachmentChecks} THEN 1 ELSE 0 END);`
}

function buildSql(manifest) {
  const rows = messageRows(manifest)
  const guardId = `publication:${manifest.publicationId}`
  const conversationStatements = manifest.conversations.map((conversation) => `INSERT INTO project_correspondence (id,organization_id,project_id,subject,participant_version,closed,created_at) SELECT ${sql(conversationId(manifest.sourceAccountId, conversation.sourceThreadId))},${sql(manifest.organizationId)},${sql(manifest.project.projectId)},${sql(conversation.subject)},1,0,${sql(conversation.createdAt)} WHERE EXISTS (SELECT 1 FROM correspondence_write_guards WHERE id=${sql(guardId)} AND allowed=1) ON CONFLICT(id) DO NOTHING;`).join("\n")
  const participantStatements = manifest.conversations.flatMap((conversation) => participantRows(manifest, conversation).map(([idValue, item]) => `INSERT INTO correspondence_participants (id,conversation_id,user_id,name,email,role,revoked_at) SELECT ${sql(`bt-participant-${hash(`${idValue}\u0000${item.userId}`).slice(0, 32)}`)},${sql(idValue)},${sql(item.userId)},${sql(item.name)},${sql(item.email)},${sql(item.role)},NULL WHERE EXISTS (SELECT 1 FROM correspondence_write_guards WHERE id=${sql(guardId)} AND allowed=1) ON CONFLICT(conversation_id,user_id) DO NOTHING;`)).join("\n")
  const messageStatements = rows.map((row) => `INSERT INTO correspondence_messages (id,conversation_id,author_user_id,author_name,source,source_key,body,sent_at,request_hash) SELECT ${sql(row.messageId)},${sql(row.conversationId)},${sql(row.message.authorUserId)},${sql(row.message.authorName)},'buildertrend',${sql(row.sourceKey)},${sql(row.message.body)},${sql(row.message.sentAt)},${sql(row.requestHash)} WHERE EXISTS (SELECT 1 FROM correspondence_write_guards WHERE id=${sql(guardId)} AND allowed=1) ON CONFLICT(source_key) DO NOTHING;`).join("\n")
  const recipientStatements = rows.flatMap((row) => row.message.grants.map((grantValue) => {
    const grantId = `bt-grant-${hash(`${row.messageId}\u0000${grantValue.userId}`).slice(0, 32)}`
    return `INSERT INTO correspondence_recipients (id,message_id,user_id,name,kind,opened_at,baseline) SELECT ${sql(grantId)},${sql(row.messageId)},${sql(grantValue.userId)},${sql(grantValue.name)},${sql(grantValue.kind)},NULL,1 WHERE EXISTS (SELECT 1 FROM correspondence_write_guards WHERE id=${sql(guardId)} AND allowed=1) ON CONFLICT(message_id,user_id) DO NOTHING;`
  })).join("\n")
  const attachmentStatements = rows.flatMap((row) => row.message.attachments.map((item) => {
    const importedAttachmentId = attachmentId(row.message.sourceAccountId, item.sourceAttachmentId)
    return `INSERT INTO correspondence_attachments (id,organization_id,project_id,owner_user_id,message_id,name,content_type,size,drive_file_id,retired_at,created_at) SELECT ${sql(importedAttachmentId)},${sql(manifest.organizationId)},${sql(manifest.project.projectId)},${sql(item.ownerUserId)},${sql(row.messageId)},${sql(item.name)},${sql(item.contentType)},${item.size},${sql(item.driveFileId)},NULL,${sql(row.message.sentAt)} WHERE EXISTS (SELECT 1 FROM correspondence_write_guards WHERE id=${sql(guardId)} AND allowed=1) ON CONFLICT(id) DO NOTHING;`
  })).join("\n")
  const counts = `SELECT 'published_messages' AS check_name,COUNT(*) AS observed,${rows.length} AS expected FROM correspondence_messages WHERE source='buildertrend' AND source_key IN (${rows.map((row) => sql(row.sourceKey)).join(",") || "NULL"});\nSELECT 'published_baseline_grants' AS check_name,COUNT(*) AS observed,${rows.reduce((count, row) => count + row.message.grants.length, 0)} AS expected FROM correspondence_recipients r JOIN correspondence_messages m ON m.id=r.message_id WHERE m.source='buildertrend' AND m.source_key IN (${rows.map((row) => sql(row.sourceKey)).join(",") || "NULL"}) AND r.baseline=1 AND r.opened_at IS NULL;`
  return `-- OFFLINE Buildertrend correspondence publication rehearsal. Do not run against production.\nBEGIN IMMEDIATE;\n${buildGuard(manifest, rows)}\n${conversationStatements}\n${participantStatements}\n${messageStatements}\n${recipientStatements}\n${attachmentStatements}\nDELETE FROM correspondence_write_guards WHERE id=${sql(guardId)};\nCOMMIT;\n-- SELECT-only reconciliation (run after the transaction in a local fixture).\n${counts}\n`
}

function buildRollbackSql(manifest) {
  const rows = messageRows(manifest)
  const messageMatch = rows.map((row) => `(m.source='buildertrend' AND m.id=${sql(row.messageId)} AND m.source_key=${sql(row.sourceKey)} AND m.body=${sql(row.message.body)} AND m.request_hash=${sql(row.requestHash)})`).join(" OR ") || "0=1"
  const attachmentMatch = rows.flatMap((row) => row.message.attachments.map((item) => `(a.id=${sql(attachmentId(row.message.sourceAccountId, item.sourceAttachmentId))} AND a.message_id=${sql(row.messageId)} AND a.organization_id=${sql(manifest.organizationId)} AND a.project_id=${sql(manifest.project.projectId)} AND a.owner_user_id=${sql(item.ownerUserId)} AND a.name=${sql(item.name)} AND a.content_type=${sql(item.contentType)} AND a.size=${item.size} AND a.drive_file_id=${sql(item.driveFileId)})`)).join(" OR ") || "0=1"
  return `-- OFFLINE rollback rehearsal. It removes only exact imported Buildertrend projection rows; native replies and changed rows remain.\nBEGIN IMMEDIATE;\nDELETE FROM correspondence_recipients WHERE message_id IN (SELECT m.id FROM correspondence_messages m WHERE ${messageMatch});\nDELETE FROM correspondence_attachments WHERE id IN (SELECT a.id FROM correspondence_attachments a WHERE ${attachmentMatch});\nDELETE FROM correspondence_messages WHERE id IN (SELECT m.id FROM correspondence_messages m WHERE ${messageMatch});\nCOMMIT;\n`
}

export function buildBuildertrendCorrespondencePublication(input) {
  const manifest = normalizeManifest(input)
  const rows = messageRows(manifest)
  const fingerprint = hash(stableJson({ schemaVersion: SCHEMA_VERSION, publicationId: manifest.publicationId, organizationId: manifest.organizationId, sourceAccountId: manifest.sourceAccountId, project: manifest.project, conversations: manifest.conversations }))
  const attachmentCount = rows.reduce((count, row) => count + row.message.attachments.length, 0)
  const grantCount = rows.reduce((count, row) => count + row.message.grants.length, 0)
  return {
    schemaVersion: PACKAGE_VERSION,
    publicationId: manifest.publicationId,
    fingerprint,
    sql: buildSql(manifest),
    rollbackSql: buildRollbackSql(manifest),
    reconciliation: {
      status: "REHEARSAL_ONLY",
      source: "buildertrend",
      organizationId: manifest.organizationId,
      projectId: manifest.project.projectId,
      sourceAccountId: manifest.sourceAccountId,
      conversations: manifest.conversations.length,
      messages: rows.length,
      grants: grantCount,
      attachments: attachmentCount,
      reviewerId: manifest.reviewed.reviewerId,
      reviewedAt: manifest.reviewed.reviewedAt,
      referenceHash: manifest.reviewed.referenceHash,
      baselineRecipients: true,
      openedAtWritten: false,
      notificationsWritten: false,
      outboxRowsWritten: false,
      bccMessagesHeld: true,
      nativeRepliesPreservedByRollback: true,
      productionReads: false,
      productionWrites: false,
    },
  }
}

async function main() {
  const [inputPath, outputPath, ...unexpected] = process.argv.slice(2)
  if (!inputPath || !outputPath || unexpected.length > 0) throw new Error("Usage: node scripts/build-buildertrend-correspondence-publication.mjs <reviewed-manifest.json> <rehearsal-package.json>")
  const input = JSON.parse(await readFile(inputPath, "utf8"))
  const result = buildBuildertrendCorrespondencePublication(input)
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  console.log(JSON.stringify({ outputPath, ...result.reconciliation, fingerprint: result.fingerprint }))
}

if (typeof process.argv[1] === "string" && process.argv[1].endsWith("build-buildertrend-correspondence-publication.mjs")) await main()
