import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { notificationLink } from "@/lib/notifications/create-event"

describe("notification email links", () => {
  it("turns an app path into a full Compass address", () => {
    expect(notificationLink({ COMPASS_APP_URL: "https://compass.example.com/" }, "/dashboard/projects/p/rfis?item=r#rfi-r"))
      .toBe("https://compass.example.com/dashboard/projects/p/rfis?item=r#rfi-r")
  })

  it("keeps a full address and falls back to the Compass site", () => {
    expect(notificationLink({}, "https://elsewhere.example.com/x")).toBe("https://elsewhere.example.com/x")
    expect(notificationLink({ COMPASS_APP_URL: "https://compass.example.com" }, "dashboard")).toBe("https://compass.example.com/dashboard")
  })
})
