import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  generateO583674OperationalCutover,
  summarizeO583674OperationalCutover,
} from "./lib/o-58-3674-operational-cutover.mjs"

function option(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

const inputPath = option("--input")
const sqlOutputPath = option("--sql-output")
const batchOutputPath = option("--batch-output")
const dryRun = process.argv.includes("--dry-run")
if (!inputPath) throw new Error("--input is required")
if (!dryRun && (!sqlOutputPath || !batchOutputPath)) {
  throw new Error("--sql-output and --batch-output are required unless --dry-run is used")
}

const fixture = JSON.parse(await readFile(resolve(inputPath), "utf8"))
if (dryRun) {
  process.stdout.write(`${JSON.stringify(summarizeO583674OperationalCutover(fixture), null, 2)}\n`)
} else {
  const output = generateO583674OperationalCutover(fixture)
  await Promise.all([
    writeFile(resolve(sqlOutputPath), output.canonicalSql, "utf8"),
    writeFile(resolve(batchOutputPath), `${JSON.stringify(output.statements, null, 2)}\n`, "utf8"),
  ])
  process.stdout.write(`${JSON.stringify(output.summary, null, 2)}\n`)
}
