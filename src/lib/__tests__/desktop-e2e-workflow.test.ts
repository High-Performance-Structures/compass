import { readFileSync } from "node:fs"
import { join } from "node:path"

function desktopJob(workflow: string, jobName: string, nextMarker: string): string {
  const jobStart = workflow.indexOf(`  ${jobName}:`)
  const jobEnd = workflow.indexOf(nextMarker, jobStart)

  if (jobStart < 0 || jobEnd < 0) {
    throw new Error(`Unable to locate workflow job ${jobName}`)
  }

  return workflow.slice(jobStart, jobEnd)
}

describe("desktop E2E workflow fixtures", () => {
  it("prepares the local schema before every desktop E2E job", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/test.yml"),
      "utf8",
    )
    const jobs = [
      desktopJob(workflow, "e2e-desktop-pr", "  # Desktop E2E tests"),
      desktopJob(workflow, "e2e-desktop", "  # Coverage report"),
    ]

    for (const job of jobs) {
      expect(job).toContain("Prepare deterministic E2E database")
      expect(job).toContain("run: bun run test:e2e:prepare")
      expect(job).toContain("LOCAL_DB_PATH: .e2e/compass.db")
    }
  })
})