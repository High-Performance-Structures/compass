#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

import { buildBuildertrendTemplateNextBatchManifest } from "./lib/buildertrend-template-next-batch.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const workplanPath = optionValue(args, "--workplan") ??
  "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json"
const pilotPath = optionValue(args, "--pilot") ??
  "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json"
const generatedAt = optionValue(args, "--generated-at")
const outputPath = optionValue(args, "--output")

if (!generatedAt || !outputPath) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-template-next-batch-manifest.mjs " +
      "--generated-at <YYYY-MM-DD> --output <manifest.json> " +
      "[--workplan <workplan.json>] [--pilot <pilot.json>]"
  )
}

const manifest = buildBuildertrendTemplateNextBatchManifest({
  workplan: JSON.parse(await readFile(workplanPath, "utf8")),
  pilotManifest: JSON.parse(await readFile(pilotPath, "utf8")),
  generatedAt,
})
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({
  output: outputPath,
  templateCount: manifest.templates.length,
  priorityTemplateCount: manifest.waves[0].templateCount,
  browserCaptureGateCount: manifest.browserCaptureGateCount,
}, null, 2))
