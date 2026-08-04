#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises"
import { extname, join } from "node:path"

import {
  buildBuildertrendTemplateNextBatchManifest,
  validateBuildertrendNextBatchFragments,
} from "./lib/buildertrend-template-next-batch.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const manifestPath = optionValue(args, "--manifest") ??
  "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json"
const workplanPath = optionValue(args, "--workplan") ??
  "scripts/fixtures/buildertrend-template-capture-workplan-2026-08-03.json"
const pilotPath = optionValue(args, "--pilot") ??
  "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json"
const fragmentsPath = optionValue(args, "--fragments") ??
  "scripts/fixtures/buildertrend-template-content-next-batch/fragments"

const [manifest, workplan, pilotManifest] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(workplanPath, "utf8").then(JSON.parse),
  readFile(pilotPath, "utf8").then(JSON.parse),
])
const expected = buildBuildertrendTemplateNextBatchManifest({
  workplan,
  pilotManifest,
  generatedAt: manifest.generatedAt,
})
if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
  throw new Error("Next-batch manifest is stale or differs from the deterministic workplan projection.")
}

const fragmentEntries = (await readdir(fragmentsPath, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
  .sort((left, right) => left.name.localeCompare(right.name))
const documents = await Promise.all(fragmentEntries.map(async (entry) => ({
  source: join(fragmentsPath, entry.name),
  document: JSON.parse(await readFile(join(fragmentsPath, entry.name), "utf8")),
})))
const status = validateBuildertrendNextBatchFragments({ manifest, documents })

if (args.includes("--require-priority-complete") && status.priorityRemainingGateCount > 0) {
  throw new Error(`Priority next-batch capture has ${status.priorityRemainingGateCount} remaining source module gate(s).`)
}
if (args.includes("--require-all-complete") && status.remainingGateCount > 0) {
  throw new Error(`Next-batch capture has ${status.remainingGateCount} remaining source module gate(s).`)
}

console.log(JSON.stringify({
  manifestValid: true,
  templateCount: manifest.templates.length,
  priorityTemplateCount: manifest.waves[0].templateCount,
  capturedGateCount: status.capturedGateCount,
  remainingGateCount: status.remainingGateCount,
  priorityRemainingGateCount: status.priorityRemainingGateCount,
  missing: status.missing,
}, null, 2))
