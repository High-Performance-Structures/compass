import { describe, expect, it } from "vitest"

import {
  FIELD_NOTIFICATION_REFRESH_DELAYS_MS,
  fieldPacketRefreshUrl,
  shouldLockFieldAppAfterBackground,
} from "./field-refresh"

describe("field packet refresh", () => {
  it("uses immediate and delayed refreshes for native push delivery", () => {
    expect(FIELD_NOTIFICATION_REFRESH_DELAYS_MS).toEqual([0, 1_000, 3_000])
  })

  it("cache-busts and safely encodes every packet request", () => {
    expect(
      fieldPacketRefreshUrl(
        "https://compass.example",
        "project/with spaces",
        1724160000123
      )
    ).toBe(
      "https://compass.example/api/field/projects/project%2Fwith%20spaces?refresh=1724160000123"
    )
  })


  it("does not skip activation refreshes when biometric locking is off", () => {
    expect(
      shouldLockFieldAppAfterBackground(false, 60_000, 30_000)
    ).toBe(false)
    expect(
      shouldLockFieldAppAfterBackground(true, 60_000, 30_000)
    ).toBe(true)
  })
})
