// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ push: vi.fn(), mark: vi.fn(), center: vi.fn(), panel: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => React.createElement("a", props) }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/conversations/conversation-panel-provider", () => ({ useConversationPanelOptional: mocks.panel }))
vi.mock("@/app/actions/notifications", () => ({ getNotificationCenter: mocks.center, markNotificationRead: mocks.mark, markAllNotificationsRead: vi.fn() }))
vi.mock("@/components/ui/popover", () => ({
  Popover: (props: {readonly children: React.ReactNode}) => React.createElement(React.Fragment, null, props.children),
  PopoverTrigger: (props: {readonly children: React.ReactNode}) => React.createElement(React.Fragment, null, props.children),
  PopoverContent: (props: {readonly children: React.ReactNode}) => React.createElement("div", null, props.children),
}))
import { NotificationsPopover } from "../notifications-popover"

describe("bell notification navigation", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true })
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
    mocks.panel.mockReturnValue(null)
    mocks.mark.mockRejectedValue(new Error("Read update offline"))
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  async function render(href: string): Promise<HTMLAnchorElement> {
    mocks.center.mockResolvedValue({ success: true, data: { unreadCount: 1, items: [{ id: "notification", eventId: "event", title: "Open received item", body: "Update", href, priority: "normal", eventType: "project_message", projectId: "project-a", readAt: null, createdAt: new Date().toISOString() }] } })
    await act(async () => { root.render(React.createElement(NotificationsPopover)) })
    const link = host.querySelector("a")
    if (!link) throw new Error("Notification link missing")
    return link
  }
  it.each([
    "/dashboard/projects/project-a/messages?conversationId=thread&messageId=reply",
    "/dashboard/automations",
    "/dashboard/projects/project-a/financials?squareReceipt=receipt-a",
  ])("opens %s even if marking it read fails", async (href) => {
    const link = await render(href)
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })) })
    expect(mocks.push).toHaveBeenCalledWith(href)
    expect(mocks.mark).toHaveBeenCalledWith("notification", undefined)
  })
  it("keeps modifier clicks as browser links", async () => {
    const link = await render("/dashboard/automations")
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, button:0, ctrlKey:true })) })
    expect(mocks.push).not.toHaveBeenCalled()
  })
  it("keeps existing conversation panel links in the panel", async () => {
    const open = vi.fn()
    mocks.panel.mockReturnValue({open})
    const link = await render("/dashboard/conversations/channel-a")
    await act(async () => { link.dispatchEvent(new MouseEvent("click", {bubbles:true,cancelable:true,button:0})) })
    expect(open).toHaveBeenCalledWith("channel-a")
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
