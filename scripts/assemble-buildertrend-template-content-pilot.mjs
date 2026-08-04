#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

import {
  assembleBuildertrendTemplateContentPilot,
  buildBuildertrendTemplateContentPilotInventory,
  readPilotContentFragments,
} from "./lib/buildertrend-template-content-pilot.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const manifestPath = optionValue(args, "--manifest")
const reviewedCapturePath = optionValue(args, "--reviewed-capture")
const basePath = optionValue(args, "--base")
const fragmentsPath = optionValue(args, "--fragments")
const outputPath = optionValue(args, "--output")
const inventoryOutputPath = optionValue(args, "--inventory-output")
const check = args.includes("--check")
const allowIncomplete = args.includes("--allow-incomplete")

if (!manifestPath || !reviewedCapturePath || (!basePath && !fragmentsPath) || (!check && !outputPath)) {
  throw new Error(
    "Usage: bun scripts/assemble-buildertrend-template-content-pilot.mjs " +
      "--manifest <pilot.json> --reviewed-capture <40-active-capture.json> " +
      "[--base <existing-capture.json>] [--fragments <directory>] " +
      "[--output <capture.json> | --check] [--inventory-output <pilot-inventory.json>] " +
      "[--allow-incomplete]"
  )
}

const documents = []
if (basePath) {
  documents.push({ source: basePath, document: JSON.parse(await readFile(basePath, "utf8")) })
}
if (fragmentsPath) documents.push(...await readPilotContentFragments(fragmentsPath))

const result = assembleBuildertrendTemplateContentPilot({
  manifest: JSON.parse(await readFile(manifestPath, "utf8")),
  reviewedCapture: JSON.parse(await readFile(reviewedCapturePath, "utf8")),
  documents,
  allowIncomplete,
})

if (outputPath) await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
if (inventoryOutputPath) {
  const pilotInventory = buildBuildertrendTemplateContentPilotInventory(result)
  await writeFile(inventoryOutputPath, `${JSON.stringify(pilotInventory, null, 2)}\n`)
}
console.log(JSON.stringify({
  complete: result.assembly.complete,
  templateCount: result.templates.length,
  missing: result.assembly.missing,
  output: outputPath,
  inventoryOutput: inventoryOutputPath,
}, null, 2))
