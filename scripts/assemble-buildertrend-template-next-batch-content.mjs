#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"
import { readPilotContentFragments } from "./lib/buildertrend-template-content-pilot.mjs"

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
const releasePath = optionValue(args, "--release") ??
  "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json"
const manifestPath = optionValue(args, "--manifest") ??
  "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json"
const reviewedCapturePath = optionValue(args, "--reviewed-capture") ??
  "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json"
const fragmentsPath = optionValue(args, "--fragments") ??
  "scripts/fixtures/buildertrend-template-content-next-batch/fragments"
const captureOutputPath = optionValue(args, "--capture-output")
const inventoryOutputPath = optionValue(args, "--inventory-output")
const check = args.includes("--check")

if (!check && (!captureOutputPath || !inventoryOutputPath)) {
  throw new Error(
    "Usage: bun scripts/assemble-buildertrend-template-next-batch-content.mjs " +
      "[--release <release.json>] [--manifest <manifest.json>] " +
      "[--reviewed-capture <capture.json>] " +
      "[--fragments <reviewed-fragment-directory>] " +
      "[--capture-output <capture.json> --inventory-output <inventory.json> | --check]"
  )
}

const [release, nextBatchManifest, reviewedCapture] = await Promise.all(
  [releasePath, manifestPath, reviewedCapturePath].map(async (path) =>
    JSON.parse(await readFile(path, "utf8"))
  )
)
// Read every available fragment so a newly completed template makes the
// reviewed release manifest fail stale instead of being silently skipped.
const documents = await readPilotContentFragments(fragmentsPath)
const result = assembleBuildertrendTemplateNextBatchContent({
  release,
  nextBatchManifest,
  reviewedCapture,
  documents,
})

if (captureOutputPath) {
  await writeFile(captureOutputPath, `${JSON.stringify(result.capture, null, 2)}\n`)
}
if (inventoryOutputPath) {
  await writeFile(inventoryOutputPath, `${JSON.stringify(result.inventory, null, 2)}\n`)
}
console.log(JSON.stringify({
  draftOnly: result.capture.assembly.draftOnly,
  publish: result.capture.assembly.publish,
  templateCount: result.capture.templates.length,
  sourceTemplateIds: result.capture.assembly.sourceTemplateIds,
  browserCaptureGateCount: result.capture.assembly.browserCaptureGateCount,
  excludedIncompleteTemplateCount: result.capture.assembly.excludedIncompleteTemplateCount,
  excludedArchivedTemplateCount: result.capture.assembly.excludedArchivedTemplateCount,
  eligibleAfterThisBatch: result.capture.assembly.eligibleAfterThisBatch,
  scheduleItemCount: result.capture.templates.reduce(
    (total, template) => total + (template.scheduleItems?.length ?? 0),
    0
  ),
  captureOutput: captureOutputPath,
  inventoryOutput: inventoryOutputPath,
}, null, 2))
