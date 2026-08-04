import { readFile, writeFile } from "node:fs/promises"

import {
  buildBuildertrendTemplateCaptureSql,
  parseBuildertrendTemplateCapture,
} from "../src/lib/templates/buildertrend-template-capture"
import { parseBuildertrendTemplateInventory } from "../src/lib/templates/buildertrend-template-inventory"
import { buildBuildertrendTemplatePilot } from "./lib/buildertrend-template-pilot.mjs"
import { buildBuildertrendTemplateScheduleScope } from "./lib/buildertrend-template-schedule-scope.mjs"

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
  const pilotManifestPath = optionValue(argumentsList, "--pilot-manifest")
  const scheduleScopeManifestPath = optionValue(
    argumentsList,
    "--schedule-scope-manifest"
  )
  const workplanPath = optionValue(argumentsList, "--workplan")
  const dryRun = argumentsList.includes("--dry-run")
  const publishCapturedSchedules = argumentsList.includes(
    "--publish-captured-schedules"
  )
  if (
    !inventoryPath ||
    !capturePath ||
    !organizationId ||
    (!dryRun && !output)
  ) {
    throw new Error(
        "Usage: bun scripts/build-buildertrend-template-capture-sql.mjs " +
        "--inventory <inventory.json> --capture <capture.json> " +
        "--organization-id <org-id> [--output <import.sql>] [--dry-run] " +
        "[--publish-captured-schedules] [--pilot-manifest <reviewed-pilot.json>] " +
        "[--schedule-scope-manifest <reviewed-nonpilot-schedules.json> " +
        "--workplan <reviewed-workplan.json>]"
    )
  }
  if (scheduleScopeManifestPath && (!pilotManifestPath || !workplanPath)) {
    throw new Error(
      "The non-pilot schedule scope requires --pilot-manifest and --workplan."
    )
  }
  if (scheduleScopeManifestPath && publishCapturedSchedules) {
    throw new Error(
      "Non-pilot schedule scope is draft-import only; whole-template publishing remains gated."
    )
  }

  let inventoryValue = await parseJsonFile(inventoryPath)
  let captureValue = await parseJsonFile(capturePath)
  let pilot = null
  let scheduleScope = null
  if (scheduleScopeManifestPath && pilotManifestPath && workplanPath) {
    scheduleScope = buildBuildertrendTemplateScheduleScope({
      inventory: inventoryValue,
      capture: captureValue,
      workplan: await parseJsonFile(workplanPath),
      pilotManifest: await parseJsonFile(pilotManifestPath),
      manifest: await parseJsonFile(scheduleScopeManifestPath),
    })
    inventoryValue = scheduleScope.inventory
    captureValue = scheduleScope.capture
  } else if (pilotManifestPath) {
    pilot = buildBuildertrendTemplatePilot({
      inventory: inventoryValue,
      capture: captureValue,
      manifest: await parseJsonFile(pilotManifestPath),
    })
    inventoryValue = pilot.inventory
    captureValue = pilot.capture
  }
  const inventory = parseBuildertrendTemplateInventory(inventoryValue)
  if (!inventory.success) {
    throw new Error(`Invalid template inventory:\n${inventory.errors.join("\n")}`)
  }
  const capture = parseBuildertrendTemplateCapture(captureValue)
  if (!capture.success) {
    throw new Error(`Invalid template capture:\n${capture.errors.join("\n")}`)
  }
  const build = buildBuildertrendTemplateCaptureSql({
    organizationId,
    inventory: inventory.data,
    capture: capture.data,
    publishCapturedSchedules,
  })
  if (!dryRun && output) await writeFile(output, build.sql, "utf8")
  console.log(
    JSON.stringify(
      {
        dryRun,
        capturedTemplateCount: build.capturedTemplateCount,
        capturedScheduleCount: build.capturedScheduleCount,
        capturedScheduleItemCount: build.capturedScheduleItemCount,
        publishCapturedSchedules,
        ...(pilot
          ? {
              pilotTemplateCount: pilot.capture.templates.length,
              remainingActiveTemplatesUnverified:
                pilot.remainingActiveTemplatesUnverified,
            }
          : {}),
        ...(scheduleScope ? scheduleScope.summary : {}),
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
