// Reading Turbopack's server chunk files. Shared by dedupe-server-chunks.mjs,
// bundle-duplicates-check.mjs and bundle-report.mjs.
//
// A server chunk is `module.exports = [id, id, factory, id, factory, ...]`:
// one or more numeric module ids followed by the function that builds that
// module. After scripts/dedupe-server-chunks.mjs has run, a factory that was
// copied into several chunks is replaced by `__compassSharedModules[n]`, an
// entry of the folder's shared-modules.js.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "acorn"

export const SHARED_FILE = "shared-modules.js"
export const SHARED_NAME = "__compassSharedModules"
/** Module id -> source file, written by the dedupe step before it moves code. */
export const MODULE_NAMES_FILE = ".next/server/module-names.json"

/** Every chunk file in a chunks folder, without the runtime and shared-modules.js. */
export function chunkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && entry.name !== SHARED_FILE)
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.endsWith("[turbopack]_runtime.js"))
}

function parseScript(source) {
  try {
    return parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true })
  } catch {
    return null
  }
}

function isModuleExports(node) {
  return node?.type === "MemberExpression" && node.object.name === "module" && node.property.name === "exports"
}

/**
 * The modules in a chunk: `{ ids, start, end, node, shared }` per factory,
 * where `shared` is the shared-modules.js index when the factory was moved
 * there. Null when the chunk has another shape.
 */
export function chunkModules(source) {
  const ast = parseScript(source)
  const last = ast?.body.at(-1)
  const assignment = last?.type === "ExpressionStatement" ? last.expression : null
  if (assignment?.type !== "AssignmentExpression" || !isModuleExports(assignment.left)) return null
  if (assignment.right.type !== "ArrayExpression") return null

  const modules = []
  let ids = []
  for (const element of assignment.right.elements) {
    if (element?.type === "Literal" && typeof element.value === "number") {
      ids.push(element.value)
      continue
    }
    const isFactory = element?.type === "ArrowFunctionExpression" || element?.type === "FunctionExpression"
    const isShared =
      element?.type === "MemberExpression" && element.object.name === SHARED_NAME && element.property.type === "Literal"
    if (!isFactory && !isShared) return null
    modules.push({ ids, start: element.start, end: element.end, node: element, shared: isShared ? element.property.value : null })
    ids = []
  }
  return modules
}

/** The factories in a folder's shared-modules.js, as `{ start, end }` ranges. */
export function sharedModules(dir) {
  const file = path.join(dir, SHARED_FILE)
  if (!existsSync(file)) return null
  const source = readFileSync(file, "utf8")
  const array = parseScript(source)?.body.at(-1)?.expression?.right
  return { bytes: source.length, factories: (array?.elements ?? []).map(({ start, end }) => ({ start, end })) }
}

export function readModuleNames() {
  return existsSync(MODULE_NAMES_FILE) ? JSON.parse(readFileSync(MODULE_NAMES_FILE, "utf8")) : {}
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

/**
 * A function naming the source file behind a byte range of a chunk, from the
 * chunk's .map file. Returns null for every range when there is no map.
 */
export function sourceNamer(chunkPath, source) {
  const mapPath = `${chunkPath}.map`
  if (!existsSync(mapPath)) return () => null
  let map
  try {
    map = JSON.parse(readFileSync(mapPath, "utf8"))
  } catch {
    return () => null
  }
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const pairs = decodeMappings(map.mappings, lineStarts)

  return (start, end) => {
    let lo = 0
    let hi = pairs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[mid][0] < start) lo = mid + 1
      else hi = mid
    }
    const counts = new Map()
    for (let i = lo; i < pairs.length && pairs[i][0] < end; i++) {
      counts.set(pairs[i][1], (counts.get(pairs[i][1]) ?? 0) + 1)
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
}

/**
 * Module code in a chunks folder: per module id, how many copies and their
 * sizes. A factory in shared-modules.js counts once, however many chunks use it.
 */
export function measureChunks(dir) {
  const modules = new Map()
  let unreadBytes = 0
  const add = (id, size) => {
    const entry = modules.get(id) ?? { id, copies: 0, size: 0, total: 0 }
    entry.copies++
    entry.size = Math.max(entry.size, size)
    entry.total += size
    modules.set(id, entry)
  }
  const shared = sharedModules(dir)
  const sharedIds = new Map()
  for (const file of chunkFiles(dir)) {
    const source = readFileSync(file, "utf8")
    const list = chunkModules(source)
    if (!list) {
      unreadBytes += source.length
      continue
    }
    for (const { ids, start, end, shared: index } of list) {
      const id = ids[0]
      if (index === null) add(id, end - start)
      else if (!sharedIds.has(index)) sharedIds.set(index, id)
    }
  }
  for (const [index, id] of sharedIds) {
    const factory = shared?.factories[index]
    if (factory) add(id, factory.end - factory.start)
  }
  return { modules: [...modules.values()], unreadBytes, sharedBytes: shared?.bytes ?? 0, sharedCount: shared?.factories.length ?? 0 }
}
