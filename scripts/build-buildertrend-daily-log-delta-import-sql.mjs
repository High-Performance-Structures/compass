import {
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import {
  generateBuildertrendDailyLogDeltaImportSql,
  summarizeBuildertrendDailyLogDeltaImport,
} from "./lib/buildertrend-daily-log-delta-import.mjs"

function option(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

async function existingFileIdentity(path) {
  try {
    const canonicalPath = await realpath(path)
    const metadata = await stat(canonicalPath)
    return { canonicalPath, device: metadata.dev, inode: metadata.ino }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null
    }
    throw error
  }
}

async function assertDistinctFiles(input, output) {
  const inputIdentity = await existingFileIdentity(input)
  if (!inputIdentity) throw new Error("--input does not exist")
  const outputIdentity = await existingFileIdentity(output)
  if (
    outputIdentity &&
    (outputIdentity.canonicalPath === inputIdentity.canonicalPath ||
      (outputIdentity.device === inputIdentity.device && outputIdentity.inode === inputIdentity.inode))
  ) {
    throw new Error("--output must not overwrite --input")
  }
}

async function writeFileAtomically(output, contents) {
  const resolvedOutput = resolve(output)
  const temporaryOutput = join(
    dirname(resolvedOutput),
    `.${basename(resolvedOutput)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    await writeFile(temporaryOutput, contents, { flag: "wx" })
    await rename(temporaryOutput, resolvedOutput)
  } catch (error) {
    try {
      await unlink(temporaryOutput)
    } catch {
      // Temporary output may not have been created.
    }
    throw error
  }
}

const inputPath = option("--input")
const outputPath = option("--output")
const dryRun = process.argv.includes("--dry-run")
if (!inputPath) throw new Error("--input is required")
if (!dryRun && !outputPath) throw new Error("--output is required unless --dry-run is used")
if (!dryRun && outputPath) await assertDistinctFiles(inputPath, outputPath)

const fixture = JSON.parse(await readFile(resolve(inputPath), "utf8"))
if (dryRun) {
  process.stdout.write(`${JSON.stringify(summarizeBuildertrendDailyLogDeltaImport(fixture), null, 2)}\n`)
} else {
  await writeFileAtomically(
    outputPath,
    generateBuildertrendDailyLogDeltaImportSql(fixture),
  )
}
