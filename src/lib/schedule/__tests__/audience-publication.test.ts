import { describe, expect, it } from "vitest"

import { selectAudienceScheduleSourceRows } from "@/lib/schedule/audience-publication"

describe("external schedule publication boundary", () => {
  it("uses the immutable publication when one exists", () => {
    expect(
      selectAudienceScheduleSourceRows({
        publishedRows: ["published"],
        draftRows: ["draft"],
        viewerIsInternal: false,
      }),
    ).toEqual(["published"])
  })

  it("keeps an unpublished draft out of an external workspace", () => {
    expect(
      selectAudienceScheduleSourceRows({
        publishedRows: null,
        draftRows: ["draft"],
        viewerIsInternal: false,
      }),
    ).toEqual([])
  })

  it("allows staff to preview an unpublished draft", () => {
    expect(
      selectAudienceScheduleSourceRows({
        publishedRows: null,
        draftRows: ["draft"],
        viewerIsInternal: true,
      }),
    ).toEqual(["draft"])
  })
})
