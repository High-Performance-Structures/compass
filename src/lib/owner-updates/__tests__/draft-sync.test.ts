import { describe, expect, it } from "vitest"

import {
  synchronizeOwnerUpdateDraft,
  type OwnerUpdateDraftSyncVersion,
} from "@/lib/owner-updates/draft-sync"
import type { OwnerUpdateDraftEdit } from "@/lib/owner-updates/draft-recovery"

const baseline: OwnerUpdateDraftEdit = {
  title: "Weekly update",
  updateDate: "2026-07-28",
  periodStart: "2026-07-28",
  periodEnd: "2026-07-28",
  summary: "Original summary",
  sourceDailyLogIds: [],
  selectedPhotoIds: [],
  selectedDocumentIds: [],
  completedScheduleItems: [],
  lookAheadScheduleItems: [],
  todos: [],
}

const oldVersion: OwnerUpdateDraftSyncVersion = {
  revision: 0,
  updatedAt: "2026-07-28T14:20:14.659Z",
}

const refreshedVersion: OwnerUpdateDraftSyncVersion = {
  revision: 1,
  updatedAt: "2026-07-28T14:30:00.000Z",
}

describe("owner update draft refresh synchronization", () => {
  it("discards stale local edits when a concurrent refresh changes the server draft", () => {
    const result = synchronizeOwnerUpdateDraft({
      baselineDraft: baseline,
      localDraft: { ...baseline, title: "My unsaved title" },
      serverDraft: { ...baseline, title: "Another editor's title" },
      previousServerVersion: oldVersion,
      serverVersion: refreshedVersion,
    })

    expect(result).toEqual({
      kind: "conflict",
      draft: { ...baseline, title: "Another editor's title" },
      message:
        "This draft changed elsewhere. Your unsaved edits were discarded; review the latest version before saving.",
    })
  })

  it("synchronizes a refreshed server version when the local draft is unchanged", () => {
    const serverDraft = { ...baseline, summary: "Saved summary" }

    expect(
      synchronizeOwnerUpdateDraft({
        baselineDraft: baseline,
        localDraft: baseline,
        serverDraft,
        previousServerVersion: oldVersion,
        serverVersion: refreshedVersion,
      })
    ).toEqual({ kind: "synchronized", draft: serverDraft })
  })

  it("does not reset local edits when the server version is unchanged", () => {
    const localDraft = { ...baseline, title: "My unsaved title" }

    expect(
      synchronizeOwnerUpdateDraft({
        baselineDraft: baseline,
        localDraft,
        serverDraft: baseline,
        previousServerVersion: oldVersion,
        serverVersion: oldVersion,
      })
    ).toEqual({ kind: "unchanged" })
  })
})
