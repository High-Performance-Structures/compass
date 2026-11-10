// Fails when copies of shared server code come back into the build.
//
//   bun run build && bun run bundle:check            # CI's Build job
//   bun run bundle:check -- --write                  # lock in an improvement
//
// scripts/dedupe-server-chunks.mjs moves every byte-for-byte copy of a module
// into one shared file after `next build`. What is left are copies it can't
// merge: the same module minified slightly differently in two chunks, or code
// tied to its own file. This check measures those leftover copies in
// .next/server/chunks and compares them with bundle-duplicates-baseline.json.
//
// It fails when:
// - shared-modules.js is missing (the dedupe step didn't run), or
// - leftover copies grow more than TOLERANCE_BYTES over the baseline, which
//   is what happens if a Next.js upgrade changes the chunk format and the
//   dedupe step quietly stops matching anything.
//
// Fix a failure by finding out why the listed modules are copied, not by
// raising the baseline. See docs/architecture/server-bundle.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { SHARED_FILE, measureChunks, readModuleNames } from "./turbopack-chunks.mjs"

const CHUNKS_DIR = ".next/server/chunks"
const BASELINE_FILE = "scripts/bundle-duplicates-baseline.json"
// Ordinary changes move leftover copies by a few KB; a broken dedupe step adds MBs.
const TOLERANCE_BYTES = 250_000
const TOP = 15

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`

function fail(message) {
  console.error(`bundle-duplicates-check: ${message}`)
  process.exit(1)
}

function main() {
  if (!existsSync(CHUNKS_DIR)) fail(`${CHUNKS_DIR} not found. Run \`bun run build\` first.`)
  if (!existsSync(path.join(CHUNKS_DIR, SHARED_FILE))) {
    fail(`${SHARED_FILE} is missing, so scripts/dedupe-server-chunks.mjs did not run after \`next build\`.`)
  }

  const { modules, sharedCount } = measureChunks(CHUNKS_DIR)
  const names = readModuleNames()
  const leftover = modules
    .map((entry) => ({ ...entry, extra: entry.total - entry.size }))
    .filter((entry) => entry.extra > 0)
    .sort((a, b) => b.extra - a.extra)
  const extraBytes = leftover.reduce((sum, entry) => sum + entry.extra, 0)

  console.log(`Shared modules: ${sharedCount}`)
  console.log(`Leftover copies: ${mb(extraBytes)} in ${leftover.length} modules`)
  for (const entry of leftover.slice(0, TOP)) {
    console.log(`  ${mb(entry.extra).padStart(9)}  x${String(entry.copies).padEnd(4)} ${names[entry.id] ?? `module #${entry.id}`}`)
  }

  if (process.argv.includes("--write")) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify({ leftoverCopyBytes: extraBytes }, null, 2)}\n`)
    console.log(`Wrote ${BASELINE_FILE}`)
    return
  }

  const { leftoverCopyBytes } = JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
  if (extraBytes > leftoverCopyBytes + TOLERANCE_BYTES) {
    fail(
      `leftover copies grew from ${mb(leftoverCopyBytes)} to ${mb(extraBytes)}. ` +
        "Check that dedupe-server-chunks.mjs still understands the chunk format, then why the modules above are copied.",
    )
  }
  if (extraBytes < leftoverCopyBytes - TOLERANCE_BYTES) {
    console.log("Leftover copies shrank. Lock it in with `bun run bundle:check -- --write`.")
  }
}

main()
