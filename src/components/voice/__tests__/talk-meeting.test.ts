// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { RealtimeKitMeetingWindow } from "../realtimekit-meeting-window"
import {
  defaultTalkPreferences,
  talkPreferencesKey
} from "@/lib/realtimekit/talk-preferences"

const mocks = vi.hoisted(() => {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId: "camera" }) }
  const transformed = { stop: vi.fn() }
  const self = {
    videoEnabled: false,
    audioEnabled: false,
    screenShareEnabled: false,
    roomJoined: false,
    backgroundActive: false,
    get videoTrack() {
      return this.backgroundActive ? transformed : track
    },
    rawVideoTrack: track,
    on: vi.fn(),
    off: vi.fn(),
    cleanUpTracks: vi.fn(),
    registerVideoElement: vi.fn(),
    deregisterVideoElement: vi.fn(),
    setDevice: vi.fn(async () => {}),
    setVideoMiddlewareGlobalConfig: vi.fn(async () => {}),
    addVideoMiddleware: vi.fn(async () => {
      self.backgroundActive = true
      return { success: true, message: "ok" }
    }),
    removeVideoMiddleware: vi.fn(async () => {
      self.backgroundActive = false
      return { success: true, message: "ok" }
    }),
    enableVideo: vi.fn(async () => {
      self.videoEnabled = true
    }),
    disableVideo: vi.fn(async () => {
      self.videoEnabled = false
    }),
    enableAudio: vi.fn(async () => {
      self.audioEnabled = true
    }),
    disableAudio: vi.fn(async () => {
      self.audioEnabled = false
    })
  }
  return {
    track,
    self,
    supported: true,
    meeting: {
      self,
      join: vi.fn(async () => {
        self.roomJoined = true
      }),
      leave: vi.fn(async () => {}),
      ai: { on: vi.fn(), off: vi.fn(), transcripts: [] }
    }
  }
})

vi.mock("@cloudflare/realtimekit-react", () => {
  const initMeeting = async () => mocks.meeting
  return { useRealtimeKitClient: () => [mocks.meeting, initMeeting] }
})
vi.mock("@cloudflare/realtimekit-react-ui", async () => {
  const ReactModule = await import("react")
  return {
    createDefaultConfig: () => ({}),
    RtkMeeting: () =>
      ReactModule.createElement("div", null, "Connected meeting")
  }
})
vi.mock("@/hooks/use-music-ducking", () => ({
  useVoiceActivityPublisher: () => {}
}))
vi.mock("@/lib/realtimekit/browser-api-proxy", () => ({
  installRealtimeKitBrowserApiProxy: () => () => {}
}))
vi.mock("@/app/actions/chat-messages", () => ({ sendMessage: vi.fn() }))
vi.mock("@/app/actions/voice-sessions", () => ({
  joinRealtimeKitVoiceSession: async () => ({
    success: true,
    data: {
      meetingTitle: "Office Talk",
      meetingId: "test",
      authToken: "test",
      cachedUserDetails: {
        userDetails: {
          preset: { name: "participant" },
          socket: { baseUri: "test" }
        },
        iceServers: []
      }
    }
  })
}))
vi.mock("@cloudflare/realtimekit-virtual-background", () => ({
  default: {
    isSupported: () => mocks.supported,
    init: async () => ({
      createBackgroundBlurVideoMiddleware: async () => async () => {},
      destruct: () => {}
    })
  }
}))

describe("Talk joining workflow", () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.self.videoEnabled = false
    mocks.self.audioEnabled = false
    mocks.self.roomJoined = false
    mocks.self.backgroundActive = false
    mocks.supported = true
    localStorage.clear()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        getUserMedia: async () => ({
          getVideoTracks: () => [mocks.track],
          getAudioTracks: () => [mocks.track],
          getTracks: () => [mocks.track]
        })
      }
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(
        React.createElement(RealtimeKitMeetingWindow, {
          channelId: "test-channel",
          userId: "test-user"
        })
      )
      await Promise.resolve()
    })
  }
  const click = async (label: string): Promise<void> => {
    const button = [...document.body.querySelectorAll("button")].find(
      (item) => item.textContent === label
    )
    if (!button) throw new Error(`Button not found: ${label}`)
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
  }

  it("shows setup without joining or requesting camera capture", async () => {
    await render()
    expect(container.textContent).toContain("Ready to join Office Talk?")
    expect(mocks.meeting.join).not.toHaveBeenCalled()
    expect(mocks.self.enableVideo).not.toHaveBeenCalled()
    expect(mocks.self.enableAudio).not.toHaveBeenCalled()
  })
  it("keeps a camera preview local until Join is clicked", async () => {
    await render()
    await click("Preview camera")
    expect(mocks.self.enableVideo).toHaveBeenCalledOnce()
    expect(mocks.meeting.join).not.toHaveBeenCalled()
    await click("Join meeting")
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    expect(mocks.meeting.join).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("Connected meeting")
  })
  it("restores a saved background before enabling the camera and joining", async () => {
    localStorage.setItem(
      talkPreferencesKey("test-user"),
      JSON.stringify({
        ...defaultTalkPreferences(),
        joinWithCamera: true,
        background: { mode: "blur", strength: 60 }
      })
    )
    await render()
    await click("Join meeting")
    expect(mocks.self.addVideoMiddleware).toHaveBeenCalledOnce()
    expect(
      mocks.self.addVideoMiddleware.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.self.enableVideo.mock.invocationCallOrder[0] ?? 0)
    expect(mocks.self.enableVideo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.meeting.join.mock.invocationCallOrder[0] ?? 0
    )
  })
  it("keeps the camera off and does not join when a required background is unsupported", async () => {
    mocks.supported = false
    localStorage.setItem(
      talkPreferencesKey("test-user"),
      JSON.stringify({
        ...defaultTalkPreferences(),
        joinWithCamera: true,
        background: { mode: "blur", strength: 60 }
      })
    )
    await render()
    await click("Join meeting")
    expect(mocks.self.enableVideo).not.toHaveBeenCalled()
    expect(mocks.meeting.join).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "Background effects are unavailable"
    )
  })
  it("persists changes for the current account", async () => {
    await render()
    await click("Blur")
    const saved = JSON.parse(
      localStorage.getItem(talkPreferencesKey("test-user")) ?? "{}"
    )
    expect(saved.background).toEqual({ mode: "blur", strength: 45 })
    expect(localStorage.getItem(talkPreferencesKey("other-user"))).toBeNull()
  })
  it("pauses a published camera before replacing the effect, then resumes", async () => {
    localStorage.setItem(
      talkPreferencesKey("test-user"),
      JSON.stringify({ ...defaultTalkPreferences(), joinWithCamera: true })
    )
    await render()
    await click("Join meeting")
    await click("Background& Settings")
    await click("Blur")
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    expect(mocks.self.enableVideo).toHaveBeenCalledTimes(2)
    expect(mocks.self.disableVideo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.self.addVideoMiddleware.mock.invocationCallOrder[0] ?? 0
    )
    expect(
      mocks.self.addVideoMiddleware.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.self.enableVideo.mock.invocationCallOrder[1] ?? 0)
    expect(mocks.self.videoEnabled).toBe(true)
  })

  it("remains camera-off if the SDK silently falls back to raw video", async () => {
    mocks.self.addVideoMiddleware.mockImplementationOnce(async () => ({
      success: true,
      message: "ok"
    }))
    localStorage.setItem(
      talkPreferencesKey("test-user"),
      JSON.stringify({
        ...defaultTalkPreferences(),
        joinWithCamera: true,
        background: { mode: "blur", strength: 45 }
      })
    )
    await render()
    await click("Join meeting")
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    expect(mocks.meeting.join).not.toHaveBeenCalled()
    expect(mocks.self.videoEnabled).toBe(false)
  })
})
