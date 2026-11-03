import { describe, expect, it } from "vitest"
import { notificationSourceHref } from "../source-href"

describe("notification producer source destinations", () => {
  it.each([
    ["rfi.created", "rfi", "/rfis", "/rfis?status=all&item=record%2F1#rfi-record%2F1"],
    ["rfi.updated", "rfi", "/rfis?status=open", "/rfis?status=all&item=record%2F1#rfi-record%2F1"],
    ["rfq.response_received (signed-in)", "rfq", "/rfqs?status=response_received", "/rfqs?status=all&item=record%2F1#rfq-record%2F1"],
    ["rfq.response_received (price link)", "rfq", "/rfqs?status=response_received#rfq-record%2F1", "/rfqs?status=all&item=record%2F1#rfq-record%2F1"],
    ["po.vendor_acknowledged", "purchase_order", "/purchase-orders", "/purchase-orders?status=all&item=record%2F1#purchase-order-record%2F1"],
    ["po.vendor_status_updated", "purchase_order", "/purchase-orders", "/purchase-orders?status=all&item=record%2F1#purchase-order-record%2F1"],
    ["task.assigned", "task", "", "/todos?item=record%2F1#todo-record%2F1"],
    ["schedule.assigned", "schedule_item", "/schedule", "/schedule?view=list&item=record%2F1#schedule-item-record%2F1"],
    ["schedule.end_date_extended", "schedule_task", "/schedule", "/schedule?view=list&item=record%2F1#schedule-item-record%2F1"],
  ])("%s reveals the record and not only the list", (_producer, sourceType, path, expected) => {
    const prefix = "/dashboard/projects/project-a"
    expect(notificationSourceHref({ projectId: "project-a", sourceType, sourceId: "record/1", href: prefix + path })).toBe(prefix + expected)
  })

  it.each([
    "/preview/projects/project-a/owner/warranty#warranty-claim",
    "/preview/projects/project-a/sub-vendor/rfis?item=record",
    "/dashboard/conversations/channel-a?thread=thread-a",
    "/dashboard/projects/project-a/messages?conversationId=conversation-a&messageId=message-a",
    "/dashboard/projects/project-b/rfis",
    "https://example.test/dashboard/projects/project-a/rfis",
  ])("preserves recipient-specific, specialized or different-project destinations: %s", (href) => {
    expect(notificationSourceHref({ projectId: "project-a", sourceType: "rfi", sourceId: "record", href })).toBe(href)
  })
  it("preserves unknown types and missing record identities", () => {
    const input = { projectId: "project-a", sourceType: "payment", sourceId: "record", href: "/dashboard/projects/project-a/financials?squareReceipt=receipt" }
    expect(notificationSourceHref(input)).toBe(input.href)
    expect(notificationSourceHref({ ...input, sourceType: "rfi", sourceId: null })).toBe(input.href)
  })
})
