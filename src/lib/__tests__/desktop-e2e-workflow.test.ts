import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordProperty(
  value: unknown,
  property: string,
): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[property])) {
    throw new Error(`Expected workflow object at ${property}`)
  }
  return value[property]
}

function stepsFor(job: Record<string, unknown>): readonly unknown[] {
  if (!Array.isArray(job.steps)) throw new Error("Expected workflow job steps")
  return job.steps
}

function actionStep(
  job: Record<string, unknown>,
  action: string,
): Record<string, unknown> {
  const step = stepsFor(job).find(
    (candidate) => isRecord(candidate) && candidate.uses === action,
  )
  if (!isRecord(step)) throw new Error(`Unable to locate workflow action ${action}`)
  return step
}

function namedStep(
  job: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const step = stepsFor(job).find(
    (candidate) => isRecord(candidate) && candidate.name === name,
  )
  if (!isRecord(step)) throw new Error(`Unable to locate workflow step ${name}`)
  return step
}

function workflow(): Record<string, unknown> {
  const source = readFileSync(
    join(process.cwd(), ".github/workflows/test.yml"),
    "utf8",
  )
  const parsed: unknown = parse(source)
  if (!isRecord(parsed)) throw new Error("Expected parsed workflow object")
  return parsed
}

describe("desktop E2E workflow fixtures", () => {
  it("prepares the local schema before every desktop E2E job", () => {
    const jobs = recordProperty(workflow(), "jobs")

    for (const jobName of ["e2e-desktop-pr", "e2e-desktop"]) {
      const job = recordProperty(jobs, jobName)
      const environment = recordProperty(job, "env")
      const prepareStep = namedStep(job, "Prepare deterministic E2E database")

      expect(environment.LOCAL_DB_PATH).toBe(".e2e/compass.db")
      expect(environment.COMPASS_E2E).toBe("true")
      expect(prepareStep.run).toBe("bun run test:e2e:prepare")
    }

    const pullRequestJob = recordProperty(jobs, "e2e-desktop-pr")
    expect(namedStep(pullRequestJob, "Install Playwright ffmpeg").run).toBe(
      "bunx playwright install ffmpeg",
    )
  })

  it("runs the full desktop matrix on pull requests and uploads rendered evidence", () => {
    const parsed = workflow()
    const triggers = recordProperty(parsed, "on")
    const jobs = recordProperty(parsed, "jobs")
    const fullMatrixJob = recordProperty(jobs, "e2e-desktop")
    const strategy = recordProperty(fullMatrixJob, "strategy")
    const matrix = recordProperty(strategy, "matrix")
    const artifactStep = actionStep(
      fullMatrixJob,
      "actions/upload-artifact@v4",
    )
    const artifactInputs = recordProperty(artifactStep, "with")

    expect(triggers).toHaveProperty("pull_request")
    expect(fullMatrixJob.if).toBe(
      "github.event_name == 'pull_request' || github.ref == 'refs/heads/main'",
    )
    expect(matrix.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ])
    expect(artifactStep.if).toBe("always()")
    expect(artifactInputs.name).toBe(
      "playwright-report-desktop-${{ matrix.os }}",
    )
    expect(artifactInputs.path).toBe("playwright-report/\ntest-results/\n")
    expect(artifactInputs["if-no-files-found"]).toBe("error")
  })
})