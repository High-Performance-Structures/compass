import { describe, it, expect, vi, beforeEach } from "vitest"

describe("ws-transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("exports BRIDGE_PORT and detectBridge", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        close = vi.fn()
        onopen: (() => void) | null = null
        onerror: (() => void) | null = null
      },
    )

    const mod = await import("../ws-transport")
    expect(mod.BRIDGE_PORT).toBe(18789)
    expect(typeof mod.detectBridge).toBe("function")
  })
})

describe("detectBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  it("resolves false when WebSocket errors", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        close = vi.fn()
        onerror: (() => void) | null = null
        onopen: (() => void) | null = null
        constructor() {
          setTimeout(() => {
            if (this.onerror) this.onerror()
          }, 0)
        }
      },
    )

    vi.resetModules()
    const { detectBridge } = await import("../ws-transport")

    const promise = detectBridge("ws://localhost:9999")
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe(false)

    vi.useRealTimers()
  })

  it("resolves true when WebSocket connects", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        close = vi.fn()
        onerror: (() => void) | null = null
        onopen: (() => void) | null = null
        constructor() {
          setTimeout(() => {
            if (this.onopen) this.onopen()
          }, 0)
        }
      },
    )

    vi.resetModules()
    const { detectBridge } = await import("../ws-transport")

    const promise = detectBridge("ws://localhost:18789")
    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe(true)

    vi.useRealTimers()
  })

  it("resolves false on connect timeout", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        close = vi.fn()
        onerror: (() => void) | null = null
        onopen: (() => void) | null = null
      },
    )

    vi.resetModules()
    const { detectBridge } = await import("../ws-transport")

    const promise = detectBridge("ws://localhost:18789")
    await vi.advanceTimersByTimeAsync(3500)
    const result = await promise
    expect(result).toBe(false)

    vi.useRealTimers()
  })

  it("resolves false if WebSocket constructor throws", async () => {
    vi.stubGlobal("WebSocket", class {
      constructor() {
        throw new Error("WebSocket not supported")
      }
    })

    vi.resetModules()
    const { detectBridge } = await import("../ws-transport")

    const result = await detectBridge("ws://localhost:18789")
    expect(result).toBe(false)

    vi.useRealTimers()
  })
})
