import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  generateBuildertrendScheduleStatusRefreshSql,
  summarizeBuildertrendScheduleStatusRefresh,
} from "./lib/buildertrend-schedule-status-refresh.mjs"

function option(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

const inputPath = option("--input")
const outputPath = option("--output")
const dryRun = process.argv.includes("--dry-run")
if (!inputPath) throw new Error("--input is required")
if (!dryRun && !outputPath) throw new Error("--output is required unless --dry-run is used")

const fixture = JSON.parse(await readFile(resolve(inputPath), "utf8"))
if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(summarizeBuildertrendScheduleStatusRefresh(fixture), null, 2)}\n`,
  )
} else {
  await writeFile(
    resolve(outputPath),
    generateBuildertrendScheduleStatusRefreshSql(fixture),
    "utf8",
  )
}
