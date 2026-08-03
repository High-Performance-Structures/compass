import { readFile, writeFile } from "node:fs/promises"

import {
  buildBuildertrendTemplateCaptureSql,
  parseBuildertrendTemplateCapture,
} from "../src/lib/templates/buildertrend-template-capture"
import { parseBuildertrendTemplateInventory } from "../src/lib/templates/buildertrend-template-inventory"

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option)
  if (index < 0) return null
  const value = argumentsList[index + 1]
  return value && !value.startsWith("--") ? value : null
}

async function parseJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

async function main() {
  const argumentsList = process.argv.slice(2)
  const inventoryPath = optionValue(argumentsList, "--inventory")
  const capturePath = optionValue(argumentsList, "--capture")
  const organizationId = optionValue(argumentsList, "--organization-id")
  const output = optionValue(argumentsList, "--output")
  const dryRun = argumentsList.includes("--dry-run")
  if (
    !inventoryPath ||
    !capturePath ||
    !organizationId ||
    (!dryRun && !output)
  ) {
    throw new Error(
      "Usage: bun scripts/build-buildertrend-template-capture-sql.mjs " +
        "--inventory <inventory.json> --capture <capture.json> " +
        "--organization-id <org-id> [--output <import.sql>] [--dry-run]"
    )
  }

  const inventory = parseBuildertrendTemplateInventory(
    await parseJsonFile(inventoryPath)
  )
  if (!inventory.success) {
    throw new Error(`Invalid template inventory:\n${inventory.errors.join("\n")}`)
  }
  const capture = parseBuildertrendTemplateCapture(await parseJsonFile(capturePath))
  if (!capture.success) {
    throw new Error(`Invalid template capture:\n${capture.errors.join("\n")}`)
  }
  const build = buildBuildertrendTemplateCaptureSql({
    organizationId,
    inventory: inventory.data,
    capture: capture.data,
  })
  if (!dryRun && output) await writeFile(output, build.sql, "utf8")
  console.log(
    JSON.stringify(
      {
        dryRun,
        capturedTemplateCount: build.capturedTemplateCount,
        capturedScheduleCount: build.capturedScheduleCount,
        capturedScheduleItemCount: build.capturedScheduleItemCount,
        excludedArchivedCount: capture.data.excludedArchivedCount,
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
