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
import { parse } from "acorn"

const BUNDLE_DIR = ".open-next/server-functions/default"
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

// --- source maps: just enough to name a module --------------------------------

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const BASE64_VALUE = new Map([...BASE64].map((char, index) => [char, index]))

/** Decodes a source map's `mappings` into [generatedOffset, sourceIndex] pairs. */
function decodeMappings(mappings, lineStarts) {
  const pairs = []
  let sourceIndex = 0
  mappings.split(";").forEach((line, lineNumber) => {
    let column = 0
    for (const segment of line.split(",")) {
      if (!segment) continue
      const fields = []
      let value = 0
      let shift = 0
      for (const char of segment) {
        const digit = BASE64_VALUE.get(char) ?? 0
        value += (digit & 31) << shift
        if (digit & 32) {
          shift += 5
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1)
          value = 0
          shift = 0
        }
      }
      column += fields[0] ?? 0
      if (fields.length > 1) {
        sourceIndex += fields[1]
        pairs.push([(lineStarts[lineNumber] ?? 0) + column, sourceIndex])
      }
    }
  })
  return pairs.sort((a, b) => a[0] - b[0])
}

function loadSourceMap(chunkPath, source) {
  // OpenNext copies chunks without their maps; the originals sit in .next/.
  const candidates = [`${chunkPath}.map`, `${chunkPath.replace(/^.*?\.next\//, ".next/")}.map`]
  const mapPath = candidates.find((path) => existsSync(path))
  if (!mapPath) return null
  try {
    const map = JSON.parse(readFileSync(mapPath, "utf8"))
    const lineStarts = [0]
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1)
    return { sources: map.sources, pairs: decodeMappings(map.mappings, lineStarts) }
  } catch {
    return null
  }
}

/** The source file that most of a byte range maps back to. */
function nameRange(map, start, end) {
  if (!map) return null
  let lo = 0
  let hi = map.pairs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (map.pairs[mid][0] < start) lo = mid + 1
    else hi = mid
  }
  const counts = new Map()
  for (let i = lo; i < map.pairs.length && map.pairs[i][0] < end; i++) {
    const index = map.pairs[i][1]
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  let best = -1
  let bestCount = 0
  for (const [index, count] of counts) if (count > bestCount) [best, bestCount] = [index, count]
  if (best < 0) return null
  return String(map.sources[best])
    .replace(/^turbopack:\/\/\/?/, "")
    .replace(/^\[project\]\//, "")
    .replace(/^(\.\.\/)+/, "")
}

// --- Turbopack chunks ---------------------------------------------------------

/**
 * A Turbopack server chunk is an array of [moduleId, factoryFunction, ...].
 * The same module id appearing in several chunks is the same module copied
 * into each route's chunk group.
 */
function findModuleArray(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null
  if (
    node.type === "ArrayExpression" &&
    node.elements.length > 1 &&
    node.elements.some((element) => element?.type === "Literal" && typeof element.value === "number")
  ) {
    return node
  }
  for (const value of Object.values(node)) {
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) {
      if (child && typeof child.type === "string") {
        const found = findModuleArray(child, depth + 1)
        if (found) return found
      }
    }
  }
  return null
}

function collectModules(chunkPaths) {
  const modules = new Map()
  let unparsedBytes = 0
  for (const path of chunkPaths) {
    const source = readFileSync(path, "utf8")
    let ast
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true })
    } catch {
      unparsedBytes += source.length
      continue
    }
    const array = findModuleArray(ast)
    if (!array) {
      unparsedBytes += source.length
      continue
    }
    let map
    const elements = array.elements
    for (let i = 0; i < elements.length - 1; i++) {
      const id = elements[i]
      const factory = elements[i + 1]
      if (id?.type !== "Literal" || typeof id.value !== "number" || !/Function/.test(factory?.type ?? "")) continue
      const size = factory.end - id.start
      const entry = modules.get(id.value) ?? { id: id.value, name: null, copies: 0, size: 0, total: 0 }
      if (!entry.name) {
        map ??= loadSourceMap(path, source)
        entry.name = nameRange(map, factory.start, factory.end)
      }
      entry.copies++
      entry.size = Math.max(entry.size, size)
      entry.total += size
      modules.set(id.value, entry)
    }
  }
  return { modules: [...modules.values()], unparsedBytes }
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

  const chunkPaths = Object.keys(inputs).filter((path) => path.includes("/.next/server/chunks/") && existsSync(path))
  const { modules, unparsedBytes } = collectModules(chunkPaths)
  const total = modules.reduce((sum, entry) => sum + entry.total, 0)
  const unique = modules.reduce((sum, entry) => sum + entry.size, 0)
  const duplicated = modules.filter((entry) => entry.copies > 1)
  // The same source file can also get a different module id per layer
  // (server-rendering vs route handlers), so count each source file once too.
  const largestBySource = new Map()
  for (const entry of modules) {
    const key = entry.name ?? `#${entry.id}`
    largestBySource.set(key, Math.max(largestBySource.get(key) ?? 0, entry.size))
  }
  const uniqueBySource = [...largestBySource.values()].reduce((sum, size) => sum + size, 0)

  console.log(`\nModule code in ${chunkPaths.length} route chunks:`)
  console.log(`  ${mb(total).padStart(10)}  total module code`)
  console.log(`  ${mb(unique).padStart(10)}  unique (each module counted once)`)
  console.log(`  ${mb(uniqueBySource).padStart(10)}  unique by source file (each file counted once)`)
  console.log(`  ${mb(total - unique).padStart(10)}  extra copies of the same module id`)
  console.log(`  ${String(modules.length).padStart(10)}  modules, ${duplicated.length} of them in more than one chunk`)
  if (unparsedBytes) console.log(`  ${mb(unparsedBytes).padStart(10)}  in chunks this script could not read`)

  console.log(`\nTop ${TOP} modules by extra copies (extra bytes, copies, source):`)
  for (const entry of duplicated.sort((a, b) => b.total - b.size - (a.total - a.size)).slice(0, TOP)) {
    console.log(`  ${mb(entry.total - entry.size).padStart(10)}  x${String(entry.copies).padEnd(4)} ${entry.name ?? `module #${entry.id} (no source map)`}`)
  }

  if (process.argv.includes("--parse")) parseTime()
}

main()
