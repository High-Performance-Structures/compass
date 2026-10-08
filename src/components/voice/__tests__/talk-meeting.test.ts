// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { RealtimeKitMeetingWindow } from "../realtimekit-meeting-window"
import { talkNotesDraftKey } from "../talk-notes-panel"
import {
  defaultTalkPreferences,
  talkPreferencesKey
} from "@/lib/realtimekit/talk-preferences"

const mocks = vi.hoisted(() => {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId: "camera" }) }
  const transformed = { stop: vi.fn() }
  const self = {
    permissions: { canProduceAudio: "ALLOWED", kickParticipant: false, addListener: vi.fn(), removeListener: vi.fn() },
    config: { pipMode: true },
    stageStatus: "ON_STAGE",
    videoEnabled: false,
    audioEnabled: false,
    screenShareEnabled: false,
    roomJoined: false,
    backgroundActive: false,
    get videoTrack() {
      return this.backgroundActive ? transformed : track
    },
    rawVideoTrack: track,
    rawAudioTrack: track,
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
    enableAudio: vi.fn(async (track: unknown) => {
      void track
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
      ai: { on: vi.fn(), off: vi.fn(), transcripts: [] },
      participants: {
        audioSubscribed: new Map<string, { audioEnabled: boolean; audioTrack: MediaStreamTrack | undefined }>(),
        kickAll: vi.fn(async () => {}),
        pip: { isSupported: vi.fn(() => true), isActive: false, init: vi.fn(), enable: vi.fn(), disable: vi.fn() }
      }
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
    RtkChatToggle: () => null,
    RtkParticipantsToggle: () => null,
    RtkMoreToggle: ({ children }: { readonly children: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "more-menu" }, children),
    RtkPollsToggle: () => ReactModule.createElement("span", null, "Polls"),
    RtkFullscreenToggle: () => ReactModule.createElement("span", null, "Fullscreen"),
    RtkMuteAllButton: () => ReactModule.createElement("span", null, "Mute all"),
    RtkRecordingToggle: () => ReactModule.createElement("span", null, "Recording"),
    RtkMeeting: ({
      mode,
      children
    }: {
      readonly mode: string
      readonly children: React.ReactNode
    }) =>
      ReactModule.createElement(
        "div",
        { "data-meeting-mode": mode },
        "Connected meeting",
        children
      )
  }
})
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
    vi.spyOn(window, "close").mockImplementation(() => {})
    vi.spyOn(window, "setTimeout").mockImplementation(() => 0)
    mocks.self.permissions.canProduceAudio = "ALLOWED"
    mocks.self.permissions.kickParticipant = false
    mocks.meeting.participants.pip.isActive = false
    mocks.self.stageStatus = "ON_STAGE"
    mocks.self.videoEnabled = false
    mocks.self.audioEnabled = false
    mocks.self.roomJoined = false
    mocks.self.backgroundActive = false
    mocks.supported = true
    localStorage.clear()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal("BroadcastChannel", undefined)
    mocks.meeting.participants.audioSubscribed.clear()
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
    vi.restoreAllMocks()
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
      (item) =>
        item.getAttribute("aria-label") === label || item.textContent === label
    )
    if (!button) throw new Error(`Button not found: ${label}`)
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
  }

  it("joins with microphone and camera off while an unmuted peer's audio is still arriving", async () => {
    const broadcastClose = vi.fn()
    const audioClose = vi.fn(async () => {})
    const sourceDisconnect = vi.fn()
    const createSource = vi.fn(() => ({ connect: vi.fn(), disconnect: sourceDisconnect }))
    const analyser = {
      fftSize: 256, disconnect: vi.fn(),
      getByteTimeDomainData: (samples: Uint8Array): void => { samples.fill(255) }
    }
    const publish = vi.fn()
    vi.stubGlobal("BroadcastChannel", class { postMessage = publish; close = broadcastClose })
    vi.stubGlobal("MediaStream", class {})
    vi.stubGlobal("AudioContext", class {
      state = "running"
      close = audioClose
      createMediaStreamSource = createSource
      createAnalyser = (): typeof analyser => analyser
    })
    const meterTimer = vi.spyOn(window, "setInterval").mockImplementation(() => 0)
    mocks.meeting.participants.audioSubscribed.set("existing-speaker", {
      audioEnabled: true, audioTrack: undefined
    })
    await render()
    await click("Join meeting")
    expect(container.textContent).toContain("Connected meeting")
    expect(container.querySelector('button[aria-label="Unmute microphone"]')).not.toBeNull()
    expect(mocks.meeting.join).toHaveBeenCalledOnce()
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
    expect(mocks.self.enableAudio).not.toHaveBeenCalled()
    expect(mocks.self.enableVideo).not.toHaveBeenCalled()
    const sampleVoice = meterTimer.mock.calls[0]?.[0]
    if (typeof sampleVoice !== "function") throw new Error("Missing voice meter callback")
    expect(() => sampleVoice()).not.toThrow()
    expect(createSource).not.toHaveBeenCalled()
    const speaker = mocks.meeting.participants.audioSubscribed.get("existing-speaker")
    if (!speaker) throw new Error("Missing remote speaker")
    // JSDOM has no native MediaStreamTrack; model the SDK's later track arrival.
    Object.defineProperty(speaker, "audioTrack", { configurable: true, value: {
      kind: "audio", readyState: "live", id: "remote-audio"
    } })
    await act(async () => sampleVoice())
    expect(createSource).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ active: true }))
    expect(container.textContent).toContain("Connected meeting")
    await act(async () => root.unmount())
    expect(sourceDisconnect).toHaveBeenCalledOnce()
    expect(audioClose).toHaveBeenCalledOnce()
    expect(broadcastClose).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }))
  })

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
  it("closes and reopens notes without losing a draft or restarting the call", async () => {
    await render()
    await click("Join meeting")
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Meeting notes"]')
    const panel = container.querySelector<HTMLElement>("#talk-notes-transcript")
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    if (!textarea || !panel || !setValue) throw new Error("Notes panel not found")
    await act(async () => {
      setValue.call(textarea, "Keep these meeting notes")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Close Notes & Transcript")
    expect(panel.hidden).toBe(true)
    expect([...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Show Notes & Transcript")?.getAttribute("aria-expanded")).toBe("false")
    await click("Show Notes & Transcript")
    expect(panel.hidden).toBe(false)
    expect(textarea.value).toBe("Keep these meeting notes")
    expect([...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Hide Notes & Transcript")?.getAttribute("aria-expanded")).toBe("true")
    await click("Hide Notes & Transcript")
    await click("Show Notes & Transcript")
    expect(textarea.value).toBe("Keep these meeting notes")
    expect(mocks.meeting.join).toHaveBeenCalledOnce()
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
  })

  it("keeps an unsaved notes draft in this browser and mentions it when leaving", async () => {
    localStorage.setItem(talkNotesDraftKey("test-user", "test-channel"), "Draft from earlier")
    await render()
    await click("Join meeting")
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Meeting notes"]')
    expect(textarea?.value).toBe("Draft from earlier")
    expect(container.textContent).toContain("Restored unsaved notes")
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    await act(async () => {
      setValue?.call(textarea, "Draft from earlier, plus more")
      textarea?.dispatchEvent(new Event("input", { bubbles: true }))
      await Promise.resolve()
    })
    window.dispatchEvent(new Event("pagehide"))
    expect(localStorage.getItem(talkNotesDraftKey("test-user", "test-channel"))).toBe("Draft from earlier, plus more")
    await click("Leave")
    expect(document.body.textContent).toContain("Your notes have not been saved to the conversation")
  })

  it("keeps the transcript tab and capture active while its panel is hidden", async () => {
    await render()
    await click("Join meeting")
    await click("Transcript")
    await click("Turn Captions On")
    const transcriptListener = mocks.meeting.ai.on.mock.calls.find(([event]) => event === "transcript")?.[1]
    if (typeof transcriptListener !== "function") throw new Error("Missing transcript subscription")
    await click("Hide Notes & Transcript")
    expect(mocks.meeting.ai.off).not.toHaveBeenCalled()
    await act(async () => {
      transcriptListener({ id: "hidden-line", name: "Colleague", transcript: "Captured while the panel is hidden", isPartialTranscript: false, date: new Date("2026-10-07T16:00:00Z") })
    })
    await click("Show Notes & Transcript")
    expect(container.textContent).toContain("Captured while the panel is hidden")
    expect(container.textContent).toContain("Turn Captions Off")
    expect(container.querySelector('textarea[aria-label="Meeting notes"]')).toBeNull()
    await click("Notes")
    expect(container.querySelector('textarea[aria-label="Meeting notes"]')).not.toBeNull()
  })

  it("opens SDK PiP without needing light-DOM camera videos and tracks browser close", async () => {
    await render()
    await click("Join meeting")
    expect(document.querySelector("video")).toBeNull()
    await click("PiP")
    expect(mocks.meeting.participants.pip.init).toHaveBeenCalledOnce()
    expect(mocks.meeting.participants.pip.enable).toHaveBeenCalledOnce()
    await act(async () => {
      mocks.meeting.participants.pip.isActive = true
      document.dispatchEvent(new Event("enterpictureinpicture"))
    })
    await click("Exit PiP")
    expect(mocks.meeting.participants.pip.disable).toHaveBeenCalledOnce()
    await act(async () => {
      mocks.meeting.participants.pip.isActive = false
      document.dispatchEvent(new Event("leavepictureinpicture"))
    })
    expect(container.textContent).toContain("PiP")
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
  })

  it("asks before leaving and lets a participant cancel or leave only themselves", async () => {
    await render()
    await click("Join meeting")
    await click("Leave")
    expect(document.body.textContent).toContain("Leave meeting?")
    expect(document.body.textContent).not.toContain("End for Everyone")
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
    await click("Cancel")
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
    await click("Leave")
    await click("Leave meeting")
    expect(mocks.meeting.leave).toHaveBeenCalledOnce()
    expect(mocks.meeting.participants.kickAll).not.toHaveBeenCalled()
    expect(window.close).toHaveBeenCalledOnce()
  })

  it("lets a host end for everyone and waits for removal before closing the connection", async () => {
    mocks.self.permissions.kickParticipant = true
    await render()
    await click("Join meeting")
    await click("Leave")
    await click("End for Everyone")
    expect(mocks.meeting.participants.kickAll).toHaveBeenCalledOnce()
    expect(mocks.meeting.leave).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
    const roomLeft = mocks.self.on.mock.calls.find(([event]) => event === "roomLeft")?.[1]
    if (typeof roomLeft !== "function") throw new Error("Missing room-left subscription")
    await act(async () => { roomLeft() })
    expect(window.close).toHaveBeenCalledOnce()
  })

  it("rechecks host permission before ending and keeps the call open on a failed leave", async () => {
    mocks.self.permissions.kickParticipant = true
    await render()
    await click("Join meeting")
    await click("Leave")
    mocks.self.permissions.kickParticipant = false
    await click("End for Everyone")
    expect(mocks.meeting.participants.kickAll).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("You do not have permission")
    mocks.meeting.leave.mockRejectedValueOnce(new Error("Connection interrupted"))
    await click("Leave meeting")
    expect(document.body.textContent).toContain("Connection interrupted")
    expect(window.close).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Leave meeting?")
  })

  it("updates the host choice when meeting permissions change and handles end failures", async () => {
    await render()
    await click("Join meeting")
    await click("Leave")
    const permissionChanged = mocks.self.permissions.addListener.mock.calls.find(([event]) => event === "permissionsUpdate")?.[1]
    if (typeof permissionChanged !== "function") throw new Error("Missing permissions subscription")
    await act(async () => {
      mocks.self.permissions.kickParticipant = true
      permissionChanged()
    })
    mocks.meeting.participants.kickAll.mockRejectedValueOnce(new Error("End request failed"))
    await click("End for Everyone")
    expect(document.body.textContent).toContain("End request failed")
    expect(window.close).not.toHaveBeenCalled()
    const roomLeft = mocks.self.on.mock.calls.find(([event]) => event === "roomLeft")?.[1]
    if (typeof roomLeft !== "function") throw new Error("Missing room-left subscription")
    await act(async () => { roomLeft() })
    expect(window.close).not.toHaveBeenCalled()
  })

  it("keeps the main call microphone usable across mute and unmute cycles", async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }, { stop: vi.fn() }]
    let requested = 0
    const capture = vi.fn(async () => {
      const track = tracks[requested++]
      if (!track) throw new Error("Unexpected capture")
      return { getAudioTracks: () => [track], getTracks: () => [track] }
    })
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: capture
    })
    await render()
    await click("Join meeting")
    expect(
      container
        .querySelector("[data-meeting-mode]")
        ?.getAttribute("data-meeting-mode")
    ).toBe("fill")
    const unmute = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Unmute microphone"]'
    )
    expect(unmute?.disabled).toBe(false)
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(1, tracks[0])
    expect(
      container.querySelector('button[aria-label="Mute microphone"]')
    ).not.toBeNull()
    await click("Mute")
    expect(tracks[0]?.stop).toHaveBeenCalledOnce()
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(2, tracks[1])
    expect(tracks[1]?.stop).not.toHaveBeenCalled()
    await click("Mute")
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(3, tracks[2])
    expect(mocks.self.audioEnabled).toBe(true)
    expect(capture).toHaveBeenCalledTimes(3)
    expect(mocks.meeting.join).toHaveBeenCalledOnce()
  })

  it("explains meeting audio restrictions without requesting microphone capture", async () => {
    const capture = vi.spyOn(navigator.mediaDevices, "getUserMedia")
    mocks.self.permissions.canProduceAudio = "NOT_ALLOWED"
    await render()
    await click("Join meeting")
    await click("Unmute")
    expect(capture).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Ask the host to allow you to speak")
    expect(mocks.self.enableAudio).not.toHaveBeenCalled()
  })

  it("gives browser-neutral instructions when microphone access is denied", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError")
    )
    await render()
    await click("Join meeting")
    await click("Unmute")
    expect(container.textContent).toContain("system privacy settings")
    expect(container.textContent).not.toContain("Brave")
    expect(container.textContent).not.toContain("macOS")
    expect(mocks.self.enableAudio).not.toHaveBeenCalled()
  })

  it("distinguishes a found microphone from SDK publishing failure and refreshes its name", async () => {
    let permitted = false
    const device: MediaDeviceInfo = {
      deviceId: "mic", groupId: "mic-group", kind: "audioinput",
      label: "Laptop microphone", toJSON: () => ({})
    }
    vi.spyOn(navigator.mediaDevices, "enumerateDevices").mockImplementation(async () => permitted ? [device] : [])
    // JSDOM has no capture hardware; provide only the track interface used by Talk.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      permitted = true
      return { getAudioTracks: () => [mocks.track], getTracks: () => [mocks.track] }
    } })
    mocks.self.enableAudio.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {})
    await render()
    await click("Join meeting")
    await click("Unmute")
    expect(container.textContent).toContain("Your browser found a microphone")
    expect(mocks.track.stop).toHaveBeenCalled()
    await click("Background & Settings")
    expect(document.body.textContent).toContain("Laptop microphone")
  })

  it("recovers the first unmute through SDK capture without opening PiP", async () => {
    mocks.self.enableAudio.mockImplementationOnce(async () => {})
    await render()
    await click("Join meeting")
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(1, mocks.track)
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(2)
    expect(mocks.self.disableAudio).toHaveBeenCalledOnce()
    expect(mocks.self.audioEnabled).toBe(true)
    expect(container.querySelector('button[aria-label="Mute microphone"]')).not.toBeNull()
    await click("Mute")
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenNthCalledWith(3, mocks.track)
    expect(mocks.self.audioEnabled).toBe(true)
  })

  it("retains a selected microphone when SDK capture is needed", async () => {
    const device: MediaDeviceInfo = {
      deviceId: "headset", groupId: "headset-group", kind: "audioinput",
      label: "Headset", toJSON: () => ({})
    }
    localStorage.setItem(talkPreferencesKey("test-user"), JSON.stringify({
      ...defaultTalkPreferences(), microphoneId: device.deviceId
    }))
    vi.spyOn(navigator.mediaDevices, "enumerateDevices").mockResolvedValue([device])
    mocks.self.enableAudio.mockImplementationOnce(async () => {})
    await render()
    await click("Join meeting")
    await click("Unmute")
    expect(mocks.self.setDevice).toHaveBeenCalledWith(device)
    expect(mocks.self.audioEnabled).toBe(true)
  })

  it("updates the main control after an SDK mute event so the user can unmute", async () => {
    await render()
    await click("Join meeting")
    await click("Unmute")
    const audioUpdate = mocks.self.on.mock.calls.find(
      ([event]) => event === "audioUpdate"
    )?.[1]
    if (typeof audioUpdate !== "function")
      throw new Error("Missing audio subscription")
    await act(async () => {
      mocks.self.audioEnabled = false
      audioUpdate({ audioEnabled: false })
    })
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Unmute microphone"]'
      )?.disabled
    ).toBe(false)
    await click("Unmute")
    expect(mocks.self.enableAudio).toHaveBeenCalledTimes(2)
    expect(mocks.self.audioEnabled).toBe(true)
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
    await click("Background & Settings")
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

  it("pauses a live camera while stronger cleanup replaces the mask pipeline", async () => {
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
    await click("Background & Settings")
    const label = [...document.body.querySelectorAll("label")].find((item) =>
      item.textContent?.includes("Stronger background cleanup")
    )
    const checkbox = label?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )
    if (!checkbox) throw new Error("Cleanup option not found")
    await act(async () => {
      checkbox.click()
      await Promise.resolve()
    })
    expect(checkbox.checked).toBe(true)
    expect(
      JSON.parse(localStorage.getItem(talkPreferencesKey("test-user")) ?? "{}")
        .backgroundCleanup
    ).toBe("strong")
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    expect(mocks.self.disableVideo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.self.removeVideoMiddleware.mock.invocationCallOrder[0] ?? 0
    )
    expect(
      mocks.self.addVideoMiddleware.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.self.enableVideo.mock.invocationCallOrder[1] ?? 0)
    expect(mocks.self.videoEnabled).toBe(true)
    await act(async () => {
      checkbox.click()
      await Promise.resolve()
    })
    expect(checkbox.checked).toBe(false)
    expect(mocks.self.disableVideo).toHaveBeenCalledTimes(2)
    expect(mocks.self.videoEnabled).toBe(true)
  })

  it("offers the alternate microphone method when the browser microphone will not start", async () => {
    await render()
    await click("Join meeting")
    // Neither the application track nor the automatic SDK retry enables audio.
    mocks.self.enableAudio.mockImplementationOnce(async () => {})
    mocks.self.enableAudio.mockImplementationOnce(async () => {})
    await click("Unmute microphone")
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("could not turn it on")
    await click("Try alternate microphone method")
    expect(mocks.self.audioEnabled).toBe(true)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Mute microphone"]')).not.toBeNull()
  })

  it("keeps an error visible until dismissed and retries from it", async () => {
    await render()
    await click("Join meeting")
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValueOnce(
      new DOMException("busy", "NotReadableError")
    )
    await click("Unmute microphone")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already in use")
    await click("Try again")
    expect(mocks.self.audioEnabled).toBe(true)
    await click("Mute microphone")
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValueOnce(
      new DOMException("busy", "NotReadableError")
    )
    await click("Unmute microphone")
    await click("Dismiss message")
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it("shows host-only controls in More only to hosts and omits developer tools", async () => {
    await render()
    await click("Join meeting")
    const menu = (): string => container.querySelector('[data-testid="more-menu"]')?.textContent ?? ""
    expect(menu()).toContain("Polls")
    expect(menu()).toContain("Fullscreen")
    expect(menu()).not.toContain("Mute all")
    expect(menu()).not.toContain("Recording")

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.self.permissions.kickParticipant = true
    mocks.self.roomJoined = false
    await render()
    await click("Join meeting")
    expect(menu()).toContain("Mute all")
    expect(menu()).toContain("Recording")
  })

  it("remembers whether Notes & Transcript is open and starts collapsed in smaller windows", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }))
    await render()
    await click("Join meeting")
    expect(container.querySelector<HTMLElement>("#talk-notes-transcript")?.hidden).toBe(true)
    await click("Show Notes & Transcript")
    expect(localStorage.getItem("compass:talk:notes-panel:v1:test-user")).toBe("open")

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.self.roomJoined = false
    await render()
    await click("Join meeting")
    expect(container.querySelector<HTMLElement>("#talk-notes-transcript")?.hidden).toBe(false)
  })

  it("restarts a live camera once per blur slider adjustment", async () => {
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
    await click("Background & Settings")
    const slider = document.body.querySelector<HTMLInputElement>('input[type="range"]')
    if (!slider) throw new Error("Blur slider not found")
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    const drag = async (value: string): Promise<void> => {
      await act(async () => {
        setValue?.call(slider, value)
        slider.dispatchEvent(new Event("input", { bubbles: true }))
        await Promise.resolve()
      })
    }
    for (const value of ["50", "60", "70", "80"]) await drag(value)
    expect(document.body.textContent).toContain("Blur strength: 80%")
    expect(mocks.self.disableVideo).not.toHaveBeenCalled()
    await act(async () => {
      slider.dispatchEvent(new Event("pointerup", { bubbles: true }))
      await Promise.resolve()
    })
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    expect(
      JSON.parse(localStorage.getItem(talkPreferencesKey("test-user")) ?? "{}").background
    ).toEqual({ mode: "blur", strength: 80 })

    // Keyboard steps commit after a pause instead of on every step.
    await drag("90")
    expect(mocks.self.disableVideo).toHaveBeenCalledOnce()
    const pending = vi.mocked(window.setTimeout).mock.calls.filter(([, delay]) => delay === 400)
    const commit = pending.at(-1)?.[0]
    if (typeof commit !== "function") throw new Error("Missing slider commit timer")
    await act(async () => {
      commit()
      await Promise.resolve()
    })
    expect(mocks.self.disableVideo).toHaveBeenCalledTimes(2)
  })

  it("keeps a bounded diagnostic trail", async () => {
    Reflect.deleteProperty(window, "__compassRealtimeKitDiagnostics")
    vi.spyOn(console, "info").mockImplementation(() => {})
    await render()
    const audioUpdate = mocks.self.on.mock.calls.find(([event]) => event === "audioUpdate")?.[1]
    if (typeof audioUpdate !== "function") throw new Error("Missing audioUpdate handler")
    await act(async () => {
      for (let index = 0; index < 75; index += 1) audioUpdate({ audioEnabled: index % 2 === 0 })
    })
    const diagnostics = Reflect.get(window, "__compassRealtimeKitDiagnostics")
    expect(Array.isArray(diagnostics) ? diagnostics.length : 0).toBe(50)
    expect(document.documentElement.hasAttribute("data-compass-realtimekit-diagnostics")).toBe(false)
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
