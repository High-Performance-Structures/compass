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
const sourceTemplateId = optionValue(args, "--source-template-id")
const verificationPartValue = optionValue(args, "--verification-part")
const verificationPart = verificationPartValue === null
  ? null
  : Number.parseInt(verificationPartValue, 10)
const outputPath = optionValue(args, "--output")
if (!capturePath || !inventoryPath || !organizationId || !phase || !outputPath) {
  throw new Error(
    "Usage: bun scripts/build-buildertrend-template-content-verification-sql.mjs " +
      "--capture <capture.json> --inventory <inventory.json> " +
      "--organization-id <org-id> --phase <preflight|postflight> " +
      "--output <read-only-query.sql> [--release <release.json>] " +
      "[--source-template-id <buildertrend-template-id>] [--verification-part <number>]"
  )
}

const [capture, inventory, release] = await Promise.all([
  readFile(capturePath, "utf8").then(JSON.parse),
  readFile(inventoryPath, "utf8").then(JSON.parse),
  releasePath ? readFile(releasePath, "utf8").then(JSON.parse) : null,
])
const scopedCapture = sourceTemplateId
  ? {
      ...capture,
      assembly: {
        ...capture.assembly,
        sourceTemplateIds: [sourceTemplateId],
      },
      templates: capture.templates.filter(
        (template) => template.sourceTemplateId === sourceTemplateId
      ),
    }
  : capture
const scopedInventory = sourceTemplateId
  ? {
      ...inventory,
      expectedActiveCount: 1,
      templates: inventory.templates.filter(
        (template) => template.sourceTemplateId === sourceTemplateId
      ),
    }
  : inventory
if (
  sourceTemplateId &&
  (scopedCapture.templates.length !== 1 || scopedInventory.templates.length !== 1)
) {
  throw new Error(`Source template ${sourceTemplateId} is not present in both verification inputs.`)
}
const build = buildBuildertrendTemplateContentVerificationSql({
  capture: scopedCapture,
  inventory: scopedInventory,
  organizationId,
  phase,
  verificationPart,
  excludedSourceTemplateIds: release?.excludedTemplates?.map(
    (template) => template.sourceTemplateId
  ) ?? [],
})
await writeFile(outputPath, build.sql, "utf8")
console.log(JSON.stringify({
  phase: build.phase,
  readOnly: true,
  verificationPart: build.verificationPart,
  verificationPartCount: build.verificationPartCount,
  templateCount: build.templateCount,
  contentItemCount: build.contentItemCount,
  predecessorCount: build.predecessorCount,
  reusableScheduleItemCount: build.reusableScheduleItemCount,
  reusableDependencyCount: build.reusableDependencyCount,
  sourceTemplateIds: build.sourceTemplateIds,
  excludedSourceTemplateIds: build.excludedSourceTemplateIds,
  output: outputPath,
}, null, 2))
