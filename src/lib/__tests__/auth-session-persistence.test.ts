import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const wranglerConfigPath = resolve(
  import.meta.dirname,
  "../../../wrangler.jsonc",
)

describe("authentication session persistence", () => {
  it("configures a persistent WorkOS cookie for browser restarts", () => {
    const wranglerConfig = readFileSync(wranglerConfigPath, "utf8")

    expect(wranglerConfig).toContain(
      '"WORKOS_COOKIE_MAX_AGE": "34560000"',
    )
  })
})
