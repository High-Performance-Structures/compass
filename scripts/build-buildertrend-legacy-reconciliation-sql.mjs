import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { buildLegacyBuildertrendReconciliationSql } from "../src/lib/buildertrend/legacy-reconciliation.ts"

const args = process.argv.slice(2)
const organizationFlagIndex = args.indexOf("--organization-id")
const outputFlagIndex = args.indexOf("--output")

const organizationId =
  organizationFlagIndex >= 0 ? args[organizationFlagIndex + 1]?.trim() : undefined
const outputPath =
  outputFlagIndex >= 0 ? args[outputFlagIndex + 1]?.trim() : undefined

if (!organizationId || !outputPath) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-legacy-reconciliation-sql.mjs --organization-id <id> --output <file>"
  )
}

const sql = buildLegacyBuildertrendReconciliationSql(organizationId)
const absoluteOutputPath = resolve(process.cwd(), outputPath)
await writeFile(absoluteOutputPath, sql, "utf8")
console.log(`Wrote guarded Buildertrend legacy reconciliation SQL to ${absoluteOutputPath}`)
