import { expect, test } from "@playwright/test"

// The production drift detector's report (src/lib/domain/data-health). The
// daily regression run sets PLAYWRIGHT_DATA_HEALTH_SECRET (the Worker's
// DATA_HEALTH_REPORT_SECRET); without it, as in PR CI, this is skipped.
const secret = process.env.PLAYWRIGHT_DATA_HEALTH_SECRET

test.describe("production data health", () => {
  test("has no status or schema drift", async ({ request }, testInfo) => {
    test.skip(!secret, "PLAYWRIGHT_DATA_HEALTH_SECRET is not set")
    // The report is the same for every browser; check it once per run.
    test.skip(testInfo.project.name !== "chromium", "Checked once, in the chromium project")

    const response = await request.get("/api/operations/data-health/report", {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(response.status(), await response.text()).toBe(200)
    const report: unknown = await response.json()
    // Print the whole report so the failure says exactly what drifted.
    expect(report, JSON.stringify(report, null, 2)).toMatchObject({ ok: true })
  })
})
