#!/usr/bin/env node

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

import { NEXT_BATCH_CONTENT_IDS } from "./lib/buildertrend-template-next-batch-content.mjs"

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
const outputPath = optionValue(args, "--output")
const dryRun = args.includes("--dry-run")
if (!capturePath || !inventoryPath || (!dryRun && !outputPath)) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-template-next-batch-content-sql.mjs " +
      "--capture <capture.json> --inventory <inventory.json> " +
      "[--output <import.sql> | --dry-run]"
  )
}

const [capture, inventory] = await Promise.all(
  [capturePath, inventoryPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
)
if (
  capture.assembly?.complete !== true ||
  capture.assembly?.draftOnly !== true ||
  capture.assembly?.publish !== false
) {
  throw new Error("Next-batch SQL requires a complete, draft-only assembled capture.")
}
const capturedIds = capture.templates?.map((template) => template.sourceTemplateId)
const inventoryIds = inventory.templates?.map((template) => template.sourceTemplateId)
if (
  JSON.stringify(capturedIds) !== JSON.stringify(NEXT_BATCH_CONTENT_IDS) ||
  JSON.stringify(inventoryIds) !== JSON.stringify(NEXT_BATCH_CONTENT_IDS)
) {
  throw new Error("Next-batch SQL may import only the approved Stucco and MEP templates.")
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
