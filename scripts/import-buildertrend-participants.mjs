/*
 * Who a Buildertrend message participant is in Compass.
 *
 * Buildertrend message pages show names (sometimes emails) but not BT
 * participant ids. Owner decision 2026-11-01, applied in this order:
 *   0. a reviewed participant-map entry for the exact `namespace:participantId`
 *      (only when the capture saw an id) always wins;
 *   a. the exact email shown (case-insensitive, trimmed) -> the single person
 *      in the organization's directory with that email;
 *   b. otherwise the exact full display name (case-insensitive, whitespace
 *      normalized; never fuzzy, initials or nicknames) matching exactly one
 *      person: first among the project's own people, then among the BT people
 *      catalog, whose single hit must resolve to exactly one Compass person by
 *      its exact BT id, else by its email;
 *   c. otherwise the participant is unmatched or ambiguous and the whole
 *      thread goes to review.
 * Used by scripts/import-buildertrend-messages.mjs; see
 * docs/plans/bt-messages-live-conversations.md.
 */

export const DIRECTORY_SCHEMA = "bt-directory-snapshot/v1"
const KINDS = new Set(["staff", "owner", "vendor"])
const CATALOG_TYPES = new Set(["internal_user", "vendor_company", "vendor_contact", "customer"])

export function normalizeEmail(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null
}

export function normalizeName(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ").toLowerCase() : null
}

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * The organization's people, exported read-only just before a run. One row
 * per person; the export groups a user with the project/vendor/customer
 * contacts that are the same person.
 *   { personKey, kind: staff|owner|vendor, displayName, emails: [],
 *     userId?, projectIds: [] (projects the person is staff on or a contact of),
 *     projectContactIds: { projectId: contactId }, vendorId?, vendorContactId?,
 *     customerId?, customerContactId?, btIds: ["vendor_contact:123", ...] }
 */
export function parseDirectory(value) {
  if (value?.schema !== DIRECTORY_SCHEMA) throw new Error(`directory schema must be ${DIRECTORY_SCHEMA}`)
  if (!Array.isArray(value.people)) throw new Error("directory people must be a list")
  const people = value.people.map((row, index) => {
    const personKey = text(row?.personKey)
    if (!personKey) throw new Error(`directory people[${index}].personKey is required`)
    if (!KINDS.has(row.kind)) throw new Error(`directory people[${index}].kind must be staff, owner or vendor`)
    if (row.kind === "staff" && !text(row.userId)) throw new Error(`directory people[${index}]: staff need a userId`)
    return {
      personKey,
      kind: row.kind,
      displayName: text(row.displayName) ?? personKey,
      names: new Set([normalizeName(row.displayName)].filter(Boolean)),
      emails: new Set((Array.isArray(row.emails) ? row.emails : []).map(normalizeEmail).filter(Boolean)),
      userId: text(row.userId),
      projectIds: new Set(Array.isArray(row.projectIds) ? row.projectIds : []),
      projectContactIds: row.projectContactIds && typeof row.projectContactIds === "object" ? row.projectContactIds : {},
      links: {
        vendorId: text(row.vendorId), vendorContactId: text(row.vendorContactId),
        customerId: text(row.customerId), customerContactId: text(row.customerContactId),
      },
      btIds: new Set(Array.isArray(row.btIds) ? row.btIds : []),
    }
  })
  return { people }
}

/** The BT people catalog captured from Buildertrend (JSONL rows). */
export function parsePeopleCatalog(textValue) {
  return textValue.split(/\r?\n/).filter((line) => line.trim() !== "").map((line, index) => {
    const row = JSON.parse(line)
    const btId = typeof row.btId === "number" ? String(row.btId) : text(row.btId)
    if (!btId) throw new Error(`catalog line ${index + 1}: btId is required`)
    if (!CATALOG_TYPES.has(row.type)) throw new Error(`catalog line ${index + 1}: type must be internal_user, vendor_company, vendor_contact or customer`)
    return {
      btId, type: row.type,
      parentBtId: row.parentBtId == null ? null : String(row.parentBtId),
      name: normalizeName(row.displayName),
      email: normalizeEmail(row.email),
    }
  })
}

/** The importer's participant entry for a matched directory person on a project. */
function entryFor(person) {
  const base = { kind: person.kind, identity: `person:${person.personKey}`, contactIds: person.projectContactIds }
  if (person.userId) return { ...base, decision: "user", userId: person.userId }
  return {
    ...base, decision: "new_contact", userId: null,
    displayName: person.displayName, email: [...person.emails][0] ?? null, companyName: null, links: person.links,
  }
}

function one(list) {
  return list.length === 1 ? list[0] : list.length === 0 ? null : "ambiguous"
}

/**
 * Builds the resolver for one run. `resolve(ref, projectId)` returns
 * `{ entry, rule }` or `{ reason: "participant_unmatched" | "participant_ambiguous" }`.
 */
export function createParticipantResolver(input) {
  const { participantMap, directory, catalog } = input
  const people = directory?.people ?? []
  const byEmail = (email) => people.filter((person) => person.emails.has(email))
  return function resolve(ref, projectId) {
    if (ref.participantId) {
      const mapped = participantMap.get(`${ref.namespace}:${ref.participantId}`)
      if (mapped) return { entry: mapped, rule: "by_map" }
    }
    const email = normalizeEmail(ref.email)
    if (email) {
      const hit = one(byEmail(email))
      if (hit === "ambiguous") return { reason: "participant_ambiguous" }
      if (hit) return { entry: entryFor(hit), rule: "by_email" }
    }
    const name = normalizeName(ref.displayName)
    if (!name) return { reason: "participant_unmatched" }
    const named = people.filter((person) => person.names.has(name))
    const inProject = one(named.filter((person) => person.projectIds.has(projectId) || person.projectContactIds[projectId]))
    if (inProject === "ambiguous") return { reason: "participant_ambiguous" }
    if (inProject) return { entry: entryFor(inProject), rule: "by_name_project" }
    const catalogHit = one((catalog ?? []).filter((row) => row.name === name))
    if (catalogHit === "ambiguous") return { reason: "participant_ambiguous" }
    if (!catalogHit) return { reason: "participant_unmatched" }
    // The catalog hit must be exactly one Compass person: by exact BT id, else by email.
    const byId = people.filter((person) => person.btIds.has(`${catalogHit.type}:${catalogHit.btId}`))
    const resolved = byId.length > 0 ? one(byId) : catalogHit.email ? one(byEmail(catalogHit.email)) : null
    if (resolved === "ambiguous") return { reason: "participant_ambiguous" }
    if (!resolved) return { reason: "participant_unmatched" }
    return { entry: entryFor(resolved), rule: "by_name_catalog" }
  }
}
