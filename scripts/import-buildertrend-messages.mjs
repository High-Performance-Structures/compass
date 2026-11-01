#!/usr/bin/env node
/*
 * Buildertrend messages -> live Compass project conversations.
 *
 * Reads the capture JSONL produced by the browser-capture agent, a reviewed
 * participant map, a job -> project map and (optionally) a sha256 -> Drive
 * file map, and writes idempotent SQL batch files plus a review list.
 *
 * DRY RUN BY DEFAULT. It never connects to a database. `--apply` only prints
 * the wrangler commands for the batches that are not yet marked applied; a
 * person runs them after taking a backup. See
 * docs/plans/bt-messages-live-conversations.md.
 *
 * Usage:
 *   node scripts/import-buildertrend-messages.mjs \
 *     --capture capture.jsonl [--participants participants.json] \
 *     [--directory directory.json] [--people-catalog catalog.jsonl] \
 *     --projects projects.json --precheck precheck.json [--files files.json] --out out-dir \
 *     [--batch-size 40] [--apply] [--mark-applied batch-0001.sql]
 *
 * Rules (owner-approved 2026-11-01):
 *   - people are matched ONLY by exact Buildertrend participant ids through the
 *     reviewed participant map; anything else goes to the review list;
 *   - import writes no notification, email, outbox or unread rows;
 *   - one Compass message per Buildertrend message id, whether it is moved out
 *     of a legacy `bt-message-archive-*` channel or inserted new;
 *   - attachments reuse any stored file with the same sha256.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createParticipantResolver, normalizeEmail, normalizeName, parseDirectory, parsePeopleCatalog } from "./import-buildertrend-participants.mjs"

export const CAPTURE_SCHEMA = "bt-message-capture/v1"
export const PARTICIPANT_MAP_SCHEMA = "bt-participant-map/v1"
export const SOURCE_SYSTEM = "buildertrend"
export const MAX_VALUES_PER_STATEMENT = 100
const THREAD_RECORD_TYPE = `${SOURCE_SYSTEM}_message_thread`
const MESSAGE_RECORD_TYPE = `${SOURCE_SYSTEM}_message`
const SHA256 = /^[a-f0-9]{64}$/
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const KINDS = new Set(["staff", "owner", "vendor"])

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function shortId(prefix, ...parts) {
  return `${prefix}-${hash(parts.join("\u0000")).slice(0, 32)}`
}

/** A SQL literal. Values are inlined (no bound parameters), NULs removed. */
export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in SQL")
    return String(Math.trunc(value))
  }
  if (typeof value === "boolean") return value ? "1" : "0"
  return `'${String(value).replaceAll("\u0000", "").replaceAll("'", "''")}'`
}

function sourceId(value, label) {
  const text = typeof value === "number" ? String(value) : value
  if (typeof text !== "string" || !SOURCE_ID.test(text.trim())) throw new Error(`${label} must be a Buildertrend id`)
  return text.trim()
}

/**
 * Buildertrend job and message ids are numbers. Only numeric ids are accepted,
 * so conversion can only ever touch `bt-message-archive-<digits>` channels and
 * `bt-message-<digits>-<digits>` rows, never other archives such as the
 * `bt-message-archive-estimate-*` channels.
 */
function numericId(value, label) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : ""
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a numeric Buildertrend id`)
  return text
}

/**
 * The source identity recorded for a participant: the BT id when the page
 * showed one, else the email, else the normalized name (BT message pages often
 * show only names).
 */
function participantKey(participant) {
  if (participant.participantId) return `${participant.namespace}:${participant.participantId}`
  const email = normalizeEmail(participant.email)
  if (email) return `${participant.namespace}:email:${email}`
  return `${participant.namespace}:name:${normalizeName(participant.displayName) ?? "unknown"}`
}

// ---------------------------------------------------------------------------
// Ids (deterministic, so every run produces the same rows)
// ---------------------------------------------------------------------------

export function legacyArchiveChannelId(btJobId) {
  return `bt-message-archive-${btJobId}`
}
export function legacyArchiveMessageId(btJobId, btMessageId) {
  return `bt-message-${btJobId}-${btMessageId}`
}
export function legacyOwnerHistoryMessageId(btJobId, btMessageId) {
  return `bt-owner-history-${btJobId}-${btMessageId}`
}
export function conversationId(organizationId, btThreadId) {
  return shortId("bt-thread", organizationId, btThreadId)
}
export function importedMessageId(btMessageId) {
  return shortId("bt-msg", btMessageId)
}
export function importedContactId(projectId, key) {
  return shortId("bt-contact", projectId, key)
}

// ---------------------------------------------------------------------------
// Sent date: the literal text is kept; the ISO value orders the conversation.
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function displayedParts(text) {
  const value = text.trim().replace(/\s+/g, " ")
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2}) ?([AaPp][Mm])$/)
  if (match) return { year: +match[3], month: +match[1], day: +match[2], hour: +match[4], minute: +match[5], meridiem: match[6].toLowerCase() }
  match = value.match(/^(?:[A-Za-z]{3,9},? )?([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4}),?(?: at)? (\d{1,2}):(\d{2}) ?([AaPp][Mm])$/)
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1
    if (month === 0) return null
    return { year: +match[3], month, day: +match[2], hour: +match[4], minute: +match[5], meridiem: match[6].toLowerCase() }
  }
  match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (match) return { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], meridiem: null }
  return null
}

function zoneOffsetMinutes(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utcMillis))
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"))
  return Math.round((asUtc - utcMillis) / 60000)
}

/**
 * The displayed sent date as an ISO instant. The zone is the one shown with
 * the date when the capture saw one, else the organization's zone (assumed).
 */
export function sentAtIso(display, timeZone) {
  const parts = displayedParts(display)
  if (!parts) return null
  let hour = parts.hour
  if (parts.meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (parts.meridiem === "pm" ? 12 : 0)
  }
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute)
  const check = new Date(local)
  if (check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null
  let utc = local - zoneOffsetMinutes(local, timeZone) * 60000
  utc = local - zoneOffsetMinutes(utc, timeZone) * 60000
  return new Date(utc).toISOString()
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function participantRef(value, label) {
  if (value === null || typeof value !== "object") throw new Error(`${label} must be an object`)
  const namespace = typeof value.namespace === "string" && value.namespace.trim() !== "" ? value.namespace.trim() : "unknown"
  if (!/^[a-z_]+$/.test(namespace)) throw new Error(`${label}.namespace must be a Buildertrend participant namespace`)
  // BT pages often show no participant id; then email or name identifies them.
  const participantId = value.participantId == null || value.participantId === "" ? null : sourceId(value.participantId, `${label}.participantId`)
  const email = normalizeEmail(value.email)
  const displayName = typeof value.displayName === "string" && value.displayName.trim() !== "" ? value.displayName : null
  if (!participantId && !email && !displayName) throw new Error(`${label} needs a participantId, email or displayName`)
  return {
    participantId,
    email,
    namespace,
    role: typeof value.role === "string" ? value.role : null,
    displayName,
    kind: typeof value.kind === "string" ? value.kind : "to",
  }
}

/** One capture line. Throws on a malformed record; review handles the rest. */
/**
 * A message with no BT thread id is its own conversation. Its thread id is
 * derived here as `msg-<btMessageId>`, so it can never collide with a real BT
 * thread id (those are stored unprefixed and may not start with `msg-`).
 */
export function selfThreadId(btMessageId) {
  return `msg-${btMessageId}`
}

function realThreadId(value) {
  const id = sourceId(value, "btThreadId")
  if (id.startsWith("msg-")) throw new Error("btThreadId may not start with msg- (reserved for messages without a thread)")
  return id
}

export function parseCaptureLine(line, lineNumber) {
  const record = JSON.parse(line)
  if (record?.schema !== CAPTURE_SCHEMA) throw new Error(`line ${lineNumber}: schema must be ${CAPTURE_SCHEMA}`)
  if (record.type === "thread") {
    return { type: "thread", btJobId: numericId(record.btJobId, "btJobId"), btThreadId: realThreadId(record.btThreadId), messageCount: Number(record.messageCount) }
  }
  if (record.type !== "message") throw new Error(`line ${lineNumber}: type must be message or thread`)
  if (typeof record.body !== "string") throw new Error(`line ${lineNumber}: body must be the full message text`)
  if (typeof record.sentAtDisplay !== "string" || record.sentAtDisplay.trim() === "") throw new Error(`line ${lineNumber}: sentAtDisplay is required`)
  const btMessageId = numericId(record.btMessageId, "btMessageId")
  // Contract: when Buildertrend exposes no thread id, the message is its own
  // conversation (btThreadId = btMessageId) and needs no thread record.
  const ownThread = record.btThreadId === undefined || record.btThreadId === null || record.btThreadId === ""
  return {
    type: "message",
    btJobId: numericId(record.btJobId, "btJobId"),
    btMessageId,
    btThreadId: ownThread ? selfThreadId(btMessageId) : realThreadId(record.btThreadId),
    ownThread,
    btParentMessageId: record.btParentMessageId == null ? null : sourceId(record.btParentMessageId, "btParentMessageId"),
    subject: typeof record.subject === "string" ? record.subject : "",
    body: record.body,
    sentAtDisplay: record.sentAtDisplay.trim(),
    sentAtZone: typeof record.sentAtZone === "string" && record.sentAtZone !== "" ? record.sentAtZone : null,
    sender: participantRef(record.sender, `line ${lineNumber}: sender`),
    recipients: (Array.isArray(record.recipients) ? record.recipients : []).map((value, index) => participantRef(value, `line ${lineNumber}: recipients[${index}]`)),
    attachments: (Array.isArray(record.attachments) ? record.attachments : []).map((value, index) => ({
      btAttachmentId: sourceId(value?.btAttachmentId, `line ${lineNumber}: attachments[${index}].btAttachmentId`),
      fileName: typeof value?.fileName === "string" && value.fileName.trim() !== "" ? value.fileName.trim() : "attachment",
      mimeType: typeof value?.mimeType === "string" && value.mimeType !== "" ? value.mimeType : "application/octet-stream",
      sizeBytes: Number.isInteger(value?.sizeBytes) && value.sizeBytes >= 0 ? value.sizeBytes : null,
      sha256: typeof value?.sha256 === "string" ? value.sha256.toLowerCase() : null,
    })),
  }
}

export function parseCapture(text) {
  const messages = []
  const threads = new Map()
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return
    const record = parseCaptureLine(line, index + 1)
    if (record.type === "thread") threads.set(record.btThreadId, record)
    else messages.push(record)
  })
  return { messages, threads }
}

/**
 * The reviewed participant map. Each exact `namespace:participantId` key has a
 * decision: "user" (a Compass account), "contact" (an existing directory
 * contact per project) or "new_contact" (add as a directory contact without
 * inviting). Keys that are absent are unmatched and go to review.
 */
export function parseParticipantMap(value) {
  if (value?.schema !== PARTICIPANT_MAP_SCHEMA) throw new Error(`participant map schema must be ${PARTICIPANT_MAP_SCHEMA}`)
  const map = new Map()
  for (const [key, entry] of Object.entries(value.participants ?? {})) {
    if (!/^[a-z_]+:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new Error(`participant key ${key} must be namespace:participantId`)
    if (!KINDS.has(entry?.kind)) throw new Error(`participant ${key}: kind must be staff, owner or vendor`)
    if (entry.decision === "user") {
      if (typeof entry.userId !== "string" || entry.userId === "") throw new Error(`participant ${key}: userId is required`)
      map.set(key, { decision: "user", kind: entry.kind, userId: entry.userId, contactIds: entry.projectContactIds ?? {} })
    } else if (entry.decision === "contact" || entry.decision === "new_contact") {
      if (entry.kind === "staff") throw new Error(`participant ${key}: staff must map to a Compass user`)
      if (typeof entry.displayName !== "string" || entry.displayName.trim() === "") throw new Error(`participant ${key}: displayName is required`)
      map.set(key, {
        decision: entry.decision, kind: entry.kind, userId: null,
        contactIds: entry.projectContactIds ?? {},
        displayName: entry.displayName.trim(),
        email: typeof entry.email === "string" && entry.email.trim() !== "" ? entry.email.trim().toLowerCase() : null,
        companyName: typeof entry.companyName === "string" ? entry.companyName.trim() : null,
      })
    } else {
      throw new Error(`participant ${key}: decision must be user, contact or new_contact`)
    }
  }
  return map
}

export const PRECHECK_SCHEMA = "bt-import-precheck/v1"

/**
 * Facts read from production just before a run (the "after 0287" part of
 * docs/plans/bt-messages-archive-shape-check.sql): projects whose
 * imported-conversations switch is on, and jobs whose legacy archive channel
 * is private. The importer trusts nothing else about the live database.
 */
export function parsePrecheck(value) {
  if (value?.schema !== PRECHECK_SCHEMA) throw new Error(`pre-check schema must be ${PRECHECK_SCHEMA}`)
  const list = (key) => {
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string" || item === "")) throw new Error(`pre-check ${key} must be a list of ids`)
    return new Set(value[key])
  }
  return { staffOnlyProjectIds: list("staffOnlyProjectIds"), privateArchiveJobIds: list("privateArchiveJobIds") }
}

// ---------------------------------------------------------------------------
// Planning: pure, so the tests can check every rule without a database.
// ---------------------------------------------------------------------------

/**
 * A conversation has one outside audience. Owner decision 2026-11-01: a thread
 * with both owners and vendors is kept internal (staff-only), not shared.
 */
function audienceFor(kinds) {
  const owner = kinds.has("owner")
  const vendor = kinds.has("vendor")
  if (owner && vendor) return "staff"
  if (owner) return "clients"
  if (vendor) return "sub_vendors"
  return "staff"
}

function review(reason, message, detail = {}) {
  return { reason, btJobId: message.btJobId, btThreadId: message.btThreadId, btMessageId: message.btMessageId ?? null, ...detail }
}

/**
 * Groups messages into threads and decides, per thread, whether it can be
 * imported. A whole thread is held when any message in it needs review, so a
 * conversation is never shown with gaps or to the wrong audience.
 */
export function planImport(input) {
  const { capture, projects, timeZone, organizationId } = input
  const resolve = input.resolveParticipant ?? createParticipantResolver({ participantMap: input.participants ?? new Map(), directory: null, catalog: [] })
  const matches = { by_map: 0, by_email: 0, by_name_project: 0, by_name_catalog: 0, review: 0 }
  const precheck = input.precheck
  const expectedStaffOnly = new Set(input.expectedStaffOnlyProjects ?? [])
  const reviews = []
  const pending = []
  const byThread = new Map()
  for (const message of capture.messages) {
    const list = byThread.get(message.btThreadId) ?? []
    list.push(message)
    byThread.set(message.btThreadId, list)
  }
  const threads = []
  for (const [btThreadId, messages] of byThread) {
    const first = messages[0]
    const summary = capture.threads.get(btThreadId)
    // Capture writes a thread record after the thread's last message. A
    // message without a thread id is its own complete, one-message thread.
    const selfThread = messages.every((m) => m.ownThread && selfThreadId(m.btMessageId) === btThreadId)
    const complete = selfThread
      ? !summary || summary.messageCount === 1
      : summary !== undefined && summary.messageCount === new Set(messages.map((m) => m.btMessageId)).size
    if (!complete) {
      pending.push({ reason: "thread_incomplete", btJobId: first.btJobId, btThreadId, captured: messages.length, expected: summary?.messageCount ?? null })
      continue
    }
    const projectId = projects[first.btJobId] ?? null
    const threadReviews = []
    if (!projectId) threadReviews.push(review("job_not_mapped", first))
    // A private legacy archive was deliberately closed even to most staff:
    // none of that job's threads may reach an outside audience.
    if (precheck.privateArchiveJobIds.has(first.btJobId)) threadReviews.push(review("private_archive", first))
    // A project that must be staff-only (legal hold) is only imported once the
    // pre-check shows its switch is on.
    if (projectId && expectedStaffOnly.has(projectId) && !precheck.staffOnlyProjectIds.has(projectId)) {
      threadReviews.push(review("staff_only_not_verified", first, { projectId }))
    }
    if (messages.some((m) => m.btJobId !== first.btJobId)) threadReviews.push(review("thread_spans_jobs", first))
    const seen = new Set()
    const resolved = new Map()
    const kinds = new Set()
    const people = new Map()
    const planned = []
    for (const message of messages) {
      if (seen.has(message.btMessageId)) continue
      seen.add(message.btMessageId)
      const refs = [{ ...message.sender, kind: "sender" }, ...message.recipients]
      for (const ref of refs) {
        if (ref.kind === "bcc") threadReviews.push(review("bcc_recipient", message, { participant: participantKey(ref) }))
        const key = participantKey(ref)
        if (!resolved.has(key)) resolved.set(key, projectId ? resolve(ref, projectId) : { reason: "participant_unmatched" })
        const match = resolved.get(key)
        if (!match.entry) {
          threadReviews.push(review(match.reason, message, { participant: key, displayName: ref.displayName, role: ref.role }))
          continue
        }
        const entry = match.entry
        if (entry.kind !== "staff") kinds.add(entry.kind)
        people.set(participantKey(ref), { key: participantKey(ref), ref, entry })
      }
      const createdAt = sentAtIso(message.sentAtDisplay, message.sentAtZone ?? timeZone)
      if (!createdAt) threadReviews.push(review("sent_at_unreadable", message, { sentAtDisplay: message.sentAtDisplay }))
      for (const attachment of message.attachments) {
        if (!attachment.sha256 || !SHA256.test(attachment.sha256) || attachment.sizeBytes === null) {
          threadReviews.push(review("attachment_unverified", message, { btAttachmentId: attachment.btAttachmentId }))
        }
      }
      planned.push({ ...message, createdAt })
    }
    for (const match of resolved.values()) matches[match.rule ?? "review"] += 1
    const audience = audienceFor(kinds)
    const mixedKeptInternal = kinds.has("owner") && kinds.has("vendor")
    if (threadReviews.length > 0) {
      reviews.push(...threadReviews)
      continue
    }
    planned.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.btMessageId.localeCompare(b.btMessageId))
    threads.push({
      btThreadId,
      btJobId: first.btJobId,
      projectId,
      organizationId,
      staffOnly: precheck.staffOnlyProjectIds.has(projectId),
      channelId: conversationId(organizationId, btThreadId),
      name: (planned.find((m) => m.subject.trim() !== "")?.subject.trim() ?? "Buildertrend conversation").slice(0, 120),
      audience,
      mixedKeptInternal,
      people: [...people.values()],
      messages: planned,
    })
  }
  return { threads, reviews, pending, matches }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

function insertSelect(table, row, where) {
  const columns = Object.keys(row)
  return `INSERT INTO ${table} (${columns.join(", ")}) SELECT ${columns.map((column) => sqlValue(row[column])).join(", ")} WHERE ${where} ON CONFLICT DO NOTHING;`
}

/** Directory contact id for a person on a project, or null for an account holder. */
function contactFor(person, projectId) {
  const mapped = person.entry.contactIds?.[projectId]
  if (typeof mapped === "string" && mapped !== "") return { id: mapped, create: false }
  if (person.entry.decision === "user") return null
  // One contact per person, however many ways the pages named them.
  return { id: importedContactId(projectId, person.entry.identity ?? person.key), create: true }
}

const NOT_STAFF_ONLY = (projectId) =>
  `NOT EXISTS (SELECT 1 FROM projects WHERE id = ${sqlValue(projectId)} AND imported_conversations_staff_only = 1)`

/**
 * Every statement for a thread runs only while the database still matches the
 * pre-check: the job's legacy archive is not private, and a staff-only
 * project still has its switch on. Run out of order, the batch does nothing.
 */
export function threadGuard(thread) {
  const archiveOpen = `NOT EXISTS (SELECT 1 FROM channels WHERE id = ${sqlValue(legacyArchiveChannelId(thread.btJobId))} AND is_private = 1)`
  if (!thread.staffOnly) return archiveOpen
  return `${archiveOpen} AND EXISTS (SELECT 1 FROM projects WHERE id = ${sqlValue(thread.projectId)} AND imported_conversations_staff_only = 1)`
}

/** Every statement for one thread, in dependency order. */
export function threadStatements(thread, input) {
  const { actorUserId, now, driveFiles } = input
  const statements = []
  const guard = threadGuard(thread)
  const lastAt = thread.messages[thread.messages.length - 1].createdAt
  statements.push(insertSelect("channels", {
    id: thread.channelId, name: thread.name, type: "text", description: null,
    organization_id: thread.organizationId, project_id: thread.projectId, category_id: null,
    is_private: 1, audience: thread.audience, created_by: actorUserId, sort_order: 0, archived_at: null,
    created_at: thread.messages[0].createdAt, updated_at: lastAt,
    source_system: SOURCE_SYSTEM, source_thread_id: thread.btThreadId,
  }, guard))
  const contactByKey = new Map()
  for (const person of thread.people) {
    const contact = person.entry.kind === "staff" ? null : contactFor(person, thread.projectId)
    contactByKey.set(person.key, contact?.id ?? null)
    if (contact?.create) {
      // Added to the directory without an invitation (owner decision 1).
      statements.push(insertSelect("project_contacts", {
        id: contact.id, project_id: thread.projectId,
        contact_type: person.entry.kind === "owner" ? "owner" : "subcontractor",
        source_system: SOURCE_SYSTEM, source_entity_type: "buildertrend_participant", source_entity_id: person.key,
        display_name: person.entry.displayName, company_name: person.entry.companyName ?? null, email: person.entry.email ?? null,
        // Linked to the matched directory company/contact when there is one.
        vendor_id: person.entry.links?.vendorId ?? null, vendor_contact_id: person.entry.links?.vendorContactId ?? null,
        customer_id: person.entry.links?.customerId ?? null, customer_contact_id: person.entry.links?.customerContactId ?? null,
        owner_portal_visible: 0, sub_vendor_portal_visible: 0, internal_visible: 1, active: 1,
        created_at: now, updated_at: now,
      }, guard))
    }
    statements.push(insertSelect("project_source_record_participants", {
      id: shortId("bt-participant", thread.projectId, THREAD_RECORD_TYPE, thread.btThreadId, person.key),
      organization_id: thread.organizationId, project_id: thread.projectId,
      source_record_type: THREAD_RECORD_TYPE, source_record_id: thread.btThreadId, source_participant_id: person.key,
      source_contact_name: person.ref.displayName ?? null,
      participant_role: person.entry.kind, audience: person.entry.kind === "staff" ? "internal" : "external",
      project_contact_id: contactByKey.get(person.key), user_id: person.entry.userId,
      identity_status: "matched", membership_status: "active", review_status: "reviewed", active: 1,
      created_at: now, updated_at: now,
    }, guard))
    // Outside people never join a staff-only project's threads: not emitted
    // at all when the pre-check shows the switch on, and guarded in SQL too.
    // A staff-audience thread (including a mixed owner + vendor one) adds staff only.
    if (person.entry.userId && (person.entry.kind === "staff" || (!thread.staffOnly && thread.audience !== "staff"))) {
      const where = person.entry.kind === "staff" ? guard : `${guard} AND ${NOT_STAFF_ONLY(thread.projectId)}`
      statements.push(insertSelect("channel_members", {
        id: shortId("bt-member", thread.channelId, person.entry.userId), channel_id: thread.channelId, user_id: person.entry.userId,
        role: person.entry.kind === "staff" ? "moderator" : "member", notify_level: "all", joined_at: now,
      }, where))
      // History arrives read: nothing imported is unread.
      statements.push(insertSelect("channel_read_state", {
        id: shortId("bt-read", thread.channelId, person.entry.userId), user_id: person.entry.userId, channel_id: thread.channelId,
        last_read_message_id: null, last_read_at: now, unread_count: 0,
      }, where))
    }
  }
  for (const message of thread.messages) statements.push(...messageStatements(thread, message, contactByKey, { actorUserId, now, driveFiles, guard }))
  return statements
}

function messageStatements(thread, message, contactByKey, { actorUserId, now, driveFiles, guard }) {
  const statements = []
  const senderKey = participantKey(message.sender)
  const senderPerson = thread.people.find((person) => person.key === senderKey)
  const senderUserId = senderPerson?.entry.userId ?? null
  const senderContactId = senderUserId ? null : contactByKey.get(senderKey) ?? null
  const legacyId = legacyArchiveMessageId(message.btJobId, message.btMessageId)
  const archiveId = legacyArchiveChannelId(message.btJobId)
  const values = {
    channel_id: thread.channelId, user_id: senderUserId ?? actorUserId, content: message.body, content_html: null,
    source_system: SOURCE_SYSTEM, source_message_id: message.btMessageId, source_sent_at_snapshot: message.sentAtDisplay,
    imported_sender_contact_id: senderContactId, created_at: message.createdAt,
  }
  // 1. Convert: move the legacy archive row in place (same id, no copy). Only
  //    the numeric legacy row in its numeric archive is ever touched; any other
  //    row in the archive stays there, staff-only. A legacy row with staff
  //    replies stays too unless this thread is staff-only, so internal notes
  //    are never exposed.
  const set = Object.entries(values).map(([column, value]) => `${column} = ${sqlValue(value)}`).join(", ")
  statements.push(`UPDATE messages SET ${set} WHERE id = ${sqlValue(legacyId)} AND channel_id = ${sqlValue(archiveId)} AND source_message_id IS NULL AND (${sqlValue(thread.audience)} = 'staff' OR NOT EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = ${sqlValue(legacyId)})) AND ${guard};`)
  // 2. Otherwise insert it once; the unique (source_system, source_message_id)
  //    index makes a re-run a no-op.
  statements.push(insertSelect("messages", {
    id: importedMessageId(message.btMessageId), thread_id: null, edited_at: null, deleted_at: null, deleted_by: null,
    is_pinned: 0, reply_count: 0, last_reply_at: null, ...values,
  }, `${guard} AND NOT EXISTS (SELECT 1 FROM messages WHERE id = ${sqlValue(legacyId)}) AND NOT EXISTS (SELECT 1 FROM messages WHERE source_system = ${sqlValue(SOURCE_SYSTEM)} AND source_message_id = ${sqlValue(message.btMessageId)})`))
  const messageRow = `(SELECT id FROM messages WHERE source_system = ${sqlValue(SOURCE_SYSTEM)} AND source_message_id = ${sqlValue(message.btMessageId)})`
  for (const ref of [{ ...message.sender, kind: "sender" }, ...message.recipients]) {
    const person = thread.people.find((entry) => entry.key === participantKey(ref))
    statements.push(insertSelect("project_source_record_participants", {
      id: shortId("bt-participant", thread.projectId, MESSAGE_RECORD_TYPE, message.btMessageId, participantKey(ref)),
      organization_id: thread.organizationId, project_id: thread.projectId,
      source_record_type: MESSAGE_RECORD_TYPE, source_record_id: message.btMessageId, source_participant_id: participantKey(ref),
      source_contact_name: ref.displayName ?? null, participant_role: ref.kind,
      audience: person?.entry.kind === "staff" ? "internal" : "external",
      project_contact_id: contactByKey.get(participantKey(ref)) ?? null, user_id: person?.entry.userId ?? null,
      identity_status: "matched", membership_status: "active", review_status: "reviewed", active: 1,
      created_at: now, updated_at: now,
    }, guard))
  }
  for (const attachment of message.attachments) {
    const mapped = driveFiles.get(attachment.sha256) ?? null
    // Reuse a stored file with the same bytes: an earlier attachment, or a
    // daily-log photo with a verified hash, before any newly uploaded file.
    // Reuse only on identical sha256 AND byte size, within the same
    // organization and audience (attachments) or organization (daily-log photos).
    const storage = `COALESCE((SELECT a.r2_path FROM message_attachments a JOIN messages am ON am.id = a.message_id JOIN channels ac ON ac.id = am.channel_id WHERE a.content_sha256 = ${sqlValue(attachment.sha256)} AND a.file_size = ${sqlValue(attachment.sizeBytes)} AND ac.organization_id = ${sqlValue(thread.organizationId)} AND ac.audience = ${sqlValue(thread.audience)} LIMIT 1), (SELECT p.drive_file_id FROM daily_log_photo_aliases x JOIN daily_log_photos p ON p.id = x.canonical_photo_id JOIN projects xp ON xp.id = x.project_id WHERE x.content_sha256 = ${sqlValue(attachment.sha256)} AND x.content_size_bytes = ${sqlValue(attachment.sizeBytes)} AND xp.organization_id = ${sqlValue(thread.organizationId)} AND p.drive_file_id IS NOT NULL LIMIT 1), ${sqlValue(mapped)})`
    statements.push(`INSERT INTO message_attachments (id, message_id, file_name, mime_type, file_size, r2_path, width, height, uploaded_at, content_sha256, source_attachment_id) SELECT ${sqlValue(shortId("bt-attachment", message.btMessageId, attachment.btAttachmentId))}, ${messageRow}, ${sqlValue(attachment.fileName)}, ${sqlValue(attachment.mimeType)}, ${sqlValue(attachment.sizeBytes)}, ${storage}, NULL, NULL, ${sqlValue(now)}, ${sqlValue(attachment.sha256)}, ${sqlValue(attachment.btAttachmentId)} WHERE ${guard} AND ${messageRow} IS NOT NULL AND ${storage} IS NOT NULL ON CONFLICT DO NOTHING;`)
  }
  return statements
}

/** Retire owner-history copies once their source message is live (no duplicates). */
export function ownerHistoryRetirement(thread) {
  // Only when the live thread is the owner's own conversation; otherwise the
  // owner would lose a message they can see today (e.g. a thread kept internal).
  if (thread.audience !== "clients") return []
  return thread.messages.map((message) => {
    const copyId = legacyOwnerHistoryMessageId(message.btJobId, message.btMessageId)
    return `DELETE FROM messages WHERE id = ${sqlValue(copyId)} AND channel_id = ${sqlValue(`project-owner-${thread.projectId}`)} AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = ${sqlValue(copyId)}) AND EXISTS (SELECT 1 FROM messages m WHERE m.source_system = ${sqlValue(SOURCE_SYSTEM)} AND m.source_message_id = ${sqlValue(message.btMessageId)} AND m.channel_id = ${sqlValue(thread.channelId)});`
  })
}

/** Archive an emptied legacy channel; held messages keep it open for staff. */
export function archiveRetirement(btJobIds, now) {
  return [...new Set(btJobIds)].filter((btJobId) => /^\d+$/.test(btJobId)).map((btJobId) => {
    const id = legacyArchiveChannelId(btJobId)
    return `UPDATE channels SET archived_at = ${sqlValue(now)} WHERE id = ${sqlValue(id)} AND archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages WHERE channel_id = ${sqlValue(id)});`
  })
}

/** Counts literal values in a statement; every statement must stay at or under the D1 limit. */
export function statementValueCount(statement) {
  return (statement.match(/'(?:[^']|'')*'|\bNULL\b|(?<![\w-])\d+(?![\w-])/g) ?? []).length
}

export const FORBIDDEN_TABLES = [
  "notification_events", "notification_recipients", "notifications", "email_outbox",
  "project_access_invitations", "message_mentions", "push_deliveries", "sms_deliveries",
]

export function assertSilent(statements) {
  for (const statement of statements) {
    for (const table of FORBIDDEN_TABLES) {
      if (new RegExp(`\\b(?:INSERT INTO|UPDATE|DELETE FROM) ${table}\\b`).test(statement)) {
        throw new Error(`import must not write ${table}`)
      }
    }
    if (/UPDATE channel_read_state/.test(statement)) throw new Error("import must not change unread counts")
  }
}

export function buildBatches(plan, input) {
  const batches = []
  let current = []
  let threadIds = []
  const flush = () => {
    if (current.length === 0) return
    batches.push({ statements: current, threadIds })
    current = []
    threadIds = []
  }
  for (const thread of plan.threads) {
    const statements = threadStatements(thread, input)
    for (const statement of statements) {
      if (statementValueCount(statement) > MAX_VALUES_PER_STATEMENT) throw new Error(`statement over ${MAX_VALUES_PER_STATEMENT} values in thread ${thread.btThreadId}`)
    }
    if (threadIds.length >= input.batchSize) flush()
    current.push(...statements)
    threadIds.push(thread.btThreadId)
  }
  flush()
  const tail = [...plan.threads.flatMap(ownerHistoryRetirement), ...archiveRetirement(plan.threads.map((t) => t.btJobId), input.now)]
  for (const batch of batches) assertSilent(batch.statements)
  assertSilent(tail)
  return { batches, tail }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function args(argv) {
  const out = { apply: false, batchSize: 40, markApplied: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      i += 1
      return value
    }
    if (flag === "--capture") out.capture = next()
    else if (flag === "--participants") out.participants = next()
    else if (flag === "--directory") out.directory = next()
    else if (flag === "--people-catalog") out.peopleCatalog = next()
    else if (flag === "--projects") out.projects = next()
    else if (flag === "--files") out.files = next()
    else if (flag === "--precheck") out.precheck = next()
    else if (flag === "--out") out.out = next()
    else if (flag === "--batch-size") out.batchSize = Number(next())
    else if (flag === "--mark-applied") out.markApplied.push(next())
    else if (flag === "--apply") out.apply = true
    else throw new Error(`unknown flag ${flag}`)
  }
  if (!out.out) throw new Error("--out is required")
  if (!Number.isInteger(out.batchSize) || out.batchSize < 1 || out.batchSize > 200) throw new Error("--batch-size must be 1-200")
  return out
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function main() {
  const options = args(process.argv.slice(2))
  mkdirSync(options.out, { recursive: true })
  const checkpointPath = join(options.out, "checkpoint.json")
  const checkpoint = existsSync(checkpointPath) ? readJson(checkpointPath) : { batches: [], applied: [] }

  if (options.markApplied.length > 0 || options.apply) {
    checkpoint.applied = [...new Set([...checkpoint.applied, ...options.markApplied])]
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
    const remaining = checkpoint.batches.filter((file) => !checkpoint.applied.includes(file))
    if (options.apply) {
      // Print only. A person takes a backup first and runs these one at a time.
      console.log("# Take a D1 backup first (see the plan's Backups section), then run in order:")
      for (const file of remaining) {
        console.log(`bunx wrangler d1 execute compass-db --remote --file ${join(options.out, file)}  # then: --mark-applied ${file}`)
      }
    }
    return
  }

  const projectsInput = readJson(options.projects)
  const config = {
    organizationId: projectsInput.organizationId,
    actorUserId: projectsInput.actorUserId,
    timeZone: projectsInput.timeZone ?? "America/Denver",
  }
  for (const key of ["organizationId", "actorUserId"]) if (typeof config[key] !== "string" || config[key] === "") throw new Error(`projects map needs ${key}`)
  const capture = parseCapture(readFileSync(options.capture, "utf8"))
  const participants = options.participants ? parseParticipantMap(readJson(options.participants)) : new Map()
  const resolveParticipant = createParticipantResolver({
    participantMap: participants,
    directory: options.directory ? parseDirectory(readJson(options.directory)) : null,
    catalog: options.peopleCatalog ? parsePeopleCatalog(readFileSync(options.peopleCatalog, "utf8")) : [],
  })
  const filesInput = options.files ? readJson(options.files) : {}
  const driveFiles = new Map(Object.entries(filesInput.files ?? {}).map(([sha, entry]) => [sha.toLowerCase(), entry.driveFileId]))
  const now = new Date().toISOString()
  if (!options.precheck) throw new Error("--precheck is required (see the plan's pre-check step)")
  const precheck = parsePrecheck(readJson(options.precheck))
  const plan = planImport({
    capture, resolveParticipant, precheck,
    projects: projectsInput.jobs ?? {},
    expectedStaffOnlyProjects: projectsInput.staffOnlyProjects ?? [],
    timeZone: config.timeZone, organizationId: config.organizationId,
  })
  const { batches, tail } = buildBatches(plan, { actorUserId: config.actorUserId, now, driveFiles, batchSize: options.batchSize })

  const files = []
  batches.forEach((batch, index) => {
    const file = `batch-${String(index + 1).padStart(4, "0")}.sql`
    writeFileSync(join(options.out, file), `-- Buildertrend messages import: threads ${batch.threadIds.join(", ")}\n-- Silent: no notifications, emails or unread counts.\n${batch.statements.join("\n")}\n`)
    files.push(file)
  })
  if (tail.length > 0) {
    writeFileSync(join(options.out, "retire-legacy.sql"), `-- Run after every batch: removes owner-history copies of now-live messages and archives emptied legacy channels.\n${tail.join("\n")}\n`)
    files.push("retire-legacy.sql")
  }
  writeFileSync(join(options.out, "review.jsonl"), plan.reviews.map((item) => JSON.stringify(item)).join("\n") + (plan.reviews.length ? "\n" : ""))
  writeFileSync(join(options.out, "pending.jsonl"), plan.pending.map((item) => JSON.stringify(item)).join("\n") + (plan.pending.length ? "\n" : ""))
  const attachmentsWithoutFile = plan.threads.flatMap((thread) => thread.messages.flatMap((message) => message.attachments.filter((a) => !driveFiles.has(a.sha256)).map((a) => ({ btMessageId: message.btMessageId, ...a }))))
  writeFileSync(join(options.out, "attachments-unmapped.jsonl"), attachmentsWithoutFile.map((item) => JSON.stringify(item)).join("\n") + (attachmentsWithoutFile.length ? "\n" : ""))
  checkpoint.batches = files
  checkpoint.applied = checkpoint.applied.filter((file) => files.includes(file))
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
  const summary = {
    dryRun: true,
    threads: plan.threads.length,
    messages: plan.threads.reduce((count, thread) => count + thread.messages.length, 0),
    mixed_kept_internal: plan.threads.filter((thread) => thread.mixedKeptInternal).length,
    // How each thread participant was matched (per thread); review = unmatched or ambiguous.
    participant_matches: plan.matches,
    reviewItems: plan.reviews.length,
    pendingThreads: plan.pending.length,
    attachmentsNeedingStoredFile: attachmentsWithoutFile.length,
    batches: files,
  }
  writeFileSync(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary))
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
