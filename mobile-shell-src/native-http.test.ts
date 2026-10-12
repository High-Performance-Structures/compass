import { describe, expect, it } from "vitest"

import {
  createSerialQueue,
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

describe("createSerialQueue", () => {
  it("runs tasks one at a time in call order", async () => {
    const enqueue = createSerialQueue()
    const events: string[] = []
    let running = 0
    const task = (name: string, delay: number) => enqueue(async () => {
      running += 1
      expect(running).toBe(1)
      events.push(`start ${name}`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      events.push(`end ${name}`)
      running -= 1
      return name
    })

    await expect(Promise.all([task("a", 20), task("b", 1), task("c", 5)]))
      .resolves.toEqual(["a", "b", "c"])
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"])
  })

  it("keeps running queued tasks after a failure", async () => {
    const enqueue = createSerialQueue()
    const failed = enqueue(async () => { throw new Error("offline") })
    const next = enqueue(async () => "ran")

    await expect(failed).rejects.toThrow("offline")
    await expect(next).resolves.toBe("ran")
  })
})
