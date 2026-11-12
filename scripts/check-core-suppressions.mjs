#!/usr/bin/env node
// Compass Core ratchet (issue #1329, architecture-standards.md section 1a).
//
// eslint-suppressions.json freezes the Core ownership violations that existed
// when the lint rules landed. ESLint itself fails on new violations and on
// fixed-but-unpruned ones; this check closes the remaining escape hatches:
//   1. the suppressions file may only shrink against the base branch, so
//      `eslint --suppress-all` / `--suppress-rule` cannot hide new code;
//   2. no inline eslint directive may name a compass-core rule.
//
// Usage: node scripts/check-core-suppressions.mjs [base-ref]   (default origin/main)
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const SUPPRESSIONS = "eslint-suppressions.json"
const SCAN = ["src", "custom-worker.ts"]
const DIRECTIVE = /^\s*(?:\/\/|\/\*|\*).*eslint-(?:disable|enable)\S*.*compass-core/
const baseRef = process.argv[2] ?? process.env.CORE_SUPPRESSIONS_BASE ?? "origin/main"
const failures = []

function readBase() {
  try {
    return JSON.parse(execFileSync("git", ["show", `${baseRef}:${SUPPRESSIONS}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return null
  }
}

function counts(suppressions) {
  const map = new Map()
  for (const [file, rules] of Object.entries(suppressions)) {
    for (const [rule, entry] of Object.entries(rules)) map.set(`${file} :: ${rule}`, entry.count)
  }
  return map
}

const current = counts(JSON.parse(readFileSync(SUPPRESSIONS, "utf8")))
const baseJson = readBase()
if (baseJson === null) {
  console.log(`check-core-suppressions: ${baseRef} has no ${SUPPRESSIONS}; this change creates the baseline.`)
} else {
  const base = counts(baseJson)
  for (const [key, count] of current) {
    const allowed = base.get(key) ?? 0
    if (count > allowed) failures.push(`suppression grew: ${key} (${allowed} -> ${count})`)
  }
}

function walk(path) {
  if (statSync(path).isFile()) return /\.(?:[cm]?[jt]sx?)$/.test(path) ? [path] : []
  return readdirSync(path).flatMap((name) => (name === "node_modules" ? [] : walk(join(path, name))))
}

for (const file of SCAN.flatMap(walk)) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (DIRECTIVE.test(line)) failures.push(`inline directive disables a compass-core rule: ${file}:${index + 1}`)
    })
}

if (failures.length > 0) {
  console.error(
    [
      "Compass Core ownership ratchet failed:",
      ...failures.map((failure) => `  - ${failure}`),
      "",
      "Do not suppress or disable compass-core rules. Move the table access into its owning",
      "domain module (src/lib/domain/<module>/, see src/lib/domain/table-ownership.json) and call it.",
      "See docs/development/architecture-standards.md (section 1a).",
    ].join("\n"),
  )
  process.exit(1)
}
console.log(`check-core-suppressions: ok (${current.size} frozen entries, none grew).`)
