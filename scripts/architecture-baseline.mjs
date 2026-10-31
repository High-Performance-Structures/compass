// Prints or rewrites the architecture ratchet baseline.
//   bun scripts/architecture-baseline.mjs          # show the current metrics
//   bun scripts/architecture-baseline.mjs --write  # lock in an improvement
// A rewritten baseline must only remove entries or lower counts; review the diff.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { computeArchitectureMetrics } from "./architecture-metrics.mjs"

const root = process.cwd()
const metrics = computeArchitectureMetrics(root)
const output = `${JSON.stringify(metrics, null, 2)}\n`

if (process.argv.includes("--write")) {
  writeFileSync(join(root, "src/lib/__tests__/architecture-baseline.json"), output)
  console.log("Wrote src/lib/__tests__/architecture-baseline.json")
} else {
  process.stdout.write(output)
}
