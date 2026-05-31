#!/usr/bin/env node
import Database from "better-sqlite3"

const DB_PATH = process.env.LOCAL_DB_PATH || "local.db"
const PROJECT_IDS = ["proj-o-170-loomis", "proj-o-202-loeffler"]
const NOW = new Date().toISOString()
const INTERNAL_COMPANY_PATTERN =
  /\bHigh\s+Performance\s+Structures(?:\s*,?\s*Inc\.?)?/gi

function idPart(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90)
}

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_contact_source_links (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL REFERENCES projects(id) ON DELETE cascade,
      project_contact_id text REFERENCES project_contacts(id) ON DELETE set null,
      source_system text NOT NULL,
      source_record_type text NOT NULL,
      source_record_id text NOT NULL,
      source_record_number text,
      source_label text NOT NULL,
      source_name text NOT NULL,
      match_status text DEFAULT 'unmatched' NOT NULL,
      match_confidence real DEFAULT 0 NOT NULL,
      match_reason text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_contact_source_links_project
      ON project_contact_source_links(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_contact_source_links_contact
      ON project_contact_source_links(project_contact_id);
    CREATE INDEX IF NOT EXISTS idx_project_contact_source_links_source
      ON project_contact_source_links(source_system, source_record_type, source_record_id);
    CREATE INDEX IF NOT EXISTS idx_project_contact_source_links_status
      ON project_contact_source_links(project_id, match_status);
  `)
}

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|llc|ltd|co|company|corp|corporation)\b/g, " ")
    .replace(/\b(scheduling|estimating|department|dept)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function contactKeys(contact) {
  return [
    { value: contact.display_name },
    { value: contact.company_name },
    ...contactAliases(contact).map((value) => ({ value })),
  ]
    .filter((item) => item.value)
    .filter(
      (item) =>
        !isInternalCompanyOnly(item.value) || isInternalCompanyContact(contact)
    )
    .map((item) => normalize(item.value))
    .filter((key) => key.length >= 3)
}

function compact(value) {
  return value.replace(/\s+/g, "")
}

function isInternalCompanyOnly(value) {
  const normalized = normalize(value)
  return normalized === "high performance structures" || normalized === "hps"
}

function isPendingAssignmentSource(value) {
  return /\b(tbd|to\s+be\s+determined)\b/i.test(value)
}

function isInternalCompanyContact(contact) {
  return (
    contact.contact_type === "internal" &&
    (isInternalCompanyOnly(contact.display_name) ||
      normalize(contact.display_name) === "open range construction")
  )
}

function contactAliases(contact) {
  if (normalize(contact.display_name) === "open range construction") {
    return ["ORC"]
  }

  if (isInternalCompanyOnly(contact.display_name)) {
    return ["HPS"]
  }

  return []
}

function displayKey(value) {
  return normalize(value)
    .replace(/\s+/g, " ")
}

function sourceContains(source, candidate) {
  const sourceKey = displayKey(source)
  const candidateKey = displayKey(candidate)
  if (candidateKey.length < 3) return false

  if (candidateKey.length <= 3) {
    return (
      sourceKey === candidateKey ||
      new RegExp(`\\b${candidateKey}\\b`, "i").test(sourceKey)
    )
  }

  return (
    sourceKey === candidateKey ||
    sourceKey.includes(candidateKey) ||
    new RegExp(`\\b${candidateKey}\\b`, "i").test(sourceKey) ||
    compact(sourceKey).includes(compact(candidateKey))
  )
}

function sourceCandidates(contacts) {
  const byName = new Map()

  for (const contact of contacts) {
    const names = [
      { value: contact.display_name, type: "display" },
      { value: contact.company_name, type: "company" },
      ...contactAliases(contact).map((value) => ({ value, type: "alias" })),
    ].filter(
      (item) =>
        item.value &&
        (!isInternalCompanyOnly(item.value) || isInternalCompanyContact(contact))
    )

    for (const item of names) {
      const key = displayKey(item.value)
      if (key.length < 3 || byName.has(key)) continue

      byName.set(key, {
        sourceName: item.value,
        key,
        type: item.type,
        contactId: contact.id,
      })
    }
  }

  return Array.from(byName.values()).sort(
    (left, right) => right.key.length - left.key.length
  )
}

function removeInternalCompany(value) {
  return value
    .replace(INTERNAL_COMPANY_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function expandScheduleAssignees(row, candidates) {
  const rawName = row.assigned_to.trim()
  const matchedCandidates = candidates.filter((candidate) =>
    sourceContains(rawName, candidate.sourceName)
  )

  if (matchedCandidates.length > 0) {
    return matchedCandidates.map((candidate) => ({
      projectId: row.project_id,
      sourceSystem: "compass_schedule",
      sourceRecordType: "schedule_task",
      sourceRecordId: row.id,
      sourceRecordNumber: null,
      sourceLabel: row.title,
      sourceName: candidate.sourceName,
      sourceContext: rawName,
    }))
  }

  const withoutInternalCompany = removeInternalCompany(rawName)
  if (withoutInternalCompany.length === 0 || isInternalCompanyOnly(rawName)) {
    return []
  }

  return [
    {
      projectId: row.project_id,
      sourceSystem: "compass_schedule",
      sourceRecordType: "schedule_task",
      sourceRecordId: row.id,
      sourceRecordNumber: null,
      sourceLabel: row.title,
      sourceName: withoutInternalCompany,
      sourceContext: rawName,
    },
  ]
}

function matchContacts(sourceName, contacts) {
  const source = normalize(sourceName)
  const sourceCompact = compact(source)
  if (source.length < 3) return []

  const exact = contacts.filter((contact) =>
    contactKeys(contact).some(
      (key) => source === key || sourceCompact === compact(key)
    )
  )
  if (exact.length > 0) {
    return exact.map((contact) => ({
      contact,
      confidence: 1,
      reason: "Exact normalized name match.",
    }))
  }

  return contacts
    .map((contact) => {
      const key = contactKeys(contact).find(
        (candidate) => {
          if (candidate === "orc" || candidate === "hps") {
            return (
              source === candidate ||
              new RegExp(`\\b${candidate}\\b`, "i").test(source)
            )
          }

          return (
            candidate.length >= 5 &&
            (source.includes(candidate) ||
              candidate.includes(source) ||
              sourceCompact.includes(compact(candidate)) ||
              compact(candidate).includes(sourceCompact))
          )
        }
      )
      if (!key) return null

      return {
        contact,
        confidence: 0.82,
        reason: `Name contains normalized key "${key}".`,
      }
    })
    .filter(Boolean)
}

function loadSources(db, projectId, contacts) {
  const candidates = sourceCandidates(contacts)
  const operations = db
    .prepare(`
      SELECT
        id,
        source_system,
        source_record_type,
        source_record_number,
        title,
        company_name,
        assignee_name
      FROM project_operations
      WHERE project_id = ?
        AND company_name IS NOT NULL
        AND trim(company_name) <> ''
    `)
    .all(projectId)
    .map((row) => ({
      projectId,
      sourceSystem: row.source_system || "sage_operation",
      sourceRecordType: row.source_record_type,
      sourceRecordId: row.id,
      sourceRecordNumber: row.source_record_number,
      sourceLabel: row.title,
      sourceName: row.company_name,
    }))

  const schedule = db
    .prepare(`
      SELECT project_id, id, title, assigned_to
      FROM schedule_tasks
      WHERE project_id = ?
        AND assigned_to IS NOT NULL
        AND trim(assigned_to) <> ''
    `)
    .all(projectId)
    .flatMap((row) => expandScheduleAssignees(row, candidates))

  return [...operations, ...schedule]
}

function insertLink(db, source, match) {
  const id = `contact-link-${idPart([
    source.projectId,
    source.sourceSystem,
    source.sourceRecordType,
    source.sourceRecordId,
    source.sourceName,
    match.projectContactId ?? match.matchStatus,
  ].join("-"))}`

  db.prepare(`
    INSERT INTO project_contact_source_links (
      id, project_id, project_contact_id, source_system, source_record_type,
      source_record_id, source_record_number, source_label, source_name,
      match_status, match_confidence, match_reason, created_at, updated_at
    ) VALUES (
      @id, @projectId, @projectContactId, @sourceSystem, @sourceRecordType,
      @sourceRecordId, @sourceRecordNumber, @sourceLabel, @sourceName,
      @matchStatus, @matchConfidence, @matchReason, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      project_contact_id = excluded.project_contact_id,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      match_reason = excluded.match_reason,
      updated_at = excluded.updated_at
  `).run({
    id,
    projectId: source.projectId,
    projectContactId: match.projectContactId,
    sourceSystem: source.sourceSystem,
    sourceRecordType: source.sourceRecordType,
    sourceRecordId: source.sourceRecordId,
    sourceRecordNumber: source.sourceRecordNumber,
    sourceLabel: source.sourceLabel,
    sourceName: source.sourceName,
    matchStatus: match.matchStatus,
    matchConfidence: match.matchConfidence,
    matchReason: source.sourceContext
      ? `${match.matchReason} Source assignment: ${source.sourceContext}.`
      : match.matchReason,
    createdAt: NOW,
    updatedAt: NOW,
  })

  return match.matchStatus
}

function reconcileProject(db, projectId) {
  const contacts = db
    .prepare(`
      SELECT id, display_name, company_name, contact_type
      FROM project_contacts
      WHERE project_id = ?
        AND active = 1
    `)
    .all(projectId)
  const sources = loadSources(db, projectId, contacts)

  db.prepare("DELETE FROM project_contact_source_links WHERE project_id = ?").run(
    projectId
  )

  const counts = { matched: 0, review: 0, unmatched: 0 }
  const review = []

  for (const source of sources) {
    if (isPendingAssignmentSource(source.sourceName)) {
      const status = insertLink(db, source, {
        projectContactId: null,
        matchStatus: "pending_assignment",
        matchConfidence: 0,
        matchReason:
          "Pending assignment. TBD means To Be Determined and should not match Sage until a real subcontractor or supplier is selected.",
      })
      counts[status] = (counts[status] ?? 0) + 1
      continue
    }

    const matches = matchContacts(source.sourceName, contacts)

    if (matches.length === 1) {
      const status = insertLink(db, source, {
        projectContactId: matches[0].contact.id,
        matchStatus: "matched",
        matchConfidence: matches[0].confidence,
        matchReason: matches[0].reason,
      })
      counts[status] += 1
      continue
    }

    if (matches.length > 1) {
      const names = matches.map((match) => match.contact.display_name).join(", ")
      const status = insertLink(db, source, {
        projectContactId: null,
        matchStatus: "review",
        matchConfidence: 0.5,
        matchReason: `Multiple possible contacts: ${names}`,
      })
      counts[status] += 1
      review.push({ sourceName: source.sourceName, sourceLabel: source.sourceLabel, reason: names })
      continue
    }

    const status = insertLink(db, source, {
      projectContactId: null,
      matchStatus: "unmatched",
      matchConfidence: 0,
      matchReason: "No Compass project contact matched this source name.",
    })
    counts[status] += 1
    review.push({ sourceName: source.sourceName, sourceLabel: source.sourceLabel, reason: "No match" })
  }

  const finalCounts = db
    .prepare(`
      SELECT match_status, count(*) AS count
      FROM project_contact_source_links
      WHERE project_id = ?
      GROUP BY match_status
    `)
    .all(projectId)
    .reduce(
      (acc, row) => ({ ...acc, [row.match_status]: row.count }),
      { matched: 0, review: 0, unmatched: 0 }
    )

  return {
    projectId,
    sourceCount: sources.length,
    matched: finalCounts.matched,
    reviewCount: finalCounts.review,
    unmatched: finalCounts.unmatched,
    reviewSamples: review.slice(0, 20),
  }
}

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")
ensureTable(db)

const run = db.transaction(() =>
  PROJECT_IDS.map((projectId) => reconcileProject(db, projectId))
)

console.log(JSON.stringify({ dbPath: DB_PATH, results: run() }, null, 2))
