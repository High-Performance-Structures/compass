#!/usr/bin/env bun

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
  buildBuildertrendLeadProjectCutoverSql,
  parseBuildertrendLeadProjectCutover,
} from "../src/lib/buildertrend/lead-project-cutover.ts"

function usage() {
  console.error(
    "Usage: bun scripts/build-buildertrend-lead-project-cutover-sql.mjs " +
      "--input <leads.json> --organization-id <org-id> " +
      "[--output <cutover.sql>] [--dry-run]",
  )
}

function parseArgs(argv) {
  const values = new Map()
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be provided once")
      dryRun = true
      continue
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`)
    }
    const option = argument.slice(2)
    if (option !== "input" && option !== "organization-id" && option !== "output") {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (values.has(option)) throw new Error(`${argument} may only be provided once`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`)
    values.set(option, value)
    index += 1
  }
  const input = values.get("input")
  const organizationId = values.get("organization-id")
  const output = values.get("output")
  if (!input || !organizationId || (!dryRun && !output)) {
    throw new Error("Missing a required option")
  }
  if (output && resolve(input) === resolve(output)) {
    throw new Error("--output must not overwrite --input")
  }
  return { input, organizationId, output, dryRun }
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.dryRun && options.output) {
    await assertDistinctFiles(options.input, options.output)
  }
  const input = JSON.parse(await readFile(options.input, "utf8"))
  const parsed = parseBuildertrendLeadProjectCutover(input, options.organizationId)
  if (!parsed.success) {
    throw new Error(`Invalid Buildertrend lead cutover:\n${parsed.errors.join("\n")}`)
  }
  const build = await buildBuildertrendLeadProjectCutoverSql(
    options.organizationId,
    parsed.data,
  )
  if (!options.dryRun && options.output) {
    await writeFileAtomically(options.output, build.sql)
  }
  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        input: options.input,
        output: options.dryRun ? null : options.output,
        ...build.summary,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
