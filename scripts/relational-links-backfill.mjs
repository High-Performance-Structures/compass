#!/usr/bin/env bun
// Backfills the directory links added in migration 0280 (projects →
// customers, RFQ/PO and budget lines → vendors, RFIs → project contacts) and
// the existing project_contacts directory columns, by EXACT match only.
//
// Dry run by default: it only runs SELECT statements and writes a JSON report
// of what would link, what is ambiguous (review list, never guessed) and what
// has no match.
//
//   bun scripts/relational-links-backfill.mjs --local                    # dry run, local D1
//   bun scripts/relational-links-backfill.mjs --remote                   # dry run, production D1 (read only)
//   bun scripts/relational-links-backfill.mjs --local --apply            # backup, then fill NULL links
//   bun scripts/relational-links-backfill.mjs --remote --org <id> --apply
//
// Options: --database <name> (default compass-db), --org <organization id>,
// --report <path>, --backup <path> (both default to tmp/), --persist-to <dir>
// (local wrangler state).
//
// With --apply it first writes a backup JSON of every row it will change (the
// old NULL values and an undo statement per row), then runs one UPDATE per
// exact match that fills only columns that are still NULL. Matching rules live
// in src/lib/domain/contacts/relational-links-plan.ts.
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { chunkD1Values } from "../src/lib/d1-query.ts"
import {
  planRelationalLinks,
  relationalLinkRestoreSql,
  relationalLinkUpdateSql,
} from "../src/lib/domain/contacts/relational-links-plan.ts"

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const remote = process.argv.includes("--remote")
const local = process.argv.includes("--local")
if (remote === local) {
  console.error("Choose exactly one of --local or --remote.")
  process.exit(1)
}
const apply = process.argv.includes("--apply")
const database = argValue("--database") ?? "compass-db"
const organizationId = argValue("--org")
const persistTo = argValue("--persist-to")
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
// tmp/ is gitignored, so reports and backups are never committed by accident.
const reportPath = argValue("--report") ?? `tmp/relational-links-report-${stamp}.json`
const backupPath = argValue("--backup") ?? `tmp/relational-links-backup-${stamp}.json`

function wranglerArgs(extra) {
  return [
    "wrangler", "d1", "execute", database,
    remote ? "--remote" : "--local",
    ...(persistTo && !remote ? ["--persist-to", persistTo] : []),
    "--json",
    ...extra,
  ]
}

/** Runs one SELECT and returns its rows. Refuses anything that is not a single SELECT. */
function select(sql) {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("relational-links-backfill reads with single SELECT statements only")
  const scoped = organizationId
    ? `SELECT * FROM (${sql}) WHERE organizationId = '${organizationId.replaceAll("'", "''")}'`
    : sql
  const output = execFileSync("bunx", wranglerArgs(["--command", scoped]), { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  return JSON.parse(output).flatMap((result) => result.results ?? [])
}

// Each query reads one table scoped through its project's company. No UNION
// and no IN lists, so nothing approaches D1's statement or parameter limits.
const DIRECTORY_QUERIES = {
  customer: `SELECT id, organization_id AS organizationId, name, company, email, NULL AS parentId
    FROM customers WHERE organization_id IS NOT NULL AND merged_into_customer_id IS NULL`,
  customer_contact: `SELECT cc.id, c.organization_id AS organizationId, cc.name,
      coalesce(c.company, c.name) AS company, cc.email, c.id AS parentId
    FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id
    WHERE cc.active = 1 AND c.organization_id IS NOT NULL AND c.merged_into_customer_id IS NULL`,
  vendor: `SELECT id, organization_id AS organizationId, name, name AS company, email, NULL AS parentId
    FROM vendors WHERE organization_id IS NOT NULL AND merged_into_vendor_id IS NULL AND directory_status = 'active'`,
  vendor_contact: `SELECT vc.id, v.organization_id AS organizationId, vc.name, v.name AS company, vc.email, v.id AS parentId
    FROM vendor_contacts vc JOIN vendors v ON v.id = vc.vendor_id
    WHERE vc.active = 1 AND v.organization_id IS NOT NULL AND v.merged_into_vendor_id IS NULL AND v.directory_status = 'active'`,
  internal_contact: `SELECT id, organization_id AS organizationId, name, NULL AS company, email, NULL AS parentId
    FROM internal_contacts WHERE active = 1`,
}

const LINKED_SOURCE_TYPES = "('customer', 'customer_contact', 'vendor', 'vendor_contact', 'internal_contact', 'user')"

const SUBJECT_QUERIES = {
  projects: `SELECT id, organization_id AS organizationId, client_name AS name
    FROM projects
    WHERE organization_id IS NOT NULL AND client_customer_id IS NULL
      AND client_name IS NOT NULL AND trim(client_name) <> ''`,
  // An RFQ names its vendor in "requested from" (sage_vendor_name); its
  // company_name may only be a trade category, so it is not matched.
  operations: `SELECT id, organizationId, name, email FROM (
      SELECT o.id, p.organization_id AS organizationId,
        CASE WHEN o.source_record_type = 'rfq' THEN o.sage_vendor_name
          ELSE coalesce(nullif(trim(o.sage_vendor_name), ''), o.company_name) END AS name,
        CASE WHEN o.source_record_type = 'rfq' AND json_valid(o.sage_payload_json)
          THEN json_extract(o.sage_payload_json, '$.recipientEmail') END AS email
      FROM project_operations o JOIN projects p ON p.id = o.project_id
      WHERE p.organization_id IS NOT NULL AND o.vendor_id IS NULL
        AND o.source_record_type IN ('rfq', 'purchase_order')
    ) WHERE trim(coalesce(name, '')) <> ''`,
  budgetLines: `SELECT b.id, p.organization_id AS organizationId, b.vendor_name AS name
    FROM project_budget_lines b JOIN projects p ON p.id = b.project_id
    WHERE p.organization_id IS NOT NULL AND b.vendor_id IS NULL
      AND b.vendor_name IS NOT NULL AND trim(b.vendor_name) <> ''`,
  rfis: `SELECT r.id, r.project_id AS projectId, p.organization_id AS organizationId, r.assigned_to_name AS name
    FROM project_rfis r JOIN projects p ON p.id = r.project_id
    WHERE p.organization_id IS NOT NULL AND r.assigned_project_contact_id IS NULL
      AND r.assigned_to_name IS NOT NULL AND trim(r.assigned_to_name) <> ''`,
  rfiContacts: `SELECT pc.id, pc.project_id AS projectId, p.organization_id AS organizationId, pc.display_name AS name
    FROM project_contacts pc JOIN projects p ON p.id = pc.project_id
    WHERE pc.active = 1 AND p.organization_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM project_rfis r WHERE r.project_id = pc.project_id
        AND r.assigned_project_contact_id IS NULL AND r.assigned_to_name IS NOT NULL)`,
  projectContacts: `SELECT pc.id, p.organization_id AS organizationId, pc.contact_type AS contactType,
      pc.display_name AS name, pc.company_name AS company, pc.email
    FROM project_contacts pc JOIN projects p ON p.id = pc.project_id
    WHERE pc.active = 1 AND p.organization_id IS NOT NULL
      AND pc.vendor_id IS NULL AND pc.vendor_contact_id IS NULL
      AND pc.customer_id IS NULL AND pc.customer_contact_id IS NULL
      AND pc.internal_contact_id IS NULL
      AND pc.source_entity_type NOT IN ${LINKED_SOURCE_TYPES}`,
}

const text = (value) => (typeof value === "string" ? value : null)

const directory = Object.entries(DIRECTORY_QUERIES).flatMap(([kind, sql]) =>
  select(sql).map((row) => ({
    kind,
    id: row.id,
    organizationId: row.organizationId,
    name: row.name ?? "",
    company: text(row.company),
    email: text(row.email),
    parentId: text(row.parentId),
  }))
)
const named = (row) => ({ id: row.id, organizationId: row.organizationId, name: row.name ?? "" })

const plan = planRelationalLinks({
  directory,
  projects: select(SUBJECT_QUERIES.projects).map(named),
  operations: select(SUBJECT_QUERIES.operations).map((row) => ({ ...named(row), email: text(row.email) })),
  budgetLines: select(SUBJECT_QUERIES.budgetLines).map(named),
  rfis: select(SUBJECT_QUERIES.rfis).map((row) => ({ id: row.id, projectId: row.projectId, name: row.name ?? "" })),
  rfiContacts: select(SUBJECT_QUERIES.rfiContacts).map((row) => ({ id: row.id, projectId: row.projectId, name: row.name ?? "" })),
  projectContacts: select(SUBJECT_QUERIES.projectContacts).map((row) => ({
    ...named(row),
    contactType: row.contactType,
    company: text(row.company),
    email: text(row.email),
  })),
})

const target = `${remote ? "remote" : "local"} ${database}${organizationId ? `, org ${organizationId}` : ""}`
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(
  reportPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), target, mode: apply ? "apply" : "dry-run", ...plan }, null, 2)}\n`
)
console.log(`Directory links (${target}) — ${apply ? "APPLY" : "dry run, nothing written"}`)
for (const [section, counts] of Object.entries(plan.counts)) {
  console.log(
    `  ${section.padEnd(18)} checked ${counts.checked}, email ${counts.exactByEmail}, name ${counts.exactByName}, review ${counts.ambiguous}, no match ${counts.noMatch}`
  )
}
console.log(`Report: ${reportPath}`)

if (apply && plan.links.length > 0) {
  // Backup first: every row this run may change, with its old (NULL) values
  // and the statement that undoes it. Nothing is written if this fails.
  const backup = plan.links.map((link) => ({
    table: link.table,
    id: link.id,
    name: link.name,
    previous: Object.fromEntries(Object.keys(link.set).map((column) => [column, null])),
    next: link.set,
    restoreSql: relationalLinkRestoreSql(link),
  }))
  mkdirSync(dirname(backupPath), { recursive: true })
  writeFileSync(backupPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), target, rows: backup }, null, 2)}\n`)
  console.log(`Backup: ${backupPath} (${backup.length} rows)`)

  // 50 updates per wrangler call (chunkD1Values). Each UPDATE is followed by
  // SELECT changes(), so the count reads back the same way locally and remotely.
  let changed = 0
  for (const chunk of chunkD1Values(plan.links.map(relationalLinkUpdateSql))) {
    const command = chunk.flatMap((statement) => [statement, "SELECT changes() AS changed;"]).join("\n")
    const output = execFileSync("bunx", wranglerArgs(["--command", command, ...(remote ? ["--yes"] : [])]), {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    changed += JSON.parse(output)
      .flatMap((result) => result.results ?? [])
      .reduce((sum, row) => sum + (typeof row.changed === "number" ? row.changed : 0), 0)
  }
  console.log(`Applied: ${plan.links.length} updates, ${changed} rows changed (links already set were left alone).`)
} else if (apply) {
  console.log("Nothing to apply.")
}
