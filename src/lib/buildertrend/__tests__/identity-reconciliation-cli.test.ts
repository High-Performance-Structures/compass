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
  "scripts/build-buildertrend-identity-review-sql.mjs"
)
const fixture = resolve(
  process.cwd(),
  "scripts/fixtures/buildertrend-identity-review-example.json"
)

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("bun", [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
}

function requiredArgs(input: string): readonly string[] {
  return ["--input", input, "--organization-id", "org-a"]
}

describe("Buildertrend identity review CLI", () => {
  let directory: string
  let input: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "compass-buildertrend-identity-"))
    input = join(directory, "review.json")
    copyFileSync(fixture, input)
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it("performs a dry run without writing SQL", () => {
    const output = join(directory, "review.sql")
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
      decisionCount: 2,
      relationshipCount: 2,
      leadConversionCount: 1,
    })
  })

  it("rejects unknown, duplicate, and aliased output paths", () => {
    const unknown = runCli([...requiredArgs(input), "--unknown"])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain("Unknown option: --unknown")

    const duplicate = runCli([
      ...requiredArgs(input),
      "--organization-id",
      "org-a",
      "--dry-run",
    ])
    expect(duplicate.status).toBe(1)
    expect(duplicate.stderr).toContain(
      "--organization-id may only be provided once"
    )

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

  it("atomically writes review-only SQL", () => {
    const output = join(directory, "review.sql")
    writeFileSync(output, "old output")
    const result = runCli([...requiredArgs(input), "--output", output])

    expect(result.status).toBe(0)
    const sql = readFileSync(output, "utf8")
    expect(sql).toContain("buildertrend_staging_identity_decisions")
    expect(sql).not.toMatch(
      /INSERT(?: OR IGNORE)? INTO (?:projects|customers|users|project_members|notifications)\b/
    )
    expect(
      readdirSync(directory).filter((name) =>
        name.startsWith(`.${basename(output)}.`)
      )
    ).toEqual([])
  })
})
