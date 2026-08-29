import { describe, expect, it } from "vitest"

import {
  nativeResponseRequiresAuthentication,
  webResponseRequiresAuthentication,
} from "./native-http"

describe("nativeResponseRequiresAuthentication", () => {
  it("recognizes API authentication failures", () => {
    expect(nativeResponseRequiresAuthentication({
      status: 401,
      url: "https://compass.example/api/field/native-bootstrap",
      headers: {},
    })).toBe(true)
  })

  it("recognizes the legacy middleware login redirect", () => {
    expect(nativeResponseRequiresAuthentication({
      status: 307,
      url: "https://compass.example/api/field/native-bootstrap",
      headers: { Location: "/login?from=%2Fapi%2Ffield%2Fnative-bootstrap" },
    })).toBe(true)
  })

  it("recognizes a redirect already followed by the native HTTP client", () => {
    expect(nativeResponseRequiresAuthentication({
      status: 200,
      url: "https://compass.example/login?from=%2Fapi%2Ffield%2Fnative-bootstrap",
      headers: { "content-type": "text/html" },
    })).toBe(true)
  })

  it("does not treat healthy Field Mode responses as authentication failures", () => {
    expect(nativeResponseRequiresAuthentication({
      status: 200,
      url: "https://compass.example/api/field/native-bootstrap",
      headers: { "content-type": "application/json" },
    })).toBe(false)
  })

  it("preserves authenticated business-rule failures", () => {
    expect(nativeResponseRequiresAuthentication({
      status: 403,
      url: "https://compass.example/api/field/daily-logs",
      headers: { "content-type": "application/json" },
    })).toBe(false)
  })
})

describe("webResponseRequiresAuthentication", () => {
  it("recognizes manual and followed login redirects", () => {
    expect(webResponseRequiresAuthentication({
      status: 0,
      url: "",
      type: "opaqueredirect",
      headers: new Headers(),
    })).toBe(true)
    expect(webResponseRequiresAuthentication({
      status: 307,
      url: "https://compass.example/api/projects/project-1/photos/upload",
      type: "basic",
      headers: new Headers({ location: "/login?from=%2Fapi%2Fprojects" }),
    })).toBe(true)
    expect(webResponseRequiresAuthentication({
      status: 200,
      url: "https://compass.example/login?from=%2Fapi%2Fprojects",
      type: "basic",
      headers: new Headers({ "content-type": "text/html" }),
    })).toBe(true)
  })

  it("preserves authenticated upload failures", () => {
    expect(webResponseRequiresAuthentication({
      status: 403,
      url: "https://compass.example/api/projects/project-1/photos/upload",
      type: "basic",
      headers: new Headers({ "content-type": "application/json" }),
    })).toBe(false)
  })
})
