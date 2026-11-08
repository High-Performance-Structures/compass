#!/usr/bin/env bun
// Read-only dry run of the automatic matching on Contacts → Needs review:
// how many names/emails (and message rows) the automatic pass WOULD resolve,
// by match type, and the leftovers staff would still review. It only runs
// single SELECT statements through wrangler and never writes.
//
//   bun scripts/contact-review-dry-run.mjs                    # local D1
//   bun scripts/contact-review-dry-run.mjs --remote           # production D1 (read only)
//   bun scripts/contact-review-dry-run.mjs --org <id>         # one organization (default: every one with rows)
//   bun scripts/contact-review-dry-run.mjs --json             # the full plan as JSON
//   bun scripts/contact-review-dry-run.mjs --include-staff-only  # also projects whose imported conversations are kept staff-only
//   # What-ifs, without saving anything:
//   bun scripts/contact-review-dry-run.mjs --remote --company-domains old.com,new.com
//   bun scripts/contact-review-dry-run.mjs --remote --assume-other-email name@old.com=name@new.com
//
// The rules are the app's own: src/lib/domain/conversations/participant-matching.ts
// and participant-directory.ts.
import { execFileSync } from "node:child_process"

import { buildMatchDirectory } from "../src/lib/domain/conversations/participant-directory.ts"
import { isInternalStaffRole } from "../src/lib/user-roles.ts"
import { planUnassigned, summarizeUnassignedPlan } from "../src/lib/domain/contacts/unassigned-matching.ts"
import { IDENTITY_KEY_SQL, MATCH_TYPES, MATCH_TYPE_LABELS, identityFromKey, matchParticipant } from "../src/lib/domain/conversations/participant-matching.ts"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function argValues(name) {
  return process.argv.flatMap((value, index) => (value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []))
}

const remote = process.argv.includes("--remote")
const json = process.argv.includes("--json")
// The "Include projects whose imported conversations are kept staff-only" box: those projects count as writable.
const includeStaffOnly = process.argv.includes("--include-staff-only")
const database = argValue("--database") ?? "compass-db"
const onlyOrg = argValue("--org")
const extraDomains = (argValue("--company-domains") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
const assumedOther = argValues("--assume-other-email").map((pair) => {
  const [other, signIn] = pair.split("=")
  return { other: other?.trim().toLowerCase(), signIn: signIn?.trim().toLowerCase() }
}).filter((pair) => pair.other && pair.signIn)

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`

/** Runs one SELECT through wrangler and returns its rows. */
function select(sql) {
  // Guard: this report must never write.
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("contact-review-dry-run only runs single SELECT statements")
  const output = execFileSync(
    "bunx",
    ["wrangler", "d1", "execute", database, remote ? "--remote" : "--local", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  )
  return JSON.parse(output).flatMap((result) => result.results ?? [])
}

/** Optional tables (a migration not applied yet) read as empty. */
function selectOptional(sql) {
  try {
    return select(sql)
  } catch {
    return []
  }
}

const UNRESOLVED = `p.review_status = 'unreviewed' AND p.active = 0
  AND p.project_contact_id IS NULL AND p.user_id IS NULL
  AND p.source_record_type LIKE '%\\_message' ESCAPE '\\'
  AND p.identity_status = 'unmatched'
  AND NOT EXISTS (SELECT 1 FROM project_source_record_participants l
    WHERE l.organization_id = p.organization_id AND l.project_id = p.project_id
      AND l.source_record_type = p.source_record_type AND l.source_record_id = p.source_record_id
      AND l.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\' AND l.source_contact_name = p.source_contact_name)`

const groupsAll = select(`SELECT p.organization_id AS organizationId, ${IDENTITY_KEY_SQL} AS identityKey, p.project_id AS projectId,
    MAX(pr.imported_conversations_staff_only) AS staffOnly, COUNT(*) AS rowCount,
    COALESCE(MAX(CASE WHEN instr(p.source_contact_name, '<') > 0 THEN p.source_contact_name END), MIN(p.source_contact_name), MIN(p.source_participant_id)) AS literal
  FROM project_source_record_participants p JOIN projects pr ON pr.id = p.project_id
  WHERE ${UNRESOLVED} ${onlyOrg ? `AND p.organization_id = ${quote(onlyOrg)}` : ""}
  GROUP BY 1, 2, 3`)
const runTogether = select(`SELECT COUNT(*) AS n FROM project_source_record_participants p
  WHERE p.review_status = 'unreviewed' AND p.identity_status LIKE 'boundary\\_unproven:%' ESCAPE '\\' ${onlyOrg ? `AND p.organization_id = ${quote(onlyOrg)}` : ""}`)[0]?.n ?? 0

const unassignedAll = select(`SELECT pr.organization_id AS organizationId, pc.id AS contactId, pc.source_entity_id AS identity, pc.display_name AS name,
    pc.email, pc.project_id AS projectId, pr.imported_conversations_staff_only AS staffOnly
  FROM project_contacts pc JOIN projects pr ON pr.id = pc.project_id
  WHERE pc.source_entity_type = 'buildertrend_new_person' AND pc.active = 1 AND pc.vendor_id IS NULL AND pc.customer_id IS NULL
    ${onlyOrg ? `AND pr.organization_id = ${quote(onlyOrg)}` : ""}`)

const orgs = [...new Set([...groupsAll, ...unassignedAll].map((group) => group.organizationId))]
const report = []

for (const organizationId of orgs) {
  const org = quote(organizationId)
  const staff = select(`SELECT u.id AS userId, u.email, COALESCE(u.display_name, trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) AS name,
      u.is_active AS active, u.phone, om.role FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = ${org}`)
    .filter((row) => isInternalStaffRole(row.role))
  const internal = select(`SELECT id, user_id AS userId, name, email, active, phone FROM internal_contacts WHERE organization_id = ${org}`)
  const alternates = selectOptional(`SELECT user_id AS userId, email FROM user_alternate_emails WHERE organization_id = ${org}`)
  for (const pair of assumedOther) {
    const owner = staff.find((row) => row.email?.toLowerCase() === pair.signIn)
    if (owner) alternates.push({ userId: owner.userId, email: pair.other })
    else console.error(`--assume-other-email: no staff sign-in ${pair.signIn}`)
  }
  const vendors = select(`SELECT id, name, email, primary_email AS primaryEmail, category FROM vendors WHERE organization_id = ${org} AND merged_into_vendor_id IS NULL`)
  const vendorPeople = select(`SELECT vc.id, vc.vendor_id AS vendorId, v.name AS vendorName, vc.name, vc.email, vc.user_id AS userId, vc.active, vc.phone
    FROM vendor_contacts vc JOIN vendors v ON v.id = vc.vendor_id
    WHERE v.organization_id = ${org} AND v.merged_into_vendor_id IS NULL AND vc.merged_into_person_id IS NULL`)
  const clientPeople = select(`SELECT cc.id, cc.customer_id AS customerId, COALESCE(NULLIF(trim(c.company), ''), c.name) AS customerName, cc.name, cc.email, cc.user_id AS userId, cc.active, cc.phone
    FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id
    WHERE c.organization_id = ${org} AND c.merged_into_customer_id IS NULL AND cc.merged_into_person_id IS NULL`)
  const projectContacts = select(`SELECT pc.id, pc.project_id AS projectId, pc.display_name AS name, pc.email, pc.phone, pc.contact_type AS contactType,
      pc.vendor_id AS vendorId, pc.customer_id AS customerId, pc.vendor_contact_id AS vendorContactId, pc.customer_contact_id AS customerContactId,
      pc.internal_contact_id AS internalContactId, pc.source_entity_type AS sourceEntityType, pc.source_entity_id AS sourceEntityId, pc.active
    FROM project_contacts pc JOIN projects p ON p.id = pc.project_id WHERE p.organization_id = ${org}`)
  const settings = selectOptional(`SELECT value FROM organization_feature_settings WHERE organization_id = ${org} AND feature_key = 'company-email-domains'`)[0]
  let savedDomains = []
  try {
    savedDomains = settings ? JSON.parse(settings.value).domains ?? [] : []
  } catch {
    savedDomains = []
  }
  const bool = (value) => value === 1 || value === true
  const customers = select(`SELECT id, COALESCE(NULLIF(trim(company), ''), name) AS name, email FROM customers WHERE organization_id = ${org} AND merged_into_customer_id IS NULL`)
  const directoryRows = {
    staff: staff.map((row) => ({ ...row, active: bool(row.active), name: row.name || null })),
    internal: internal.map((row) => ({ ...row, active: bool(row.active) })),
    alternates,
    vendors,
    vendorPeople: vendorPeople.map((row) => ({ ...row, active: bool(row.active) })),
    clientPeople: clientPeople.map((row) => ({ ...row, active: bool(row.active) })),
    projectContacts: projectContacts.map((row) => ({ ...row, name: row.name ?? "", active: bool(row.active) })),
    companyDomains: [...savedDomains, ...extraDomains],
  }
  const built = buildMatchDirectory(directoryRows)
  // Contacts → Unassigned can connect people to clients too.
  const builtWithClients = buildMatchDirectory({ ...directoryRows, customers })
  const unassignedRows = unassignedAll.filter((row) => row.organizationId === organizationId).map((row) => ({ ...row, staffOnly: !includeStaffOnly && bool(row.staffOnly), name: row.name ?? "" }))
  const unassignedPlan = planUnassigned(builtWithClients, unassignedRows)

  const planned = groupsAll.filter((group) => group.organizationId === organizationId).flatMap((group) => {
    const identity = identityFromKey(group.identityKey)
    if (!identity) return []
    return [{ ...group, staffOnly: !includeStaffOnly && group.staffOnly === 1, result: matchParticipant(built.directory, identity, group.projectId) }]
  })
  report.push({ organizationId, built, planned, unassignedPlan })
}

const sum = (groups) => ({
  identities: new Set(groups.map((group) => `${group.organizationId}|${group.identityKey}`)).size,
  groups: groups.length,
  rows: groups.reduce((total, group) => total + group.rowCount, 0),
})

const all = report.flatMap((entry) => entry.planned)
const writable = all.filter((group) => !group.staffOnly)
const decided = writable.filter((group) => group.result.kind !== "none")
const leftovers = writable.filter((group) => group.result.kind === "none")

const describeTarget = (entry, result) => {
  if (result.kind === "vendor") return `new contact of ${result.vendorName}`
  const person = entry.built.people.get(result.ref)
  return person ? `${person.name} (${person.label})` : result.ref
}

const resolvedByIdentity = new Map()
for (const entry of report) {
  for (const group of entry.planned) {
    if (group.staffOnly || group.result.kind === "none") continue
    const id = `${group.identityKey}|${describeTarget(entry, group.result)}`
    const current = resolvedByIdentity.get(id) ?? { literal: group.literal, target: describeTarget(entry, group.result), matchType: group.result.matchType, projects: 0, rows: 0 }
    current.projects += 1
    current.rows += group.rowCount
    resolvedByIdentity.set(id, current)
  }
}
const leftoverByIdentity = new Map()
for (const group of leftovers) {
  const current = leftoverByIdentity.get(group.identityKey) ?? { literal: group.literal, reasons: new Set(), suggestion: null, projects: 0, rows: 0 }
  current.reasons.add(group.result.reason)
  current.suggestion ??= group.result.suggestion?.vendorName ?? null
  current.projects += 1
  current.rows += group.rowCount
  leftoverByIdentity.set(group.identityKey, current)
}

const summary = {
  database, remote, includeStaffOnly, companyDomainsAssumed: extraDomains, otherEmailsAssumed: assumedOther,
  total: sum(all), legalHold: sum(all.filter((group) => group.staffOnly)), resolved: sum(decided), leftover: sum(leftovers),
  runTogetherRows: runTogether,
  byMatchType: Object.fromEntries(MATCH_TYPES.map((type) => [type, sum(decided.filter((group) => group.result.matchType === type))])),
  resolutions: [...resolvedByIdentity.values()].sort((a, b) => b.rows - a.rows),
  leftovers: [...leftoverByIdentity.values()].sort((a, b) => b.rows - a.rows).map((item) => ({ ...item, reasons: [...item.reasons] })),
}

const unassignedPlan = report.flatMap((entry) => entry.unassignedPlan)
const unassignedSummary = summarizeUnassignedPlan(unassignedPlan)
const unassignedConnections = unassignedPlan
  .filter((group) => group.result.kind === "connect" && group.legalHoldRows < group.rows)
  .map((group) => ({ person: group.email ?? group.name, company: group.result.companyName, companyKind: group.result.companyKind, matchType: group.result.matchType, identities: group.identities.length, rows: group.rows }))
const unassignedLeftovers = unassignedPlan
  .filter((group) => group.result.kind !== "connect" && group.legalHoldRows < group.rows)
  .map((group) => ({ person: group.email ?? group.name, why: group.result.kind === "staff" ? `staff: ${group.result.name}` : group.result.reason, suggestion: group.result.kind === "none" ? group.result.suggestion?.vendorName ?? null : null, identities: group.identities.length, rows: group.rows }))

if (json) {
  console.log(JSON.stringify({ ...summary, unassigned: { summary: unassignedSummary, connections: unassignedConnections, leftovers: unassignedLeftovers } }, null, 2))
} else {
  const line = (label, value) => console.log(`${label.padEnd(36)} ${String(value.identities).padStart(6)} names ${String(value.groups).padStart(6)} groups ${String(value.rows).padStart(7)} rows`)
  console.log(`Contacts → Needs review dry run (${remote ? "remote" : "local"} ${database}; read only)`)
  if (includeStaffOnly) console.log("Including projects whose imported conversations are kept staff-only (conversations stay staff-only)")
  if (extraDomains.length) console.log(`Assuming company domains: ${extraDomains.join(", ")}`)
  if (assumedOther.length) console.log(`Assuming other emails: ${assumedOther.map((pair) => `${pair.other} → ${pair.signIn}`).join(", ")}`)
  line("Unresolved (person rows)", summary.total)
  line("  on legal-hold projects (untouched)", summary.legalHold)
  line("Would resolve automatically", summary.resolved)
  for (const type of MATCH_TYPES) if (summary.byMatchType[type].groups > 0) line(`  ${MATCH_TYPE_LABELS[type]}`, summary.byMatchType[type])
  line("Left for review", summary.leftover)
  console.log(`Names run together (split review): ${runTogether} rows`)
  console.log("\nLargest automatic resolutions:")
  for (const item of summary.resolutions.slice(0, 40)) console.log(`  ${String(item.rows).padStart(6)}  ${item.literal} → ${item.target}  [${item.matchType}, ${item.projects} projects]`)
  console.log("\nLeftovers (largest first):")
  for (const item of summary.leftovers) console.log(`  ${String(item.rows).padStart(6)}  ${item.literal}  [${item.reasons.join(", ")}, ${item.projects} projects]${item.suggestion ? `  suggest: ${item.suggestion}` : ""}`)
}

if (!json) {
  const u = unassignedSummary
  const uline = (label, value) => console.log(`${label.padEnd(36)} ${String(value.people).padStart(6)} people ${String(value.identities).padStart(6)} identities ${String(value.rows).padStart(6)} rows`)
  console.log("\nContacts → Unassigned")
  uline("Unassigned (active, no company)", u.total)
  console.log(`${"  duplicate groups (one person)".padEnd(36)} ${String(u.duplicateGroups).padStart(6)} people ${String(u.duplicateIdentities).padStart(6)} identities`)
  uline("  only on legal-hold projects", u.legalHoldOnly)
  uline("Would connect automatically", u.connect)
  for (const type of MATCH_TYPES) if (u.byMatchType[type]) uline(`  ${MATCH_TYPE_LABELS[type]}`, u.byMatchType[type])
  uline("Staff (not connected)", u.staff)
  uline("Left in Unassigned", u.leftover)
  console.log(`  with a suggested company: ${u.withSuggestion}`)
  console.log("\nUnassigned connections (first 40):")
  for (const item of unassignedConnections.slice(0, 40)) console.log(`  ${item.person} → ${item.company} (${item.companyKind}) [${item.matchType}${item.identities > 1 ? `, ${item.identities} duplicates` : ""}]`)
  console.log("\nUnassigned leftovers by reason:")
  const reasons = new Map()
  for (const item of unassignedLeftovers) {
    const why = item.why.startsWith("staff:") ? "staff" : item.why
    reasons.set(why, (reasons.get(why) ?? 0) + 1)
  }
  for (const [why, n] of reasons) console.log(`  ${why}: ${n}`)
}
