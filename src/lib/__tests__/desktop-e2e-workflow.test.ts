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

function expectInOrder(source: string, fragments: readonly string[]): void {
  let cursor = 0

  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor)
    expect(index, `Missing workflow fragment: ${fragment}`).toBeGreaterThanOrEqual(cursor)
    cursor = index + fragment.length
  }
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
      expectInOrder(job, [
        "    env:\n      LOCAL_DB_PATH: .e2e/compass.db\n      COMPASS_E2E: \"true\"",
        "      - name: Prepare deterministic E2E database\n        run: bun run test:e2e:prepare",
        "      - name: Run desktop E2E",
      ])
    }
  })

  it("runs the full desktop matrix for pull requests and preserves rendered artifacts", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/test.yml"),
      "utf8",
    )
    const job = desktopJob(workflow, "e2e-desktop", "  # Coverage report")

    expectInOrder(job, [
      "if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'",
      "        os: [ubuntu-latest, macos-latest, windows-latest]",
      "name: playwright-report-desktop-${{ matrix.os }}",
      "path: |\n            playwright-report/\n            test-results/",
    ])
  })
})