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
    expect(
      isPublicPath(
        "/api/integrations/jarvis/feedback/request-123/status"
      )
    ).toBe(true)
  })

  it("does not make unrelated integration routes public", () => {
    expect(isPublicPath("/api/integrations/other/events")).toBe(false)
  })

  it("allows only the two HMAC-authenticated Sage bridge endpoints", () => {
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/requests")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/results")
    ).toBe(true)
    expect(isPublicPath("/api/integrations/sage/admin")).toBe(false)
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/requests/extra")
    ).toBe(false)
  })

  it("allows the secret-protected GoTo webhook through WorkOS middleware", () => {
    expect(isPublicPath("/api/integrations/goto/inbound")).toBe(true)
    expect(isPublicPath("/api/integrations/goto/setup")).toBe(false)
  })
})
