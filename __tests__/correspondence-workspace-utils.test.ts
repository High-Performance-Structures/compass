import { describe, expect, it } from "vitest"

import { applyMessageRevision, composerTransitionBlock, detailForConversation, mergeMessages } from "@/components/correspondence/correspondence-workspace-utils"
import type { CorrespondenceDetail, CorrespondenceMessage } from "@/lib/correspondence/types"

function message(id: string, sequence: number, body: string): CorrespondenceMessage {
  return {
    id,
    sequence,
    source: "compass",
    authorName: "Casey Lee",
    authorUserId: "casey",
    sentAt: `2026-09-05T05:3${sequence}:00.000Z`,
    body,
    recipients: [],
    attachments: [],
    editedAt: null,
    retractedAt: null,
    delivery: "saved",
    canEdit: false,
    readReceipts: [],
  }
}

describe("mergeMessages", () => {
  it("keeps the fresh detail copy of an edited or retracted message", () => {
    const stale = message("message-a", 1, "Original text")
    const fresh: CorrespondenceMessage = { ...stale, body: "", editedAt: "2026-09-05T06:00:00.000Z", retractedAt: "2026-09-05T06:01:00.000Z" }

    expect(mergeMessages([stale], [fresh])).toEqual([fresh])
  })

  it("keeps existing newer history while adding an older page chronologically", () => {
    const older = message("message-a", 1, "Historical message")
    const newer = message("message-b", 2, "Recent message")

    expect(mergeMessages([older], [newer])).toEqual([older, newer])
  })
})

describe("applyMessageRevision", () => {
  it("patches an older loaded message after an edit or retraction", () => {
    const older = message("older", 1, "Original")
    const newest = message("newest", 56, "Newest")
    const edited = applyMessageRevision([older, newest], "older", "Edited", "2026-09-05T06:00:00.000Z")
    const retracted = applyMessageRevision(edited, "older", null, "2026-09-05T06:01:00.000Z")

    expect(edited[0]).toMatchObject({ body: "Edited", editedAt: "2026-09-05T06:00:00.000Z", retractedAt: null })
    expect(retracted[0]).toMatchObject({ body: "Edited", retractedAt: "2026-09-05T06:01:00.000Z" })
    expect(retracted[1]).toEqual(newest)
  })
})

describe("correspondence composer lifecycle guards", () => {
  it("never exposes detail from a conversation other than the active one", () => {
    const detail: CorrespondenceDetail = {
      conversation: summary("conversation-a", false),
      participantVersion: 1,
      messages: [],
      hasEarlier: false,
      draft: null,
    }

    expect(detailForConversation(detail, "conversation-a")).toBe(detail)
    expect(detailForConversation(detail, "conversation-b")).toBeNull()
    expect(detailForConversation(detail, null)).toBeNull()
  })

  it("blocks replacement while an operation, edit, or attachment session owns the composer", () => {
    expect(composerTransitionBlock({ busy: true, editing: true, attachmentCount: 1 })).toBe("busy")
    expect(composerTransitionBlock({ busy: false, editing: true, attachmentCount: 1 })).toBe("editing")
    expect(composerTransitionBlock({ busy: false, editing: false, attachmentCount: 1 })).toBe("attachments")
    expect(composerTransitionBlock({ busy: false, editing: false, attachmentCount: 0 })).toBeNull()
  })
})

function summary(id: string, archived: boolean, overrides: Partial<Pick<import("@/lib/correspondence/types").CorrespondenceSummary, "unread" | "saved" | "followUp">> = {}) {
  return {
    id,
    projectId: "project-a",
    subject: id,
    excerpt: id,
    lastActivityAt: "2026-09-05T00:00:00.000Z",
    people: [],
    unread: overrides.unread ?? false,
    saved: overrides.saved ?? false,
    followUp: overrides.followUp ?? false,
    archived,
    closed: false,
    shareReadReceipts: true,
  }
}

describe("archive inbox filters", () => {
  it("hides archived conversations from active views and exposes them for restore", async () => {
    const { filterConversations } = await import("@/components/correspondence/correspondence-workspace-utils")
    const active = summary("active", false, { unread: true, saved: true, followUp: true })
    const archived = summary("archived", true, { unread: true, saved: true, followUp: true })

    expect(filterConversations([active, archived], "inbox", "")).toEqual([active])
    expect(filterConversations([active, archived], "unread", "")).toEqual([active])
    expect(filterConversations([active, archived], "follow-up", "")).toEqual([active])
    expect(filterConversations([active, archived], "saved", "")).toEqual([active])
    expect(filterConversations([active, archived], "archived", "")).toEqual([archived])
  })
})
