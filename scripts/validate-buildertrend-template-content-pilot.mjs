#!/usr/bin/env node

import { readFile } from "node:fs/promises"

import { assembleBuildertrendTemplateContentPilot } from "./lib/buildertrend-template-content-pilot.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

const args = process.argv.slice(2)
const input = optionValue(args, "--input")
const manifestPath = optionValue(args, "--manifest") ??
  "scripts/fixtures/buildertrend-template-pilot-2026-08-03.json"
const reviewedCapturePath = optionValue(args, "--reviewed-capture") ??
  "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json"
const allowIncomplete = args.includes("--allow-incomplete")

if (!input) {
  throw new Error(
    "Usage: bun scripts/validate-buildertrend-template-content-pilot.mjs --input <pilot-capture.json> " +
      "[--manifest <pilot.json>] [--reviewed-capture <40-active-capture.json>] [--allow-incomplete]"
  )
}

const result = assembleBuildertrendTemplateContentPilot({
  manifest: JSON.parse(await readFile(manifestPath, "utf8")),
  reviewedCapture: JSON.parse(await readFile(reviewedCapturePath, "utf8")),
  documents: [{ source: input, document: JSON.parse(await readFile(input, "utf8")) }],
  allowIncomplete,
})

const totals = result.templates.reduce(
  (current, template) => ({
    tasks: current.tasks + (template.tasks?.length ?? 0),
    scheduleItems: current.scheduleItems + (template.scheduleItems?.length ?? 0),
    selections: current.selections + (template.selections?.length ?? 0),
    bidPackages: current.bidPackages + (template.bidPackages?.length ?? 0),
  }),
  { tasks: 0, scheduleItems: 0, selections: 0, bidPackages: 0 }
)

console.log(JSON.stringify({
  complete: result.assembly.complete,
  templateCount: result.templates.length,
  excludedArchivedCount: result.excludedArchivedCount,
  remainingActiveTemplatesUnverified: result.assembly.remainingActiveTemplatesUnverified,
  totals,
  missing: result.assembly.missing,
}, null, 2))
