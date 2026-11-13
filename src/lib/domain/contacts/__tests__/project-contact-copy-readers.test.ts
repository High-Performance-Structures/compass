import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { readSource, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

/*
 * One source of truth for job contacts (owner requirement 2026-11-10): a job
 * contact shows its Contacts directory record everywhere. The name, company,
 * email, phone and address copied onto project_contacts are a history
 * snapshot, so code reads them only through
 * `src/lib/domain/contacts/resolved-columns.ts` (withContactDirectory +
 * resolvedContactColumns, or resolvedContactValueOf), which uses the copy only
 * for an unlinked or unreachable row. Writes (the store's copy sync) set the
 * columns with plain object keys and are not reads.
 *
 * The allowlists below are explicit and minimal: add to them only with a
 * reason, and prefer converting the reader.
 */

const ROOT = process.cwd()
const COPIED = "(?:email|phone|displayName|companyName|address)"
const COPIED_SQL = "(?:email|phone|display_name|company_name|address)"

/** Files allowed to name a copied column directly. */
const COPY_COLUMN_READERS: Readonly<Record<string, string>> = {
  // Matches the copied email only when no directory record is reachable
  // (guarded by contactDirectoryRecordReachable).
  "src/lib/domain/contacts/person-status.ts": "guarded fallback",
}

/** Files allowed to select whole project_contacts rows (every copied column). */
const FULL_ROW_READERS: Readonly<Record<string, string>> = {
  // Overrides every copied column with the resolved one.
  "src/lib/domain/contacts/resolved-project-contacts.ts": "the read model",
  // Uses the resolved identity for the invitation and resolved values for
  // the next job's snapshot; row.contact supplies ids and flags.
  "src/app/actions/project-access-invitations.ts": "ids and flags only",
  // Unassigned people are unlinked by definition: the copy is their only data.
  "src/lib/domain/contacts/connect-unassigned-person.ts": "unlinked rows only",
}

function sourceFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, {
    skipDirectories: ["__tests__", "node_modules"],
    include: /^(?!.*\.test\.[jt]sx?$).*\.[cm]?[jt]sx?$/,
  })
}

const FILES = sourceFiles("src").map((path) => ({ path, text: readSource(join(ROOT, path)) }))

function offenders(pattern: RegExp, allowed: Readonly<Record<string, string>>): readonly string[] {
  return FILES.filter(({ path, text }) => !(path in allowed) && pattern.test(text)).map(({ path }) => path)
}

describe("project contact copies are read only through the resolver", () => {
  it("names no copied column outside the resolver (select, where, orderBy)", () => {
    expect(offenders(new RegExp(`\\bprojectContacts\\.${COPIED}\\b`), COPY_COLUMN_READERS)).toEqual([])
  })

  it("reads no copied column in raw SQL", () => {
    // project_contacts.email, or a short alias such as pc.email, in a file that queries project_contacts.
    const raw = new RegExp(`\\b(?:project_contacts|pc|active_contact)\\.${COPIED_SQL}\\b`)
    // The resolver builds its fallback from the copy (its `pc` is the table).
    const resolver = "src/lib/domain/contacts/resolved-columns.ts"
    const found = FILES.filter(({ path, text }) => path !== resolver && text.includes("project_contacts") && raw.test(text))
    expect(found.map(({ path }) => path)).toEqual([])
  })

  it("selects whole project_contacts rows only in the allowlisted files", () => {
    const fullRow = /\.select\(\)\s*\.from\(projectContacts\)|\b\w+:\s*projectContacts\s*[,}]|getTableColumns\(projectContacts\)|\.\.\.projectContacts\b/
    expect(offenders(fullRow, FULL_ROW_READERS)).toEqual([])
  })

  it("keeps the allowlists minimal", () => {
    for (const path of Object.keys(COPY_COLUMN_READERS)) {
      const file = FILES.find((candidate) => candidate.path === path)
      expect(file && new RegExp(`\\bprojectContacts\\.${COPIED}\\b`).test(file.text), path).toBe(true)
    }
    for (const path of Object.keys(FULL_ROW_READERS)) {
      const file = FILES.find((candidate) => candidate.path === path)
      expect(file && /\.select\(\)\s*\.from\(projectContacts\)|\b\w+:\s*projectContacts\s*[,}]|getTableColumns\(projectContacts\)/.test(file.text), path).toBe(true)
    }
  })
})
