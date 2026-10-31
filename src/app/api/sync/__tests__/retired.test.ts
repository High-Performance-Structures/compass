import { describe, expect, it } from "vitest"

import * as checkpoint from "@/app/api/sync/checkpoint/route"
import * as delta from "@/app/api/sync/delta/route"
import * as mutate from "@/app/api/sync/mutate/route"

describe("retired sync API", () => {
  it("answers every former sync endpoint with 410 Gone and touches no data", async () => {
    for (const handler of [checkpoint.GET, checkpoint.POST, delta.GET, mutate.POST]) {
      const response = handler()
      expect(response.status).toBe(410)
      expect(await response.json()).toEqual({ error: "The sync API has been retired." })
    }
  })
})
