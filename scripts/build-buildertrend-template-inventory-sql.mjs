import { readFile, writeFile } from "node:fs/promises"

import {
  buildBuildertrendTemplateInventorySql,
  parseBuildertrendTemplateInventory,
} from "../src/lib/templates/buildertrend-template-inventory"

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option)
  if (index < 0) return null
  const value = argumentsList[index + 1]
  return value && !value.startsWith("--") ? value : null
}

async function main() {
  const argumentsList = process.argv.slice(2)
  const input = optionValue(argumentsList, "--input")
  const organizationId = optionValue(argumentsList, "--organization-id")
  const output = optionValue(argumentsList, "--output")
  const dryRun = argumentsList.includes("--dry-run")
  if (!input || !organizationId || (!dryRun && !output)) {
    throw new Error(
      "Usage: bun scripts/build-buildertrend-template-inventory-sql.mjs " +
        "--input <inventory.json> --organization-id <org-id> " +
        "[--output <import.sql>] [--dry-run]"
    )
  }

  const parsed = parseBuildertrendTemplateInventory(
    JSON.parse(await readFile(input, "utf8"))
  )
  if (!parsed.success) {
    throw new Error(`Invalid template inventory:\n${parsed.errors.join("\n")}`)
  }
  const build = buildBuildertrendTemplateInventorySql(
    organizationId,
    parsed.data
  )
  if (!dryRun && output) await writeFile(output, build.sql, "utf8")
  console.log(
    JSON.stringify(
      {
        dryRun,
        importedCount: build.importedCount,
        excludedArchivedCount: parsed.data.excludedArchivedCount,
        output: dryRun ? null : output,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
