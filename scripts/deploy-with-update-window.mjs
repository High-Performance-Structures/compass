// Puts a built Compass live without breaking tabs that are already open.
//
// `bun run deploy` builds, then runs this script. It:
//
// 1. Notes which Worker version is live now (the "previous" version).
// 2. Uploads the new build as a new version without sending it traffic
//    (`opennextjs-cloudflare upload`, i.e. `wrangler versions upload`).
// 3. Deploys new@100% and previous@0% in one step. Every new page load gets
//    the new version immediately. Tabs that were already open tag their
//    requests with their own version (src/lib/deployment/version-pin.ts), and
//    Cloudflare keeps sending those to the previous version, so Save keeps
//    working while their "Compass will update in 2 minutes" countdown runs
//    (src/lib/deployment/update-window.ts holds the 2-minute constant).
// 4. The previous version stays at 0% until the next deploy replaces it.
//
// Every production deploy must come through here (`bun run deploy`). A plain
// `wrangler deploy` / `opennextjs-cloudflare deploy` puts the new version at
// 100% alone, so open tabs' saves fail at once; the in-app countdown still
// appears and the unsaved-text safety net still keeps what people typed.
//
// One exception: Cloudflare refuses `versions upload` for a build that adds,
// renames or deletes a Durable Object class. Run `bun run deploy:direct` for
// that one deploy (open tabs will need to refresh straight away).
//
// Extra arguments (for example `--env demo`) are passed to Wrangler.

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const passthrough = process.argv.slice(2)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: false,
  })
  if (result.error) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout ?? "" }
}

function wrangler(args, options) {
  return run("npx", ["--no-install", "wrangler", ...args, ...passthrough], options)
}

// 1. The version serving most traffic right now.
function currentLiveVersion() {
  const status = wrangler(["deployments", "status", "--json"], { capture: true })
  if (status.status !== 0) return null
  try {
    const start = status.stdout.indexOf("{")
    const deployment = JSON.parse(status.stdout.slice(start))
    const versions = Array.isArray(deployment.versions) ? deployment.versions : []
    const live = [...versions].sort((a, b) => b.percentage - a.percentage)[0]
    return typeof live?.version_id === "string" ? live.version_id : null
  } catch {
    return null
  }
}

const previousVersion = currentLiveVersion()
console.log(`[deploy] live version before deploy: ${previousVersion ?? "none found"}`)

// 2. Upload without traffic. Wrangler reports the new version id in its
//    machine-readable output file.
const outputDir = mkdtempSync(path.join(tmpdir(), "compass-deploy-"))
const outputFile = path.join(outputDir, "wrangler-output.ndjson")
const upload = run(
  "npx",
  ["--no-install", "opennextjs-cloudflare", "upload", ...passthrough],
  { env: { WRANGLER_OUTPUT_FILE_PATH: outputFile } }
)
if (upload.status !== 0) {
  console.error(
    "[deploy] Upload failed. If this build changes a Durable Object class, " +
      "deploy it once with `bun run deploy:direct`."
  )
  process.exit(upload.status)
}

let newVersion = null
try {
  for (const line of readFileSync(outputFile, "utf8").split("\n")) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    if (entry.type === "version-upload" && typeof entry.version_id === "string") {
      newVersion = entry.version_id
    }
  }
} catch (error) {
  console.error("[deploy] Could not read Wrangler's output file:", error)
} finally {
  rmSync(outputDir, { recursive: true, force: true })
}
if (newVersion === null) {
  console.error("[deploy] Uploaded, but no version id was reported; nothing was put live.")
  process.exit(1)
}

// 3. New version live for everyone new; previous kept for open tabs.
const specs =
  previousVersion !== null && previousVersion !== newVersion
    ? [`${newVersion}@100%`, `${previousVersion}@0%`]
    : [`${newVersion}@100%`]
const deploy = wrangler([
  "versions",
  "deploy",
  ...specs,
  "--yes",
  "--message",
  "bun run deploy: previous version kept at 0% for open tabs",
])
if (deploy.status !== 0) {
  console.error(`[deploy] Version ${newVersion} was uploaded but could not be put live.`)
  process.exit(deploy.status)
}

console.log(`[deploy] live: ${newVersion} (100%)`)
if (specs.length === 2) {
  console.log(`[deploy] kept for open tabs: ${previousVersion} (0%)`)
}
