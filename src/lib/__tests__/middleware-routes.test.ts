import { describe, expect, it } from "vitest"
import {
  isAuthSessionWritePath,
  isPublicPath,
} from "@/lib/public-paths"

describe("middleware public routes", () => {
  it("keeps legal and compliance disclosures public", () => {
    expect(isPublicPath("/privacy")).toBe(true)
    expect(isPublicPath("/terms")).toBe(true)
  })

  it("allows private-token e-card pages without exposing the card dashboard", () => {
    expect(isPublicPath("/ecard/6b8bb215-7cf0-4c5c-a426-9689dd645ec7")).toBe(true)
    expect(isPublicPath("/ecard")).toBe(false)
    expect(isPublicPath("/dashboard/cards")).toBe(false)
  })

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

  it("allows only signed social media delivery through WorkOS middleware", () => {
    expect(isPublicPath("/api/social/media/photo-123")).toBe(true)
    expect(isPublicPath("/api/social/meta/connect")).toBe(false)
    expect(isPublicPath("/api/social/x/callback")).toBe(false)
  })

  it("allows only the HMAC-authenticated Sage bridge endpoints", () => {
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/requests")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/results")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/tax-catalog/results")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/client-project-writes/requests")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/client-project-writes/results")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/square-payments/requests")
    ).toBe(true)
    expect(
      isPublicPath("/api/integrations/sage/square-payments/results")
    ).toBe(true)
    expect(isPublicPath("/api/integrations/sage/admin")).toBe(false)
    expect(
      isPublicPath("/api/integrations/sage/pay-applications/requests/extra")
    ).toBe(false)
  })

  it("allows the secret-protected GoTo webhook through WorkOS middleware", () => {
    expect(isPublicPath("/api/integrations/goto/inbound")).toBe(true)
    expect(isPublicPath("/api/integrations/square/webhook")).toBe(true)
    expect(isPublicPath("/api/integrations/square/webhook/extra")).toBe(false)
    expect(isPublicPath("/api/integrations/goto/setup")).toBe(false)
  })

  it("allows only exact independently authenticated maintenance routes", () => {
    expect(isPublicPath("/api/email/gmail-sync")).toBe(true)
    expect(isPublicPath("/api/operations/feedback/reconcile")).toBe(true)
    expect(
      isPublicPath("/api/operations/goto/recover-message-bodies")
    ).toBe(true)
    expect(isPublicPath("/api/operations/sage/health")).toBe(true)
    expect(isPublicPath("/api/operations/sage/square-receipts")).toBe(true)
    expect(isPublicPath("/api/operations/goto")).toBe(false)
    expect(
      isPublicPath("/api/operations/goto/recover-message-bodies/extra")
    ).toBe(false)
    expect(isPublicPath("/api/operations/sage/health/extra")).toBe(false)
    expect(
      isPublicPath("/api/operations/sage/square-receipts/extra")
    ).toBe(false)
  })

  it("isolates handlers that replace the WorkOS session cookie", () => {
    expect(isAuthSessionWritePath("/callback")).toBe(true)
    expect(isAuthSessionWritePath("/api/auth/callback")).toBe(true)
    expect(isAuthSessionWritePath("/api/auth/login")).toBe(true)
    expect(isAuthSessionWritePath("/api/auth/mobile/session")).toBe(true)
    expect(isAuthSessionWritePath("/login")).toBe(false)
    expect(isAuthSessionWritePath("/api/auth/password-reset")).toBe(false)
  })
})
