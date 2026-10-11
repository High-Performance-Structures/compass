// Records Help tutorial videos against the local Compass Developer workspace.
// Usage: node scripts/help-videos/record.mjs [clip-id ...]
// Start Compass first (see docs/development/help-videos.md).
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { startRecording } from "./lib.mjs"

const clipsDir = resolve("scripts/help-videos/clips")
const outDir = resolve(".help-videos/output")
mkdirSync(outDir, { recursive: true })

const dbEnv = { ...process.env, LOCAL_DB_PATH: process.env.LOCAL_DB_PATH ?? ".help-videos/compass.db" }
// Apply any migrations added since the recording database was created.
execFileSync("node", ["scripts/init-local-db.mjs"], { env: dbEnv, stdio: "ignore" })

const requested = new Set(process.argv.slice(2))
const files = readdirSync(clipsDir).filter((name) => name.endsWith(".mjs")).sort()

for (const file of files) {
  const clipModule = await import(pathToFileURL(join(clipsDir, file)).href)
  if (requested.size > 0 && !requested.has(clipModule.clip.id)) continue
  console.log(`Recording ${clipModule.clip.id}...`)
  // Each clip starts from the same seeded state so re-recordings match.
  execFileSync("node", ["scripts/help-videos/seed.mjs"], { env: dbEnv, stdio: "ignore" })
  const session = await startRecording(join(".help-videos/raw", clipModule.clip.id), {
    captionAt: clipModule.clip.captionAt,
  })
  try {
    await clipModule.record(session)
    const output = await session.finish(join(outDir, `${clipModule.clip.id}.mp4`))
    console.log(`  wrote ${output}`)
  } catch (error) {
    await session.page.screenshot({ path: join(outDir, `${clipModule.clip.id}-failure.png`) }).catch(() => {})
    throw error
  }
}
