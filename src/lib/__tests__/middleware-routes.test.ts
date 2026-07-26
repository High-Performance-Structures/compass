import { describe, expect, it } from "vitest"
import { isPublicPath } from "@/lib/public-paths"

describe("middleware public routes", () => {
  it("allows the HMAC-authenticated Jarvis bridge through WorkOS middleware", () => {
    expect(isPublicPath("/api/integrations/jarvis/events")).toBe(true)
    expect(
      isPublicPath(
        "/api/integrations/jarvis/events/event-123/ack",
      ),
    ).toBe(true)
    expect(isPublicPath("/api/integrations/jarvis/replies")).toBe(true)
  })

  it("does not make unrelated integration routes public", () => {
    expect(isPublicPath("/api/integrations/other/events")).toBe(false)
  })
})
