import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MessageCard } from "@/components/correspondence/correspondence-message-card"
import { SearchResults } from "@/components/correspondence/correspondence-workspace-parts"
import type { CorrespondenceMessage } from "@/lib/correspondence/types"

function renderMessage(message: CorrespondenceMessage): string {
  return renderToStaticMarkup(React.createElement(MessageCard, {
    projectId: "project-a",
    message,
    viewerId: "owner-a",
    editDisabled: false,
    onEdit: async () => {},
    onRetract: () => {},
  }))
}

function message(overrides: Partial<CorrespondenceMessage> = {}): CorrespondenceMessage {
  return {
    id: "message",
    sequence: 1,
    source: "buildertrend",
    authorName: "Historic Sender",
    authorUserId: null,
    sentAt: "2026-08-01T08:00:00",
    sourceSentDisplay: "Aug 1, 2026 8:00 AM",
    sourceSentAt: null,
    sourceAttachmentReadiness: { expectedRecoverableFileCount: 4, linkedAttachmentCount: 0, pendingFileCount: 4 },
    body: "Historical body",
    recipients: [{ name: "Pending Original Recipient", kind: "to" }, { name: "Staff A", kind: "cc" }],
    attachments: [{ id: "retired", name: "old.jpg", size: 12, contentType: "image/jpeg", available: false }],
    editedAt: null,
    retractedAt: null,
    delivery: "imported",
    canEdit: false,
    readReceipts: [],
    ...overrides,
  }
}

describe("historical source audience renderers", () => {
  it("renders source-local message time, pending-file truth, and only source To/CC", () => {
    const markup = renderMessage(message())
    expect(markup).toContain("Source time: Aug 1, 2026 8:00 AM")
    expect(markup).toContain("4 original files are pending migration. Message text is available.")
    expect(markup).toContain("TO: Pending Original Recipient")
    expect(markup).toContain("CC: Staff A")
    expect(markup).not.toContain("Bcc")
    expect(markup).not.toContain("dateTime=\"2026-08-01T08:00:00\"")
    expect(markup).toContain("File unavailable")
  })

  it("keeps native timestamp formatting separate from source-local rendering", () => {
    const markup = renderMessage(message({ source: "compass", sentAt: "2026-09-05T12:00:00.000Z", sourceSentDisplay: null, sourceSentAt: null, sourceAttachmentReadiness: null, delivery: "saved" }))
    expect(markup).not.toContain("Source time:")
    expect(markup).toContain("dateTime=\"2026-09-05T12:00:00.000Z\"")
  })

  it("renders a search source-local label without converting it to a Date", () => {
    const unknown = renderToStaticMarkup(React.createElement(SearchResults, {
      hits: [{ conversationId: "conversation", messageId: "source", subject: "Subject", excerpt: "Body", sentAt: "2026-08-01T08:00:00", sourceSentDisplay: "Aug 1, 2026 8:00 AM", sourceSentAt: null }],
      hasMore: false,
      onOpen: () => {},
    }))
    expect(unknown).toContain("Source time: Aug 1, 2026 8:00 AM")
    expect(unknown).not.toContain("dateTime=\"2026-08-01T08:00:00\"")

    const native = renderToStaticMarkup(React.createElement(SearchResults, {
      hits: [{ conversationId: "conversation", messageId: "native", subject: "Subject", excerpt: "Body", sentAt: "2026-09-05T12:00:00.000Z", sourceSentDisplay: null, sourceSentAt: null }],
      hasMore: false,
      onOpen: () => {},
    }))
    expect(native).not.toContain("Source time:")
    expect(native).toContain("dateTime=\"2026-09-05T12:00:00.000Z\"")
  })
})
