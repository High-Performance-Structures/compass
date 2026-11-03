#!/usr/bin/env bun
// Builds the Compass Developer Manual.
//
//   bun scripts/manual/build.mjs              generate, render, check, docx, pdf
//   bun scripts/manual/build.mjs --no-render  reuse already-rendered diagrams
//   bun scripts/manual/build.mjs --check      generate + neutrality check only
//   bun scripts/manual/build.mjs --diagrams-only  stop after rendering (prints fit report)
//
// Steps:
//   1. Regenerate the code-derived appendices and ER diagrams
//      (scripts/manual/generate-appendices.ts).
//   2. Fail if any chapter, appendix or diagram names one company
//      (scripts/manual/neutral.mjs).
//   3. Render docs/manual/diagrams/*.mmd to PNG locally with mermaid-cli
//      (headless Chromium through puppeteer; nothing is sent to a web service).
//   4. Assemble build/manual/Compass Developer Manual.docx (python-docx).
//   5. Convert it to PDF with LibreOffice, if installed.
//
// Requirements: bun, node/npx, python3 with python-docx
// (`pip install --user python-docx`), and LibreOffice for the PDF.
// Outputs land in build/manual/ (git-ignored).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { findNeutralityHits } from "./neutral.mjs"

const ROOT = process.cwd()
const SOURCE = join(ROOT, "docs/manual")
const DIAGRAMS = join(SOURCE, "diagrams")
const OUT = join(ROOT, "build/manual")
const RENDERED = join(OUT, "diagrams")
const MERMAID_CLI = "@mermaid-js/mermaid-cli@11.4.2"
const SOFFICE_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
]

const args = new Set(process.argv.slice(2))

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd: ROOT, ...options })
  if (result.status !== 0) {
    console.error(`\n${command} ${commandArgs.join(" ")} failed (${result.status ?? result.signal})`)
    process.exit(result.status ?? 1)
  }
}

function neutralityCheck() {
  const files = [
    ...readdirSync(SOURCE).filter((name) => name.endsWith(".md")).map((name) => join(SOURCE, name)),
    ...readdirSync(DIAGRAMS).filter((name) => name.endsWith(".mmd")).map((name) => join(DIAGRAMS, name)),
  ]
  const hits = files.flatMap((file) => findNeutralityHits(readFileSync(file, "utf8"), file.replace(`${ROOT}/`, "")))
  if (hits.length > 0) {
    for (const hit of hits) console.error(`${hit.file}:${hit.line}: "${hit.term}" in: ${hit.text}`)
    console.error(`\nNeutrality check failed: ${hits.length} hit(s). The manual must not name one company.`)
    process.exit(1)
  }
  console.log(`neutrality check: 0 hits across ${files.length} files`)
}

// Page area a diagram may fill (inches) and the CSS pixels per inch it was
// drawn at. Rendered at scale 2, so a PNG pixel is half a CSS pixel.
const PAGE_WIDTH_IN = 6.5
const PAGE_HEIGHT_IN = 8.6
const MIN_LEGIBLE_SCALE = 0.55

function pngSize(path) {
  const header = readFileSync(path).subarray(16, 24)
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) }
}

/** How much the diagram must shrink to fit the page (1 = natural size). */
function fitScale(path) {
  const { width, height } = pngSize(path)
  const cssWidth = width / 2
  const cssHeight = height / 2
  return Math.min(1, (PAGE_WIDTH_IN * 96) / cssWidth, (PAGE_HEIGHT_IN * 96) / cssHeight)
}

function renderOne(input, output, config) {
  run("npx", ["-y", MERMAID_CLI, "-i", input, "-o", output, "-c", config, "-s", "2", "-b", "white", "-q"])
}

function renderDiagrams() {
  mkdirSync(RENDERED, { recursive: true })
  const config = join(ROOT, "scripts/manual/mermaid-config.json")
  const sources = readdirSync(DIAGRAMS).filter((name) => name.endsWith(".mmd")).sort()
  for (const name of sources) {
    const input = join(DIAGRAMS, name)
    const output = join(RENDERED, name.replace(/\.mmd$/, ".png"))
    if (existsSync(output) && statSync(output).mtimeMs > statSync(input).mtimeMs) continue
    console.log(`render ${name}`)
    renderOne(input, output, config)
    // ER diagrams of loosely related tables can come out as one tall column
    // (or one wide row). Try the other direction and keep the more legible one.
    if (name.startsWith("er-") && fitScale(output) < 0.75) {
      const flipped = join(RENDERED, `.flipped-${name}`)
      const alternate = join(RENDERED, `.flipped-${name.replace(/\.mmd$/, ".png")}`)
      writeFileSync(flipped, readFileSync(input, "utf8").replace("direction LR", "direction TB"))
      renderOne(flipped, alternate, config)
      if (fitScale(alternate) > fitScale(output)) renameSync(alternate, output)
      rmSync(flipped, { force: true })
      rmSync(alternate, { force: true })
    }
  }
  const report = sources.map((name) => {
    const scale = fitScale(join(RENDERED, name.replace(/\.mmd$/, ".png")))
    return { name, scale }
  })
  for (const { name, scale } of report) {
    const flag = scale < MIN_LEGIBLE_SCALE ? "  <-- too small when fitted; simplify or split" : ""
    console.log(`fit ${name}: ${(scale * 100).toFixed(0)}%${flag}`)
  }
}

run("bun", ["scripts/manual/generate-appendices.ts"])
neutralityCheck()
if (args.has("--check")) process.exit(0)
if (!args.has("--no-render")) renderDiagrams()
if (args.has("--diagrams-only")) process.exit(0)
// With LibreOffice, build_docx.py converts twice: once to read each heading's
// page for the contents list, then the final PDF.
const soffice = process.env.SOFFICE ?? SOFFICE_CANDIDATES.find((candidate) => existsSync(candidate))
if (!soffice) console.warn("LibreOffice not found: the contents list has no page numbers and no PDF is made.")
run("python3", [
  "scripts/manual/build_docx.py",
  "--source", SOURCE,
  "--diagrams", RENDERED,
  "--out", OUT,
  ...(soffice ? ["--soffice", soffice] : []),
])
console.log(`\nDone: ${OUT}`)
