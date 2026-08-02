import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { generateBuildertrendChangeOrderImportSql } from "./lib/buildertrend-change-order-import.mjs"

const fixturePath = resolve(
  "scripts/fixtures/buildertrend-loeffler-loomis-change-orders-2026-07-31.json"
)
const fixture = JSON.parse(await readFile(fixturePath, "utf8"))
const output = generateBuildertrendChangeOrderImportSql(fixture)
const outputIndex = process.argv.indexOf("--output")

if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1]
  if (!outputPath) throw new Error("--output requires a path")
  await writeFile(resolve(outputPath), output, "utf8")
} else {
  process.stdout.write(output)
}
