import { describe, expect, it } from "vitest"

import {
  changeOrderStatusGroup,
  parseChangeOrderListFilter,
} from "@/lib/change-orders/record-list"

describe("change order sheet filters", () => {
  it("groups the fixed change-order steps for the filter buttons", () => {
    expect(changeOrderStatusGroup("draft")).toBe("in_progress")
    expect(changeOrderStatusGroup("internal_review")).toBe("in_progress")
    expect(changeOrderStatusGroup("signature_pending")).toBe("with_owner")
    expect(changeOrderStatusGroup("sage_pending")).toBe("executed")
    expect(changeOrderStatusGroup("synced")).toBe("executed")
    expect(changeOrderStatusGroup("closed")).toBe("closed")
    expect(changeOrderStatusGroup("declined")).toBe("ended")
  })

  it("opens on Open unless a known filter is chosen", () => {
    expect(parseChangeOrderListFilter("with_owner")).toBe("with_owner")
    expect(parseChangeOrderListFilter("bogus")).toBe("open")
    expect(parseChangeOrderListFilter(null)).toBe("open")
  })
})
