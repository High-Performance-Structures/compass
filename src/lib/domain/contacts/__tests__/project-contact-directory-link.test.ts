import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  hasProjectContactDirectoryLink,
  insertableProjectContacts,
  PROJECT_CONTACT_DIRECTORY_REQUIRED,
} from "@/lib/domain/contacts/rules"

/*
 * Job contacts come from the directory: a new project contact must name a
 * directory record. There are no exceptions, imports included.
 */

const NOW = "2026-11-09T00:00:00.000Z"
const base = {
  id: "c1",
  projectId: "p1",
  contactType: "owner" as const,
  sourceSystem: "compass",
  sourceEntityType: "manual",
  sourceEntityId: null,
  displayName: "Someone",
  createdAt: NOW,
  updatedAt: NOW,
}

describe("project contact directory link", () => {
  it("accepts each kind of directory link", () => {
    for (const link of [
      { customerId: "cust-1" },
      { customerContactId: "person-1" },
      { vendorId: "vendor-1" },
      { vendorContactId: "vperson-1" },
      { internalContactId: "staff-1" },
      { sourceEntityType: "customer", sourceEntityId: "cust-1" },
      { sourceEntityType: "vendor", sourceEntityId: "vendor-1" },
      { sourceEntityType: "user", sourceEntityId: "user-1" },
    ]) {
      expect(hasProjectContactDirectoryLink({ ...base, ...link })).toBe(true)
      expect(insertableProjectContacts({ ...base, ...link })).toEqual({ ...base, ...link })
    }
  })

  it("refuses a typed contact with no directory record", () => {
    expect(hasProjectContactDirectoryLink(base)).toBe(false)
    expect(hasProjectContactDirectoryLink({ ...base, sourceEntityType: "customer" })).toBe(false)
    expect(hasProjectContactDirectoryLink({ ...base, sourceEntityType: "manual_pending_sage" })).toBe(false)
    expect(() => insertableProjectContacts(base)).toThrow(PROJECT_CONTACT_DIRECTORY_REQUIRED)
    expect(() => insertableProjectContacts([{ ...base, vendorId: "vendor-1" }, base])).toThrow(PROJECT_CONTACT_DIRECTORY_REQUIRED)
  })

  it("refuses an imported person who is not in the directory", () => {
    for (const sourceEntityType of ["buildertrend_participant", "buildertrend_new_person"]) {
      const imported = { ...base, sourceSystem: "buildertrend", sourceEntityType, sourceEntityId: "new:email:someone@example.com" }
      expect(hasProjectContactDirectoryLink(imported)).toBe(false)
      expect(() => insertableProjectContacts(imported)).toThrow(PROJECT_CONTACT_DIRECTORY_REQUIRED)
    }
  })

  it("routes every project contact insert through the check", () => {
    const root = process.cwd()
    const store = readFileSync(join(root, "src/lib/domain/contacts/store.ts"), "utf8")
    const inserts = store.split("\n").filter((line) => line.includes("insert(projectContacts)"))
    expect(inserts.length).toBeGreaterThan(0)
    for (const line of inserts) expect(line).toContain("insertableProjectContacts(")

    // The store is the only writer of project_contacts (architecture ratchet).
    const baseline: unknown = JSON.parse(readFileSync(join(root, "src/lib/__tests__/architecture-baseline.json"), "utf8"))
    const writers = typeof baseline === "object" && baseline !== null ? Reflect.get(Reflect.get(baseline, "tableWriters"), "projectContacts") : null
    expect(writers).toEqual(["src/lib/domain/contacts/store.ts"])
  })

  it("has no raw SQL inserts into project_contacts outside migrations and tests", () => {
    const root = process.cwd()
    // A local-only dev seed that writes a developer's own SQLite file, never D1.
    const allowed = new Set(["scripts/seed-project-contacts-local.mjs"])
    const rawInsert = /insert\s+(?:or\s+\w+\s+)?into\s+["'`]?project_contacts\b/i
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(path)
        } else if (/\.(?:[cm]?[jt]sx?|sql)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) && !allowed.has(path)) {
          if (rawInsert.test(readFileSync(join(root, path), "utf8"))) offenders.push(path)
        }
      }
    }
    walk("src")
    walk("scripts")
    expect(offenders).toEqual([])
  })
})
