import { afterEach, describe, expect, it, vi } from "vitest"

import { DEVELOPER_MODE_COOKIE } from "@/lib/developer-mode"
import { VIEW_AS_COOKIE, VIEW_AS_ENDED_PATH } from "@/lib/view-as/constants"
import { installViewAsFetchGuard, viewAsFetchRefusal } from "@/lib/view-as/fetch-guard"
import { cookieHeaderWithout, viewAsMiddlewareDecision, viewAsReturnUrl } from "@/lib/view-as/middleware"
import { ViewAsReadOnlyError } from "@/lib/view-as/write-guard"

describe("outside requests while viewing as", () => {
  it("refuses writes to outside services", () => {
    expect(viewAsFetchRefusal("https://www.googleapis.com/upload/drive/v3/files", { method: "POST" })).toMatch(/write/)
    expect(viewAsFetchRefusal("https://fcm.googleapis.com/v1/projects/x/messages:send", { method: "POST" })).toMatch(/write/)
    expect(viewAsFetchRefusal(new URL("https://api.github.com/repos/x/issues"), { method: "PATCH" })).toMatch(/write/)
  })

  it("never fetches Gmail or Google Calendar, even to read", () => {
    expect(viewAsFetchRefusal("https://gmail.googleapis.com/gmail/v1/users/me/messages")).toMatch(/Gmail/)
    expect(viewAsFetchRefusal("https://www.googleapis.com/calendar/v3/calendars/primary/events")).toMatch(/Calendar/)
  })

  it("allows reads and sign-in token refreshes", () => {
    expect(viewAsFetchRefusal("https://www.googleapis.com/drive/v3/files/abc")).toBeNull()
    expect(viewAsFetchRefusal("https://oauth2.googleapis.com/token", { method: "POST" })).toBeNull()
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/authenticate", { method: "POST" })).toBeNull()
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/users/user_1")).toBeNull()
  })

  it("refuses every other WorkOS write (profile, password, invitations, deletion)", () => {
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/users/user_1", { method: "PUT" })).toMatch(/write/)
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/users/user_1", { method: "DELETE" })).toMatch(/write/)
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/invitations", { method: "POST" })).toMatch(/write/)
    expect(viewAsFetchRefusal("https://api.workos.com/user_management/users/user_1/email_verification/send", { method: "POST" })).toMatch(/write/)
    expect(viewAsFetchRefusal("https://oauth2.googleapis.com/revoke", { method: "POST" })).toMatch(/write/)
  })
})

describe("installViewAsFetchGuard", () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })

  it("blocks refused requests only on View as requests", async () => {
    const inner = vi.fn(async () => new Response("ok"))
    globalThis.fetch = inner
    let viewing = true
    installViewAsFetchGuard(async () => viewing)
    await expect(fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST" })).rejects.toBeInstanceOf(ViewAsReadOnlyError)
    expect(inner).not.toHaveBeenCalled()
    await fetch("https://www.googleapis.com/drive/v3/files/abc")
    expect(inner).toHaveBeenCalledTimes(1)
    viewing = false
    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST" })
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("answers 403 instead of throwing while a page renders", async () => {
    const inner = vi.fn(async () => new Response("ok"))
    globalThis.fetch = inner
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    installViewAsFetchGuard(async () => true, async () => "skip")
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events")
    expect(response.status).toBe(403)
    expect(inner).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("installs once", () => {
    const inner = vi.fn(async () => new Response("ok"))
    globalThis.fetch = inner
    installViewAsFetchGuard(async () => false)
    const first = globalThis.fetch
    installViewAsFetchGuard(async () => false)
    expect(globalThis.fetch).toBe(first)
  })
})

function request(method: string, pathname: string, cookies: Record<string, string>) {
  return {
    method,
    nextUrl: { pathname },
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] ?? "" } : undefined) },
  }
}

function tokenWithExpiry(exp: number): string {
  return `${btoa(JSON.stringify({ exp })).replace(/=+$/, "")}.signature`
}

describe("View as middleware", () => {
  const now = 1_800_000_000
  const live = { [VIEW_AS_COOKIE]: tokenWithExpiry(now + 60), [DEVELOPER_MODE_COOKIE]: "enabled" }

  it("blocks non-GET API requests while viewing as", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(viewAsMiddlewareDecision(request(method, "/api/projects/1/photos", live), now)).toBe("block-write")
    }
    expect(viewAsMiddlewareDecision(request("GET", "/api/projects/1/photos", live), now)).toBe("pass")
  })

  it("passes everything when not viewing as", () => {
    expect(viewAsMiddlewareDecision(request("POST", "/api/projects/1/photos", {}), now)).toBe("pass")
  })

  it("clears a session once developer mode is off or it has expired", () => {
    expect(viewAsMiddlewareDecision(request("GET", "/dashboard", { [VIEW_AS_COOKIE]: tokenWithExpiry(now + 60) }), now)).toBe("clear")
    expect(viewAsMiddlewareDecision(request("GET", "/dashboard", { ...live, [VIEW_AS_COOKIE]: tokenWithExpiry(now - 1) }), now)).toBe("clear")
    expect(viewAsMiddlewareDecision(request("GET", "/dashboard", live), now)).toBe("pass")
  })

  it("lets the end-recording page through so it can clear the cookie", () => {
    expect(viewAsMiddlewareDecision(request("GET", VIEW_AS_ENDED_PATH, { [VIEW_AS_COOKIE]: tokenWithExpiry(now - 1) }), now)).toBe("pass")
  })
})

describe("viewAsReturnUrl (no open redirect)", () => {
  const from = "https://compass.example/view-as/ended"

  it("returns to a same-site path", () => {
    expect(viewAsReturnUrl("/dashboard/projects?tab=1#x", from).href).toBe("https://compass.example/dashboard/projects?tab=1#x")
  })

  it("never leaves the site", () => {
    for (const next of ["/%5Cevil.com", "/\\evil.com", "/\tevil.com", "/%09/evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "evil.com", "/.//evil.com", null]) {
      const url = viewAsReturnUrl(next, from)
      expect(url.origin).toBe("https://compass.example")
    }
    expect(viewAsReturnUrl("//evil.com", from).pathname).toBe("/dashboard")
    expect(viewAsReturnUrl("/\\evil.com", from).pathname).toBe("/dashboard")
  })
})

describe("signing in again during View as", () => {
  it("lets the sign-in routes through instead of blocking them", () => {
    const cookies = { [VIEW_AS_COOKIE]: "token" }
    for (const path of ["/api/auth/login", "/api/auth/mobile/session", "/api/auth/callback", "/callback"]) {
      expect(viewAsMiddlewareDecision(request("POST", path, cookies))).toBe("signing-in")
    }
    expect(viewAsMiddlewareDecision(request("POST", "/api/projects", cookies))).toBe("block-write")
  })

  it("removes only the View as cookie from the request", () => {
    expect(cookieHeaderWithout(`a=1; ${VIEW_AS_COOKIE}=tok.sig; wos-session=x`, VIEW_AS_COOKIE)).toBe("a=1; wos-session=x")
    expect(cookieHeaderWithout(null, VIEW_AS_COOKIE)).toBe("")
  })
})
