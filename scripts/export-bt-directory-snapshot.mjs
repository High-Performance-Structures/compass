#!/usr/bin/env node
/*
 * READ ONLY. Builds the `bt-directory-snapshot/v1` file that
 * scripts/import-buildertrend-messages.mjs reads with --directory (see
 * scripts/import-buildertrend-participants.mjs and
 * docs/plans/bt-messages-live-conversations.md, "Participant matching").
 *
 * One row per Compass person in one organization: a user grouped with the
 * internal, vendor, customer and project contacts that are the same person,
 * plus the Buildertrend ids registered for them. Only directory fields are
 * read (names, emails, ids, roles); no message content.
 *
 * Every statement is a SELECT scoped to the organization, paged by id
 * (LIMIT 500) with values inlined, so no statement has bound parameters.
 *
 * Usage:
 *   node scripts/export-bt-directory-snapshot.mjs --org <organizationId> [--db compass-db]
 *     prints the SQL it would run (the default);
 *   node scripts/export-bt-directory-snapshot.mjs --org <id> --run --out directory.json
 *     runs the SELECTs with `wrangler d1 execute <db> --remote --json --command`
 *     and writes the snapshot.
 *
 * BT id registry used (`<catalog type>:<btId>`):
 *   vendor_contacts.source_system = 'buildertrend' -> vendor_contact:<source_record_id>
 *   vendors.source_system = 'buildertrend'         -> vendor_company:<source_record_id> (on each of its contacts)
 *   customer_contacts.source_system = 'buildertrend' -> customer:<source_record_id>
 *   customers.buildertrend_contact_id              -> customer:<id> (on each of its contacts)
 *   reviewed access candidates matched to a staff user -> internal_user:<buildertrend_contact_id>
 * A BT id on more than one person makes the importer treat it as ambiguous.
 */
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { DIRECTORY_SCHEMA } from "./import-buildertrend-participants.mjs"
const PAGE_SIZE = 500

// Mirrors isInternalStaffRole in src/lib/user-roles.ts.
const INTERNAL_ROLES = new Set([
  "admin", "secondary_admin", "executive", "project_manager", "project_administrator",
  "assistant_project_manager", "accounting", "office_manager", "office", "field_superintendent",
  "field_crew", "architectural_designer", "drafter", "lead_estimator", "assistant_estimator",
  "coordinator", "field",
])
const VENDOR_ROLES = new Set(["supplier", "subcontractor"])

function literal(value) {
  return `'${String(value).replaceAll("\u0000", "").replaceAll("'", "''")}'`
}

/**
 * The paged SELECTs. Each `sql(cursor)` returns rows whose `cursor` column is
 * greater than the previous page's last value.
 */
export function directoryQueries(organizationId) {
  const org = literal(organizationId)
  const page = (body, key) => (cursor) => `${body} AND ${key} > ${literal(cursor)} ORDER BY ${key} LIMIT ${PAGE_SIZE}`
  return [
    { name: "users", sql: page(`SELECT u.id AS cursor, u.id, u.email, u.display_name, u.first_name, u.last_name, om.role FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = ${org} AND u.is_active = 1`, "u.id") },
    { name: "members", sql: page(`SELECT pm.id AS cursor, pm.user_id, pm.project_id, pm.role FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE p.organization_id = ${org}`, "pm.id") },
    { name: "internalContacts", sql: page(`SELECT ic.id AS cursor, ic.id, ic.user_id, ic.name, ic.email FROM internal_contacts ic WHERE ic.organization_id = ${org} AND ic.active = 1 AND ic.user_id IS NOT NULL`, "ic.id") },
    { name: "vendorContacts", sql: page(`SELECT vc.id AS cursor, vc.id, vc.vendor_id, vc.user_id, vc.name, vc.email, vc.source_system, vc.source_record_id, v.source_system AS vendor_source_system, v.source_record_id AS vendor_source_record_id FROM vendor_contacts vc JOIN vendors v ON v.id = vc.vendor_id WHERE v.organization_id = ${org} AND vc.active = 1 AND vc.merged_into_person_id IS NULL AND v.merged_into_vendor_id IS NULL`, "vc.id") },
    { name: "customerContacts", sql: page(`SELECT cc.id AS cursor, cc.id, cc.customer_id, cc.user_id, cc.name, cc.email, cc.source_system, cc.source_record_id, c.buildertrend_contact_id AS customer_bt_id FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id WHERE c.organization_id = ${org} AND cc.active = 1 AND cc.merged_into_person_id IS NULL AND c.merged_into_customer_id IS NULL`, "cc.id") },
    { name: "projectContacts", sql: page(`SELECT pc.id AS cursor, pc.id, pc.project_id, pc.contact_type, pc.display_name, pc.email, pc.source_entity_type, pc.source_entity_id, pc.internal_contact_id, pc.vendor_contact_id, pc.customer_id, pc.customer_contact_id FROM project_contacts pc JOIN projects p ON p.id = pc.project_id WHERE p.organization_id = ${org} AND pc.active = 1`, "pc.id") },
    { name: "btVendors", sql: page(`SELECT v.id AS cursor, v.id, v.source_record_id FROM vendors v WHERE v.organization_id = ${org} AND v.source_system = 'buildertrend' AND v.source_record_id IS NOT NULL AND v.merged_into_vendor_id IS NULL`, "v.id") },
    { name: "projects", sql: page(`SELECT p.id AS cursor, p.id, p.client_customer_id FROM projects p WHERE p.organization_id = ${org}`, "p.id") },
    { name: "btInternal", sql: page(`SELECT a.id AS cursor, a.matched_user_id AS user_id, a.buildertrend_contact_id FROM buildertrend_staging_access_candidates a WHERE a.organization_id = ${org} AND a.matched_user_id IS NOT NULL AND a.buildertrend_contact_id IS NOT NULL AND a.review_status IN ('approved', 'verified')`, "a.id") },
  ]
}

/** Runs every query to completion with `execute(sql) -> rows`. */
export async function collectDirectoryRows(organizationId, execute) {
  const rows = {}
  for (const query of directoryQueries(organizationId)) {
    rows[query.name] = []
    let cursor = ""
    for (;;) {
      const page = await execute(query.sql(cursor))
      rows[query.name].push(...page)
      if (page.length < PAGE_SIZE) break
      cursor = String(page[page.length - 1].cursor)
    }
  }
  return rows
}

function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/** Groups the rows into one person per human, exactly as the importer reads them. */
export function buildDirectorySnapshot(rows) {
  const people = new Map()
  const person = (key, kind) => {
    if (!people.has(key)) {
      people.set(key, { personKey: key, kind, names: [], emails: new Set(), userId: null, projectIds: new Set(), projectContactIds: {}, links: {}, btIds: new Set(), vendor: false })
    }
    return people.get(key)
  }
  const addName = (target, value) => { const name = text(value); if (name && !target.names.includes(name)) target.names.push(name) }
  const addEmail = (target, value) => { const email = text(value); if (email) target.emails.add(email.toLowerCase()) }

  const userRole = new Map()
  for (const row of rows.users) {
    const target = person(`user:${row.id}`, INTERNAL_ROLES.has(row.role) ? "staff" : "owner")
    target.userId = row.id
    userRole.set(row.id, row.role)
    if (VENDOR_ROLES.has(row.role)) target.vendor = true
    addName(target, row.display_name ?? [row.first_name, row.last_name].filter(Boolean).join(" "))
    addEmail(target, row.email)
  }
  const userPerson = (userId) => (userId && people.has(`user:${userId}`) ? people.get(`user:${userId}`) : null)

  for (const row of rows.members) {
    const target = userPerson(row.user_id)
    if (!target) continue
    target.projectIds.add(row.project_id)
    if (VENDOR_ROLES.has(row.role)) target.vendor = true
  }
  const internalByContact = new Map()
  for (const row of rows.internalContacts) {
    const target = userPerson(row.user_id)
    if (!target) continue
    internalByContact.set(row.id, target)
    addName(target, row.name)
    addEmail(target, row.email)
  }
  const vendorByContact = new Map()
  for (const row of rows.vendorContacts) {
    const target = userPerson(row.user_id) ?? person(`vendor_contact:${row.id}`, "vendor")
    if (!target.userId) target.links = { vendorId: row.vendor_id, vendorContactId: row.id }
    target.vendor = true
    vendorByContact.set(row.id, target)
    addName(target, row.name)
    addEmail(target, row.email)
    if (row.source_system === "buildertrend" && text(row.source_record_id)) target.btIds.add(`vendor_contact:${text(row.source_record_id)}`)
    if (row.vendor_source_system === "buildertrend" && text(row.vendor_source_record_id)) target.btIds.add(`vendor_company:${text(row.vendor_source_record_id)}`)
  }
  const customerByContact = new Map()
  for (const row of rows.customerContacts) {
    const target = userPerson(row.user_id) ?? person(`customer_contact:${row.id}`, "owner")
    if (!target.userId) target.links = { customerId: row.customer_id, customerContactId: row.id }
    customerByContact.set(row.id, target)
    addName(target, row.name)
    addEmail(target, row.email)
    if (row.source_system === "buildertrend" && text(row.source_record_id)) target.btIds.add(`customer:${text(row.source_record_id)}`)
    if (text(row.customer_bt_id)) target.btIds.add(`customer:${text(row.customer_bt_id)}`)
  }
  for (const row of rows.projectContacts) {
    const linked = (row.source_entity_type === "user" ? userPerson(row.source_entity_id) : null)
      ?? internalByContact.get(row.internal_contact_id)
      ?? vendorByContact.get(row.vendor_contact_id)
      ?? customerByContact.get(row.customer_contact_id)
    // An unlinked internal contact has no account, so it can never be staff.
    if (!linked && row.contact_type === "internal") continue
    const target = linked ?? person(`project_contact:${row.id}`, row.contact_type === "owner" ? "owner" : "vendor")
    target.projectIds.add(row.project_id)
    target.projectContactIds[row.project_id] ??= row.id
    addName(target, row.display_name)
    addEmail(target, row.email)
  }
  for (const row of rows.btInternal) {
    const target = userPerson(row.user_id)
    if (target && INTERNAL_ROLES.has(userRole.get(row.user_id))) target.btIds.add(`internal_user:${row.buildertrend_contact_id}`)
  }

  // A project's clients: its client customer plus the customers of its owner contacts.
  const clients = new Map()
  for (const row of rows.projects ?? []) clients.set(row.id, new Set(row.client_customer_id ? [row.client_customer_id] : []))
  for (const row of rows.projectContacts) {
    if (row.contact_type === "owner" && row.customer_id) (clients.get(row.project_id) ?? clients.set(row.project_id, new Set()).get(row.project_id)).add(row.customer_id)
  }

  return {
    schema: DIRECTORY_SCHEMA,
    vendors: (rows.btVendors ?? []).map((row) => ({ vendorId: row.id, btId: String(row.source_record_id) })),
    projects: [...clients.entries()].map(([projectId, ids]) => ({ projectId, clientCustomerIds: [...ids].sort() })).sort((a, b) => a.projectId.localeCompare(b.projectId)),
    people: [...people.values()]
      .filter((entry) => entry.names.length > 0 || entry.emails.size > 0)
      .map((entry) => ({
        personKey: entry.personKey,
        kind: entry.kind === "owner" && entry.vendor ? "vendor" : entry.kind,
        displayName: entry.names[0] ?? [...entry.emails][0],
        names: entry.names,
        emails: [...entry.emails].sort(),
        userId: entry.userId,
        projectIds: [...entry.projectIds].sort(),
        projectContactIds: entry.projectContactIds,
        vendorId: entry.links.vendorId ?? null, vendorContactId: entry.links.vendorContactId ?? null,
        customerId: entry.links.customerId ?? null, customerContactId: entry.links.customerContactId ?? null,
        btIds: [...entry.btIds].sort(),
      }))
      .sort((a, b) => a.personKey.localeCompare(b.personKey)),
  }
}

function args(argv) {
  const out = { db: "compass-db", run: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => { const value = argv[i + 1]; if (value === undefined) throw new Error(`${flag} needs a value`); i += 1; return value }
    if (flag === "--org") out.org = next()
    else if (flag === "--db") out.db = next()
    else if (flag === "--out") out.out = next()
    else if (flag === "--run") out.run = true
    else throw new Error(`unknown flag ${flag}`)
  }
  if (!out.org) throw new Error("--org is required")
  if (out.run && !out.out) throw new Error("--run needs --out")
  return out
}

function wranglerSelect(db, sql) {
  if (!/^SELECT\s/i.test(sql)) throw new Error("only SELECT statements are allowed")
  const result = spawnSync("bunx", ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`wrangler failed: ${result.stderr || result.stdout}`)
  const parsed = JSON.parse(result.stdout)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  if (!first?.success) throw new Error("wrangler returned an unsuccessful result")
  return first.results ?? []
}

async function main() {
  const options = args(process.argv.slice(2))
  if (!options.run) {
    console.log("-- READ ONLY. First page of each query; later pages repeat it with the last cursor.")
    for (const query of directoryQueries(options.org)) console.log(`-- ${query.name}\n${query.sql("")};`)
    return
  }
  const rows = await collectDirectoryRows(options.org, (sql) => wranglerSelect(options.db, sql))
  const snapshot = buildDirectorySnapshot(rows)
  writeFileSync(options.out, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(JSON.stringify({ out: options.out, people: snapshot.people.length }))
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
