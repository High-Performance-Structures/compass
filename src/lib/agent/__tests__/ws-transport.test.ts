import { describe, it, expect, vi, beforeEach } from "vitest"

// the ws-transport module is "use client" and relies on
// browser globals (WebSocket, localStorage, window).
// we test what we can: the detectBridge timeout logic
// and the constructor / getApiKey behavior via mocks.

describe("WebSocketChatTransport", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("can be imported without throwing", async () => {
    // mock WebSocket globally so the module loads
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1
        readyState = 0
        close = vi.fn()
        send = vi.fn()
        onopen: (() => void) | null = null
        onmessage: ((e: unknown) => void) | null = null
        onerror: (() => void) | null = null
        onclose: (() => void) | null = null
        addEventListener = vi.fn()
        removeEventListener = vi.fn()
      },
    )

    const mod = await import("../ws-transport")
    expect(mod.WebSocketChatTransport).toBeDefined()
    expect(mod.BRIDGE_PORT).toBe(18789)
  })

  it("getApiKey returns null when window is undefined", async () => {
    // simulate server-side: no window
    const originalWindow = globalThis.window
    // @ts-expect-error intentionally removing window
    delete globalThis.window

    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1
        readyState = 0
        close = vi.fn()
        send = vi.fn()
        onopen: (() => void) | null = null
        onmessage: ((e: unknown) => void) | null = null
        onerror: (() => void) | null = null
        onclose: (() => void) | null = null
        addEventListener = vi.fn()
        removeEventListener = vi.fn()
      },
    )

    // re-import fresh
    vi.resetModules()
    const { WebSocketChatTransport } = await import(
      "../ws-transport"
    )
    const transport = new WebSocketChatTransport()

    // ensureConnected should reject because getApiKey
    // returns null
    await expect(
      (transport as unknown as {
        ensureConnected: () => Promise<void>
      }).ensureConnected(),
    ).rejects.toThrow("no bridge API key configured")

    // restore window
    globalThis.window = originalWindow
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
          // fire error on next tick
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
        // never fires onopen or onerror
      },
    )

    vi.resetModules()
    const { detectBridge } = await import("../ws-transport")

    const promise = detectBridge("ws://localhost:18789")
    // advance past the 3000ms CONNECT_TIMEOUT
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
