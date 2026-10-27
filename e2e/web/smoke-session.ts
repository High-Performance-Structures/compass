import { expect, type Page } from "@playwright/test"

export const applicationErrorText =
  /Application error|Internal Server Error|This page could not be found/i

const smokeEmail = process.env.PLAYWRIGHT_SMOKE_EMAIL
const smokePassword = process.env.PLAYWRIGHT_SMOKE_PASSWORD

// Production refuses the anonymous /demo session (see src/app/demo/route.ts),
// so remote smoke runs sign in with a dedicated read-only account instead.
// The demo fixtures (project e2e-project-001, seeded conversations and
// calendar items) only exist in the anonymous demo workspace, so tests that
// walk them skip under the smoke login; PR CI covers them locally.
export const usingSmokeLogin = Boolean(smokeEmail && smokePassword)

// The signed-in cookies are reused across tests to avoid a login per test.
let smokeSessionCookies: Awaited<
  ReturnType<ReturnType<Page["context"]>["cookies"]>
> | null = null

async function signInWithSmokeAccount(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  if (smokeSessionCookies) {
    await page.context().addCookies(smokeSessionCookies)
    await page.goto("/dashboard")
    if (page.url().includes("/dashboard")) return
    // The cached session expired mid-run; fall through to a fresh login.
    smokeSessionCookies = null
  }
  await page.goto("/login")
  // The password tab panel and the "Show password" toggle also carry a
  // "Password" accessible name, so scope the labels to the actual inputs.
  await page.getByLabel("Email", { exact: true }).and(page.locator("input")).fill(email)
  await page.getByLabel("Password", { exact: true }).and(page.locator("input")).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL(/\/dashboard/)
  smokeSessionCookies = await page.context().cookies()
}

export async function enterDemo(page: Page): Promise<void> {
  if (smokeEmail && smokePassword) {
    await signInWithSmokeAccount(page, smokeEmail, smokePassword)
  } else {
    await page.goto("/demo")
    await page.waitForURL(/\/dashboard/)
  }
  await expect(page.locator("body")).not.toContainText(applicationErrorText)
}
