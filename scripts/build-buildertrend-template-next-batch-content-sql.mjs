#!/usr/bin/env node

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
if (args.some((argument) => argument.startsWith("--publish"))) {
  throw new Error("Next-batch template content is draft-only; publication requests are prohibited.")
}
const capturePath = optionValue(args, "--capture")
const inventoryPath = optionValue(args, "--inventory")
const releasePath = optionValue(args, "--release") ??
  "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json"
const outputPath = optionValue(args, "--output")
const dryRun = args.includes("--dry-run")
if (!capturePath || !inventoryPath || (!dryRun && !outputPath)) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-template-next-batch-content-sql.mjs " +
      "--capture <capture.json> --inventory <inventory.json> " +
      "[--release <reviewed-release.json>] [--output <import.sql> | --dry-run]"
  )
}

const [capture, inventory, release] = await Promise.all(
  [capturePath, inventoryPath, releasePath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
)
if (
  capture.assembly?.complete !== true ||
  capture.assembly?.draftOnly !== true ||
  capture.assembly?.publish !== false
) {
  throw new Error("Next-batch SQL requires a complete, draft-only assembled capture.")
}
if (
  release.draftOnly !== true ||
  release.publish !== false ||
  release.releasePolicy?.lifecycleStatus !== "draft" ||
  release.releasePolicy?.versionStatus !== "draft" ||
  release.releasePolicy?.publishAllowed !== false ||
  !Array.isArray(release.templates)
) {
  throw new Error("Next-batch SQL requires a reviewed, draft-only release manifest.")
}
const approvedIds = release.templates.map((template) => template.sourceTemplateId)
if (
  approvedIds.length === 0 ||
  approvedIds.some((sourceTemplateId) => typeof sourceTemplateId !== "string" || !sourceTemplateId) ||
  new Set(approvedIds).size !== approvedIds.length ||
  release.scope?.structurallyCompleteTemplatesIncluded !== approvedIds.length ||
  release.scope?.structurallyCompleteTemplatesIncluded + release.scope?.incompleteTemplatesExcluded !== 34 ||
  release.scope?.archivedTemplatesExcluded !== 27 ||
  release.scope?.archivedTemplatesIncluded !== 0
) {
  throw new Error("Next-batch SQL release manifest has an invalid reviewed scope.")
}
const capturedIds = capture.templates?.map((template) => template.sourceTemplateId)
const inventoryIds = inventory.templates?.map((template) => template.sourceTemplateId)
if (
  JSON.stringify(capturedIds) !== JSON.stringify(approvedIds) ||
  JSON.stringify(inventoryIds) !== JSON.stringify(approvedIds) ||
  JSON.stringify(capture.assembly.sourceTemplateIds) !== JSON.stringify(approvedIds)
) {
  throw new Error("Next-batch SQL may import only templates in the reviewed draft release manifest.")
}
if (capture.excludedArchivedCount !== 27 || inventory.excludedArchivedCount !== 27) {
  throw new Error("Next-batch SQL requires all 27 archived templates to remain excluded.")
}

const command = [
  "scripts/build-buildertrend-template-content-sql.mjs",
  "--capture", capturePath,
  "--inventory", inventoryPath,
  "--strict-draft-only",
]
if (dryRun) command.push("--dry-run")
if (outputPath) command.push("--output", outputPath)
const result = await execFileAsync("bun", command)
process.stdout.write(result.stdout)
