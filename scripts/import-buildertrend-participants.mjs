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
 *   c. a unique catalog match (by email, else exact name) that resolves to no
 *      Compass record becomes a new, uninvited directory contact (owner
 *      decision 1): a vendor contact under the vendor matched by the catalog
 *      parent's exact BT id (the vendor is created too when it is missing), or
 *      a customer contact under the project's single client. Staff
 *      (internal_user) must be real users, so they go to review;
 *   d. otherwise the participant is unmatched or ambiguous. Owner decision
 *      2026-11-02: the thread imports STAFF-ONLY with the participant kept
 *      exactly as shown and unresolved. An ambiguous participant (several
 *      exact candidates) is never attached to any candidate and never becomes
 *      a new contact; only a zero-match person may become a new contact.
 * Used by scripts/import-buildertrend-messages.mjs; see
 * docs/plans/bt-messages-live-conversations.md.
 */

import { createHash } from "node:crypto"

export const DIRECTORY_SCHEMA = "bt-directory-snapshot/v1"
const KINDS = new Set(["staff", "owner", "vendor"])
const CATALOG_TYPES = new Set(["internal_user", "vendor_company", "vendor_contact", "customer"])

export function normalizeEmail(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null
}

export function normalizeName(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ").toLowerCase() : null
}

/**
 * Legal-entity suffixes ignored when comparing company names (owner decision
 * 2026-11-02: "ABC Plumbing" and "ABC Plumbing LLC" are the same company).
 * Compared after punctuation is removed, so "L.L.C." is "llc".
 */
export const COMPANY_NAME_SUFFIXES = ["llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "lp", "llp", "pllc", "pc"]

/**
 * A company name for exact comparison: lowercased, punctuation (. , ' ")
 * removed, whitespace collapsed, and trailing legal-entity suffixes dropped.
 * Nothing else is changed: no fuzzy matching.
 */
export function normalizeCompanyName(value) {
  if (typeof value !== "string") return null
  const words = value.toLowerCase().replace(/[.,'"]/g, "").trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && COMPANY_NAME_SUFFIXES.includes(words[words.length - 1])) words.pop()
  return words.length > 0 ? words.join(" ") : null
}

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * The organization's people, exported read-only just before a run. One row
 * per person; the export groups a user with the project/vendor/customer
 * contacts that are the same person.
 *   { personKey, kind: staff|owner|vendor, displayName, names: [], emails: [],
 *     userId?, projectIds: [] (projects the person is staff on or a contact of),
 *     projectContactIds: { projectId: contactId }, vendorId?, vendorContactId?,
 *     customerId?, customerContactId?, btIds: ["vendor_contact:123", ...] }
 * plus optional `vendors: [{ vendorId, btId }]` (vendors registered with a BT
 * company id), `vendorNames: [{ vendorId, name }]` (active vendors) and
 * `projects: [{ projectId, clientCustomerIds: [] }]`.
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
      names: new Set([row.displayName, ...(Array.isArray(row.names) ? row.names : [])].map(normalizeName).filter(Boolean)),
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
  const vendorsByBtId = new Map()
  for (const row of Array.isArray(value.vendors) ? value.vendors : []) {
    const btId = text(row?.btId == null ? null : String(row.btId))
    const vendorId = text(row?.vendorId)
    if (!btId || !vendorId) continue
    vendorsByBtId.set(btId, [...(vendorsByBtId.get(btId) ?? []), vendorId])
  }
  // Active vendors by normalized company name (see normalizeCompanyName).
  const vendorsByName = new Map()
  for (const row of Array.isArray(value.vendorNames) ? value.vendorNames : []) {
    const name = normalizeCompanyName(row?.name)
    const vendorId = text(row?.vendorId)
    if (!name || !vendorId) continue
    vendorsByName.set(name, [...new Set([...(vendorsByName.get(name) ?? []), vendorId])])
  }
  const projectClients = new Map()
  for (const row of Array.isArray(value.projects) ? value.projects : []) {
    if (text(row?.projectId)) projectClients.set(row.projectId, [...new Set((row.clientCustomerIds ?? []).filter((id) => text(id)))])
  }
  return { people, vendorsByBtId, vendorsByName, projectClients }
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
      displayName: text(row.displayName),
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

function shortId(prefix, ...parts) {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 32)}`
}

/**
 * A catalog person with no Compass record becomes a new, uninvited directory
 * contact. Ids come from the organization and the exact BT ids, so re-runs
 * never create a second copy.
 */
function newContactFromCatalog(input) {
  const { row, catalog, directory, organizationId, projectId } = input
  if (!row.displayName) return { reason: "participant_unmatched" }
  const base = { decision: "new_contact", userId: null, contactIds: {}, displayName: row.displayName, email: row.email, companyName: null }
  if (row.type === "vendor_contact" || row.type === "vendor_company") {
    const companyBtId = row.type === "vendor_company" ? row.btId : row.parentBtId
    if (!companyBtId) return { reason: "participant_unmatched" }
    const vendors = directory?.vendorsByBtId.get(companyBtId) ?? []
    if (vendors.length > 1) return { reason: "participant_ambiguous" }
    const parent = catalog.find((entry) => entry.type === "vendor_company" && entry.btId === companyBtId)
    const namedVendor = vendors.length === 0 ? vendorByExactName(directory, parent?.displayName ?? null) : null
    const vendor = vendors.length === 1
      ? { id: vendors[0], create: false }
      : namedVendor
        ? { id: namedVendor, create: false }
        : parent?.displayName
        ? { id: shortId("bt-vendor", organizationId, companyBtId), create: true, name: parent.displayName, btId: companyBtId }
        : null
    if (!vendor) return { reason: "participant_unmatched" }
    const vendorContactId = shortId("bt-vendor-contact", organizationId, row.type, row.btId)
    return {
      entry: {
        ...base, kind: "vendor", identity: `catalog:${row.type}:${row.btId}`,
        companyName: parent?.displayName ?? null,
        links: { vendorId: vendor.id, vendorContactId },
        createDirectory: {
          vendor: vendor.create ? { id: vendor.id, name: vendor.name, btId: vendor.btId } : null,
          // A company participant is recorded as the company's own contact.
          vendorContact: { id: vendorContactId, vendorId: vendor.id, name: row.displayName, email: row.email, btId: row.type === "vendor_contact" ? row.btId : null },
          customerContact: null,
        },
      },
      rule: "new_contact_from_catalog",
    }
  }
  if (row.type === "customer") {
    const clients = directory?.projectClients.get(projectId) ?? []
    if (clients.length !== 1) return { reason: clients.length > 1 ? "participant_ambiguous" : "participant_unmatched" }
    const customerContactId = shortId("bt-customer-contact", organizationId, row.btId)
    return {
      entry: {
        ...base, kind: "owner", identity: `catalog:customer:${row.btId}`,
        links: { customerId: clients[0], customerContactId },
        createDirectory: {
          vendor: null, vendorContact: null,
          customerContact: { id: customerContactId, customerId: clients[0], name: row.displayName, email: row.email, btId: row.btId },
        },
      },
      rule: "new_contact_from_catalog",
    }
  }
  // internal_user with no active Compass user: a former employee (owner
  // decision 2026-11-02). Added as an archived internal contact so they never
  // show in employee lists or pickers, but still read as the sender.
  if (row.type === "internal_user") return formerEmployee({ row, organizationId })
  return { reason: "participant_unmatched" }
}

function formerEmployee({ row, organizationId }) {
  const key = row.btId ? `bt:${row.btId}` : row.email ? `email:${row.email}` : `name:${row.name}`
  const internalContactId = shortId("bt-former-employee", organizationId, key)
  return {
    entry: {
      decision: "new_contact", kind: "former_staff", userId: null, contactIds: {}, identity: `former:${key}`,
      displayName: row.displayName, email: row.email, companyName: null,
      links: { internalContactId },
      createDirectory: {
        vendor: null, vendorContact: null, customerContact: null,
        internalContact: { id: internalContactId, name: row.displayName, email: row.email, btId: row.btId },
      },
    },
    rule: "former_employee_archived",
  }
}

/**
 * The one active vendor whose normalized name matches exactly (see
 * normalizeCompanyName). Zero or several matches: none.
 */
function vendorByExactName(directory, companyName) {
  const name = normalizeCompanyName(companyName)
  const ids = name ? directory?.vendorsByName?.get(name) ?? [] : []
  return ids.length === 1 ? ids[0] : null
}

/** Looks like one whole person: an exact email, or a name of two or more words. */
export function isFullPersonText(value) {
  const textValue = typeof value === "string" ? value.trim() : ""
  if (textValue.includes("@") && !/\s/.test(textValue)) return normalizeEmail(textValue) !== null
  return textValue.split(/\s+/).filter(Boolean).length >= 2 && !/[,;]/.test(textValue)
}

/**
 * Nobody in Compass matches: a new, uninvited directory person (owner decision
 * 2026-11-02), not yet connected to any company. Keyed by the exact email,
 * else the exact full name, so every message and project reuses one person.
 */
function newUnassignedPerson(ref, context) {
  const email = normalizeEmail(ref.email)
  const name = normalizeName(ref.displayName)
  if (!email && !(name && isFullPersonText(ref.displayName))) return { reason: "participant_unmatched" }
  const identity = email ? `new:email:${email}` : `new:name:${name}`
  const displayName = ref.displayName?.trim().replace(/\s+/g, " ") ?? email
  // The source named their company and it is exactly one Compass vendor:
  // connect them as that vendor's contact (owner decision 2026-11-02).
  const vendorId = vendorByExactName(context.directory, ref.companyName ?? context.companyName ?? null)
  if (vendorId) {
    const vendorContactId = shortId("bt-vendor-contact", context.organizationId, identity)
    return {
      entry: {
        decision: "new_contact", kind: "vendor", userId: null, contactIds: {}, identity,
        displayName, email, companyName: ref.companyName ?? context.companyName ?? null,
        links: { vendorId, vendorContactId },
        createDirectory: {
          vendor: null, customerContact: null, internalContact: null,
          vendorContact: { id: vendorContactId, vendorId, name: displayName, email, btId: null },
        },
      },
      rule: "connected_by_vendor_name",
    }
  }
  return {
    entry: {
      decision: "new_contact", kind: ref.namespace === "owner" ? "owner" : "vendor", unassigned: true,
      userId: null, contactIds: {}, identity,
      displayName, email, companyName: null, links: {},
    },
    rule: email ? "new_person_by_email" : "new_person_by_name",
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
  const { participantMap, directory } = input
  const catalog = input.catalog ?? []
  const organizationId = input.organizationId ?? null
  const people = directory?.people ?? []
  const byEmail = (email) => people.filter((person) => person.emails.has(email))
  /**
   * Is this exact text (a full name or an email) exactly one known person?
   * Project people first, then the whole directory, then the BT catalog; the
   * first tier with any match decides, and two matches there mean no.
   */
  function knownToken(token, projectId) {
    const email = token.includes("@") && !/\s/.test(token) ? normalizeEmail(token) : null
    if (email) {
      const tiers = [people.filter((person) => person.emails.has(email)), catalog.filter((row) => row.email === email)]
      const tier = tiers.find((list) => list.length > 0)
      return tier?.length === 1 ? { email } : null
    }
    const name = normalizeName(token)
    if (!name) return null
    const named = people.filter((person) => person.names.has(name))
    const tiers = [
      named.filter((person) => person.projectIds.has(projectId) || person.projectContactIds[projectId]),
      named,
      catalog.filter((row) => row.name === name),
    ]
    const tier = tiers.find((list) => list.length > 0)
    return tier?.length === 1 ? { displayName: token.trim().replace(/\s+/g, " ") } : null
  }

  function newPieceToken(piece) {
    const value = piece.trim()
    return value.includes("@") ? { email: normalizeEmail(value) } : { displayName: value.replace(/\s+/g, " ") }
  }

  /**
   * Splits an undivided recipient literal (BT renders a whole envelope field
   * as one string) into known people, exactly: the literal is cut only at
   * ", " or "; ", every piece must be the exact name or email of exactly one
   * known person, and exactly one complete way to cut it may exist. A known
   * "Smith, John" can keep its comma. Anything else: review.
   */
  function segment(literal, projectId) {
    const normalized = typeof literal === "string" ? literal.trim().replace(/\s+/g, " ") : ""
    if (!normalized) return { reason: "participant_boundary_unproven" }
    const pieces = normalized.split(/(, |; )/)
    const words = pieces.filter((_, index) => index % 2 === 0)
    const seps = pieces.filter((_, index) => index % 2 === 1)
    const text = (from, to) => words.slice(from, to).map((word, index) => (index === 0 ? word : `${seps[from + index - 1]}${word}`)).join("")
    // ways[i]: complete cuttings of words[i..] (counted up to 2) and one of them.
    const ways = new Array(words.length + 1).fill(null)
    ways[words.length] = { count: 1, tokens: [] }
    for (let from = words.length - 1; from >= 0; from -= 1) {
      let count = 0
      let tokens = null
      for (let to = from + 1; to <= words.length; to += 1) {
        const rest = ways[to]
        if (!rest || rest.count === 0) continue
        const piece = text(from, to)
        // An unknown piece may be a new person, but only a single, separator-free
        // piece that looks like one whole person; known people may keep a comma.
        const token = knownToken(piece, projectId) ?? (to === from + 1 && isFullPersonText(piece) ? newPieceToken(piece) : null)
        if (!token) continue
        count += rest.count
        tokens ??= [token, ...rest.tokens]
      }
      ways[from] = { count: Math.min(count, 2), tokens }
    }
    const result = ways[0]
    if (result.count === 1 && result.tokens) return { tokens: result.tokens }
    // Owner decision 2026-11-02: a literal that does not split in exactly one
    // way (an unknown one-word piece, or two valid cuts) holds the thread.
    // Its person boundaries are unproven, so it is never imported, not even
    // staff-only (`participant_ambiguous` is kept for one proven person who
    // matches several candidates, which imports staff-only).
    return { reason: "participant_boundary_unproven", hold: true, split: result.count === 0 ? "none" : "several" }
  }

  const resolve = function resolve(ref, projectId) {
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
    if (name) {
      const named = people.filter((person) => person.names.has(name))
      const inProject = one(named.filter((person) => person.projectIds.has(projectId) || person.projectContactIds[projectId]))
      if (inProject === "ambiguous") return { reason: "participant_ambiguous" }
      if (inProject) return { entry: entryFor(inProject), rule: "by_name_project" }
    }
    // The BT catalog: by the email shown first, else by the exact name.
    const byCatalogEmail = email ? catalog.filter((row) => row.email === email) : []
    const catalogHit = one(byCatalogEmail.length > 0 ? byCatalogEmail : name ? catalog.filter((row) => row.name === name) : [])
    if (catalogHit === "ambiguous") return { reason: "participant_ambiguous" }
    if (!catalogHit) return organizationId ? newUnassignedPerson(ref, { directory, organizationId }) : { reason: "participant_unmatched" }
    // The catalog hit must be exactly one Compass person: by exact BT id, else by email.
    const byId = people.filter((person) => person.btIds.has(`${catalogHit.type}:${catalogHit.btId}`))
    const resolved = byId.length > 0 ? one(byId) : catalogHit.email ? one(byEmail(catalogHit.email)) : null
    if (resolved === "ambiguous") return { reason: "participant_ambiguous" }
    if (!resolved) {
      if (!organizationId) return { reason: "participant_unmatched" }
      const created = newContactFromCatalog({ row: catalogHit, catalog, directory, organizationId, projectId })
      // No company to attach them to: still add them, unassigned.
      const parent = catalog.find((row) => row.type === "vendor_company" && row.btId === catalogHit.parentBtId)
      return created.reason === "participant_unmatched"
        ? newUnassignedPerson(ref, { directory, organizationId, companyName: parent?.displayName ?? null })
        : created
    }
    return { entry: entryFor(resolved), rule: byCatalogEmail.length > 0 ? "by_email_catalog" : "by_name_catalog" }
  }
  resolve.segment = segment
  return resolve
}
