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
  buildBuildertrendInventoryManifest,
  buildertrendInventoryKinds,
} from "../src/lib/buildertrend/inventory-manifest"

function usage() {
  console.error(
    "Usage: bun scripts/build-buildertrend-inventory-manifest.mjs " +
      "--input <snapshot.json> --kind <jobs|lead-opportunities> " +
      "--run-key <key> --source-label <label> --captured-at <ISO timestamp> " +
      "[--expected-row-count <count>] [--allow-empty] " +
      "[--source-method <method>] [--raw-artifact-drive-file-id <id>] " +
      "[--raw-artifact-drive-url <url>] [--notes <notes>] " +
      "[--output <manifest.json>] [--dry-run]"
  )
}

function parseKind(value) {
  const normalized = value.replaceAll("-", "_")
  if (!buildertrendInventoryKinds.includes(normalized)) {
    throw new Error(`Unsupported --kind: ${value}`)
  }
  return normalized
}

function parseArgs(argv) {
  const valueOptions = new Set([
    "input",
    "kind",
    "run-key",
    "source-label",
    "captured-at",
    "expected-row-count",
    "source-method",
    "raw-artifact-drive-file-id",
    "raw-artifact-drive-url",
    "notes",
    "output",
  ])
  const values = new Map()
  let dryRun = false
  let allowEmpty = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be provided once")
      dryRun = true
      continue
    }
    if (argument === "--allow-empty") {
      if (allowEmpty) {
        throw new Error("--allow-empty may only be provided once")
      }
      allowEmpty = true
      continue
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`)
    }
    const option = argument.slice(2)
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (values.has(option)) {
      throw new Error(`${argument} may only be provided once`)
    }

    const value = argv[index + 1]
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`)
    }
    values.set(option, value)
    index += 1
  }

  const input = values.get("input")
  const kind = values.get("kind")
  const runKey = values.get("run-key")
  const sourceLabel = values.get("source-label")
  const capturedAt = values.get("captured-at")
  const output = values.get("output")
  if (
    !input ||
    !kind ||
    !runKey ||
    !sourceLabel ||
    !capturedAt ||
    (!dryRun && !output)
  ) {
    throw new Error("Missing a required option")
  }
  if (output && resolve(input) === resolve(output)) {
    throw new Error("--output must not overwrite --input")
  }
  const expectedRowCountValue = values.get("expected-row-count")
  const expectedRowCount =
    expectedRowCountValue === undefined
      ? undefined
      : Number(expectedRowCountValue)
  if (
    expectedRowCount !== undefined &&
    (!Number.isInteger(expectedRowCount) || expectedRowCount < 0)
  ) {
    throw new Error("--expected-row-count must be a nonnegative integer")
  }

  return {
    dryRun,
    allowEmpty,
    input,
    kind: parseKind(kind),
    runKey,
    sourceLabel,
    capturedAt,
    sourceMethod: values.get("source-method"),
    rawArtifactDriveFileId: values.get("raw-artifact-drive-file-id"),
    rawArtifactDriveUrl: values.get("raw-artifact-drive-url"),
    notes: values.get("notes"),
    expectedRowCount,
    output,
  }
}

async function existingFileIdentity(path) {
  try {
    const canonicalPath = await realpath(path)
    const metadata = await stat(canonicalPath)
    return {
      canonicalPath,
      device: metadata.dev,
      inode: metadata.ino,
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
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
      (outputIdentity.device === inputIdentity.device &&
        outputIdentity.inode === inputIdentity.inode))
  ) {
    throw new Error("--output must not overwrite --input")
  }
}

async function writeFileAtomically(output, contents) {
  const resolvedOutput = resolve(output)
  const temporaryOutput = join(
    dirname(resolvedOutput),
    `.${basename(resolvedOutput)}.${process.pid}.${Date.now()}.tmp`
  )

  try {
    await writeFile(temporaryOutput, contents, { flag: "wx" })
    await rename(temporaryOutput, resolvedOutput)
  } catch (error) {
    try {
      await unlink(temporaryOutput)
    } catch {
      // The temporary file may not have been created.
    }
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.dryRun && options.output) {
    await assertDistinctFiles(options.input, options.output)
  }

  const snapshot = JSON.parse(await readFile(options.input, "utf8"))
  const build = buildBuildertrendInventoryManifest(snapshot, {
    kind: options.kind,
    runKey: options.runKey,
    sourceLabel: options.sourceLabel,
    capturedAt: options.capturedAt,
    sourceMethod: options.sourceMethod,
    rawArtifactDriveFileId: options.rawArtifactDriveFileId,
    rawArtifactDriveUrl: options.rawArtifactDriveUrl,
    notes: options.notes,
    allowEmpty: options.allowEmpty,
    expectedRowCount: options.expectedRowCount,
  })
  if (!build.success) {
    throw new Error(`Invalid Buildertrend inventory:\n${build.errors.join("\n")}`)
  }

  if (!options.dryRun && options.output) {
    await writeFileAtomically(
      options.output,
      `${JSON.stringify(build.manifest, null, 2)}\n`
    )
  }

  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        input: options.input,
        output: options.dryRun ? null : options.output,
        runKey: build.manifest.runKey,
        ...build.summary,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  usage()
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
