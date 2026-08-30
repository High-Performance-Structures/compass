import { describe, expect, it } from "vitest"

import {
  ownerUpdateDraftStorageKey,
  parseOwnerUpdateDraftEdit,
  parseRecoverableOwnerUpdateDraft,
  serializeOwnerUpdateDraftBackup,
  type OwnerUpdateDraftEdit,
} from "@/lib/owner-updates/draft-recovery"

const draft: OwnerUpdateDraftEdit = {
  title: "Weekly update",
  updateDate: "2026-07-28",
  periodStart: "2026-07-20",
  periodEnd: "2026-07-28",
  summary: "Drywall is moving forward.",
  sourceDailyLogIds: ["log-1"],
  selectedPhotoIds: ["photo-1"],
  selectedDocumentIds: [],
  completedScheduleItems: [],
  lookAheadScheduleItems: [],
  todos: [],
}

describe("owner update draft recovery", () => {
  it("normalizes a legacy save payload with missing newer draft fields", () => {
    expect(
      parseOwnerUpdateDraftEdit({
        title: "Weekly update",
        updateDate: "2026-07-28",
        summary: "Drywall is moving forward.",
        sourceDailyLogIds: ["log-1"],
        selectedPhotoIds: ["photo-1"],
      })
    ).toEqual({
      success: true,
      data: {
        ...draft,
        periodStart: "2026-07-28",
        periodEnd: "2026-07-28",
        selectedDocumentIds: [],
        completedScheduleItems: [],
        lookAheadScheduleItems: [],
        todos: [],
      },
    })
  })

  it("uses a project- and update-specific browser key", () => {
    expect(ownerUpdateDraftStorageKey("user-1", "project-1", "update-1")).toBe(
      "compass:owner-update-draft:user-1:project-1:update-1"
    )
  })

  it("recovers a browser draft saved after the server version", () => {
    const serialized = serializeOwnerUpdateDraftBackup({
      draft,
      serverUpdatedAt: "2026-07-28T14:20:14.659Z",
      savedAt: "2026-07-28T14:30:00.000Z",
    })

    expect(
      parseRecoverableOwnerUpdateDraft(
        serialized,
        "2026-07-28T14:20:14.659Z"
      )?.draft
    ).toEqual(draft)
  })

  it("does not restore a backup based on a different server version", () => {
    const serialized = serializeOwnerUpdateDraftBackup({
      draft,
      serverUpdatedAt: "2026-07-28T14:19:00.000Z",
      savedAt: "2026-07-28T14:30:00.000Z",
    })

    expect(
      parseRecoverableOwnerUpdateDraft(
        serialized,
        "2026-07-28T14:20:14.659Z"
      )
    ).toBeNull()
  })

  it("ignores malformed browser data", () => {
    expect(
      parseRecoverableOwnerUpdateDraft(
        "{not-json",
        "2026-07-28T14:20:14.659Z"
      )
    ).toBeNull()
  })
})
