import { execFileSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { buildBuildertrendDailyLogPdfPlan, parseBuildertrendDailyLogPdf, sha256 } from "./lib/buildertrend-daily-log-pdf.mjs"

const args = process.argv.slice(2)
const allowed = new Set(["--input", "--pdf", "--output-prefix", "--dry-run", "--inspect"])
for (let index = 0; index < args.length; index++) {
  const flag = args[index]
  if (!allowed.has(flag)) throw new Error(`Unsupported option ${flag}; replacement and production execution are not supported`)
  if (!["--dry-run", "--inspect"].includes(flag)) {
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} requires a value`)
    index++
  }
}
function option(flag) {
  if (args.filter((value) => value === flag).length > 1) throw new Error(`Repeated option ${flag}`)
  const index = args.indexOf(flag)
  return index < 0 ? null : args[index + 1]
}
const pdf = option("--pdf")
if (!pdf) throw new Error("--pdf is required")
const bytes = await readFile(resolve(pdf))
const layoutText = execFileSync("pdftotext", ["-layout", resolve(pdf), "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (args.includes("--inspect")) {
  process.stdout.write(`${JSON.stringify({ pdfSha256: sha256(bytes), bytes: bytes.length, layoutTextSha256: sha256(layoutText), records: parseBuildertrendDailyLogPdf(layoutText) }, null, 2)}\n`)
} else {
  const input = option("--input")
  if (!input) throw new Error("--input is required")
  const plan = buildBuildertrendDailyLogPdfPlan(JSON.parse(await readFile(resolve(input), "utf8")), bytes, layoutText)
  if (!args.includes("--dry-run")) {
    const prefix = option("--output-prefix")
    if (!prefix) throw new Error("--output-prefix is required unless --dry-run is used")
    // Exclusive creation prevents accidental replacement of a previously reviewed plan.
    await writeFile(resolve(`${prefix}.plan.json`), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" })
    await writeFile(resolve(`${prefix}.apply.sql`), plan.applySql, { flag: "wx" })
    await writeFile(resolve(`${prefix}.inverse.sql`), plan.inverseSql, { flag: "wx" })
  }
  process.stdout.write(`${JSON.stringify(plan.summary, null, 2)}\n`)
}
