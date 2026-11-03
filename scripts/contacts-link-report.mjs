#!/usr/bin/env bun
// Read-only report: proposes directory links for unlinked project contacts
// and for projects.client_name, then prints how many would link exactly,
// how many are ambiguous (sent to review, never guessed) and how many have
// no match. It only runs SELECT statements and never writes.
//
//   bun scripts/contacts-link-report.mjs                 # local D1
//   bun scripts/contacts-link-report.mjs --remote        # production D1 (read only)
//   bun scripts/contacts-link-report.mjs --org <id>      # one organization
//   bun scripts/contacts-link-report.mjs --json          # every proposal as JSON
//   bun scripts/contacts-link-report.mjs --database compass-demo-db
//
// Matching rules live in src/lib/domain/contacts/link-matching.ts.
import { execFileSync } from "node:child_process"

import {
  buildLinkReport,
  DIRECTORY_KINDS,
  directoryKindsForContactType,
} from "../src/lib/domain/contacts/link-matching.ts"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const remote = process.argv.includes("--remote")
const json = process.argv.includes("--json")
const database = argValue("--database") ?? "compass-db"
const organizationId = argValue("--org")

// Linked project contacts already read from the directory; only these need a proposal.
const LINKED_SOURCE_TYPES = "('customer', 'customer_contact', 'vendor', 'vendor_contact', 'internal_contact', 'user')"

const QUERIES = {
  projectContacts: `SELECT pc.id, p.organization_id AS organizationId, pc.contact_type AS contactType,
      pc.display_name AS name, pc.company_name AS company, pc.email
    FROM project_contacts pc JOIN projects p ON p.id = pc.project_id
    WHERE pc.active = 1 AND p.organization_id IS NOT NULL
      AND pc.vendor_id IS NULL AND pc.vendor_contact_id IS NULL
      AND pc.customer_id IS NULL AND pc.customer_contact_id IS NULL
      AND pc.internal_contact_id IS NULL
      AND pc.source_entity_type NOT IN ${LINKED_SOURCE_TYPES}`,
  projects: `SELECT id, organization_id AS organizationId, client_name AS name
    FROM projects
    WHERE organization_id IS NOT NULL AND client_name IS NOT NULL AND trim(client_name) <> ''`,
  customer: `SELECT id, organization_id AS organizationId, name, company, email
    FROM customers WHERE organization_id IS NOT NULL AND merged_into_customer_id IS NULL`,
  customer_contact: `SELECT cc.id, c.organization_id AS organizationId, cc.name,
      coalesce(c.company, c.name) AS company, cc.email
    FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id
    WHERE cc.active = 1 AND c.organization_id IS NOT NULL AND c.merged_into_customer_id IS NULL`,
  vendor: `SELECT id, organization_id AS organizationId, name, name AS company, email
    FROM vendors WHERE organization_id IS NOT NULL AND directory_status = 'active'`,
  vendor_contact: `SELECT vc.id, v.organization_id AS organizationId, vc.name, v.name AS company, vc.email
    FROM vendor_contacts vc JOIN vendors v ON v.id = vc.vendor_id
    WHERE vc.active = 1 AND v.organization_id IS NOT NULL AND v.directory_status = 'active'`,
  internal_contact: `SELECT id, organization_id AS organizationId, name, NULL AS company, email
    FROM internal_contacts WHERE active = 1`,
}

/** Runs one SELECT through wrangler and returns its rows. */
function select(sql) {
  // Guard: this report must never write.
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("contacts-link-report only runs single SELECT statements")
  const scoped = organizationId ? `SELECT * FROM (${sql}) WHERE organizationId = '${organizationId.replaceAll("'", "''")}'` : sql
  const output = execFileSync(
    "bunx",
    ["wrangler", "d1", "execute", database, remote ? "--remote" : "--local", "--json", "--command", scoped],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }
  )
  const parsed = JSON.parse(output)
  return parsed.flatMap((result) => result.results ?? [])
}

const candidates = DIRECTORY_KINDS.flatMap((kind) =>
  select(QUERIES[kind]).map((row) => ({
    kind,
    id: row.id,
    organizationId: row.organizationId,
    name: row.name ?? "",
    company: row.company ?? null,
    email: row.email ?? null,
  }))
)

const contactSubjects = select(QUERIES.projectContacts).map((row) => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name ?? "",
  company: row.company ?? null,
  email: row.email ?? null,
  kinds: directoryKindsForContactType(row.contactType),
  compareCompany: true,
}))
const projectSubjects = select(QUERIES.projects).map((row) => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  company: null,
  email: null,
  kinds: ["customer"],
  // projects store only the client's name, so the company is not compared.
  compareCompany: false,
}))

const reports = {
  projectContacts: buildLinkReport(contactSubjects, candidates),
  projectClientNames: buildLinkReport(projectSubjects, candidates),
}

if (json) {
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)
} else {
  console.log(`Directory link proposals (${remote ? "remote" : "local"} ${database}${organizationId ? `, org ${organizationId}` : ""})`)
  console.log("Read only: nothing was written. Ambiguous matches go to review.\n")
  for (const [label, report] of Object.entries(reports)) {
    const { counts } = report
    console.log(label)
    console.log(`  records checked        ${counts.total}`)
    console.log(`  exact match (email)    ${counts.exactByEmail}`)
    console.log(`  exact match (name+co.) ${counts.exactByNameCompany}`)
    console.log(`  ambiguous (review)     ${counts.ambiguous}`)
    console.log(`  no match               ${counts.noMatch}\n`)
  }
}
