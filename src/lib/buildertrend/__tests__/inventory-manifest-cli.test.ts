import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const script = resolve(
  process.cwd(),
  "scripts/build-buildertrend-inventory-manifest.mjs"
)
const fixture = resolve(
  process.cwd(),
  "scripts/fixtures/buildertrend-job-inventory-visible.json"
)

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("bun", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
}

function requiredArgs(input: string): readonly string[] {
  return [
    "--input",
    input,
    "--kind",
    "jobs",
    "--run-key",
    "cli-test-jobs",
    "--source-label",
    "CLI test jobs",
    "--captured-at",
    "2026-07-30T12:00:00.000Z",
  ]
}

describe("Buildertrend inventory manifest CLI", () => {
  let directory: string
  let input: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "compass-buildertrend-cli-"))
    input = join(directory, "input.json")
    copyFileSync(fixture, input)
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it("performs a dry run without writing an output file", () => {
    const output = join(directory, "manifest.json")
    const result = runCli([
      ...requiredArgs(input),
      "--output",
      output,
      "--dry-run",
    ])

    expect(result.status).toBe(0)
    expect(existsSync(output)).toBe(false)
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      recordCount: 1,
      accessCandidateCount: 1,
    })
  })

  it("rejects unknown, duplicate, and unsafe output options", () => {
    const unknown = runCli([...requiredArgs(input), "--unknown"])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain("Unknown option: --unknown")

    const duplicate = runCli([
      ...requiredArgs(input),
      "--kind",
      "jobs",
      "--dry-run",
    ])
    expect(duplicate.status).toBe(1)
    expect(duplicate.stderr).toContain(
      "--kind may only be provided once"
    )

    const samePath = runCli([
      ...requiredArgs(input),
      "--output",
      input,
    ])
    expect(samePath.status).toBe(1)
    expect(samePath.stderr).toContain(
      "--output must not overwrite --input"
    )
  })

  it("rejects hardlink and symlink aliases of the input", () => {
    const hardlink = join(directory, "hardlink.json")
    linkSync(input, hardlink)
    const hardlinkResult = runCli([
      ...requiredArgs(input),
      "--output",
      hardlink,
    ])
    expect(hardlinkResult.status).toBe(1)
    expect(hardlinkResult.stderr).toContain(
      "--output must not overwrite --input"
    )

    const symlink = join(directory, "symlink.json")
    symlinkSync(input, symlink)
    const symlinkResult = runCli([
      ...requiredArgs(input),
      "--output",
      symlink,
    ])
    expect(symlinkResult.status).toBe(1)
    expect(symlinkResult.stderr).toContain(
      "--output must not overwrite --input"
    )
  })

  it("atomically replaces output without leaving temporary files", () => {
    const output = join(directory, "manifest.json")
    writeFileSync(output, "old output")
    const result = runCli([
      ...requiredArgs(input),
      "--output",
      output,
    ])

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      runKey: "cli-test-jobs",
      records: [{ sourceKey: "job:1001" }],
    })
    expect(
      readdirSync(directory).filter((name) =>
        name.startsWith(`.${basename(output)}.`)
      )
    ).toEqual([])
  })
})
