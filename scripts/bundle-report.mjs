// Bundle report: how big the production Worker file is and where the size
// comes from. Run it after a build (`bun run upload` / `bun run deploy`, or
// `opennextjs-cloudflare build` + `bun scripts/ascii-worker-bundle.mjs`):
//
//   bun run bundle:report            # sizes, duplicate module code, top duplicates
//   node --experimental-vm-modules scripts/bundle-report.mjs --parse
//                                    # also times how long V8 takes to parse handler.mjs
//
// What the numbers mean is explained in docs/architecture/server-bundle.md.
// Read only: it never changes the build output.

import { existsSync, readFileSync, statSync } from "node:fs"
import vm from "node:vm"

import { measureChunks, readModuleNames } from "./turbopack-chunks.mjs"

const BUNDLE_DIR = ".open-next/server-functions/default"
const CHUNKS_DIR = `${BUNDLE_DIR}/.next/server/chunks`
const HANDLER = `${BUNDLE_DIR}/handler.mjs`
const META = `${HANDLER}.meta.json`
const TOP = 25

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`

function fail(message) {
  console.error(`bundle-report: ${message}`)
  process.exit(1)
}

/** Which bucket an esbuild input file belongs to. */
function bucket(path) {
  if (path.includes("/.next/server/chunks/")) return "route chunks (app code + libraries)"
  // OpenNext inlines every build manifest into Next's load-manifest module.
  if (path.endsWith("/load-manifest.external.js") || (/manifest/i.test(path) && !path.includes("/node_modules/"))) {
    return "Next manifests (inlined by OpenNext)"
  }
  if (path.includes("/node_modules/")) return "Next runtime + other node_modules"
  return "OpenNext glue"
}

// --- report -------------------------------------------------------------------

function parseTime() {
  if (typeof vm.SourceTextModule !== "function") {
    console.log("\nV8 parse time: run with `node --experimental-vm-modules scripts/bundle-report.mjs --parse`")
    return
  }
  // latin1 keeps one byte per character, like the ASCII-only deployed file.
  const source = readFileSync(HANDLER, "latin1")
  const times = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    new vm.SourceTextModule(source, { identifier: `handler-${i}` })
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  console.log(`\nV8 parse time (median of 5): ${times[2].toFixed(0)} ms`)
}

function main() {
  if (!existsSync(HANDLER) || !existsSync(META)) {
    fail(`${HANDLER} not found. Build first (see the header of this file).`)
  }
  const handlerBytes = statSync(HANDLER).size
  const handlerText = readFileSync(HANDLER, "latin1")
  const nonAscii = handlerText.match(/[^\x00-\x7f]/g)?.length ?? 0

  console.log(`handler.mjs: ${mb(handlerBytes)}${nonAscii ? `  (WARNING: ${nonAscii} non-ASCII bytes - run scripts/ascii-worker-bundle.mjs)` : "  (ASCII only)"}`)

  const meta = JSON.parse(readFileSync(META, "utf8"))
  const inputs = Object.values(meta.outputs)[0]?.inputs ?? {}
  const buckets = new Map()
  for (const [path, info] of Object.entries(inputs)) {
    const name = bucket(path)
    buckets.set(name, (buckets.get(name) ?? 0) + info.bytesInOutput)
  }
  console.log("\nWhat handler.mjs is made of:")
  for (const [name, bytes] of [...buckets].sort((a, b) => b[1] - a[1])) console.log(`  ${mb(bytes).padStart(10)}  ${name}`)

  const { modules, unreadBytes, sharedBytes, sharedCount } = measureChunks(CHUNKS_DIR)
  const names = readModuleNames()
  const nameOf = (entry) => names[entry.id] ?? null
  const total = modules.reduce((sum, entry) => sum + entry.total, 0)
  const unique = modules.reduce((sum, entry) => sum + entry.size, 0)
  const duplicated = modules.filter((entry) => entry.copies > 1)
  // The same source file can also get a different module id per layer
  // (server-rendering vs route handlers), so count each source file once too.
  const largestBySource = new Map()
  for (const entry of modules) {
    const key = nameOf(entry) ?? `#${entry.id}`
    largestBySource.set(key, Math.max(largestBySource.get(key) ?? 0, entry.size))
  }
  const uniqueBySource = [...largestBySource.values()].reduce((sum, size) => sum + size, 0)

  console.log(`\nModule code in the route chunks:`)
  console.log(`  ${mb(total).padStart(10)}  total module code`)
  console.log(`  ${mb(unique).padStart(10)}  unique (each module counted once)`)
  console.log(`  ${mb(uniqueBySource).padStart(10)}  unique by source file (each file counted once)`)
  console.log(`  ${mb(total - unique).padStart(10)}  leftover copies of the same module id`)
  console.log(`  ${mb(sharedBytes).padStart(10)}  in shared-modules.js (${sharedCount} modules moved there by dedupe-server-chunks.mjs)`)
  console.log(`  ${String(modules.length).padStart(10)}  modules, ${duplicated.length} of them still in more than one chunk`)
  if (unreadBytes) console.log(`  ${mb(unreadBytes).padStart(10)}  in chunks this script could not read`)

  console.log(`\nTop ${TOP} modules by leftover copies (extra bytes, copies, source):`)
  for (const entry of duplicated.sort((a, b) => b.total - b.size - (a.total - a.size)).slice(0, TOP)) {
    console.log(`  ${mb(entry.total - entry.size).padStart(10)}  x${String(entry.copies).padEnd(4)} ${nameOf(entry) ?? `module #${entry.id} (no name)`}`)
  }

  if (process.argv.includes("--parse")) parseTime()
}

main()
