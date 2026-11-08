import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { tokenizer, tokTypes } from "acorn"

// V8 keeps a script's source in memory, and one character above U+00FF makes it
// store the whole source two bytes per character. The server bundle is ~58 MB,
// so a few dashes and quotes in regular expressions (which esbuild copies
// verbatim) cost ~55 MB of the Worker's 128 MB. Rewrite them as \u escapes,
// which mean the same thing in strings and regular expressions.

const WORKER_BUNDLE_FILES = [
  ".open-next/server-functions/default/handler.mjs",
  ".open-next/middleware/handler.mjs",
  ".open-next/worker.js",
]

const NON_ASCII = /[^\x00-\x7f]/
const NON_ASCII_ALL = /[^\x00-\x7f]/g
// A character already escaped (`\—`) means the character itself, so its
// backslash is dropped rather than doubled into a literal backslash.
const ESCAPABLE = /(\\*)([^\x00-\x7f])/g

function escapeNonAscii(text) {
  return text.replace(ESCAPABLE, (_match, slashes, char) =>
    `${slashes.length % 2 === 1 ? slashes.slice(1) : slashes}\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
}

export function asciiEscapeJavaScript(source, label = "bundle") {
  if (!NON_ASCII.test(source)) return { source, escaped: 0 }
  const ranges = []
  const comments = []
  for (const token of tokenizer(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
    onComment: (_block, _text, start, end) => comments.push([start, end]),
  })) {
    const raw = source.slice(token.start, token.end)
    if (NON_ASCII.test(raw)) {
      // Templates are refused: an escape changes a String.raw-tagged value.
      const escapable = token.type === tokTypes.string || token.type === tokTypes.regexp
      if (!escapable) {
        const line = source.slice(0, token.start).split("\n").length
        throw new Error(`${label}:${line}: non-ASCII text in a ${token.type.label} token cannot be escaped safely`)
      }
      ranges.push([token.start, token.end])
    }
  }
  ranges.push(...comments.filter(([start, end]) => NON_ASCII.test(source.slice(start, end))))
  ranges.sort((a, b) => a[0] - b[0])

  let escaped = 0
  let cursor = 0
  const parts = []
  for (const [start, end] of ranges) {
    const text = source.slice(start, end)
    escaped += text.match(NON_ASCII_ALL)?.length ?? 0
    parts.push(source.slice(cursor, start), escapeNonAscii(text))
    cursor = end
  }
  parts.push(source.slice(cursor))
  const result = parts.join("")
  if (NON_ASCII.test(result)) throw new Error(`${label}: non-ASCII text remains after escaping`)
  return { source: result, escaped }
}

async function main() {
  for (const file of WORKER_BUNDLE_FILES) {
    const source = await readFile(file, "utf8")
    const { source: next, escaped } = asciiEscapeJavaScript(source, file)
    if (escaped > 0) await writeFile(file, next)
    console.log(`ascii-worker-bundle: ${file} ${escaped} character(s) escaped`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main()
}
