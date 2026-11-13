import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getTableName } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { STATUS_CHECKS } from "../status-checks"

const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Every `export const name = defineMachine(` in src, as [file, export name]. */
function declaredMachines(): readonly (readonly [string, string])[] {
  return sourceFiles(join(ROOT, "src")).flatMap((path) => {
    const text = readFileSync(path, "utf8")
    return [...text.matchAll(/export const (\w+) = defineMachine\(/g)].map((match) => [path, match[1]] as const)
  })
}

describe("data health status checks", () => {
  it("registers every declared state machine", async () => {
    const machines = declaredMachines()
    expect(machines.length).toBeGreaterThan(20)
    const registered = new Set<unknown>(STATUS_CHECKS.map((check) => check.machine))
    const missing: string[] = []
    for (const [path, name] of machines) {
      const loaded: Record<string, unknown> = await import(path)
      if (!registered.has(loaded[name])) missing.push(`${relative(ROOT, path)}: ${name}`)
    }
    expect(missing, "Add these machines to src/lib/domain/data-health/status-checks.ts").toEqual([])
  })

  it("checks each column once", () => {
    const columns = STATUS_CHECKS.flatMap((check) =>
      check.kind === "not_stored" ? [] : [`${getTableName(check.column.table)}.${check.column.name}:${check.kind === "company_statuses" ? check.recordType : ""}`],
    )
    expect(new Set(columns).size).toBe(columns.length)
  })

  it("scopes company status checks to their record types", () => {
    for (const check of STATUS_CHECKS) {
      if (check.kind !== "company_statuses") continue
      expect("equals" in check.scope && check.scope.equals.length > 0, check.machine.name).toBe(true)
    }
  })
})
