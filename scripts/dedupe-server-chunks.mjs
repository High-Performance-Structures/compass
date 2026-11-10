// Removes the copies Turbopack makes of shared server code.
//
// Turbopack splits each page and API route's server code into its own group
// of chunk files under .next/server/chunks/. A module that many routes use
// (src/lib/permissions.ts, the Drizzle schema, Radix's Slot ...) gets copied
// into the chunks of each of those groups, so the Worker bundle held about
// 15 MB of repeated code. See docs/architecture/server-bundle.md.
//
// The Turbopack runtime installs the first factory it sees for a module id
// and ignores later copies, so the copies are pure waste. This script:
//
// 1. finds each factory that appears, byte for byte, in more than one chunk,
// 2. writes one copy of each to shared-modules.js in the chunks folder,
// 3. replaces the copies with `__compassSharedModules[n]`, a lookup into it.
//
// Module ids, chunk files and load order stay exactly as Turbopack made
// them; only where a factory's text lives changes. A factory that uses its
// own file's `require`, `module`, `exports`, `__dirname` or `__filename` stays
// where it is.
//
// `bun run build` runs this right after `next build`. OpenNext's build
// (deploy, upload, preview) calls `bun run build`, so every Worker gets it.
// Running it twice is harmless. `bun run bundle:check` (CI) fails if the
// copies come back; `bun run bundle:report` shows the details.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  MODULE_NAMES_FILE,
  SHARED_FILE,
  SHARED_NAME,
  chunkFiles,
  chunkModules,
  readModuleNames,
  sourceNamer,
} from "./turbopack-chunks.mjs"

// `next start` (local runs, CI's browser tests) loads .next/server/chunks.
// OpenNext packages the Worker from the copy in .next/standalone.
const CHUNK_DIRS = [".next/server/chunks", ".next/standalone/.next/server/chunks"]
// OpenNext copies only the files these traces list; the new file is added.
const SERVER_TRACES = [".next/next-server.js.nft.json", ".next/next-minimal-server.js.nft.json"]
const FILE_NAMES = new Set(["require", "module", "exports", "__dirname", "__filename"])

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`

/** True when the code uses a name tied to its own file as a variable, or `import.meta`. */
function usesFileNames(node) {
  if (!node || typeof node.type !== "string") return false
  if (node.type === "Identifier") return FILE_NAMES.has(node.name)
  if (node.type === "MetaProperty") return true
  for (const [field, value] of Object.entries(node)) {
    // `x.require` and `{ require: ... }` are property names, not variables.
    if (field === "property" && node.type === "MemberExpression" && !node.computed) continue
    if (field === "key" && !node.computed && /^(Property|PropertyDefinition|MethodDefinition)$/.test(node.type)) continue
    const children = Array.isArray(value) ? value : [value]
    if (children.some((child) => child && typeof child === "object" && usesFileNames(child))) return true
  }
  return false
}

/** Moves the repeated factories of one chunks folder into its shared-modules.js. */
function dedupe(dir, names) {
  const sharedPath = path.join(dir, SHARED_FILE)
  if (existsSync(sharedPath)) {
    console.log(`dedupe-server-chunks: ${dir} already done`)
    return
  }

  const chunks = []
  const copies = new Map()
  const fileBound = new Set()
  for (const file of chunkFiles(dir)) {
    const source = readFileSync(file, "utf8")
    const list = chunkModules(source)
    if (!list) continue
    const nameOf = sourceNamer(file, source)
    const factories = list.map(({ ids, start, end, node }) => {
      const key = `${ids.join(",")}:${source.slice(start, end)}`
      copies.set(key, (copies.get(key) ?? 0) + 1)
      if (usesFileNames(node)) fileBound.add(key)
      if (!names[ids[0]]) names[ids[0]] = nameOf(start, end)
      return { key, start, end }
    })
    chunks.push({ file, source, factories })
  }

  // The key holds the ids too, so a factory is only shared with chunks that
  // install it under the same ids.
  const shared = new Map()
  for (const [key, count] of copies) {
    if (count > 1 && !fileBound.has(key)) shared.set(key, shared.size)
  }

  let removedBytes = 0
  for (const { file, source, factories } of chunks) {
    const moved = factories.filter(({ key }) => shared.has(key))
    if (moved.length === 0) continue
    let out = source
    // Back to front so the earlier offsets stay valid.
    for (const { key, start, end } of moved.reverse()) {
      out = `${out.slice(0, start)}${SHARED_NAME}[${shared.get(key)}]${out.slice(end)}`
      removedBytes += end - start
    }
    let relative = path.relative(path.dirname(file), sharedPath)
    if (!relative.startsWith(".")) relative = `./${relative}`
    writeFileSync(file, `var ${SHARED_NAME}=require(${JSON.stringify(relative)});${out}`)
    // The chunk's source map no longer lines up; module-names.json keeps the names.
    rmSync(`${file}.map`, { force: true })
  }

  const texts = [...shared.keys()].map((key) => key.slice(key.indexOf(":") + 1))
  const sharedSource = `module.exports=[\n${texts.join(",\n")}\n]\n`
  writeFileSync(sharedPath, sharedSource)
  console.log(
    `dedupe-server-chunks: ${dir}: ${mb(removedBytes)} of copies replaced by ${shared.size} shared modules (${mb(sharedSource.length)})`,
  )
}

function main() {
  const dirs = CHUNK_DIRS.filter((dir) => existsSync(dir))
  if (dirs.length === 0) {
    console.error("dedupe-server-chunks: no .next/server/chunks folder. Run `next build` first.")
    process.exit(1)
  }

  const names = readModuleNames()
  for (const dir of dirs) dedupe(dir, names)
  writeFileSync(MODULE_NAMES_FILE, JSON.stringify(names))

  for (const traceFile of SERVER_TRACES.filter((file) => existsSync(file))) {
    const trace = JSON.parse(readFileSync(traceFile, "utf8"))
    const traced = `server/chunks/${SHARED_FILE}`
    if (!trace.files.includes(traced)) trace.files.push(traced)
    writeFileSync(traceFile, JSON.stringify(trace))
  }
}

main()
