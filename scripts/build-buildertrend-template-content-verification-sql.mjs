#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

import { buildBuildertrendTemplateContentVerificationSql } from "./lib/buildertrend-template-content-verification.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const capturePath = optionValue(args, "--capture")
const inventoryPath = optionValue(args, "--inventory")
const releasePath = optionValue(args, "--release")
const organizationId = optionValue(args, "--organization-id")
const phase = optionValue(args, "--phase")
const outputPath = optionValue(args, "--output")
if (!capturePath || !inventoryPath || !organizationId || !phase || !outputPath) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-template-content-verification-sql.mjs " +
      "--capture <capture.json> --inventory <inventory.json> " +
      "--organization-id <org-id> --phase <preflight|postflight> " +
      "--output <read-only-query.sql> [--release <release.json>]"
  )
}

const [capture, inventory, release] = await Promise.all([
  readFile(capturePath, "utf8").then(JSON.parse),
  readFile(inventoryPath, "utf8").then(JSON.parse),
  releasePath ? readFile(releasePath, "utf8").then(JSON.parse) : null,
])
const build = buildBuildertrendTemplateContentVerificationSql({
  capture,
  inventory,
  organizationId,
  phase,
  excludedSourceTemplateIds: release?.excludedTemplates?.map(
    (template) => template.sourceTemplateId
  ) ?? [],
})
await writeFile(outputPath, build.sql, "utf8")
console.log(JSON.stringify({
  phase: build.phase,
  readOnly: true,
  templateCount: build.templateCount,
  contentItemCount: build.contentItemCount,
  predecessorCount: build.predecessorCount,
  sourceTemplateIds: build.sourceTemplateIds,
  excludedSourceTemplateIds: build.excludedSourceTemplateIds,
  output: outputPath,
}, null, 2))
