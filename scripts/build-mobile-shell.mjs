import { copyFile, mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const source = resolve(root, "mobile-shell-src")
const output = resolve(root, "mobile-shell")

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await Promise.all([
  copyFile(resolve(source, "index.html"), resolve(output, "index.html")),
  copyFile(resolve(source, "styles.css"), resolve(output, "styles.css")),
  copyFile(
    resolve(root, "public", "logo-black.png"),
    resolve(output, "compass-watermark.png")
  ),
])

const result = await Bun.build({
  entrypoints: [resolve(source, "app.ts")],
  outdir: output,
  naming: "app.js",
  target: "browser",
  minify: true,
  sourcemap: "none",
})

if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exitCode = 1
}
