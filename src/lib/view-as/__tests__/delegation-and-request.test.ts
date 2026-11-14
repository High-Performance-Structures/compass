import { describe, expect, it } from "vitest"

import { isViewedPersonSubject } from "@/lib/view-as/delegation"
import { isOutsideRequestError, isViewAsRequest } from "@/lib/view-as/request"

describe("Google delegation during View as", () => {
  const viewed = { email: "Pat@Builder.com", googleEmail: "pat.g@builder.com" }

  it("refuses the viewed person's own Google identities", () => {
    expect(isViewedPersonSubject("pat@builder.com", viewed)).toBe(true)
    expect(isViewedPersonSubject(" PAT.G@builder.com ", viewed)).toBe(true)
  })

  it("leaves Compass-owned identities alone", () => {
    expect(isViewedPersonSubject("jarvis@builder.com", viewed)).toBe(false)
    expect(isViewedPersonSubject("drive-bot@builder.com", { email: "x@y.com", googleEmail: null })).toBe(false)
  })
})

describe("isViewAsRequest outside a request", () => {
  it("treats only Next's 'outside a request scope' error as not viewing", () => {
    const outside = Object.assign(new Error("`cookies` was called outside a request scope."), { __NEXT_ERROR_CODE: "E251" })
    expect(isOutsideRequestError(outside)).toBe(true)
    expect(isOutsideRequestError(new Error("Route used cookies() inside \"use cache\""))).toBe(false)
    expect(isOutsideRequestError("nope")).toBe(false)
  })

  it("is false for background work with no request (cron)", async () => {
    expect(await isViewAsRequest()).toBe(false)
  })
})
