// Uploads recorded Help videos to the private help-video R2 bucket.
// Usage: node scripts/help-videos/upload.mjs [clip-id ...]
// Requires a Cloudflare login with access to the bucket (`wrangler login`).
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const BUCKET = process.env.HELP_VIDEOS_BUCKET ?? "compass-help-videos"
const outDir = ".help-videos/output"
const requested = process.argv.slice(2)
const files = requested.length > 0
  ? requested.map((id) => `${id}.mp4`)
  : readdirSync(outDir).filter((name) => name.endsWith(".mp4"))

for (const file of files) {
  const path = join(outDir, file)
  if (!existsSync(path)) throw new Error(`Missing ${path}. Record it first.`)
  console.log(`Uploading ${file} to ${BUCKET}...`)
  execFileSync("bunx", [
    "wrangler", "r2", "object", "put", `${BUCKET}/${file}`,
    "--file", path, "--content-type", "video/mp4", "--remote",
  ], { stdio: "inherit" })
}
